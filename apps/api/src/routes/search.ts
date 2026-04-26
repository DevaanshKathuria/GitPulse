import { prisma, Prisma } from "@gitpulse/db";
import { hashText, SearchEngine, type SearchResult } from "@gitpulse/retrieval";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { redis } from "../redis.js";

export const searchRouter = Router();

const searchSchema = z.object({
  query: z.string().min(3),
  repoId: z.string().min(1),
  strategy: z.enum(["vector", "bm25", "hybrid"]).default("hybrid"),
  filters: z
    .object({
      language: z.string().min(1).optional(),
      filePattern: z.string().min(1).optional()
    })
    .optional(),
  topK: z.number().int().positive().max(20).default(10)
});

interface CachedSearchPayload {
  results: SearchResult[];
  strategy: "vector" | "bm25" | "hybrid";
}

const isSearchResult = (value: unknown): value is SearchResult => {
  return (
    typeof value === "object" &&
    value !== null &&
    "chunkId" in value &&
    "fileId" in value &&
    "filePath" in value &&
    "language" in value &&
    "content" in value &&
    "score" in value &&
    typeof (value as { chunkId: unknown }).chunkId === "string" &&
    typeof (value as { fileId: unknown }).fileId === "string" &&
    typeof (value as { filePath: unknown }).filePath === "string" &&
    typeof (value as { language: unknown }).language === "string" &&
    typeof (value as { content: unknown }).content === "string" &&
    typeof (value as { score: unknown }).score === "number"
  );
};

const parseCachedSearch = (cached: string | null): CachedSearchPayload | null => {
  if (cached === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(cached) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "results" in parsed &&
      "strategy" in parsed &&
      Array.isArray((parsed as { results: unknown }).results) &&
      (parsed as { results: unknown[] }).results.every(isSearchResult) &&
      (parsed as { strategy: unknown }).strategy !== undefined
    ) {
      return parsed as CachedSearchPayload;
    }
  } catch {
    return null;
  }

  return null;
};

const getCachedSearch = async (
  cacheKey: string
): Promise<CachedSearchPayload | null> => {
  try {
    return parseCachedSearch(await redis.get(cacheKey));
  } catch {
    return null;
  }
};

const setCachedSearch = async (
  cacheKey: string,
  payload: CachedSearchPayload
): Promise<void> => {
  try {
    await redis.set(cacheKey, JSON.stringify(payload), "EX", 60 * 60);
  } catch {
    return;
  }
};

const retrievalResultsJson = (results: SearchResult[]): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify({ items: results })) as unknown as Prisma.InputJsonValue;
};

searchRouter.post(
  "/api/v1/search",
  async (request: Request, response: Response): Promise<void> => {
    const parsed = searchSchema.parse(request.body);
    const startedAt = Date.now();
    const cacheKey = `gitpulse:search:${hashText(
      JSON.stringify({
        query: parsed.query,
        repoId: parsed.repoId,
        strategy: parsed.strategy,
        filters: parsed.filters,
        topK: parsed.topK
      })
    )}`;
    const cached = await getCachedSearch(cacheKey);

    if (cached !== null) {
      const latencyMs = Date.now() - startedAt;
      await prisma.retrievalLog.create({
        data: {
          query: parsed.query,
          repoId: parsed.repoId,
          results: retrievalResultsJson(cached.results),
          latencyMs,
          strategy: cached.strategy
        }
      });
      response.status(200).json({
        results: cached.results,
        strategy: cached.strategy,
        latencyMs,
        cached: true
      });
      return;
    }

    const results = await new SearchEngine().search(parsed);
    const latencyMs = Date.now() - startedAt;

    await prisma.retrievalLog.create({
      data: {
        query: parsed.query,
        repoId: parsed.repoId,
        results: retrievalResultsJson(results),
        latencyMs,
        strategy: parsed.strategy
      }
    });
    await setCachedSearch(cacheKey, {
      results,
      strategy: parsed.strategy
    });

    response.status(200).json({
      results,
      strategy: parsed.strategy,
      latencyMs,
      cached: false
    });
  }
);
