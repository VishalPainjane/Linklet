/**
 * Rate Limiter contracts and algorithms
 */

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

/**
 * Sliding log rate limiter in memory (suitable for single process / tests).
 * Eliminates edge burst issues of fixed windows.
 */
export class InMemorySlidingWindowRateLimiter implements RateLimiter {
  private readonly logs = new Map<string, number[]>();

  public async check(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = now - windowMs;

    let timestamps = this.logs.get(key);
    if (!timestamps) {
      timestamps = [];
      this.logs.set(key, timestamps);
    }

    // Filter out timestamps outside the current window
    const validTimestamps = timestamps.filter((t) => t > windowStart);
    this.logs.set(key, validTimestamps);

    if (validTimestamps.length >= limit) {
      const oldest = validTimestamps[0]!;
      const resetAfterSeconds = Math.ceil((oldest + windowMs - now) / 1000);
      return {
        allowed: false,
        limit,
        remaining: 0,
        resetAfterSeconds: Math.max(1, resetAfterSeconds),
      };
    }

    validTimestamps.push(now);
    return {
      allowed: true,
      limit,
      remaining: limit - validTimestamps.length,
      resetAfterSeconds: windowSeconds,
    };
  }

  public clear(): void {
    this.logs.clear();
  }
}

/**
 * Atomic Lua script for Redis fixed-window rate limiting
 * Avoids race condition where process dies between INCR and EXPIRE
 */
export const REDIS_FIXED_WINDOW_LUA_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

