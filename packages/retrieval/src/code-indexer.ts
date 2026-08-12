import { prisma, type ASTNode } from "@gitpulse/db";
import pino from "pino";
import { CodeChunker } from "./chunker.js";
import { Embedder } from "./embedder.js";
import { stablePointId } from "./hash.js";
import { KeywordStore, type IndexedChunk } from "./keyword-store.js";
import { getRedis } from "./redis.js";
import { VectorStore, type VectorPoint } from "./vector-store.js";
import type { Chunk, EmbeddedChunk } from "./types.js";

const logger = pino({ name: "gitpulse-retrieval" });

export interface IndexableCodeFile {
  id: string;
  path: string;
  content: string;
  language: string | null;
  astNodes: ASTNode[];
}

export interface PersistedChunk {
  id: string;
  chunk: Chunk;
  hasEmbedding: boolean;
}

interface ChunkerLike {
  chunk(
    fileId: string,
    filePath: string,
    content: string,
    language: string,
    astNodes: ASTNode[]
  ): Chunk[];
}

interface EmbedderLike {
  embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]>;
}

interface VectorStoreLike {
  upsert(points: VectorPoint[]): Promise<void>;
}

interface KeywordStoreLike {
  index(chunks: IndexedChunk[]): Promise<void>;
}

export interface ChunkPersistence {
  replaceFileChunks(
    repoId: string,
    fileId: string,
    chunks: PersistedChunk[]
  ): Promise<void>;
}

class PrismaChunkPersistence implements ChunkPersistence {
  public async replaceFileChunks(
    repoId: string,
    fileId: string,
    chunks: PersistedChunk[]
  ): Promise<void> {
    await prisma.$transaction([
      ...chunks.map(({ id, chunk, hasEmbedding }) =>
        prisma.embeddingChunk.upsert({
          where: {
            fileId_chunkIndex: {
              fileId: chunk.fileId,
              chunkIndex: chunk.chunkIndex
            }
          },
          create: {
            fileId: chunk.fileId,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            qdrantPointId: hasEmbedding ? id : null,
            metadata: chunk.metadata
          },
          update: {
            content: chunk.content,
            qdrantPointId: hasEmbedding ? id : null,
            metadata: chunk.metadata
          }
        })
      ),
      prisma.embeddingChunk.deleteMany({
        where: {
          fileId,
          chunkIndex: {
            gte: chunks.length
          }
        }
      }),
      prisma.codeFile.update({
        where: { id: fileId },
        data: { indexedAt: new Date() }
      })
    ]);

    const remainingFiles = await prisma.codeFile.count({
      where: {
        repoId,
        indexedAt: null
      }
    });

    if (remainingFiles === 0) {
      const completedAt = new Date();
      await prisma.$transaction([
        prisma.repository.update({
          where: { id: repoId },
          data: { status: "ready" }
        }),
        prisma.ingestionJob.updateMany({
          where: {
            repoId,
            status: "running"
          },
          data: {
            status: "completed",
            completedAt
          }
        })
      ]);

      try {
        const cacheKey = `gitpulse:stats:${repoId}`;
        await getRedis().del(cacheKey, `${cacheKey}:stale`);
      } catch (error: unknown) {
        logger.warn(
          {
            repoId,
            error: error instanceof Error ? error.message : "unknown cache error"
          },
          "repository status cache invalidation failed"
        );
      }
    }
  }
}

export class CodeIndexer {
  public constructor(
    private readonly chunker: ChunkerLike = new CodeChunker(),
    private readonly embedder: EmbedderLike = new Embedder(),
    private readonly vectorStore: VectorStoreLike = new VectorStore(),
    private readonly keywordStore: KeywordStoreLike = new KeywordStore(),
    private readonly persistence: ChunkPersistence = new PrismaChunkPersistence()
  ) {}

  public async indexFile(
    repoId: string,
    codeFile: IndexableCodeFile
  ): Promise<void> {
    const chunks = this.chunker.chunk(
      codeFile.id,
      codeFile.path,
      codeFile.content,
      codeFile.language ?? "unknown",
      codeFile.astNodes
    );
    const embeddedChunks = await this.embedder.embedChunks(chunks);
    const embeddings = new Map(
      embeddedChunks.map((chunk) => [chunk.chunkIndex, chunk.embedding])
    );
    const indexedChunks = chunks.map((chunk) => {
      const id = stablePointId(
        `${repoId}:${chunk.fileId}:${chunk.chunkIndex}:${chunk.content}`
      );
      return {
        id,
        chunk,
        embedding: embeddings.get(chunk.chunkIndex) ?? null
      };
    });

    await this.keywordStore.index(
      indexedChunks.map(({ id, chunk }) => ({
        ...chunk,
        id,
        repoId
      }))
    );

    const vectorPoints = indexedChunks
      .filter(
        (item): item is typeof item & { embedding: number[] } =>
          item.embedding !== null
      )
      .map(({ id, chunk, embedding }) => ({
        id,
        vector: embedding,
        payload: {
          ...chunk.metadata,
          fileId: chunk.fileId,
          repoId,
          chunkIndex: chunk.chunkIndex,
          chunkContent: chunk.content
        }
      } satisfies VectorPoint));

    if (vectorPoints.length > 0) {
      await this.vectorStore.upsert(vectorPoints);
    }

    await this.persistence.replaceFileChunks(
      repoId,
      codeFile.id,
      indexedChunks.map(({ id, chunk, embedding }) => ({
        id,
        chunk,
        hasEmbedding: embedding !== null
      }))
    );

    logger.info(
      {
        filePath: codeFile.path,
        chunkCount: indexedChunks.length,
        vectorCount: vectorPoints.length
      },
      `Indexed ${codeFile.path}: ${indexedChunks.length} searchable chunks`
    );
  }
}
