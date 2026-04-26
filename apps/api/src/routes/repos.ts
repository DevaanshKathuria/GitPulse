import { prisma } from "@gitpulse/db";
import { DependencyGraphBuilder } from "@gitpulse/parser";
import { getRepoIngestionQueue } from "@gitpulse/queue";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { AppError } from "../errors.js";
import { redis } from "../redis.js";

export const reposRouter = Router();
const architectureCacheTtlSeconds = 60 * 60;

const getCachedArchitecture = async (cacheKey: string): Promise<unknown | null> => {
  try {
    const cached = await redis.get(cacheKey);
    return cached === null ? null : (JSON.parse(cached) as unknown);
  } catch {
    return null;
  }
};

const setCachedArchitecture = async (
  cacheKey: string,
  body: unknown
): Promise<void> => {
  try {
    await redis.set(
      cacheKey,
      JSON.stringify(body),
      "EX",
      architectureCacheTtlSeconds
    );
  } catch {
    return;
  }
};

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
    const cacheKey = `gitpulse:arch:${repoId}`;
    const cached = await getCachedArchitecture(cacheKey);

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

    await setCachedArchitecture(cacheKey, body);
    response.status(200).json(body);
  }
);

reposRouter.get(
  "/api/v1/repos/:id",
  async (request: Request, response: Response): Promise<void> => {
    const repoId = getRouteParam(request.params.id);
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

    response.status(200).json({
      ...repository,
      commitCount: repository._count.commits,
      prCount: repository._count.pullRequests,
      issueCount: repository._count.issues,
      fileCount: repository._count.codeFiles,
      latestIngestionJob: repository.ingestionJobs[0] ?? null,
      ingestionJobs: undefined,
      _count: undefined
    });
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

    await getRepoIngestionQueue().add("ingest-repo", {
      repoId: repository.id,
      githubUrl: repository.githubUrl,
      isIncremental: true
    });

    response.status(202).json({ status: "queued" });
  }
);
