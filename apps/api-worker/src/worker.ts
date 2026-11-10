import { httpServerHandler } from "cloudflare:node";
import { createApp } from "@linklet/api-node";
import type { ApiServices } from "@linklet/api-node";
import { UrlService } from "@linklet/core";
import {
  HyperdriveUrlRepository,
  HyperdriveIdempotencyRepository,
  HyperdriveAnalyticsRepository,
} from "@linklet/adapter-postgres-hyperdrive";
import { UpstashRedisCacheRepository } from "@linklet/adapter-redis-upstash";
import { CloudflareQueueClickEventPublisher } from "@linklet/adapter-cloudflare-queues";

export interface Env {
  HYPERDRIVE: {
    connectionString: string;
  };
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  CLICK_EVENTS: {
    send(message: unknown): Promise<void>;
  };
  PUBLIC_SHORT_DOMAIN?: string;
  ALLOWED_WEB_ORIGINS?: string;
}

function createWorkerApp(env: Env) {
  const dbConn = env.HYPERDRIVE.connectionString;
  const urlRepo = new HyperdriveUrlRepository(dbConn);
  const idempotencyRepo = new HyperdriveIdempotencyRepository(dbConn);
  const analyticsRepo = new HyperdriveAnalyticsRepository(dbConn);

  const cacheRepo = new UpstashRedisCacheRepository({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });

  const eventPublisher = new CloudflareQueueClickEventPublisher(env.CLICK_EVENTS);

  const publicShortDomain = env.PUBLIC_SHORT_DOMAIN ?? "https://short.domain";
  const allowedWebOrigins = (env.ALLOWED_WEB_ORIGINS ?? "*").split(",").map((s) => s.trim());

  const urlService = new UrlService({
    urlRepo,
    idempotencyRepo,
    cacheRepo,
    eventPublisher,
    config: {
      publicShortDomain,
      defaultCacheTtlSeconds: 900,
      maxAllocationRetries: 5,
    },
  });

  const services: ApiServices = {
    urls: urlService,
    analytics: analyticsRepo,
    health: {
      async checkReady() {
        return true;
      },
    },
    config: {
      port: 3000,
      publicShortDomain,
      allowedWebOrigins,
      rateLimit: {
        createWindowSeconds: 60,
        createMaxRequests: 30,
      },
    },
  };

  return createApp(services);
}

// Global handler export for Cloudflare Workers nodejs_compat
let cachedHandler: any = null;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!cachedHandler) {
      const app = createWorkerApp(env);
      app.listen(3000);
      cachedHandler = httpServerHandler({ port: 3000 });
    }
    return cachedHandler.fetch(request, env, ctx);
  },
};

