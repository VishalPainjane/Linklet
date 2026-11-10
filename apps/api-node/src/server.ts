import dotenv from "dotenv";
import { resolve } from "node:path";
import { createApp } from "./app.js";
import type { ApiServices, HealthCheckService } from "./types.js";
import { UrlService } from "@linklet/core";
import {
  createPgPool,
  PostgresUrlRepository,
  PostgresIdempotencyRepository,
  PostgresAnalyticsRepository,
  runPostgresMigrations,
} from "@linklet/adapter-postgres-node";
import { RedisCacheRepository } from "@linklet/adapter-redis-node";
import { RabbitMqClickEventPublisher } from "@linklet/adapter-rabbitmq";
import { InMemoryDatabase } from "@linklet/database";
import { InMemoryCacheRepository } from "@linklet/cache";
import { InMemoryClickEventPublisher } from "@linklet/events";
import { InMemorySlidingWindowRateLimiter } from "@linklet/rate-limiter";
import type { CacheRepository } from "@linklet/cache";
import type { ClickEventPublisher } from "@linklet/events";
import type {
  UrlRepository,
  IdempotencyRepository,
  AnalyticsRepository,
} from "@linklet/database";

dotenv.config();

async function bootstrap() {
  const port = Number(process.env["PORT"] ?? 3001);
  const dbUrl = process.env["DATABASE_URL"];
  const redisUrl = process.env["REDIS_URL"];
  const rabbitmqUrl = process.env["RABBITMQ_URL"];
  const publicShortDomain = process.env["PUBLIC_SHORT_DOMAIN"] ?? `http://localhost:${port}`;
  const allowedWebOrigins = (process.env["ALLOWED_WEB_ORIGINS"] ?? "http://localhost:3000")
    .split(",")
    .map((s) => s.trim());

  let urlRepo: UrlRepository;
  let idempotencyRepo: IdempotencyRepository;
  let analyticsRepo: AnalyticsRepository;
  let cacheRepo: CacheRepository;
  let eventPublisher: ClickEventPublisher;

  let pgPool: ReturnType<typeof createPgPool> | null = null;
  let redisAdapter: RedisCacheRepository | null = null;
  let rabbitmqPublisher: RabbitMqClickEventPublisher | null = null;

  // 1. PostgreSQL Initialization
  if (dbUrl) {
    try {
      console.log("[db] Connecting to PostgreSQL pool...");
      pgPool = createPgPool({
        connectionString: dbUrl,
        max: Number(process.env["DB_POOL_MAX"] ?? 10),
        idleTimeoutMillis: Number(process.env["DB_POOL_IDLE_TIMEOUT_MS"] ?? 30000),
        connectionTimeoutMillis: Number(process.env["DB_POOL_CONN_TIMEOUT_MS"] ?? 2000),
        statement_timeout: Number(process.env["DB_STATEMENT_TIMEOUT_MS"] ?? 3000),
      });

      // Run SQL migrations on startup
      const migrationsDir = resolve(process.cwd(), "migrations");
      const applied = await runPostgresMigrations(pgPool, migrationsDir);
      console.log(`[db] Migrations applied: ${applied.length > 0 ? applied.join(", ") : "none (up to date)"}`);

      urlRepo = new PostgresUrlRepository(pgPool);
      idempotencyRepo = new PostgresIdempotencyRepository(pgPool);
      analyticsRepo = new PostgresAnalyticsRepository(pgPool);
    } catch (err) {
      console.warn(`[db] PostgreSQL connection failed: ${(err as Error).message}. Falling back to In-Memory DB.`);
      const memDb = new InMemoryDatabase();
      urlRepo = memDb;
      idempotencyRepo = memDb;
      analyticsRepo = memDb;
    }
  } else {
    console.log("[db] DATABASE_URL not set. Using In-Memory Database.");
    const memDb = new InMemoryDatabase();
    urlRepo = memDb;
    idempotencyRepo = memDb;
    analyticsRepo = memDb;
  }

  // 2. Redis Initialization
  if (redisUrl) {
    try {
      console.log("[cache] Connecting to Redis...");
      redisAdapter = await RedisCacheRepository.create({ url: redisUrl });
      cacheRepo = redisAdapter;
      console.log("[cache] Redis connected.");
    } catch (err) {
      console.warn(`[cache] Redis connection failed: ${(err as Error).message}. Falling back to In-Memory LRU Cache.`);
      cacheRepo = new InMemoryCacheRepository(10_000);
    }
  } else {
    console.log("[cache] REDIS_URL not set. Using In-Memory LRU Cache.");
    cacheRepo = new InMemoryCacheRepository(10_000);
  }

  // 3. RabbitMQ Initialization
  if (rabbitmqUrl) {
    try {
      console.log("[queue] Connecting to RabbitMQ publisher confirm channel...");
      rabbitmqPublisher = new RabbitMqClickEventPublisher({
        url: rabbitmqUrl,
        exchange: process.env["RABBITMQ_EXCHANGE"] ?? "analytics.events",
        queue: process.env["RABBITMQ_QUEUE"] ?? "url.clicks.v1",
        routingKey: process.env["RABBITMQ_ROUTING_KEY"] ?? "url.click",
      });
      await rabbitmqPublisher.connect();
      eventPublisher = rabbitmqPublisher;
      console.log("[queue] RabbitMQ publisher ready.");
    } catch (err) {
      console.warn(`[queue] RabbitMQ connection failed: ${(err as Error).message}. Falling back to In-Memory Event Publisher.`);
      eventPublisher = new InMemoryClickEventPublisher();
    }
  } else {
    console.log("[queue] RABBITMQ_URL not set. Using In-Memory Event Publisher.");
    eventPublisher = new InMemoryClickEventPublisher();
  }

  // 4. Rate Limiter
  const rateLimiter = new InMemorySlidingWindowRateLimiter();

  // 5. Core URL Domain Service
  const urlService = new UrlService({
    urlRepo,
    idempotencyRepo,
    cacheRepo,
    eventPublisher,
    config: {
      publicShortDomain,
      defaultCacheTtlSeconds: Number(process.env["CACHE_DEFAULT_TTL_SECONDS"] ?? 900),
      maxAllocationRetries: 5,
    },
  });

  const healthCheck: HealthCheckService = {
    async checkReady() {
      if (pgPool) {
        try {
          await pgPool.query("SELECT 1;");
        } catch {
          return false;
        }
      }
      return true;
    },
  };

  const services: ApiServices = {
    urls: urlService,
    analytics: analyticsRepo,
    rateLimiter,
    health: healthCheck,
    config: {
      port,
      publicShortDomain,
      allowedWebOrigins,
      rateLimit: {
        createWindowSeconds: Number(process.env["RATE_LIMIT_CREATE_WINDOW_SECONDS"] ?? 60),
        createMaxRequests: Number(process.env["RATE_LIMIT_CREATE_MAX_REQUESTS"] ?? 30),
      },
    },
  };

  const app = createApp(services);
  const server = app.listen(port, () => {
    console.log(`[linklet-api] Listening on http://localhost:${port} in ${process.env["NODE_ENV"] ?? "development"} mode`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[shutdown] Received ${signal}. Draining connections...`);
    server.close(async () => {
      console.log("[shutdown] HTTP server closed.");
      try {
        if (rabbitmqPublisher) await rabbitmqPublisher.close();
        if (redisAdapter) await redisAdapter.close();
        if (pgPool) await pgPool.end();
        console.log("[shutdown] All resources drained cleanly. Exiting.");
        process.exit(0);
      } catch (err) {
        console.error("[shutdown] Error during cleanup:", err);
        process.exit(1);
      }
    });

    // Forced exit after 10s timeout
    setTimeout(() => {
      console.error("[shutdown] Forced timeout reached. Exiting immediately.");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((err) => {
  console.error("[bootstrap] Fatal startup error:", err);
  process.exit(1);
});

