import { Octokit } from "@octokit/rest";
import { gunzipSync } from "node:zlib";

// Pause only when the current request exhausts the unauthenticated allowance.
// Repository contents use one archive request, so reserving several calls
// would unnecessarily stall otherwise viable public-repository ingestion.
const RATE_LIMIT_FLOOR = 1;
const MAX_RETRIES = 3;

export interface GitHubRepoMetadata {
  id: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  htmlUrl: string;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  timestamp: Date;
  filesChanged: string[] | null;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  author: string;
  status: string;
  diff: string | null;
  metadata: Record<string, string | number | boolean | null>;
  updatedAt: Date | null;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  labels: Array<string>;
  updatedAt: Date | null;
}

export interface GitHubTreeFile {
  path: string;
  size: number | null;
  sha: string | null;
}

export interface GitHubArchiveFile {
  path: string;
  size: number;
  content: Buffer;
}

export interface GitHubContributorStats {
  login: string;
  commitCount: number;
  linesAdded: number;
  linesRemoved: number;
}

interface GitHubResponseHeaders {
  "x-ratelimit-remaining"?: string | number;
  "x-ratelimit-reset"?: string | number;
}

interface RequestLikeError {
  status: number;
  response?: {
    headers?: GitHubResponseHeaders;
  };
}

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const isRequestLikeError = (error: unknown): error is RequestLikeError => {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  );
};

