import { Octokit } from "@octokit/rest";

const RATE_LIMIT_FLOOR = 100;
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

  public constructor(token: string | undefined) {
    this.octokit = new Octokit({
      auth: token === undefined || token.length === 0 ? undefined : token
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

  public async getContributors(
    owner: string,
    name: string
  ): Promise<GitHubContributorStats[]> {
    const contributors = await this.withRetry(() =>
      this.octokit.paginate(this.octokit.rest.repos.getContributorsStats, {
        owner,
        repo: name
      })
    );

    return contributors.map((contributor) => ({
      login: contributor.author?.login ?? "unknown",
      commitCount: contributor.total,
      linesAdded: contributor.weeks.reduce(
        (total, week) => total + (week.a ?? 0),
        0
      ),
      linesRemoved: contributor.weeks.reduce(
        (total, week) => total + (week.d ?? 0),
        0
      )
    }));
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
