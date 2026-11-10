import { describe, it, expect } from "vitest";
import { UrlService } from "./index.js";
import { InMemoryDatabase } from "@linklet/database";
import { InMemoryCacheRepository } from "@linklet/cache";
import { InMemoryClickEventPublisher } from "@linklet/events";
import {
  DeterministicCodeGenerator,
  CryptoCodeGenerator,
} from "@linklet/code-generator";
import {
  ConflictError,
  RetryableAllocationError,
} from "@linklet/shared-types";

function createTestHarness(customGenerator?: any) {
  const db = new InMemoryDatabase();
  const cache = new InMemoryCacheRepository();
  const publisher = new InMemoryClickEventPublisher();
  const generator = customGenerator ?? new CryptoCodeGenerator();

  const service = new UrlService({
    urlRepo: db,
    idempotencyRepo: db,
    cacheRepo: cache,
    codeGenerator: generator,
    eventPublisher: publisher,
    config: {
      publicShortDomain: "https://sho.rt",
      defaultCacheTtlSeconds: 300,
      maxAllocationRetries: 3,
    },
  });

  return { service, db, cache, publisher };
}

describe("UrlService", () => {
  it("creates a short link with generated code and resolves it", async () => {
    const { service, cache, publisher } = createTestHarness();

    const created = await service.create({
      destinationUrl: "https://example.com/test-article",
    });

    expect(created.code).toHaveLength(8);
    expect(created.shortUrl).toBe(`https://sho.rt/${created.code}`);
    expect(created.destinationUrl).toBe("https://example.com/test-article");

    // 1st resolution: Cold miss -> reads DB, populates cache
    const res1 = await service.resolve(created.code);
    expect(res1.state).toBe("active");
    expect(res1.url).toBe("https://example.com/test-article");

    // Verify cache is now populated
    const cached = await cache.get(`url:${created.code}`);
    expect(cached).not.toBeNull();

    // 2nd resolution: Cache hit
    const res2 = await service.resolve(created.code);
    expect(res2.state).toBe("active");
    expect(res2.url).toBe("https://example.com/test-article");

    // Wait for setImmediate background event
    await new Promise((r) => setTimeout(r, 20));
    expect(publisher.publishedEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("handles custom alias and throws ConflictError on duplicates", async () => {
    const { service } = createTestHarness();

    const res1 = await service.create({
      destinationUrl: "https://example.com/first",
      customAlias: "engineering",
    });
    expect(res1.code).toBe("engineering");

    await expect(
      service.create({
        destinationUrl: "https://example.com/second",
        customAlias: "engineering",
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("recovers from code collision using bounded retry loop", async () => {
    // Simulator sequence: yields COLLIDE1 twice, then UNIQUE01
    const deterministicGen = new DeterministicCodeGenerator([
      "COLLIDE1",
      "COLLIDE1",
      "UNIQUE01",
    ]);
    const { service, db } = createTestHarness(deterministicGen);

    // Pre-insert "COLLIDE1" in DB to force collision
    await db.insert({
      code: "COLLIDE1",
      destinationUrl: "https://example.com/existing",
      ownerId: null,
      isCustom: false,
      expiresAt: null,
    });

    // create should collide on first attempt and succeed on second attempt
    const created = await service.create({
      destinationUrl: "https://example.com/retry-test",
    });

    expect(created.code).toBe("UNIQUE01");
  });

  it("throws RetryableAllocationError when retries are exhausted", async () => {
    // Generator always yields the same colliding code
    const deterministicGen = new DeterministicCodeGenerator(["EXHAUSTED"]);
    const { service, db } = createTestHarness(deterministicGen);

    await db.insert({
      code: "EXHAUSTED",
      destinationUrl: "https://example.com/existing",
      ownerId: null,
      isCustom: false,
      expiresAt: null,
    });

    await expect(
      service.create({
        destinationUrl: "https://example.com/fail-test",
      }),
    ).rejects.toThrow(RetryableAllocationError);
  });

  it("implements transactional idempotency", async () => {
    const { service } = createTestHarness();

    const first = await service.create({
      destinationUrl: "https://example.com/idempotent",
      idempotencyKey: "idem-key-100",
    });

    // Replay with identical payload returns exact same response
    const replay = await service.create({
      destinationUrl: "https://example.com/idempotent",
      idempotencyKey: "idem-key-100",
    });

    expect(replay.code).toBe(first.code);
    expect(replay.shortUrl).toBe(first.shortUrl);

    // Replay with DIFFERENT payload throws ConflictError
    await expect(
      service.create({
        destinationUrl: "https://example.com/different-url",
        idempotencyKey: "idem-key-100",
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("disables link and invalidates cache", async () => {
    const { service, cache } = createTestHarness();

    const created = await service.create({
      destinationUrl: "https://example.com/to-disable",
    });

    // Warm cache
    await service.resolve(created.code);
    expect(await cache.get(`url:${created.code}`)).not.toBeNull();

    // Disable
    const disabled = await service.disable(created.code);
    expect(disabled).toBe(true);

    // Cache entry must have been invalidated
    expect(await cache.get(`url:${created.code}`)).toBeNull();

    // Subsequent resolution must return state "disabled"
    const resolution = await service.resolve(created.code);
    expect(resolution.state).toBe("disabled");
  });

  it("resolves expired links as expired", async () => {
    const { service, db } = createTestHarness();

    // Insert an already expired link directly into DB
    const past = new Date(Date.now() - 5000);
    await db.insert({
      code: "expired1",
      destinationUrl: "https://example.com/old",
      ownerId: null,
      isCustom: false,
      expiresAt: past,
    });

    const resolution = await service.resolve("expired1");
    expect(resolution.state).toBe("expired");
  });
});

