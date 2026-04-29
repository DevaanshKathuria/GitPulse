import { prisma } from "@gitpulse/db";
import { DependencyGraphBuilder } from "@gitpulse/parser";
import {
  getContributorAnalysisQueue,
  getPrAnalysisQueue,
  getRepoIngestionQueue
} from "@gitpulse/queue";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { AppError } from "../errors.js";
import { cache } from "../lib/cache.js";
import { CacheKeys } from "../lib/cache-keys.js";
import { ContributorIntelligenceService } from "../services/contributor-intelligence.js";

export const reposRouter = Router();
const architectureCacheTtlSeconds = 60 * 60;
const contributorCacheTtlSeconds = 6 * 60 * 60;
const repoStatsCacheTtlSeconds = 5 * 60;

const createRepoSchema = z.object({
  githubUrl: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return url.hostname === "github.com";
    }, "URL must be a github.com URL")
});

const parseGithubOwnerName = (
  githubUrl: string
): { owner: string; name: string } => {
  const url = new URL(githubUrl);
  const [owner, rawName] = url.pathname.split("/").filter(Boolean);
  const name = rawName?.replace(/\.git$/, "");

  if (owner === undefined || name === undefined) {
    throw new AppError("GitHub URL must include owner and repository name", 400);
  }

  return { owner, name };
};

const getRouteParam = (value: string | string[] | undefined): string => {
  if (typeof value !== "string") {
    throw new AppError("Invalid route parameter", 400);
  }

  return value;
};

const firstQueryValue = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return undefined;
};

const parsePositiveInteger = (
  value: unknown,
  fallback: number,
  max = 100
): number => {
  const raw = firstQueryValue(value);
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, max);
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const breakingChangesFromMetadata = (metadata: unknown): unknown[] => {
  if (!isObject(metadata) || !Array.isArray(metadata.breakingChanges)) {
    return [];
  }

  return metadata.breakingChanges;
};

const ownedFilesCount = (ownedFiles: unknown): number => {
  return Array.isArray(ownedFiles) ? ownedFiles.length : 0;
};

const contributorAnalyticsFromMetadata = (
  metadata: unknown
): {
  overall: number;
  byDirectory: Record<string, { busFactor: number; owners: string[] }>;
  risks: unknown[];
} | null => {
  if (!isObject(metadata) || !isObject(metadata.contributorAnalytics)) {
    return null;
  }

  const analytics = metadata.contributorAnalytics;
  if (
    typeof analytics.overall !== "number" ||
    !isObject(analytics.byDirectory) ||
    !Array.isArray(analytics.risks)
  ) {
    return null;
  }

  return {
    overall: analytics.overall,
    byDirectory: analytics.byDirectory as Record<
      string,
      { busFactor: number; owners: string[] }
    >,
    risks: analytics.risks
  };
};

reposRouter.post(
  "/api/v1/repos",
  async (request: Request, response: Response): Promise<void> => {
    const parsed = createRepoSchema.safeParse(request.body);

    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message ?? "Invalid body", 400);
    }

    const { owner, name } = parseGithubOwnerName(parsed.data.githubUrl);
    const repository = await prisma.repository.create({
      data: {
        githubUrl: parsed.data.githubUrl,
        owner,
        name
      }
    });

    await prisma.ingestionJob.create({
      data: {
        repoId: repository.id,
        status: "pending",
        metadata: { source: "api" }
      }
    });

    await getRepoIngestionQueue().add("ingest-repo", {
      repoId: repository.id,
      githubUrl: repository.githubUrl,
      isIncremental: false
    });

    response.status(201).json({ id: repository.id });
  }
);

