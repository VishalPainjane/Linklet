import type { RequestHandler } from "express";
import type { RateLimiter } from "@linklet/rate-limiter";
export declare function createRateLimitMiddleware(limiter: RateLimiter | undefined, limit: number, windowSeconds: number, keyPrefix?: string): RequestHandler;
//# sourceMappingURL=rate-limit.d.ts.map