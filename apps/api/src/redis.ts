import { redisConnection } from "@gitpulse/queue";
import { Redis } from "ioredis";
import { logger } from "./lib/logger.js";

export const redis = new Redis({
  ...redisConnection,
  enableOfflineQueue: false,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null
});

redis.on("error", (error) => {
  logger.warn(
    { error: error.message || error.name || "connection failed" },
    "redis cache unavailable"
  );
});
