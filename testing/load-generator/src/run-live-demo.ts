import type { Server } from "node:http";
import { createApp } from "@linklet/api-node";
import { UrlService } from "@linklet/core";
import { InMemoryDatabase } from "@linklet/database";
import { InMemoryCacheRepository } from "@linklet/cache";
import { InMemoryClickEventPublisher } from "@linklet/events";
import { InMemorySlidingWindowRateLimiter } from "@linklet/rate-limiter";
import type { ApiServices } from "@linklet/api-node";
import { LoadEngine } from "./engine.js";
import { BenchmarkReporter } from "./reporter.js";

async function runLiveBenchmarkDemo() {
  const port = 3001;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`[demo] Initializing Linklet API server on ${baseUrl}...`);

  const db = new InMemoryDatabase();
  const cache = new InMemoryCacheRepository(50_000);
  const publisher = new InMemoryClickEventPublisher();
  const rateLimiter = new InMemorySlidingWindowRateLimiter();

  // Pre-seed 100 warm links in database and warm cache
  console.log("[demo] Pre-seeding database & cache with 100 warm links...");
  for (let i = 0; i < 100; i++) {
    await db.insert({
      code: `warm_${i}`,
      destinationUrl: `https://example.com/target/${i}`,
      ownerId: null,
      isCustom: true,
      expiresAt: null,
    });
    // Prime cache
    await cache.set(
      `url:warm_${i}`,
      JSON.stringify({
        code: `warm_${i}`,
        destinationUrl: `https://example.com/target/${i}`,
        expiresAt: null,
        disabled: false,
      }),
      900,
    );
  }

  const urlService = new UrlService({
    urlRepo: db,
    idempotencyRepo: db,
    cacheRepo: cache,
    eventPublisher: publisher,
    config: {
      publicShortDomain: baseUrl,
      defaultCacheTtlSeconds: 900,
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
      port,
      publicShortDomain: baseUrl,
      allowedWebOrigins: ["*"],
      rateLimit: {
        createWindowSeconds: 60,
        createMaxRequests: 100000,
      },
    },
  };

  const app = createApp(services);
  let server: Server;

  await new Promise<void>((resolve) => {
    server = app.listen(port, () => {
      console.log(`[demo] Linklet API listening on ${baseUrl}`);
      resolve();
    });
  });

  try {
    console.log("\n================================================================================");
    console.log(" EXPERIMENT 1: HIGH-CONCURRENCY CLOSED WORKLOAD (50 Virtual Users)");
    console.log("================================================================================");

    const closedEngine = new LoadEngine({
      baseUrl,
      scenario: "redirect-warm",
      model: "closed",
      durationSeconds: 3,
      virtualUsers: 50,
      maxConnections: 50,
    });

    const closedReport = await closedEngine.run();
    BenchmarkReporter.printSummary(closedReport);

    console.log("\n================================================================================");
    console.log(" EXPERIMENT 2: OPEN WORKLOAD (Scheduled Arrival Rate 1,500 RPS)");
    console.log("================================================================================");

    const openEngine = new LoadEngine({
      baseUrl,
      scenario: "redirect-warm",
      model: "open",
      durationSeconds: 3,
      targetRps: 1500,
      maxConnections: 50,
    });

    const openReport = await openEngine.run();
    BenchmarkReporter.printSummary(openReport);
  } finally {
    server!.close();
    console.log("[demo] Live benchmark completed and server stopped.");
  }
}

runLiveBenchmarkDemo().catch(console.error);

