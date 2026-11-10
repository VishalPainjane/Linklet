import { describe, it, expect, vi } from "vitest";
import { UrlService } from "@linklet/core";
import { InMemoryDatabase } from "@linklet/database";
import { InMemoryCacheRepository } from "@linklet/cache";
import { InMemoryClickEventPublisher } from "@linklet/events";
import { ConflictError } from "@linklet/shared-types";

describe("Systems Engineering Concurrency Harness", () => {
  it("claims custom alias concurrently: exactly one succeeds among 1,000 concurrent attempts", async () => {
    const db = new InMemoryDatabase();
    const cache = new InMemoryCacheRepository();
    const publisher = new InMemoryClickEventPublisher();

    const service = new UrlService({
      urlRepo: db,
      idempotencyRepo: db,
      cacheRepo: cache,
      eventPublisher: publisher,
    });

    const targetAlias = "the-one-and-only";
    const totalRequests = 1000;

    let successes = 0;
    let conflicts = 0;

    const attempts = Array.from({ length: totalRequests }, async (_, i) => {
      try {
        await service.create({
          destinationUrl: `https://example.com/competitor/${i}`,
          customAlias: targetAlias,
        });
        successes += 1;
      } catch (err) {
        if (err instanceof ConflictError) {
          conflicts += 1;
        } else {
          throw err;
        }
      }
    });

    await Promise.all(attempts);

    expect(successes).toBe(1);
    expect(conflicts).toBe(totalRequests - 1);
  });

  it("creates independent unique short links for 500 concurrent identical destinations", async () => {
    const db = new InMemoryDatabase();
    const cache = new InMemoryCacheRepository();
    const publisher = new InMemoryClickEventPublisher();

    const service = new UrlService({
      urlRepo: db,
      idempotencyRepo: db,
      cacheRepo: cache,
      eventPublisher: publisher,
    });

    const destination = "https://example.com/popular-article";
    const totalRequests = 500;

    const promises = Array.from({ length: totalRequests }, () =>
      service.create({ destinationUrl: destination }),
    );

    const results = await Promise.all(promises);
    expect(results).toHaveLength(totalRequests);

    const uniqueCodes = new Set(results.map((r) => r.code));
    expect(uniqueCodes.size).toBe(totalRequests);
  });

  it("handles 500 concurrent requests with same idempotency key: exactly one URL created, all return same response", async () => {
    const db = new InMemoryDatabase();
    const cache = new InMemoryCacheRepository();
    const publisher = new InMemoryClickEventPublisher();

    const service = new UrlService({
      urlRepo: db,
      idempotencyRepo: db,
      cacheRepo: cache,
      eventPublisher: publisher,
    });

    const totalRequests = 500;
    const idempotencyKey = "concurrent-idem-key-777";
    const destination = "https://example.com/idempotent-concurrent";

    const promises = Array.from({ length: totalRequests }, () =>
      service.create({
        destinationUrl: destination,
        idempotencyKey,
        principalKey: "user:worker-1",
      }),
    );

    const results = await Promise.all(promises);
    expect(results).toHaveLength(totalRequests);

    const firstCode = results[0]!.code;
    for (const r of results) {
      expect(r.code).toBe(firstCode);
      expect(r.destinationUrl).toBe(destination);
    }
  });

  it("single-flight eliminates cache stampede on popular miss under 1,000 concurrent resolvers", async () => {
    const db = new InMemoryDatabase();
    const cache = new InMemoryCacheRepository();
    const publisher = new InMemoryClickEventPublisher();

    // Insert a destination in DB but do not warm cache
    await db.insert({
      code: "viral-hit",
      destinationUrl: "https://example.com/viral",
      ownerId: null,
      isCustom: true,
      expiresAt: null,
    });

    let dbQueryCount = 0;
    const originalFindByCode = db.findByCode.bind(db);
    db.findByCode = async (code: string) => {
      dbQueryCount += 1;
      // Inject realistic 20ms I/O delay
      await new Promise((resolve) => setTimeout(resolve, 20));
      return originalFindByCode(code);
    };

    const service = new UrlService({
      urlRepo: db,
      idempotencyRepo: db,
      cacheRepo: cache,
      eventPublisher: publisher,
    });

    // 1,000 concurrent requests for cold key
    const totalRequests = 1000;
    const promises = Array.from({ length: totalRequests }, () =>
      service.resolve("viral-hit"),
    );

    const results = await Promise.all(promises);

    // Without single-flight, dbQueryCount would be 1000.
    // With single-flight, dbQueryCount is 1!
    expect(dbQueryCount).toBe(1);

    for (const res of results) {
      expect(res.state).toBe("active");
      expect(res.url).toBe("https://example.com/viral");
    }
  });
});