const parseHeaderInt = (value: string | number | undefined): number | null => {
  if (value === undefined) {
    return null;
  }

  const parsed =
    typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

export class GitHubClient {
  private readonly octokit: Octokit;
  private readonly token: string | undefined;

  public constructor(token: string | undefined) {
    const normalizedToken = token?.trim();
    this.token =
      normalizedToken === undefined || normalizedToken.length === 0
        ? undefined
        : normalizedToken;
    this.octokit = new Octokit({
      auth: this.token
    });

    this.octokit.hook.after("request", async (response) => {
      await this.pauseIfRateLimitIsLow(response.headers);
    });
  }

  public async getRepo(
    owner: string,
    name: string
  ): Promise<GitHubRepoMetadata> {
    const response = await this.withRetry(() =>
      this.octokit.rest.repos.get({ owner, repo: name })
    );

    return {
      id: response.data.id,
      fullName: response.data.full_name,
      defaultBranch: response.data.default_branch,
      private: response.data.private,
      description: response.data.description,
      htmlUrl: response.data.html_url
    };
  }

  public async getCommits(
    owner: string,
    name: string,
    since?: Date
  ): Promise<GitHubCommit[]> {
    const commits = await this.withRetry(() =>
      this.octokit.paginate(this.octokit.rest.repos.listCommits, {
        owner,
        repo: name,
        since: since?.toISOString(),
        per_page: 100
      })
    );

    return commits.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.author?.login ?? commit.commit.author?.name ?? "unknown",
      timestamp: new Date(commit.commit.author?.date ?? commit.commit.committer?.date ?? Date.now()),
      filesChanged: null
    }));
  }

  public async getPullRequests(
    owner: string,
    name: string,
    state: "open" | "closed" | "all"
  ): Promise<GitHubPullRequest[]> {
    const pullRequests = await this.withRetry(() =>
      this.octokit.paginate(this.octokit.rest.pulls.list, {
        owner,
        repo: name,
        state,
        per_page: 100
      })
    );

    return Promise.all(
      pullRequests.map(async (pullRequest) => ({
        number: pullRequest.number,
        title: pullRequest.title,
        body: pullRequest.body,
        author: pullRequest.user?.login ?? "unknown",
        status: pullRequest.state,
        diff: await this.getPullRequestDiff(owner, name, pullRequest.number),
        metadata: {
          htmlUrl: pullRequest.html_url,
          mergedAt: pullRequest.merged_at,
          updatedAt: pullRequest.updated_at
        },
        updatedAt:
          pullRequest.updated_at === null
            ? null
            : new Date(pullRequest.updated_at)
      }))
    );
  }

  public async getIssues(owner: string, name: string): Promise<GitHubIssue[]> {
    const issues = await this.withRetry(() =>
      this.octokit.paginate(this.octokit.rest.issues.listForRepo, {
        owner,
        repo: name,
        state: "all",
        per_page: 100
      })
    );

    return issues
      .filter((issue) => issue.pull_request === undefined)
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body ?? null,
        labels: issue.labels.map((label) =>
          typeof label === "string" ? label : label.name ?? ""
        ),
        updatedAt: issue.updated_at === null ? null : new Date(issue.updated_at)
      }));
  }

  public async getFileTree(
    owner: string,
    name: string,
    branch: string
  ): Promise<GitHubTreeFile[]> {
    const response = await this.withRetry(() =>
      this.octokit.rest.git.getTree({
        owner,
        repo: name,
        tree_sha: branch,
        recursive: "1"
      })
    );

    return response.data.tree
      .filter((entry) => entry.type === "blob" && entry.path !== undefined)
      .map((entry) => ({
        path: entry.path ?? "",
        size: entry.size ?? null,
        sha: entry.sha ?? null
      }));
  }

  public async getFileContent(
    owner: string,
    name: string,
    path: string
  ): Promise<string> {
    const response = await this.withRetry(() =>
      this.octokit.rest.repos.getContent({
        owner,
        repo: name,
        path
      })
    );

    if (Array.isArray(response.data) || response.data.type !== "file") {
      return "";
    }

    if (response.data.encoding !== "base64") {
      return response.data.content;
    }

    return Buffer.from(response.data.content, "base64").toString("utf8");
  }

  public async downloadRepositoryArchive(
    owner: string,
    name: string,
    branch: string
  ): Promise<GitHubArchiveFile[]> {
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tarball/${encodeURIComponent(branch)}`,
      {
        redirect: "follow",
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "gitpulse",
          "x-github-api-version": "2022-11-28",
          ...(this.token === undefined
            ? {}
            : { authorization: `Bearer ${this.token}` })
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `GitHub archive download failed with status ${response.status}`
      );
    }

    const archive = Buffer.from(await response.arrayBuffer());
    const tar =
      archive[0] === 0x1f && archive[1] === 0x8b
        ? gunzipSync(archive)
        : archive;

    return parseTarFiles(tar);
  }

  public async getContributors(
    owner: string,
    name: string
  ): Promise<GitHubContributorStats[]> {
    // Contributor statistics is a computed, non-paginated endpoint. Passing it
    // through Octokit's paginator can flatten the response incorrectly.
    const response = await this.withRetry(() =>
      this.octokit.rest.repos.getContributorsStats({
        owner,
        repo: name
      })
    );
    const contributors = Array.isArray(response.data) ? response.data : [];

    return contributors.map((contributor) => {
      const weeks = contributor.weeks ?? [];

      return {
        login: contributor.author?.login ?? "unknown",
        commitCount: contributor.total,
        linesAdded: weeks.reduce(
          (total, week) => total + (week.a ?? 0),
          0
        ),
        linesRemoved: weeks.reduce(
          (total, week) => total + (week.d ?? 0),
          0
        )
      };
    });
  }

  private async getPullRequestDiff(
    owner: string,
    name: string,
    pullNumber: number
  ): Promise<string | null> {
    const response = await this.withRetry(() =>
      this.octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner,
        repo: name,
        pull_number: pullNumber,
        mediaType: {
          format: "diff"
        }
      })
    );

    return typeof response.data === "string" ? response.data : null;
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        return await operation();
      } catch (error: unknown) {
        attempt += 1;

        if (!this.shouldRetry(error, attempt)) {
          throw error;
        }

        const backoffMs = 2 ** attempt * 1000;
        await sleep(backoffMs);
      }
    }
  }

  private shouldRetry(error: unknown, attempt: number): boolean {
    if (!isRequestLikeError(error) || attempt > MAX_RETRIES) {
      return false;
    }

    return error.status === 429 || error.status >= 500;
  }

  private async pauseIfRateLimitIsLow(
    headers: GitHubResponseHeaders | undefined
  ): Promise<void> {
    const remaining = parseHeaderInt(headers?.["x-ratelimit-remaining"]);

    if (remaining === null || remaining >= RATE_LIMIT_FLOOR) {
      return;
    }

    const resetSeconds = parseHeaderInt(headers?.["x-ratelimit-reset"]);
    if (resetSeconds === null) {
      return;
    }

    const delayMs = Math.max(resetSeconds * 1000 - Date.now(), 0);
    await sleep(delayMs);
  }
}

const tarString = (buffer: Buffer, start: number, length: number): string => {
  return buffer
    .subarray(start, start + length)
    .toString("utf8")
    .replace(/\0.*$/s, "")
    .trim();
};

const tarSize = (buffer: Buffer, offset: number): number => {
  const value = tarString(buffer, offset + 124, 12);
  const parsed = Number.parseInt(value, 8);
  return Number.isFinite(parsed) ? parsed : 0;
};

const stripArchiveRoot = (archivePath: string): string => {
  return archivePath.split("/").slice(1).join("/");
};

export const parseTarFiles = (tar: Buffer): GitHubArchiveFile[] => {
  const files: GitHubArchiveFile[] = [];
  let offset = 0;
  let pendingLongName: string | null = null;

  while (offset + 512 <= tar.length) {
    const name = tarString(tar, offset, 100);
    if (name.length === 0) {
      break;
    }

    const prefix = tarString(tar, offset + 345, 155);
    const type = tarString(tar, offset + 156, 1);
    const size = tarSize(tar, offset);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    const headerPath = prefix.length > 0 ? `${prefix}/${name}` : name;

    if (type === "L") {
      pendingLongName = tar
        .subarray(contentStart, contentEnd)
        .toString("utf8")
        .replace(/\0.*$/s, "")
        .trim();
    } else if (type === "" || type === "0") {
      const path = stripArchiveRoot(pendingLongName ?? headerPath);
      pendingLongName = null;

      if (path.length > 0) {
        files.push({
          path,
          size,
          content: tar.subarray(contentStart, contentEnd)
        });
      }
    } else {
      pendingLongName = null;
    }

    offset = contentStart + Math.ceil(size / 512) * 512;
  }

  return files;
};
