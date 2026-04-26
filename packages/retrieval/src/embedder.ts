import OpenAI from "openai";
import pino from "pino";
import { hashText } from "./hash.js";
import { getRedis } from "./redis.js";
import type { Chunk, EmbeddedChunk } from "./types.js";

const logger = pino({ name: "gitpulse-retrieval" });
const embeddingCacheTtlSeconds = 7 * 24 * 60 * 60;
const embeddingBatchSize = 50;
const maxRetries = 3;

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
};

const parseCachedEmbedding = (cached: string | null): number[] | null => {
  if (cached === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(cached) as unknown;
    return Array.isArray(parsed) && parsed.every((value) => typeof value === "number")
      ? parsed
      : null;
  } catch {
    return null;
  }
};

export class Embedder {
  private readonly openai: OpenAI;

  public constructor(apiKey = process.env.OPENAI_API_KEY) {
    this.openai = new OpenAI({ apiKey });
  }

  public async embedText(content: string): Promise<number[] | null> {
    const [embedded] = await this.embedChunks([
      {
        fileId: "query",
        chunkIndex: 0,
        content,
        metadata: {
          filePath: "query",
          language: "text",
          type: "window"
        }
      }
    ]);

    return embedded?.embedding ?? null;
  }

  public async embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
    const results = new Map<number, number[] | null>();
    const pending: Array<{ index: number; chunk: Chunk; cacheKey: string }> = [];
    const redis = getRedis();

    for (const [index, chunk] of chunks.entries()) {
      const cacheKey = `gitpulse:emb:${hashText(chunk.content)}`;
      try {
        const cached = parseCachedEmbedding(await redis.get(cacheKey));
        if (cached !== null) {
          results.set(index, cached);
          continue;
        }
      } catch {
        // Cache misses due to Redis availability should not block embedding.
      }

      pending.push({ index, chunk, cacheKey });
    }

    for (let start = 0; start < pending.length; start += embeddingBatchSize) {
      const batch = pending.slice(start, start + embeddingBatchSize);
      const embeddings = await this.embedBatchWithRetry(
        batch.map((item) => item.chunk.content)
      );

      if (embeddings === null) {
        for (const item of batch) {
          results.set(item.index, null);
        }
        continue;
      }

      for (const [batchIndex, embedding] of embeddings.entries()) {
        const item = batch[batchIndex];
        if (item === undefined) {
          continue;
        }

        results.set(item.index, embedding);
        try {
          await redis.set(
            item.cacheKey,
            JSON.stringify(embedding),
            "EX",
            embeddingCacheTtlSeconds
          );
        } catch {
          // Cache writes are best-effort.
        }
      }
    }

    return chunks.map((chunk, index) => ({
      ...chunk,
      embedding: results.get(index) ?? null
    }));
  }

  private async embedBatchWithRetry(inputs: string[]): Promise<number[][] | null> {
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const response = await this.openai.embeddings.create({
          model: "text-embedding-3-small",
          input: inputs
        });

        return response.data.map((item) => item.embedding);
      } catch (error: unknown) {
        if (attempt === maxRetries) {
          const message = error instanceof Error ? error.message : "OpenAI error";
          logger.error({ error: message }, "embedding failed");
          return null;
        }

        await sleep(2 ** attempt * 1000);
      }
    }

    return null;
  }
}
