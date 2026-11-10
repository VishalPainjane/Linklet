import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import type { ApiServices } from "./types.js";
export type { ApiServices, ApiConfig, HealthCheckService } from "./types.js";
import { createUrlRouter } from "./routes/url.routes.js";
import { createRedirectRouter } from "./routes/redirect.routes.js";
import { notFound } from "./middleware/not-found.js";
import { errorHandler } from "./middleware/error-handler.js";

export function createApp(services: ApiServices): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(
    cors({
      origin: services.config.allowedWebOrigins,
      credentials: false,
    }),
  );
  app.use(express.json({ limit: "16kb" }));

  // Liveness probe
  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  // Readiness probe
  app.get("/ready", async (_req, res, next) => {
    try {
      const isReady = await services.health.checkReady();
      if (isReady) {
        res.status(200).json({ ready: true });
      } else {
        res.status(503).json({ ready: false });
      }
    } catch (err) {
      next(err);
    }
  });

  // Mount API router under versioned path /api/v1
  app.use("/api/v1", createUrlRouter(services));

  // Mount Redirect router on root (must be after /api/v1 and health routes)
  app.use("/", createRedirectRouter(services));

  // 404 handler for unmatched routes
  app.use(notFound);

  // Central error handling middleware
  app.use(errorHandler);

  return app;
}

