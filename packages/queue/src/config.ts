import type { JobsOptions } from "bullmq";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const parsedRedisUrl = new URL(redisUrl);

export const redisConnection = {
  host: parsedRedisUrl.hostname,
  port: Number(parsedRedisUrl.port || 6379),
  password:
    parsedRedisUrl.password.length > 0
      ? decodeURIComponent(parsedRedisUrl.password)
      : undefined
};

export const defaultJobOptions: JobsOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 2000
  },
  removeOnComplete: 100,
  removeOnFail: 500
};
