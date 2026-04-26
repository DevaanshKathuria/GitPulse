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
const queues = new Map<QueueName, Queue<object>>();

const errorMessage = (error: Error): string => {
  return error.message.length > 0 ? error.message : error.name;
};

const attachQueueErrorLogger = <TJobData extends object>(
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

const getQueue = <TJobData extends object>(queueName: QueueName): Queue<TJobData> => {
  const existingQueue = queues.get(queueName);

  if (existingQueue !== undefined) {
    return existingQueue as unknown as Queue<TJobData>;
  }

  const queue = attachQueueErrorLogger(
    new Queue<TJobData>(queueName, {
      connection: redisConnection,
      defaultJobOptions
    }),
    queueName
  );
  queues.set(queueName, queue as unknown as Queue<object>);
  return queue;
};

export const getRepoIngestionQueue = (): Queue<RepoIngestionJob> =>
  getQueue<RepoIngestionJob>(QUEUES.REPO_INGESTION);

export const getFileParsingQueue = (): Queue<FileParsingJob> =>
  getQueue<FileParsingJob>(QUEUES.FILE_PARSING);

export const getEmbeddingGenerationQueue = (): Queue<EmbeddingJob> =>
  getQueue<EmbeddingJob>(QUEUES.EMBEDDING_GENERATION);

export const getPrAnalysisQueue = (): Queue<PRAnalysisJob> =>
  getQueue<PRAnalysisJob>(QUEUES.PR_ANALYSIS);

export const getContributorAnalysisQueue = (): Queue<ContributorAnalysisJob> =>
  getQueue<ContributorAnalysisJob>(QUEUES.CONTRIBUTOR_ANALYSIS);

export const closeQueues = async (): Promise<void> => {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
};
