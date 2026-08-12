import { prisma } from "@gitpulse/db";
import {
  getContributorAnalysisQueue,
  getFileParsingQueue
} from "@gitpulse/queue";
import { redisConnection } from "@gitpulse/queue";
import { Redis } from "ioredis";
import pino from "pino";
import { Counter, Histogram, register } from "prom-client";
import { GitHubClient, type GitHubIssue, type GitHubPullRequest } from "./github-client.js";

const logger = pino({ name: "gitpulse-ingestion" });
const ingestionJobsTotal =
  (register.getSingleMetric("gitpulse_ingestion_jobs_total") as
    | Counter<string>
    | undefined) ??
  new Counter({
    name: "gitpulse_ingestion_jobs_total",
    help: "Total ingestion jobs",
    labelNames: ["status"]
  });
const ingestionDurationSeconds =
  (register.getSingleMetric("gitpulse_ingestion_duration_seconds") as
    | Histogram<string>
    | undefined) ??
  new Histogram({
    name: "gitpulse_ingestion_duration_seconds",
    help: "Ingestion duration",
    buckets: [1, 5, 10, 30, 60, 120, 300]
  });
let redis: Redis | null = null;

const getRedis = (): Redis => {
  redis ??= new Redis({
    ...redisConnection,
    enableOfflineQueue: true,
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null
  });

  redis.on("error", (error) => {
    logger.warn(
      { error: error.message || error.name || "connection failed" },
      "redis cache unavailable"
    );
  });

  return redis;
};

const observeIngestion = (status: string, durationMs: number): void => {
  try {
    ingestionJobsTotal.inc({ status });
    ingestionDurationSeconds.observe(durationMs / 1000);
  } catch {
    return;
  }
};

const invalidateCachePattern = async (pattern: string): Promise<void> => {
  const keys: string[] = [];

  try {
    const client = getRedis();
    const stream = client.scanStream({ match: pattern, count: 100 });

    for await (const chunk of stream) {
      if (Array.isArray(chunk)) {
        keys.push(...chunk.filter((key): key is string => typeof key === "string"));
      }
    }

    if (keys.length > 0) {
      await client.del(...keys, ...keys.map((key) => `${key}:stale`));
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown Redis error";
    logger.warn({ pattern, error: message }, "failed to invalidate cache pattern");
  }
};
const MAX_FILE_BYTES = 500 * 1024;

interface ParsedGitHubUrl {
  owner: string;
  name: string;
}

const parseGitHubUrl = (githubUrl: string): ParsedGitHubUrl => {
  const url = new URL(githubUrl);

  if (url.hostname !== "github.com") {
    throw new Error("Repository URL must be on github.com");
  }

  const [owner, rawName] = url.pathname.split("/").filter(Boolean);
  const name = rawName?.replace(/\.git$/, "");

  if (owner === undefined || name === undefined) {
    throw new Error("Repository URL must include owner and name");
  }

  return { owner, name };
};

const shouldSkipPath = (path: string): boolean => {
  return (
    path.startsWith("node_modules/") ||
    path.startsWith(".git/") ||
    path.startsWith("dist/") ||
    path.startsWith("build/") ||
    path.endsWith(".min.js") ||
    path.endsWith(".lock") ||
    path.endsWith("package-lock.json") ||
    path.endsWith("pnpm-lock.yaml")
  );
};

const isBinary = (content: Buffer): boolean => {
  return content.subarray(0, 8_000).includes(0);
};

const detectLanguage = (path: string): string => {
  const extension = path.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "py":
      return "python";
    case "go":
      return "go";
    case "rs":
      return "rust";
    case "java":
      return "java";
    case "cs":
      return "csharp";
    case "rb":
      return "ruby";
    case "php":
      return "php";
    default:
      return "unknown";
  }
};

const isUpdatedSince = (
  item: { updatedAt: Date | null },
  since: Date | undefined
): boolean => {
  return since === undefined || item.updatedAt === null || item.updatedAt >= since;
};

const errorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : "Unknown ingestion error";
};

const jsonRecord = (value: unknown): Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

export class IngestionService {
  private readonly githubClient: GitHubClient;
  private readonly hasGitHubToken: boolean;

  public constructor(githubToken = process.env.GITHUB_TOKEN) {
    this.githubClient = new GitHubClient(githubToken);
    this.hasGitHubToken = (githubToken?.trim().length ?? 0) > 0;
  }

