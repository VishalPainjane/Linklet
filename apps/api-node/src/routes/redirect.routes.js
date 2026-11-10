import { Router } from "express";
export function createRedirectRouter(services) {
    const router = Router();
    const handleRedirect = async (req, res, next) => {
        try {
            const code = req.params.code;
            const meta = {
                referrer: req.header("Referer") || req.header("Referrer") || null,
                userAgent: req.header("User-Agent") || null,
                countryCode: req.header("CF-IPCountry") || null, // Cloudflare edge header if available
            };
            const resolution = await services.urls.resolve(code, meta);
            if (resolution.state === "not_found") {
                res.status(404).json({
                    error: "not_found",
                    message: "Short URL does not exist",
                });
                return;
            }
            if (resolution.state === "expired" || resolution.state === "disabled") {
                res.status(410).json({
                    error: "link_unavailable",
                    message: `This short link has been ${resolution.state}`,
                });
                return;
            }
            // Valid active short link -> HTTP 302 Found redirect
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Referrer-Policy", "no-referrer");
            if (req.method === "HEAD") {
                res.setHeader("Location", resolution.url);
                res.status(302).end();
                return;
            }
            res.redirect(302, resolution.url);
        }
        catch (err) {
            next(err);
        }
    };
    router.get("/:code", handleRedirect);
    router.head("/:code", handleRedirect);
    return router;
}
//# sourceMappingURL=redirect.routes.js.map