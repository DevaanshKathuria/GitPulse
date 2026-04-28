import {
  QUEUES,
  WorkerBase,
  type ContributorAnalysisJob
} from "@gitpulse/queue";
import { ContributorIntelligenceService } from "../services/contributor-intelligence.js";

interface QueueJob<TJobData> {
  data: TJobData;
}

export class ContributorAnalysisWorker extends WorkerBase<ContributorAnalysisJob> {
  private readonly contributorIntelligenceService: ContributorIntelligenceService;

  public constructor(
    contributorIntelligenceService = new ContributorIntelligenceService()
  ) {
    super(QUEUES.CONTRIBUTOR_ANALYSIS, 1);
    this.contributorIntelligenceService = contributorIntelligenceService;
  }

  protected async processJob(job: QueueJob<ContributorAnalysisJob>): Promise<void> {
    await this.contributorIntelligenceService.analyzeContributors(job.data.repoId);
  }
}
