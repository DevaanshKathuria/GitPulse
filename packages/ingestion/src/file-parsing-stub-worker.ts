import { type Job } from "bullmq";
import {
  QUEUES,
  WorkerBase,
  type FileParsingJob
} from "@gitpulse/queue";

export class FileParsingStubWorker extends WorkerBase<FileParsingJob> {
  public constructor() {
    super(QUEUES.FILE_PARSING, 2);
  }

  protected async processJob(job: Job<FileParsingJob>): Promise<void> {
    this.logger.info(
      {
        repoId: job.data.repoId,
        fileId: job.data.fileId,
        path: job.data.path
      },
      `stub: parsing queued for ${job.data.path}`
    );
  }
}
