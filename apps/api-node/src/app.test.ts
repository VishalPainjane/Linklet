import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import type { ApiServices } from "./types.js";
import { UrlService } from "@linklet/core";
import { InMemoryDatabase } from "@linklet/database";
import { InMemoryCacheRepository } from "@linklet/cache";
import { InMemoryClickEventPublisher } from "@linklet/events";
import { InMemorySlidingWindowRateLimiter } from "@linklet/rate-limiter";

describe("API Node Integration", () => {
  let app: ReturnType<typeof createApp>;
  let db: InMemoryDatabase;
  let cache: InMemoryCacheRepository;
  let publisher: InMemoryClickEventPublisher;

  beforeEach(() => {
    db = new InMemoryDatabase();
    cache = new InMemoryCacheRepository();
    publisher = new InMemoryClickEventPublisher();
    const rateLimiter = new InMemorySlidingWindowRateLimiter();

    const urlService = new UrlService({
      urlRepo: db,
      idempotencyRepo: db,
      cacheRepo: cache,
      eventPublisher: publisher,
      config: {
        publicShortDomain: "http://localhost:3001",
        defaultCacheTtlSeconds: 300,
        maxAllocationRetries: 5,
      },
    });

    const services: ApiServices = {
      urls: urlService,
      analytics: db,
      rateLimiter,
      health: {
        async checkReady() {
          return true;
        },
      },
      config: {
        port: 3001,
        publicShortDomain: "http://localhost:3001",
        allowedWebOrigins: ["http://localhost:3000"],
        rateLimit: {
          createWindowSeconds: 60,
          createMaxRequests: 50,
        },
      },
    };

    app = createApp(services);
  });

  it("GET /health returns 200 ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("GET /ready returns 200 ready", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ready: true });
  });

  it("POST /api/v1/urls creates a short link and returns 201 Created", async () => {
    const res = await request(app)
      .post("/api/v1/urls")
      .send({ url: "https://news.ycombinator.com" });

    expect(res.status).toBe(201);
    expect(res.body.code).toBeDefined();
    expect(res.body.destinationUrl).toBe("https://news.ycombinator.com");
    expect(res.body.shortUrl).toBe(`http://localhost:3001/${res.body.code}`);
  });

  it("POST /api/v1/urls rejects invalid URL with 422", async () => {
    const res = await request(app)
      .post("/api/v1/urls")
      .send({ url: "javascript:alert(1)" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("validation_error");
  });

  it("POST /api/v1/urls creates custom alias and rejects duplicates with 409", async () => {
    const res1 = await request(app)
      .post("/api/v1/urls")
      .send({ url: "https://example.com/sys-eng", customAlias: "syseng" });

    expect(res1.status).toBe(201);
    expect(res1.body.code).toBe("syseng");

    const res2 = await request(app)
      .post("/api/v1/urls")
      .send({ url: "https://example.com/duplicate", customAlias: "syseng" });

    expect(res2.status).toBe(409);
    expect(res2.body.error).toBe("conflict");
  });

  it("POST /api/v1/urls rejects reserved alias names with 422", async () => {
    const res = await request(app)
      .post("/api/v1/urls")
      .send({ url: "https://example.com/test", customAlias: "health" });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("validation_error");
  });

  it("GET /:code returns 302 Found redirect with no-store and Location header", async () => {
    const createRes = await request(app)
      .post("/api/v1/urls")
      .send({ url: "https://example.com/target-destination" });

    const code = createRes.body.code;

    const res = await request(app).get(`/${code}`).redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("https://example.com/target-destination");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("HEAD /:code returns 302 Found with headers and empty body", async () => {
    const createRes = await request(app)
      .post("/api/v1/urls")
      .send({ url: "https://example.com/head-test" });

    const code = createRes.body.code;
    const res = await request(app).head(`/${code}`);

    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("https://example.com/head-test");
    expect(res.text).toBeUndefined();
  });

  it("GET /:code returns 404 for unknown codes", async () => {
    const res = await request(app).get("/nonexistent");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("not_found");
  });

  it("DELETE /api/v1/urls/:code disables link and subsequent redirect returns 410", async () => {
    const createRes = await request(app)
      .post("/api/v1/urls")
      .send({ url: "https://example.com/will-disable" });

    const code = createRes.body.code;

    const delRes = await request(app).delete(`/api/v1/urls/${code}`);
    expect(delRes.status).toBe(200);

    const redirectRes = await request(app).get(`/${code}`);
    expect(redirectRes.status).toBe(410);
    expect(redirectRes.body.error).toBe("link_unavailable");
  });

  it("supports Idempotency-Key header on creation", async () => {
    const idemKey = "idem-test-999";
    const body = { url: "https://example.com/idempotent-api" };

    const first = await request(app)
      .post("/api/v1/urls")
      .set("Idempotency-Key", idemKey)
      .send(body);

    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/v1/urls")
      .set("Idempotency-Key", idemKey)
      .send(body);

    expect(second.status).toBe(201);
    expect(second.body.code).toBe(first.body.code);
    expect(second.body.shortUrl).toBe(first.body.shortUrl);
  });
});

