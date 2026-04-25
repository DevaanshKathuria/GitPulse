import { type Job } from "bullmq";
import {
  QUEUES,
  WorkerBase,
  type RepoIngestionJob
} from "@gitpulse/queue";
import { IngestionService } from "./ingestion-service.js";

export class IngestionWorker extends WorkerBase<RepoIngestionJob> {
  private readonly ingestionService: IngestionService;

  public constructor(ingestionService = new IngestionService()) {
    super(QUEUES.REPO_INGESTION, 2);
    this.ingestionService = ingestionService;
  }

  protected async processJob(job: Job<RepoIngestionJob>): Promise<void> {
    await job.updateProgress(10);
    await this.ingestionService.ingestRepo(
      job.data.repoId,
      job.data.githubUrl,
      job.data.isIncremental,
      async (percentage) => {
        await job.updateProgress(percentage);
      }
    );
    await job.updateProgress(100);
  }
}
