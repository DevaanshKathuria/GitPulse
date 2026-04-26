import { prisma } from "@gitpulse/db";
import {
  QUEUES,
  WorkerBase,
  type EmbeddingJob
} from "@gitpulse/queue";
import { type Job } from "bullmq";
import pino from "pino";
import { CodeChunker } from "./chunker.js";
import { Embedder } from "./embedder.js";
import { stablePointId } from "./hash.js";
import { KeywordStore } from "./keyword-store.js";
import { VectorStore } from "./vector-store.js";
import type { ChunkPayload } from "./types.js";

const logger = pino({ name: "gitpulse-retrieval" });

export class EmbeddingWorker extends WorkerBase<EmbeddingJob> {
  private readonly chunker: CodeChunker;
  private readonly embedder: Embedder;
  private readonly vectorStore: VectorStore;
  private readonly keywordStore: KeywordStore;

  public constructor(
    chunker = new CodeChunker(),
    embedder = new Embedder(),
    vectorStore = new VectorStore(),
    keywordStore = new KeywordStore()
  ) {
    super(QUEUES.EMBEDDING_GENERATION, 3);
    this.chunker = chunker;
    this.embedder = embedder;
    this.vectorStore = vectorStore;
    this.keywordStore = keywordStore;
  }

  protected async processJob(job: Job<EmbeddingJob>): Promise<void> {
    const codeFile = await prisma.codeFile.findUnique({
      where: { id: job.data.fileId },
      include: {
        astNodes: true
      }
    });

    if (codeFile === null || codeFile.content === null) {
      return;
    }

    const chunks = this.chunker.chunk(
      codeFile.id,
      codeFile.path,
      codeFile.content,
      codeFile.language ?? "unknown",
      codeFile.astNodes
    );
    const embeddedChunks = await this.embedder.embedChunks(chunks);
    const validChunks = embeddedChunks.filter(
      (chunk) => chunk.embedding !== null
    );

    if (validChunks.length === 0) {
      logger.warn({ filePath: codeFile.path }, "no valid embeddings generated");
      return;
    }

    const indexedChunks = validChunks.map((chunk) => {
      const id = stablePointId(
        `${job.data.repoId}:${chunk.fileId}:${chunk.chunkIndex}:${chunk.content}`
      );
      return { id, chunk };
    });

    await this.vectorStore.upsert(
      indexedChunks.map(({ id, chunk }) => ({
        id,
        vector: chunk.embedding ?? [],
        payload: {
          ...chunk.metadata,
          fileId: chunk.fileId,
          repoId: job.data.repoId,
          chunkIndex: chunk.chunkIndex,
          chunkContent: chunk.content
        } satisfies ChunkPayload
      }))
    );

    await this.keywordStore.index(
      indexedChunks.map(({ id, chunk }) => ({
        ...chunk,
        id,
        repoId: job.data.repoId
      }))
    );

    await prisma.$transaction([
      ...indexedChunks.map(({ id, chunk }) =>
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
            qdrantPointId: id,
            metadata: chunk.metadata
          },
          update: {
            content: chunk.content,
            qdrantPointId: id,
            metadata: chunk.metadata
          }
        })
      ),
      prisma.embeddingChunk.deleteMany({
        where: {
          fileId: codeFile.id,
          chunkIndex: {
            gte: indexedChunks.length
          }
        }
      })
    ]);

    logger.info(
      {
        filePath: codeFile.path,
        chunkCount: indexedChunks.length
      },
      `Embedded ${codeFile.path}: ${indexedChunks.length} chunks`
    );
  }
}
