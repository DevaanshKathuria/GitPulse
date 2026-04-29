import { redis } from "../redis.js";
import { logger } from "./logger.js";
import { observeCacheHit, observeCacheMiss } from "./metrics.js";

export interface CacheOptions {
  ttl?: number;
  staleWhileRevalidate?: boolean;
}

const defaultTtlSeconds = 60;

const staleKey = (key: string): string => `${key}:stale`;

const keyType = (key: string): string => {
  const [, type] = key.split(":");
  return type ?? "unknown";
};

const parseCacheValue = <T>(value: string | null): T | null => {
  if (value === null) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

export class CacheService {
  public async get<T>(key: string): Promise<T | null> {
    const type = keyType(key);

    try {
      const cached = parseCacheValue<T>(await redis.get(key));
      if (cached !== null) {
        observeCacheHit(type);
        logger.debug({ key, keyType: type }, "cache hit");
        return cached;
      }

      const stale = parseCacheValue<T>(await redis.get(staleKey(key)));
      if (stale !== null) {
        observeCacheHit(type);
        logger.debug({ key, keyType: type }, "cache stale hit");
        return stale;
      }

      observeCacheMiss(type);
      return null;
    } catch (error: unknown) {
      observeCacheMiss(type);
      const message = error instanceof Error ? error.message : "Unknown cache error";
      logger.debug({ key, keyType: type, error: message }, "cache get failed");
      return null;
    }
  }

  public async set<T>(
    key: string,
    value: T,
    options: CacheOptions = {}
  ): Promise<void> {
    const ttl = options.ttl ?? defaultTtlSeconds;
    const payload = JSON.stringify(value);

    try {
      await redis.set(key, payload, "EX", ttl);

      if (options.staleWhileRevalidate === true) {
        await redis.set(staleKey(key), payload, "EX", ttl * 2);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown cache error";
      logger.debug({ key, error: message }, "cache set failed");
    }
  }

  public async invalidate(key: string): Promise<void> {
    try {
      await redis.del(key, staleKey(key));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown cache error";
      logger.debug({ key, error: message }, "cache invalidate failed");
    }
  }

  public async invalidatePattern(pattern: string): Promise<void> {
    const keys: string[] = [];

    try {
      const stream = redis.scanStream({
        match: pattern,
        count: 100
      });

      for await (const chunk of stream) {
        if (Array.isArray(chunk)) {
          keys.push(...chunk.filter((key): key is string => typeof key === "string"));
        }
      }

      if (keys.length > 0) {
        await redis.del(...keys, ...keys.map(staleKey));
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown cache error";
      logger.debug({ pattern, error: message }, "cache pattern invalidate failed");
    }
  }
}

export const cache = new CacheService();
