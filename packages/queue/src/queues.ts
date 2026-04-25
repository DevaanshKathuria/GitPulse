import { Queue } from "bullmq";
import pino from "pino";
import { defaultJobOptions, redisConnection } from "./config.js";
import type {
  ContributorAnalysisJob,
  EmbeddingJob,
  FileParsingJob,
  PRAnalysisJob,
  RepoIngestionJob
} from "./jobs.js";

export const QUEUES = {
  REPO_INGESTION: "repo-ingestion",
  FILE_PARSING: "file-parsing",
  EMBEDDING_GENERATION: "embedding-generation",
  PR_ANALYSIS: "pr-analysis",
  CONTRIBUTOR_ANALYSIS: "contributor-analysis"
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const logger = pino({ name: "gitpulse-queue" });

const errorMessage = (error: Error): string => {
  return error.message.length > 0 ? error.message : error.name;
};

const attachQueueErrorLogger = <TJobData>(
  queue: Queue<TJobData>,
  queueName: QueueName
): Queue<TJobData> => {
  queue.on("error", (error) => {
    logger.error(
      {
        queue: queueName,
        error: errorMessage(error)
      },
      "queue error"
    );
  });

  return queue;
};

export const repoIngestionQueue = new Queue<RepoIngestionJob>(
  QUEUES.REPO_INGESTION,
  {
    connection: redisConnection,
    defaultJobOptions
  }
);
attachQueueErrorLogger(repoIngestionQueue, QUEUES.REPO_INGESTION);

export const fileParsingQueue = new Queue<FileParsingJob>(QUEUES.FILE_PARSING, {
  connection: redisConnection,
  defaultJobOptions
});
attachQueueErrorLogger(fileParsingQueue, QUEUES.FILE_PARSING);

export const embeddingGenerationQueue = new Queue<EmbeddingJob>(
  QUEUES.EMBEDDING_GENERATION,
  {
    connection: redisConnection,
    defaultJobOptions
  }
);
attachQueueErrorLogger(
  embeddingGenerationQueue,
  QUEUES.EMBEDDING_GENERATION
);

export const prAnalysisQueue = new Queue<PRAnalysisJob>(QUEUES.PR_ANALYSIS, {
  connection: redisConnection,
  defaultJobOptions
});
attachQueueErrorLogger(prAnalysisQueue, QUEUES.PR_ANALYSIS);

export const contributorAnalysisQueue = new Queue<ContributorAnalysisJob>(
  QUEUES.CONTRIBUTOR_ANALYSIS,
  {
    connection: redisConnection,
    defaultJobOptions
  }
);
attachQueueErrorLogger(
  contributorAnalysisQueue,
  QUEUES.CONTRIBUTOR_ANALYSIS
);

export const closeQueues = async (): Promise<void> => {
  await Promise.all([
    repoIngestionQueue.close(),
    fileParsingQueue.close(),
    embeddingGenerationQueue.close(),
    prAnalysisQueue.close(),
    contributorAnalysisQueue.close()
  ]);
};
