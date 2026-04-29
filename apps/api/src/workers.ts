import { isRedisAvailable } from "@gitpulse/queue";
import {
  getContributorAnalysisQueue,
  getEmbeddingGenerationQueue,
  getFileParsingQueue,
  getPrAnalysisQueue,
  getRepoIngestionQueue,
  QUEUES
} from "@gitpulse/queue";
import { logger } from "./lib/logger.js";
import { queueDepth } from "./lib/metrics.js";

type ManagedWorker = {
  close: () => Promise<void>;
};

let workers: ManagedWorker[] = [];
let queueDepthInterval: NodeJS.Timeout | null = null;

const queueDepthPollSeconds = 30;

const observeQueueDepth = async (): Promise<void> => {
  const queues = [
    [QUEUES.REPO_INGESTION, getRepoIngestionQueue()] as const,
    [QUEUES.FILE_PARSING, getFileParsingQueue()] as const,
    [QUEUES.EMBEDDING_GENERATION, getEmbeddingGenerationQueue()] as const,
    [QUEUES.PR_ANALYSIS, getPrAnalysisQueue()] as const,
    [QUEUES.CONTRIBUTOR_ANALYSIS, getContributorAnalysisQueue()] as const
  ];

  await Promise.all(
    queues.map(async ([name, queue]) => {
      try {
        queueDepth.set({ queue: name }, await queue.getWaitingCount());
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown queue error";
        logger.debug({ queue: name, error: message }, "queue depth polling failed");
      }
    })
  );
};

const startQueueDepthPolling = (): void => {
  if (queueDepthInterval !== null) {
    return;
  }

  void observeQueueDepth();
  queueDepthInterval = setInterval(() => {
    void observeQueueDepth();
  }, queueDepthPollSeconds * 1000);
};

export const startWorkers = async (): Promise<void> => {
  if (workers.length > 0) {
    return;
  }

  if (!(await isRedisAvailable())) {
    logger.warn(
      "redis is not reachable; queue workers are disabled for this api process"
    );
    return;
  }

  const [
    { IngestionWorker },
    { FileParsingWorker },
    { EmbeddingWorker },
    { PRAnalysisWorker },
    { ContributorAnalysisWorker }
  ] = await Promise.all([
    import("@gitpulse/ingestion"),
    import("@gitpulse/parser"),
    import("@gitpulse/retrieval"),
    import("./workers/pr-analysis-worker.js"),
    import("./workers/contributor-analysis-worker.js")
  ]);

  workers = [
    new IngestionWorker(),
    new FileParsingWorker(),
    new EmbeddingWorker(),
    new PRAnalysisWorker(),
    new ContributorAnalysisWorker()
  ];
  startQueueDepthPolling();
};

export const shutdownWorkers = async (): Promise<void> => {
  if (queueDepthInterval !== null) {
    clearInterval(queueDepthInterval);
    queueDepthInterval = null;
  }

  await Promise.all(workers.map((worker) => worker.close()));
  workers = [];
};
