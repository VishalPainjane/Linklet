import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { createApp } from "@linklet/api-node";
import type { ApiServices } from "@linklet/api-node";
import { UrlService } from "@linklet/core";
import { InMemoryDatabase } from "@linklet/database";
import { InMemoryCacheRepository } from "@linklet/cache";
import { InMemoryClickEventPublisher } from "@linklet/events";
import { InMemorySlidingWindowRateLimiter } from "@linklet/rate-limiter";
import { LoadEngine } from "./engine.js";

describe("LoadEngine Integration Benchmark", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const db = new InMemoryDatabase();
    const cache = new InMemoryCacheRepository();
    const publisher = new InMemoryClickEventPublisher();
    const rateLimiter = new InMemorySlidingWindowRateLimiter();

    // Pre-populate database with warm and zipf test records
    for (let i = 0; i < 50; i++) {
      await db.insert({
        code: `warm_${i}`,
        destinationUrl: `https://example.com/warm/${i}`,
        ownerId: null,
        isCustom: true,
        expiresAt: null,
      });
    }

    for (let i = 0; i < 1000; i++) {
      await db.insert({
        code: `zipf_${i}`,
        destinationUrl: `https://example.com/zipf/${i}`,
        ownerId: null,
        isCustom: true,
        expiresAt: null,
      });
    }

    const urlService = new UrlService({
      urlRepo: db,
      idempotencyRepo: db,
      cacheRepo: cache,
      eventPublisher: publisher,
      config: {
        publicShortDomain: "http://localhost",
        defaultCacheTtlSeconds: 300,
        maxAllocationRetries: 5,
      },
    });

    const services: ApiServices = {
      urls: urlService,
      analytics: db,
      rateLimiter,
      health: {
        async checkReady() {
          return true;
        },
      },
      config: {
        port: 0,
        publicShortDomain: "http://localhost",
        allowedWebOrigins: ["*"],
        rateLimit: {
          createWindowSeconds: 60,
          createMaxRequests: 10000,
        },
      },
    };

    const app = createApp(services);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("executes closed workload scenario with high throughput and accurate percentiles", async () => {
    const engine = new LoadEngine({
      baseUrl,
      scenario: "redirect-warm",
      model: "closed",
      durationSeconds: 2,
      virtualUsers: 20,
      maxConnections: 20,
    });

    const report = await engine.run();

    expect(report.scenario).toBe("redirect-warm");
    expect(report.model).toBe("closed");
    expect(report.requestsCompleted).toBeGreaterThan(100);
    expect(report.throughputRps).toBeGreaterThan(50);
    expect(report.timeouts).toBe(0);
    expect(report.networkErrors).toBe(0);

    // Warm redirects should return HTTP 302
    expect(report.statusCodes["302"]).toBeGreaterThan(100);

    // Latency checks
    const lat = report.latencyMs;
    expect(lat.count).toBe(report.requestsCompleted);
    expect(lat.p50).toBeGreaterThan(0);
    expect(lat.p99).toBeGreaterThanOrEqual(lat.p50);
    expect(lat.max).toBeGreaterThanOrEqual(lat.p99);

    // Generator metrics
    expect(report.generator.rssMb).toBeGreaterThan(0);
  });

  it("executes open workload scenario at scheduled target rate", async () => {
    const targetRps = 200;
    const engine = new LoadEngine({
      baseUrl,
      scenario: "redirect-zipf",
      model: "open",
      durationSeconds: 2,
      targetRps,
      maxConnections: 20,
    });

    const report = await engine.run();

    expect(report.scenario).toBe("redirect-zipf");
    expect(report.model).toBe("open");
    expect(report.requestsScheduled).toBeGreaterThanOrEqual(300);
    expect(report.requestsCompleted).toBeGreaterThan(100);
    expect(report.throughputRps).toBeGreaterThan(50);
    expect(report.latencyMs.p50).toBeGreaterThan(0);
  });
});
