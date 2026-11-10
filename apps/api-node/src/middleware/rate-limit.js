import { RateLimitExceededError } from "@linklet/shared-types";
export function createRateLimitMiddleware(limiter, limit, windowSeconds, keyPrefix = "rl") {
    if (!limiter) {
        return (_req, _res, next) => next();
    }
    return async (req, res, next) => {
        // Client IP handling - express ip is populated based on trust proxy settings
        const clientIp = req.ip || req.socket.remoteAddress || "127.0.0.1";
        const key = `${keyPrefix}:${clientIp}`;
        try {
            const result = await limiter.check(key, limit, windowSeconds);
            res.setHeader("X-RateLimit-Limit", result.limit);
            res.setHeader("X-RateLimit-Remaining", result.remaining);
            res.setHeader("X-RateLimit-Reset", result.resetAfterSeconds);
            if (!result.allowed) {
                res.setHeader("Retry-After", result.resetAfterSeconds);
                throw new RateLimitExceededError(result.resetAfterSeconds);
            }
            next();
        }
        catch (err) {
            next(err);
        }
    };
}
//# sourceMappingURL=rate-limit.js.map