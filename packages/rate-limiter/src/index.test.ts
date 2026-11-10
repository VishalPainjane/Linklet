import { describe, it, expect } from "vitest";
import { InMemorySlidingWindowRateLimiter } from "./index.js";

describe("InMemorySlidingWindowRateLimiter", () => {
  it("allows requests up to the limit and then blocks with reset time", async () => {
    const limiter = new InMemorySlidingWindowRateLimiter();
    const key = "ip:127.0.0.1";
    const limit = 3;
    const windowSec = 60;

    const r1 = await limiter.check(key, limit, windowSec);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = await limiter.check(key, limit, windowSec);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await limiter.check(key, limit, windowSec);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    // 4th request exceeds limit
    const r4 = await limiter.check(key, limit, windowSec);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.resetAfterSeconds).toBeGreaterThan(0);
  });
});

