import { createClient, type RedisClientType } from "redis";
import type { CacheRepository } from "@linklet/cache";

export interface RedisConfig {
  url: string;
  socketTimeoutMs?: number;
}

export class RedisCacheRepository implements CacheRepository {
  private readonly client: RedisClientType;
  private isConnected = false;

  constructor(client: RedisClientType) {
    this.client = client;
    this.client.on("connect", () => {
      this.isConnected = true;
    });
    this.client.on("error", (err) => {
      this.isConnected = false;
      console.warn(JSON.stringify({
        level: "warn",
        message: "Redis connection error",
        error: (err as Error).message,
      }));
    });
  }

  public static async create(config: RedisConfig): Promise<RedisCacheRepository> {
    const client = createClient({
      url: config.url,
      socket: {
        connectTimeout: config.socketTimeoutMs ?? 2000,
        reconnectStrategy(retries) {
          if (retries > 10) return new Error("Redis retry limit exhausted");
          // Exponential backoff with jitter
          return Math.min(retries * 100, 3000) + Math.random() * 100;
        },
      },
    }) as RedisClientType;

    await client.connect();
    return new RedisCacheRepository(client);
  }

  public async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  public async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    await this.client.set(key, value, {
      EX: ttlSeconds,
    });
  }

  public async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  public async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    const result = await this.client.set(key, value, {
      PX: ttlMs,
      NX: true,
    });
    return result === "OK";
  }

  public async close(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.quit();
    }
  }

  public get connected(): boolean {
    return this.isConnected;
  }
}

