import { prisma } from "@gitpulse/db";
import {
  getEmbeddingGenerationQueue,
  QUEUES,
  WorkerBase,
  type FileParsingJob
} from "@gitpulse/queue";
import { type Job } from "bullmq";
import { detectLanguage } from "./language-detector.js";
import { ParserOrchestrator } from "./parser-orchestrator.js";

export class FileParsingWorker extends WorkerBase<FileParsingJob> {
  private readonly parserOrchestrator: ParserOrchestrator;

  public constructor(parserOrchestrator = new ParserOrchestrator()) {
    super(QUEUES.FILE_PARSING, 5);
    this.parserOrchestrator = parserOrchestrator;
  }

  protected async processJob(job: Job<FileParsingJob>): Promise<void> {
    const codeFile = await prisma.codeFile.findUnique({
      where: { id: job.data.fileId },
      select: {
        id: true,
        path: true,
        content: true
      }
    });

    if (codeFile === null || codeFile.content === null) {
      return;
    }

    const language = detectLanguage(codeFile.path);

    if (language === null) {
      return;
    }

    await this.parserOrchestrator.parse(
      codeFile.id,
      codeFile.path,
      codeFile.content,
      language
    );

    await getEmbeddingGenerationQueue().add("generate-embeddings", {
      repoId: job.data.repoId,
      fileId: codeFile.id,
      chunkCount: 0
    });
  }
}
