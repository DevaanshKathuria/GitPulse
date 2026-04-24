export const QUEUE_NAMES = {
  INGESTION: "ingestion",
  RETRIEVAL: "retrieval",
  WEBHOOKS: "webhooks"
} as const;

export const JOB_STATUSES = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed"
} as const;

export const REPOSITORY_STATUSES = {
  PENDING: "pending",
  INDEXING: "indexing",
  READY: "ready",
  FAILED: "failed"
} as const;

export const SUPPORTED_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "java",
  "csharp",
  "ruby",
  "php"
] as const;
