import { redisConnection } from "@gitpulse/queue";
import { Redis } from "ioredis";

export const redis = new Redis(redisConnection);

redis.on("error", (error) => {
  console.warn(`Redis cache unavailable: ${error.message}`);
});