reposRouter.get(
  "/api/v1/repos",
  async (_request: Request, response: Response): Promise<void> => {
    const repositories = await prisma.repository.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        ingestionJobs: {
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    response.status(200).json(
      repositories.map((repository) => ({
        ...repository,
        latestIngestionJob: repository.ingestionJobs[0] ?? null,
        ingestionJobs: undefined
      }))
    );
  }
);

reposRouter.get(
  "/api/v1/repos/:id/architecture",
  async (request: Request, response: Response): Promise<void> => {
    const repoId = getRouteParam(request.params.id);
    const cacheKey = CacheKeys.architecture(repoId);
    const cached = await cache.get<unknown>(cacheKey);

    if (cached !== null) {
      response.status(200).json(cached);
      return;
    }

    const graph = await new DependencyGraphBuilder().buildForRepo(repoId);
    const body = {
      ...graph,
      stats: {
        totalFiles: graph.nodes.length,
        totalEdges: graph.edges.length,
        circularCount: graph.circularDependencies.length,
        unusedCount: graph.unusedFiles.length
      }
    };

    await cache.set(cacheKey, body, {
      ttl: architectureCacheTtlSeconds,
      staleWhileRevalidate: true
    });
    response.status(200).json(body);
  }
);

reposRouter.get(
  "/api/v1/repos/:id/prs",
  async (request: Request, response: Response): Promise<void> => {
    const repoId = getRouteParam(request.params.id);
    const page = parsePositiveInteger(request.query.page, 1);
    const limit = parsePositiveInteger(request.query.limit, 20);
    const pullRequests = await prisma.pullRequest.findMany({
      where: { repoId },
      orderBy: [{ riskScore: "desc" }, { updatedAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit
    });

    response.status(200).json({
      page,
      limit,
      items: pullRequests.map((pr) => ({
        id: pr.id,
        number: pr.number,
        title: pr.title,
        author: pr.author,
        status: pr.status,
        riskScore: pr.riskScore,
        summary:
          pr.summary === null || pr.summary.length <= 150
            ? pr.summary
            : `${pr.summary.slice(0, 150)}...`,
        breakingChanges: breakingChangesFromMetadata(pr.metadata)
      }))
    });
  }
);

reposRouter.get(
  "/api/v1/repos/:id/prs/:prId/intelligence",
  async (request: Request, response: Response): Promise<void> => {
    const repoId = getRouteParam(request.params.id);
    const prId = getRouteParam(request.params.prId);
    const pullRequest = await prisma.pullRequest.findFirst({
      where: {
        id: prId,
        repoId
      }
    });

    if (pullRequest === null) {
      throw new AppError("Pull request not found", 404);
    }

    if (pullRequest.summary === null || pullRequest.riskScore === null) {
      const job = await getPrAnalysisQueue().add("analyze-pr", {
        repoId,
        prId: pullRequest.id,
        prNumber: pullRequest.number
      });
      response.status(202).json({
        message: "Analysis queued",
        jobId: job.id
      });
      return;
    }

    response.status(200).json({
      id: pullRequest.id,
      number: pullRequest.number,
      title: pullRequest.title,
      author: pullRequest.author,
      status: pullRequest.status,
      summary: pullRequest.summary,
      riskScore: pullRequest.riskScore,
      metadata: pullRequest.metadata
    });
  }
);

reposRouter.get(
  "/api/v1/repos/:id/contributors",
  async (request: Request, response: Response): Promise<void> => {
    const repoId = getRouteParam(request.params.id);
    const cacheKey = CacheKeys.contributors(repoId);
    const cached = await cache.get<unknown>(cacheKey);

    if (cached !== null) {
      response.status(200).json(cached);
      return;
    }

    const contributors = await prisma.contributor.findMany({
      where: { repoId },
      orderBy: { commitCount: "desc" }
    });

    const body = contributors.map((contributor) => ({
        login: contributor.login,
        commitCount: contributor.commitCount,
        linesAdded: contributor.linesAdded,
        linesRemoved: contributor.linesRemoved,
        ownedFilesCount: ownedFilesCount(contributor.ownedFiles)
      }));

    await cache.set(cacheKey, body, {
      ttl: contributorCacheTtlSeconds,
      staleWhileRevalidate: true
    });
    response.status(200).json(body);
  }
);

reposRouter.get(
  "/api/v1/repos/:id/bus-factor",
  async (request: Request, response: Response): Promise<void> => {
    const repoId = getRouteParam(request.params.id);
    const cacheKey = CacheKeys.busFactor(repoId);
    const cached = await cache.get<unknown>(cacheKey);

    if (cached !== null) {
      response.status(200).json(cached);
      return;
    }

    const repository = await prisma.repository.findUnique({
      where: { id: repoId },
      select: { metadata: true }
    });

    if (repository === null) {
      throw new AppError("Repository not found", 404);
    }

    const analytics = contributorAnalyticsFromMetadata(repository.metadata);
    if (analytics === null) {
      const job = await getContributorAnalysisQueue().add("analyze-contributors", {
        repoId
      });
      response.status(202).json({
        message: "Analysis queued",
        jobId: job.id
      });
      return;
    }

    await cache.set(cacheKey, analytics, {
      ttl: contributorCacheTtlSeconds,
      staleWhileRevalidate: true
    });
    response.status(200).json(analytics);
  }
);

reposRouter.get(
  "/api/v1/repos/:id/contributors/:login/activity",
  async (request: Request, response: Response): Promise<void> => {
    const repoId = getRouteParam(request.params.id);
    const login = getRouteParam(request.params.login);
    const trends = await new ContributorIntelligenceService().getActivityTrends(
      repoId,
      login
    );

    response.status(200).json(trends);
  }
);

reposRouter.get(
  "/api/v1/repos/:id",
  async (request: Request, response: Response): Promise<void> => {
    const repoId = getRouteParam(request.params.id);
    const cacheKey = CacheKeys.repoStats(repoId);
    const cached = await cache.get<unknown>(cacheKey);

    if (cached !== null) {
      response.status(200).json(cached);
      return;
    }

    const repository = await prisma.repository.findUnique({
      where: { id: repoId },
      include: {
        ingestionJobs: {
          orderBy: { createdAt: "desc" },
          take: 1
        },
        _count: {
          select: {
            commits: true,
            pullRequests: true,
            issues: true,
            codeFiles: true
          }
        }
      }
    });

    if (repository === null) {
      throw new AppError("Repository not found", 404);
    }

    const body = {
      ...repository,
      commitCount: repository._count.commits,
      prCount: repository._count.pullRequests,
      issueCount: repository._count.issues,
      fileCount: repository._count.codeFiles,
      latestIngestionJob: repository.ingestionJobs[0] ?? null,
      ingestionJobs: undefined,
      _count: undefined
    };

    await cache.set(cacheKey, body, {
      ttl: repoStatsCacheTtlSeconds,
      staleWhileRevalidate: true
    });
    response.status(200).json(body);
  }
);

reposRouter.post(
  "/api/v1/repos/:id/sync",
  async (request: Request, response: Response): Promise<void> => {
    const repoId = getRouteParam(request.params.id);
    const repository = await prisma.repository.findUnique({
      where: { id: repoId }
    });

    if (repository === null) {
      throw new AppError("Repository not found", 404);
    }

    await cache.invalidate(CacheKeys.repoStats(repoId));
    await getRepoIngestionQueue().add("ingest-repo", {
      repoId: repository.id,
      githubUrl: repository.githubUrl,
      isIncremental: true
    });

    response.status(202).json({ status: "queued" });
  }
);
