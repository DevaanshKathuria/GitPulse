import {
  QUEUES,
  WorkerBase,
  type PRAnalysisJob
} from "@gitpulse/queue";
import { PRIntelligenceService } from "../services/pr-intelligence.js";

interface QueueJob<TJobData> {
  data: TJobData;
}

export class PRAnalysisWorker extends WorkerBase<PRAnalysisJob> {
  private readonly prIntelligenceService: PRIntelligenceService;

  public constructor(prIntelligenceService = new PRIntelligenceService()) {
    super(QUEUES.PR_ANALYSIS, 3);
    this.prIntelligenceService = prIntelligenceService;
  }

  protected async processJob(job: QueueJob<PRAnalysisJob>): Promise<void> {
    await this.prIntelligenceService.analyzePR(job.data.prId);
  }
}
