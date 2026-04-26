import { redisConnection } from "@gitpulse/queue";
import { Redis } from "ioredis";

let redis: Redis | null = null;

export const getRedis = (): Redis => {
  redis ??= new Redis({
    ...redisConnection,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null
  });

  return redis;
};