  public async ingestRepo(
    repoId: string,
    githubUrl: string,
    isIncremental: boolean,
    updateProgress?: (percentage: number) => Promise<void>
  ): Promise<void> {
    let ingestionJobId: string | null = null;
    const startedAt = Date.now();

    try {
      const { owner, name } = parseGitHubUrl(githubUrl);
      logger.info({ repoId, step: "start", isIncremental }, "ingestion started");

      await prisma.repository.update({
        where: { id: repoId },
        data: { status: "indexing" }
      });

      const pendingJob = await prisma.ingestionJob.findFirst({
        where: { repoId, status: "pending" },
        orderBy: { createdAt: "desc" }
      });
      const ingestionJob =
        pendingJob === null
          ? await prisma.ingestionJob.create({
              data: {
                repoId,
                status: "running",
                startedAt: new Date(),
                metadata: { isIncremental, stage: "fetching" }
              }
            })
          : await prisma.ingestionJob.update({
              where: { id: pendingJob.id },
              data: {
                status: "running",
                startedAt: new Date(),
                metadata: { isIncremental, stage: "fetching" }
              }
            });
      ingestionJobId = ingestionJob.id;

      const repository = await prisma.repository.findUniqueOrThrow({
        where: { id: repoId }
      });
      const since =
        isIncremental && repository.lastSyncedAt !== null
          ? repository.lastSyncedAt
          : undefined;

      const repoMetadata = await this.githubClient.getRepo(owner, name);
      logger.info({ repoId, step: "repo_metadata", itemCount: 1 }, "ingestion step complete");
      await updateProgress?.(20);
      const commitCount = this.hasGitHubToken
        ? await this.upsertCommits(repoId, owner, name, since)
        : 0;
      logger.info(
        { repoId, step: "commits", itemCount: commitCount },
        "ingestion step complete"
      );
      await updateProgress?.(35);
      const pullRequestCount = this.hasGitHubToken
        ? await this.upsertPullRequests(repoId, owner, name, since)
        : 0;
      logger.info(
        { repoId, step: "pull_requests", itemCount: pullRequestCount },
        "ingestion step complete"
      );
      await updateProgress?.(50);
      const issueCount = this.hasGitHubToken
        ? await this.upsertIssues(repoId, owner, name, since)
        : 0;
      logger.info(
        { repoId, step: "issues", itemCount: issueCount },
        "ingestion step complete"
      );
      await updateProgress?.(65);
      const contributorCount = this.hasGitHubToken
        ? await this.upsertContributors(repoId, owner, name)
        : 0;
      logger.info(
        { repoId, step: "contributors", itemCount: contributorCount },
        "ingestion step complete"
      );
      await updateProgress?.(80);
      const fileCount = await this.upsertFiles(repoId, owner, name, repoMetadata.defaultBranch);
      logger.info(
        { repoId, step: "files", itemCount: fileCount },
        "ingestion step complete"
      );
      await updateProgress?.(90);

      const fetchedAt = new Date();

      await prisma.repository.update({
        where: { id: repoId },
        data: {
          status: fileCount === 0 ? "ready" : "indexing",
          lastSyncedAt: fetchedAt,
          metadata: {
            ...jsonRecord(repository.metadata),
            githubId: repoMetadata.id,
            fullName: repoMetadata.fullName,
            defaultBranch: repoMetadata.defaultBranch,
            private: repoMetadata.private,
            description: repoMetadata.description,
            indexedFileCount: fileCount,
            analyticsMode: this.hasGitHubToken ? "full" : "code-only"
          }
        }
      });

      await prisma.ingestionJob.update({
        where: { id: ingestionJobId },
        data: {
          status: fileCount === 0 ? "completed" : "running",
          completedAt: fileCount === 0 ? fetchedAt : null,
          metadata: {
            isIncremental,
            stage: fileCount === 0 ? "completed" : "indexing",
            fileCount
          }
        }
      });

      await Promise.all([
        invalidateCachePattern(`gitpulse:arch:${repoId}`),
        invalidateCachePattern(`gitpulse:contrib:${repoId}`),
        invalidateCachePattern(`gitpulse:busf:${repoId}`),
        invalidateCachePattern(`gitpulse:stats:${repoId}`),
        invalidateCachePattern("gitpulse:search:*")
      ]);
      await getContributorAnalysisQueue().add("analyze-contributors", { repoId });
      observeIngestion("completed", Date.now() - startedAt);
      logger.info(
        {
          repoId,
          step: "completed",
          itemCount: fileCount,
          durationMs: Date.now() - startedAt
        },
        "repository fetched; indexing queued"
      );
    } catch (error: unknown) {
      const message = errorMessage(error);
      logger.error({ repoId, githubUrl, error: message }, "ingestion failed");

      await prisma.repository.update({
        where: { id: repoId },
        data: { status: "failed" }
      });

      if (ingestionJobId !== null) {
        await prisma.ingestionJob.update({
          where: { id: ingestionJobId },
          data: {
            status: "failed",
            completedAt: new Date(),
            error: message
          }
        });
      }
      observeIngestion("failed", Date.now() - startedAt);
      throw error;
    }
  }

