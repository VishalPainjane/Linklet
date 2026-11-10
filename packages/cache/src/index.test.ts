import { describe, it, expect } from "vitest";
import {
  LruCache,
  SingleFlight,
  calculateCacheTtlSeconds,
  InMemoryCacheRepository,
} from "./index.js";

describe("LruCache", () => {
  it("stores and retrieves values with O(1) eviction when capacity is exceeded", () => {
    const lru = new LruCache<string>(3);
    lru.set("a", "1");
    lru.set("b", "2");
    lru.set("c", "3");

    expect(lru.get("a")).toBe("1"); // touches "a", so order MRU -> a, c, b (LRU)
    lru.set("d", "4"); // should evict "b"

    expect(lru.get("b")).toBeNull();
    expect(lru.get("a")).toBe("1");
    expect(lru.get("c")).toBe("3");
    expect(lru.get("d")).toBe("4");

    const stats = lru.getStats();
    expect(stats.size).toBe(3);
    expect(stats.evictions).toBe(1);
  });

  it("expires keys based on TTL", async () => {
    const lru = new LruCache<string>(10);
    lru.set("temp", "val", 0.05); // 50ms TTL

    expect(lru.get("temp")).toBe("val");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(lru.get("temp")).toBeNull();
  });

  it("handles deletion and update correctly", () => {
    const lru = new LruCache<string>(5);
    lru.set("k1", "v1");
    expect(lru.delete("k1")).toBe(true);
    expect(lru.delete("k1")).toBe(false);
    expect(lru.get("k1")).toBeNull();

    lru.set("k2", "v2");
    lru.set("k2", "v2_updated");
    expect(lru.get("k2")).toBe("v2_updated");
    expect(lru.getStats().size).toBe(1);
  });
});

describe("SingleFlight", () => {
  it("collapses duplicate concurrent executions into a single invocation", async () => {
    const sf = new SingleFlight<string>();
    let invocationCount = 0;

    const slowQuery = async () => {
      invocationCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return "db_result";
    };

    // Dispatch 50 concurrent calls for the same key
    const promises = Array.from({ length: 50 }, () => sf.do("popular_code", slowQuery));
    const results = await Promise.all(promises);

    expect(invocationCount).toBe(1);
    for (const res of results) {
      expect(res).toBe("db_result");
    }
    expect(sf.activeCount).toBe(0);
  });

  it("propagates error to all concurrent callers and cleans up inFlight map", async () => {
    const sf = new SingleFlight<string>();
    const failingQuery = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      throw new Error("DB connection timeout");
    };

    const promises = Array.from({ length: 10 }, () => sf.do("err_key", failingQuery));
    await expect(Promise.all(promises)).rejects.toThrow("DB connection timeout");
    expect(sf.activeCount).toBe(0);
  });
});

describe("calculateCacheTtlSeconds", () => {
  it("returns configured max when expiresAt is null", () => {
    expect(calculateCacheTtlSeconds(null, 900)).toBe(900);
  });

  it("returns remaining seconds when expiresAt is in the future", () => {
    const now = Date.now();
    const expiresAt = new Date(now + 120 * 1000); // 120s in future
    expect(calculateCacheTtlSeconds(expiresAt, 900, now)).toBe(120);
  });

  it("caps at maxTtlSeconds if remaining is longer than max", () => {
    const now = Date.now();
    const expiresAt = new Date(now + 3600 * 1000); // 1 hour in future
    expect(calculateCacheTtlSeconds(expiresAt, 900, now)).toBe(900);
  });

  it("returns 0 if already expired", () => {
    const now = Date.now();
    const expiresAt = new Date(now - 1000);
    expect(calculateCacheTtlSeconds(expiresAt, 900, now)).toBe(0);
  });
});

describe("InMemoryCacheRepository", () => {
  it("implements setIfAbsent atomically", async () => {
    const repo = new InMemoryCacheRepository();
    expect(await repo.setIfAbsent("lock:1", "tokenA", 1000)).toBe(true);
    expect(await repo.setIfAbsent("lock:1", "tokenB", 1000)).toBe(false);
    expect(await repo.get("lock:1")).toBe("tokenA");
  });
});

