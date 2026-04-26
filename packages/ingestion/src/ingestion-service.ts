import { prisma } from "@gitpulse/db";
import {
  getContributorAnalysisQueue,
  getFileParsingQueue
} from "@gitpulse/queue";
import { redisConnection } from "@gitpulse/queue";
import { Redis } from "ioredis";
import pino from "pino";
import { GitHubClient, type GitHubIssue, type GitHubPullRequest } from "./github-client.js";

const logger = pino({ name: "gitpulse-ingestion" });
let redis: Redis | null = null;

const getRedis = (): Redis => {
  redis ??= new Redis({
    ...redisConnection,
    enableOfflineQueue: false,
    lazyConnect: true,
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

const invalidateArchitectureCache = async (repoId: string): Promise<void> => {
  try {
    await getRedis().del(`gitpulse:arch:${repoId}`);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown Redis error";
    logger.warn({ repoId, error: message }, "failed to invalidate architecture cache");
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
    path.endsWith(".lock")
  );
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

export class IngestionService {
  private readonly githubClient: GitHubClient;

  public constructor(githubToken = process.env.GITHUB_TOKEN) {
    this.githubClient = new GitHubClient(githubToken);
  }

  public async ingestRepo(
    repoId: string,
    githubUrl: string,
    isIncremental: boolean,
    updateProgress?: (percentage: number) => Promise<void>
  ): Promise<void> {
    let ingestionJobId: string | null = null;

    try {
      const { owner, name } = parseGitHubUrl(githubUrl);

      await prisma.repository.update({
        where: { id: repoId },
        data: { status: "indexing" }
      });

      const ingestionJob = await prisma.ingestionJob.create({
        data: {
          repoId,
          status: "running",
          startedAt: new Date(),
          metadata: { isIncremental }
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
      await updateProgress?.(20);
      await this.upsertCommits(repoId, owner, name, since);
      await updateProgress?.(35);
      await this.upsertPullRequests(repoId, owner, name, since);
      await updateProgress?.(50);
      await this.upsertIssues(repoId, owner, name, since);
      await updateProgress?.(65);
      await this.upsertContributors(repoId, owner, name);
      await updateProgress?.(80);
      await this.upsertFiles(repoId, owner, name, repoMetadata.defaultBranch);
      await updateProgress?.(90);

      const completedAt = new Date();

      await prisma.repository.update({
        where: { id: repoId },
        data: {
          status: "ready",
          lastSyncedAt: completedAt,
          metadata: {
            githubId: repoMetadata.id,
            fullName: repoMetadata.fullName,
            defaultBranch: repoMetadata.defaultBranch,
            private: repoMetadata.private,
            description: repoMetadata.description
          }
        }
      });

      await prisma.ingestionJob.update({
        where: { id: ingestionJobId },
        data: {
          status: "completed",
          completedAt
        }
      });

      await invalidateArchitectureCache(repoId);
      await getContributorAnalysisQueue().add("analyze-contributors", { repoId });
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
    }
  }

  private async upsertCommits(
    repoId: string,
    owner: string,
    name: string,
    since?: Date
  ): Promise<void> {
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
  }

  private async upsertPullRequests(
    repoId: string,
    owner: string,
    name: string,
    since?: Date
  ): Promise<void> {
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
  }

  private async upsertIssues(
    repoId: string,
    owner: string,
    name: string,
    since?: Date
  ): Promise<void> {
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
  }

  private async upsertContributors(
    repoId: string,
    owner: string,
    name: string
  ): Promise<void> {
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
  }

  private async upsertFiles(
    repoId: string,
    owner: string,
    name: string,
    branch: string
  ): Promise<void> {
    const tree = await this.githubClient.getFileTree(owner, name, branch);

    for (const file of tree) {
      if (
        shouldSkipPath(file.path) ||
        (file.size !== null && file.size > MAX_FILE_BYTES)
      ) {
        continue;
      }

      const content = await this.githubClient.getFileContent(
        owner,
        name,
        file.path
      );
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
          lastModified: new Date()
        }
      });

      await getFileParsingQueue().add("parse-file", {
        repoId,
        fileId: codeFile.id,
        path: file.path,
        language
      });
    }
  }
}
