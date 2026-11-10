import { Router } from "express";
import { createRateLimitMiddleware } from "../middleware/rate-limit.js";
import { idempotencyKeyHeaderSchema, validate } from "@linklet/validation";
export function createUrlRouter(services) {
    const router = Router();
    const createRateLimit = createRateLimitMiddleware(services.rateLimiter, services.config.rateLimit.createMaxRequests, services.config.rateLimit.createWindowSeconds, "create");
    // POST /api/v1/urls
    router.post("/urls", createRateLimit, async (req, res, next) => {
        try {
            const idempotencyKey = req.header("Idempotency-Key");
            let validatedIdempotencyKey;
            if (idempotencyKey) {
                validatedIdempotencyKey = validate(idempotencyKeyHeaderSchema, idempotencyKey);
            }
            const clientIp = req.ip || req.socket.remoteAddress || "127.0.0.1";
            const result = await services.urls.create({
                destinationUrl: req.body?.url,
                customAlias: req.body?.customAlias,
                expiresAt: req.body?.expiresAt ? new Date(req.body.expiresAt) : null,
                idempotencyKey: validatedIdempotencyKey,
                principalKey: `ip:${clientIp}`,
            });
            res.status(201).json(result);
        }
        catch (err) {
            next(err);
        }
    });
    // GET /api/v1/urls/:code
    router.get("/urls/:code", async (req, res, next) => {
        try {
            const record = await services.urls.getMetadata(req.params.code);
            res.status(200).json(record);
        }
        catch (err) {
            next(err);
        }
    });
    // DELETE /api/v1/urls/:code
    router.delete("/urls/:code", async (req, res, next) => {
        try {
            const disabled = await services.urls.disable(req.params.code);
            if (!disabled) {
                res.status(404).json({ error: "not_found", message: "Short URL not found or already disabled" });
                return;
            }
            res.status(200).json({ ok: true });
        }
        catch (err) {
            next(err);
        }
    });
    // GET /api/v1/urls/:code/stats
    router.get("/urls/:code/stats", async (req, res, next) => {
        try {
            if (!services.analytics) {
                res.status(501).json({ error: "analytics_disabled", message: "Analytics repository is not enabled" });
                return;
            }
            const stats = await services.analytics.getStats(req.params.code);
            if (!stats) {
                // Return baseline zero-click record if url exists
                await services.urls.getMetadata(req.params.code); // verifies existence, throws 404 if not found
                res.status(200).json({
                    code: req.params.code,
                    clickCount: 0,
                    lastClickedAt: null,
                    updatedAt: new Date(),
                });
                return;
            }
            res.status(200).json(stats);
        }
        catch (err) {
            next(err);
        }
    });
    return router;
}
//# sourceMappingURL=url.routes.js.map