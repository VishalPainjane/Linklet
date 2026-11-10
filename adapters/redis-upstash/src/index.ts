import { Redis } from "@upstash/redis/cloudflare";
import type { CacheRepository } from "@linklet/cache";

export interface UpstashRedisConfig {
  url: string;
  token: string;
}

export class UpstashRedisCacheRepository implements CacheRepository {
  private readonly redis: Redis;

  constructor(config: UpstashRedisConfig) {
    this.redis = new Redis({
      url: config.url,
      token: config.token,
    });
  }

  public static fromEnv(env: { UPSTASH_REDIS_REST_URL: string; UPSTASH_REDIS_REST_TOKEN: string }): UpstashRedisCacheRepository {
    return new UpstashRedisCacheRepository({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });
  }

  public async get(key: string): Promise<string | null> {
    const result = await this.redis.get<string>(key);
    if (result === null || result === undefined) {
      return null;
    }
    return typeof result === "string" ? result : JSON.stringify(result);
  }

  public async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    await this.redis.set(key, value, {
      ex: ttlSeconds,
    });
  }

  public async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  public async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    const res = await this.redis.set(key, value, {
      px: ttlMs,
      nx: true,
    });
    return res === "OK";
  }
}