  private async upsertCommits(
    repoId: string,
    owner: string,
    name: string,
    since?: Date
  ): Promise<number> {
    const commits = await this.githubClient.getCommits(owner, name, since);

    for (const commit of commits) {
      await prisma.commit.upsert({
        where: {
          repoId_sha: {
            repoId,
            sha: commit.sha
          }
        },
        create: {
          repoId,
          sha: commit.sha,
          message: commit.message,
          author: commit.author,
          timestamp: commit.timestamp,
          filesChanged: commit.filesChanged ?? undefined
        },
        update: {
          message: commit.message,
          author: commit.author,
          timestamp: commit.timestamp,
          filesChanged: commit.filesChanged ?? undefined
        }
      });
    }

    return commits.length;
  }

  private async upsertPullRequests(
    repoId: string,
    owner: string,
    name: string,
    since?: Date
  ): Promise<number> {
    const pullRequests = (await this.githubClient.getPullRequests(
      owner,
      name,
      "all"
    )).filter((pullRequest: GitHubPullRequest) =>
      isUpdatedSince(pullRequest, since)
    );

    for (const pullRequest of pullRequests) {
      await prisma.pullRequest.upsert({
        where: {
          repoId_number: {
            repoId,
            number: pullRequest.number
          }
        },
        create: {
          repoId,
          number: pullRequest.number,
          title: pullRequest.title,
          body: pullRequest.body,
          author: pullRequest.author,
          status: pullRequest.status,
          diff: pullRequest.diff,
          metadata: pullRequest.metadata
        },
        update: {
          title: pullRequest.title,
          body: pullRequest.body,
          author: pullRequest.author,
          status: pullRequest.status,
          diff: pullRequest.diff,
          metadata: pullRequest.metadata
        }
      });
    }

    return pullRequests.length;
  }

  private async upsertIssues(
    repoId: string,
    owner: string,
    name: string,
    since?: Date
  ): Promise<number> {
    const issues = (await this.githubClient.getIssues(owner, name)).filter(
      (issue: GitHubIssue) => isUpdatedSince(issue, since)
    );

    for (const issue of issues) {
      await prisma.issue.upsert({
        where: {
          repoId_number: {
            repoId,
            number: issue.number
          }
        },
        create: {
          repoId,
          number: issue.number,
          title: issue.title,
          body: issue.body,
          labels: issue.labels
        },
        update: {
          title: issue.title,
          body: issue.body,
          labels: issue.labels
        }
      });
    }

    return issues.length;
  }

  private async upsertContributors(
    repoId: string,
    owner: string,
    name: string
  ): Promise<number> {
    const contributors = await this.githubClient.getContributors(owner, name);

    for (const contributor of contributors) {
      await prisma.contributor.upsert({
        where: {
          repoId_login: {
            repoId,
            login: contributor.login
          }
        },
        create: {
          repoId,
          login: contributor.login,
          commitCount: contributor.commitCount,
          linesAdded: contributor.linesAdded,
          linesRemoved: contributor.linesRemoved
        },
        update: {
          commitCount: contributor.commitCount,
          linesAdded: contributor.linesAdded,
          linesRemoved: contributor.linesRemoved
        }
      });
    }

    return contributors.length;
  }

  private async upsertFiles(
    repoId: string,
    owner: string,
    name: string,
    branch: string
  ): Promise<number> {
    const archiveFiles = await this.githubClient.downloadRepositoryArchive(
      owner,
      name,
      branch
    );
    const parseJobs: Array<{
      name: string;
      data: {
        repoId: string;
        fileId: string;
        path: string;
        language: string;
      };
    }> = [];

    for (const file of archiveFiles) {
      if (
        shouldSkipPath(file.path) ||
        file.size > MAX_FILE_BYTES ||
        isBinary(file.content)
      ) {
        continue;
      }

      const content = file.content.toString("utf8");
      const language = detectLanguage(file.path);
      const codeFile = await prisma.codeFile.upsert({
        where: {
          repoId_path: {
            repoId,
            path: file.path
          }
        },
        create: {
          repoId,
          path: file.path,
          language,
          content,
          lastModified: new Date()
        },
        update: {
          language,
          content,
          lastModified: new Date(),
          indexedAt: null
        }
      });

      parseJobs.push({
        name: "parse-file",
        data: {
          repoId,
          fileId: codeFile.id,
          path: file.path,
          language
        }
      });
    }

    if (parseJobs.length > 0) {
      // Queue only after every current file has been marked unindexed. This
      // prevents a fast worker from declaring the repository ready while the
      // ingestion loop is still discovering later files.
      await getFileParsingQueue().addBulk(parseJobs);
    }

    return parseJobs.length;
  }
}
