import { describe, expect, it, vi } from "vitest";
import { CodeIndexer, type ChunkPersistence } from "./code-indexer.js";
import type { Chunk, EmbeddedChunk } from "./types.js";

const chunk: Chunk = {
  fileId: "file-1",
  chunkIndex: 0,
  content: "export function authenticate() { return true; }",
  metadata: {
    filePath: "src/auth.ts",
    language: "typescript",
    functionName: "authenticate",
    startLine: 1,
    endLine: 1,
    type: "function"
  }
};

const codeFile = {
  id: "file-1",
  path: "src/auth.ts",
  content: chunk.content,
  language: "typescript",
  astNodes: []
};

describe("CodeIndexer", () => {
  it("indexes BM25 and persists chunks when embeddings are unavailable", async () => {
    const chunker = { chunk: vi.fn(() => [chunk]) };
    const embedder = {
      embedChunks: vi.fn(async (): Promise<EmbeddedChunk[]> => [
        { ...chunk, embedding: null }
      ])
    };
    const vectorStore = { upsert: vi.fn(async () => undefined) };
    const keywordStore = { index: vi.fn(async () => undefined) };
    const persistence: ChunkPersistence = {
      replaceFileChunks: vi.fn(async () => undefined)
    };
    const indexer = new CodeIndexer(
      chunker,
      embedder,
      vectorStore,
      keywordStore,
      persistence
    );

    await indexer.indexFile("repo-1", codeFile);

    expect(keywordStore.index).toHaveBeenCalledWith([
      expect.objectContaining({
        repoId: "repo-1",
        fileId: "file-1",
        content: chunk.content
      })
    ]);
    expect(vectorStore.upsert).not.toHaveBeenCalled();
    expect(persistence.replaceFileChunks).toHaveBeenCalledWith(
      "repo-1",
      "file-1",
      [expect.objectContaining({ hasEmbedding: false })]
    );
  });

  it("writes vector points for chunks that have embeddings", async () => {
    const embedding = [0.25, 0.75];
    const vectorStore = { upsert: vi.fn(async () => undefined) };
    const keywordStore = { index: vi.fn(async () => undefined) };
    const persistence: ChunkPersistence = {
      replaceFileChunks: vi.fn(async () => undefined)
    };
    const indexer = new CodeIndexer(
      { chunk: () => [chunk] },
      {
        embedChunks: async () => [{ ...chunk, embedding }]
      },
      vectorStore,
      keywordStore,
      persistence
    );

    await indexer.indexFile("repo-1", codeFile);

    expect(vectorStore.upsert).toHaveBeenCalledWith([
      expect.objectContaining({
        vector: embedding,
        payload: expect.objectContaining({
          repoId: "repo-1",
          fileId: "file-1"
        })
      })
    ]);
    expect(persistence.replaceFileChunks).toHaveBeenCalledWith(
      "repo-1",
      "file-1",
      [expect.objectContaining({ hasEmbedding: true })]
    );
  });
});
