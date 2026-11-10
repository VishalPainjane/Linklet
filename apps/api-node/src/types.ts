import type { UrlService } from "@linklet/core";
import type { AnalyticsRepository } from "@linklet/database";
import type { RateLimiter } from "@linklet/rate-limiter";

export interface ApiConfig {
  port: number;
  publicShortDomain: string;
  allowedWebOrigins: string[];
  rateLimit: {
    createWindowSeconds: number;
    createMaxRequests: number;
  };
}

export interface HealthCheckService {
  checkReady(): Promise<boolean>;
}

export interface ApiServices {
  urls: UrlService;
  analytics?: AnalyticsRepository;
  rateLimiter?: RateLimiter;
  health: HealthCheckService;
  config: ApiConfig;
}

