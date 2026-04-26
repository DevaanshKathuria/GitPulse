import { redisConnection } from "@gitpulse/queue";
import { Redis } from "ioredis";

export const redis = new Redis({
  ...redisConnection,
  enableOfflineQueue: false,
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null
});

redis.on("error", (error) => {
  console.warn(
    `Redis cache unavailable: ${error.message || error.name || "connection failed"}`
  );
});
