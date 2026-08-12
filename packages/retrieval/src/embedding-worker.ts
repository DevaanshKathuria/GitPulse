import { prisma } from "@gitpulse/db";
import {
  QUEUES,
  WorkerBase,
  type EmbeddingJob
} from "@gitpulse/queue";
import { type Job } from "bullmq";
import { CodeIndexer } from "./code-indexer.js";

export class EmbeddingWorker extends WorkerBase<EmbeddingJob> {
  private readonly codeIndexer: CodeIndexer;

  public constructor(codeIndexer = new CodeIndexer()) {
    super(QUEUES.EMBEDDING_GENERATION, 3);
    this.codeIndexer = codeIndexer;
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

    await this.codeIndexer.indexFile(job.data.repoId, {
      ...codeFile,
      content: codeFile.content
    });
  }
}
