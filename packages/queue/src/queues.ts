import { Queue } from "bullmq";
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

export const repoIngestionQueue = new Queue<RepoIngestionJob>(
  QUEUES.REPO_INGESTION,
  {
    connection: redisConnection,
    defaultJobOptions
  }
);

export const fileParsingQueue = new Queue<FileParsingJob>(QUEUES.FILE_PARSING, {
  connection: redisConnection,
  defaultJobOptions
});

export const embeddingGenerationQueue = new Queue<EmbeddingJob>(
  QUEUES.EMBEDDING_GENERATION,
  {
    connection: redisConnection,
    defaultJobOptions
  }
);

export const prAnalysisQueue = new Queue<PRAnalysisJob>(QUEUES.PR_ANALYSIS, {
  connection: redisConnection,
  defaultJobOptions
});

export const contributorAnalysisQueue = new Queue<ContributorAnalysisJob>(
  QUEUES.CONTRIBUTOR_ANALYSIS,
  {
    connection: redisConnection,
    defaultJobOptions
  }
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
