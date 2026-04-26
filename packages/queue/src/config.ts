import type { JobsOptions } from "bullmq";
import net from "node:net";

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

export const isRedisAvailable = async (timeoutMs = 500): Promise<boolean> => {
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: redisConnection.host,
      port: redisConnection.port
    });

    const finish = (available: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(available);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
};
