# URL Shortener — Complete Engineering Blueprint

**Project reference / source of truth**  
**Revision:** 1.0  
**Prepared:** 10 November 2026  
**Primary language:** TypeScript  
**Backend:** Express 5  
**Frontend:** Next.js  
**Public deployment:** Cloudflare Workers + Vercel  
**Local engineering lab:** Docker Compose + PostgreSQL + Redis + RabbitMQ

---

## 0. Executive decision

We are building a production-minded URL-shortening service and using it as a systems-engineering laboratory. The project is not intended to be a simple CRUD demo. It will be used to study and measure:

- URL/code generation and collision handling.
- Concurrent creation requests and idempotency.
- PostgreSQL schema design, transactions, indexes, locks, isolation and connection pooling.
- Redis caching, cache invalidation, TTL, hot keys and cache stampedes.
- Node.js event-loop behavior, HTTP, TCP connections, keep-alive, timeouts and backpressure.
- RabbitMQ queues, acknowledgements, retries, dead-letter queues and idempotent consumers.
- Docker images, containers, volumes, networks and resource limits.
- Load generation, open/closed workloads, throughput and tail latency.
- Deployment, secrets, quotas, failure handling and safe recovery.

### Locked stack

| Area | Final choice | Purpose |
|---|---|---|
| Language | TypeScript | Shared language across frontend, backend and testing tools |
| Runtime | Node.js 26 LTS locally | Local Express server, worker processes and load generator |
| Backend framework | Express 5 | REST API and redirect handling |
| Frontend | Next.js App Router | URL management interface and analytics dashboard |
| UI styling | Tailwind CSS | Styling |
| Request validation | Zod | Validate API inputs and configuration |
| Local database | PostgreSQL in Docker | Primary database and database experiments |
| Public database | Neon PostgreSQL | Free-tier hosted PostgreSQL for the demo |
| Local DB driver | `pg` (`node-postgres`) | Explicit SQL queries and connection pooling |
| Cloud DB connectivity | Cloudflare Hyperdrive + `pg` | Connection pooling between Workers and Neon |
| Local cache | Redis in Docker | Shared cache for local Node processes |
| Public cache | Upstash Redis | Hosted Redis-compatible cache |
| Local Redis client | `redis` (node-redis) | Standard Redis protocol client |
| Worker Redis client | `@upstash/redis` | HTTP-based Redis client for Workers |
| Local queue | RabbitMQ in Docker | Queue and broker experiments |
| Public queue | Cloudflare Queues | Worker-native queue adapter for deployed analytics |
| Unit/integration tests | Vitest + Node assertions | Tests without browser automation |
| Property-based tests | fast-check | Generate edge cases and verify invariants |
| Load generator | Our own TypeScript tool using Undici | Controlled load tests and virtual users |
| Containerization | Docker | Reproducible local services and application images |
| Local service composition | Docker Compose | Start and connect local dependencies; no cluster orchestration |
| Frontend deployment | Vercel Hobby | Personal/demo Next.js deployment |
| Backend deployment | Cloudflare Workers | Express application using Cloudflare's documented Node compatibility adapter |
| CI/CD | GitHub Actions | Tests and deployment automation |

### Explicitly out of scope for the initial version

- Kubernetes, Docker Swarm, service meshes and cluster orchestration.
- Node.js cluster mode and multi-process orchestration. We will run multiple containers manually when studying replicas.
- OpenTelemetry and a centralized instrumentation stack.
- Prometheus and Grafana.
- Playwright and browser automation.
- Kafka/Redpanda in the first implementation.
- ClickHouse in the first implementation.
- An ORM. We will write and inspect SQL directly.

We will still collect the measurements required for performance experiments through the load generator, operating-system tools, database statistics and ordinary application logs. Removing a monitoring stack does not mean removing performance measurement.

---

## 1. Product requirements and initial assumptions

### 1.1 Core product behavior

A user submits a destination URL and receives a short URL. Opening the short URL redirects to the destination.

The first version supports:

1. Create a short URL using a generated code.
2. Create a short URL using a custom alias.
3. Resolve a code and redirect.
4. Optionally expire a link at a specified timestamp.
5. Disable a link.
6. Retrieve basic click statistics after the asynchronous analytics path is implemented.
7. Apply rate limits to creation and other abuse-prone operations.

### 1.2 Default duplicate-URL policy

Two users submitting the same original destination receive separate short links by default.

Example:

- User A submits `https://example.com/article` and receives `short.domain/aB3dE9kP`.
- User B submits the same URL and receives a different code.

This is intentional. Ownership, expiration, disabling, and analytics are independent. A global deduplication policy could accidentally couple users' permissions and lifecycle. Per-user deduplication can be explored later as an explicit feature.

### 1.3 Custom alias policy

A custom alias is globally unique. If two requests concurrently claim the same alias, exactly one succeeds. The other receives HTTP `409 Conflict`.

### 1.4 Initial workload assumption

Use the following synthetic workload as a starting benchmark, not as a universal production fact:

- 99% redirect/read operations.
- 1% URL-creation operations.
- Begin with uniform code distribution.
- Then introduce a skewed/Zipf-like distribution where a small number of codes receive most traffic.
- Test reads and writes separately before mixing them.

### 1.5 Non-functional goals

We will measure and set targets after establishing a baseline. We will not claim an arbitrary RPS figure before benchmarking.

Primary measures:

- Requests per second (RPS) and completed throughput.
- p50, p95 and p99 latency.
- HTTP error rate and timeout rate.
- Application CPU and RSS memory.
- Database query latency and connection-pool wait time.
- Redis command latency, hit ratio and command count.
- Queue publish rate, consumer throughput and backlog.
- Load-generator CPU, memory, socket count and network throughput.

---

## 2. System architecture

We deliberately maintain two environments. They share the core business logic and contracts, but have environment-specific adapters.

### 2.1 Public deployment architecture

```text
                         PUBLIC USERS
                              |
                              v
                    Next.js application
                   Vercel Hobby deployment
                              |
                       HTTPS / CORS
                              |
                              v
                    Express 5 application
                 Cloudflare Workers runtime
                  (documented Node adapter)
                              |
             +----------------+----------------+
             |                |                |
             v                v                v
      Neon PostgreSQL     Upstash Redis   Cloudflare Queues
       via Hyperdrive     via REST API      click events
             |                |                |
             +----------------+                v
                                      Queue consumer Worker
                                               |
                                               v
                                      Neon analytics tables
```

Cloudflare documents deploying Express on Workers using `nodejs_compat` and `httpServerHandler`. Cloudflare also documents connecting Workers to Neon through Hyperdrive and using the `pg` driver. This means we can retain Express and PostgreSQL rather than switching the public app to Hono or D1. The exact library set must still be tested against the Workers runtime because Node compatibility is broad but not identical to a full Node.js server.

### 2.2 Local engineering-lab architecture

```text
Browser / curl / custom load generator
                  |
                  v
           Next.js dev server
                  |
                  v
       Express 5 on Node.js 26
                  |
       +----------+-----------+----------------+
       |                      |                |
       v                      v                v
 PostgreSQL                Redis           RabbitMQ
 (Docker)                  (Docker)         (Docker)
       |                      |                |
       +----------------------+                v
                                     Analytics consumer
                                               |
                                               v
                                       PostgreSQL stats
```

The local environment is the primary place for deep database, Redis, RabbitMQ, concurrency and performance tests. It is under our control and does not consume third-party free-tier quotas.

### 2.3 Why two queue adapters?

- Local: RabbitMQ is the broker we study in depth. We can inspect exchanges, queues, bindings, acknowledgements, prefetch, persistence, dead-letter routing and redelivery.
- Public: Cloudflare Queues integrates directly with the Workers runtime and is available on its free plan. It gives us a deployable queue path without requiring a continuously running RabbitMQ server.
- The application publishes a broker-neutral `ClickEvent` through a small interface. It does not know whether the implementation is RabbitMQ or Cloudflare Queues.

This is not claiming RabbitMQ and Cloudflare Queues are identical. We will test their semantics separately.

---

## 3. Backend and frontend responsibilities

### 3.1 Express backend

Express owns:

- URL creation and validation.
- Code generation and alias claims.
- Database transactions.
- Redirect resolution.
- Redis cache access.
- Rate limiting.
- API error mapping.
- Click-event publication.
- Authorization checks when authentication is added.

Use Express 5 with TypeScript. Express 5 automatically forwards rejected promises returned by async middleware and route handlers to error handling. We will still implement a consistent error middleware and never leak stack traces to clients.

### 3.2 Next.js frontend

Next.js owns:

- Landing page and URL creation form.
- URL list/dashboard.
- Copy-short-link interaction.
- Link status and expiration display.
- Analytics views after the event pipeline is complete.
- Sign-in/account screens if authentication is added.

The frontend calls the Express API over HTTPS. The API base URL is configured through environment variables; it is not hard-coded into components.

### 3.3 Cross-origin requests

Initially, Vercel and Cloudflare will have different hostnames. Express must configure CORS with the exact trusted frontend origin. Do not use `Access-Control-Allow-Origin: *` when credentials are enabled.

If cookie-based sessions are introduced, use HTTPS, secure cookies, correct `SameSite` behavior, an exact CORS origin and `credentials: true`. A later custom-domain setup such as `app.example.com` and `api.example.com` simplifies same-site cookie behavior.

---

## 4. API contract

All API routes are versioned under `/api/v1`. Reserve `/api`, `/health`, `/ready`, `/favicon.ico` and other infrastructure paths so they cannot be used as custom aliases.

### 4.1 Create a generated short URL

`POST /api/v1/urls`

Request:

```json
{
  "url": "https://example.com/a/long/path?x=1",
  "expiresAt": null
}
```

Response `201 Created`:

```json
{
  "code": "aB3dE9kP",
  "shortUrl": "https://s.example/aB3dE9kP",
  "destinationUrl": "https://example.com/a/long/path?x=1",
  "expiresAt": null
}
```

### 4.2 Create a custom alias

`POST /api/v1/urls`

```json
{
  "url": "https://example.com/docs",
  "customAlias": "docs"
}
```

If `docs` already exists, respond with `409 Conflict`.

### 4.3 Resolve a link

`GET /:code` and `HEAD /:code`

- Return `302 Found` with a `Location` header when active.
- Return `404 Not Found` for an unknown code.
- Return `410 Gone` for a known but expired or disabled link if we want to distinguish it from an unknown code.
- Use `Cache-Control: no-store` in the initial version so browser/shared caches do not hide clicks or retain stale redirects.

We choose 302 rather than 301 because a short link may later be disabled or its destination changed. A browser or CDN may cache a permanent 301 and continue redirecting without reaching our service. We can test 301/302/307 behavior separately.

### 4.4 Other endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Process/runtime liveness response |
| GET | `/ready` | Dependency readiness check, kept lightweight |
| GET | `/api/v1/urls` | List the current user's links, once accounts exist |
| GET | `/api/v1/urls/:code` | Return link metadata, not redirect |
| DELETE | `/api/v1/urls/:code` | Disable a link owned by the caller |
| GET | `/api/v1/urls/:code/stats` | Return aggregated analytics |

### 4.5 Status-code policy

| Status | Meaning |
|---|---|
| 201 | Short URL created |
| 200 | Metadata/statistics request succeeded |
| 302 | Temporary redirect |
| 400 | Malformed request |
| 401 | Authentication required, when enabled |
| 403 | Authenticated but not allowed |
| 404 | Code does not exist |
| 409 | Custom alias or idempotency conflict |
| 410 | Known link expired or disabled |
| 422 | URL or field validation failed |
| 429 | Rate limit exceeded |
| 500 | Unexpected internal error |
| 503 | Required dependency unavailable or retry budget exhausted |

---

## 5. PostgreSQL data model

PostgreSQL is the authoritative source of truth. Redis is a cache, not a database of record.

### 5.1 Main tables

1. `users`: reserved for account ownership when authentication is added.
2. `urls`: one row per short link.
3. `idempotency_keys`: makes repeated creation requests safe.
4. `click_events`: optional raw event storage for local experiments.
5. `url_stats`: aggregated click counts.
6. `processed_events`: consumer deduplication ledger.

### 5.2 Initial SQL schema

```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE urls (
    code VARCHAR(16) PRIMARY KEY,
    destination_url TEXT NOT NULL,
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    is_custom BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ,
    disabled_at TIMESTAMPTZ,
    CONSTRAINT code_not_empty CHECK (length(code) > 0),
    CONSTRAINT expiry_after_creation
        CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX urls_owner_created_idx
    ON urls (owner_id, created_at DESC)
    WHERE owner_id IS NOT NULL;

CREATE INDEX urls_expiry_idx
    ON urls (expires_at)
    WHERE expires_at IS NOT NULL AND disabled_at IS NULL;

CREATE TABLE idempotency_keys (
    principal_key TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash CHAR(64) NOT NULL,
    response_status INTEGER,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (principal_key, idempotency_key)
);

CREATE INDEX idempotency_expiry_idx
    ON idempotency_keys (expires_at);

CREATE TABLE url_stats (
    code VARCHAR(16) PRIMARY KEY REFERENCES urls(code) ON DELETE CASCADE,
    click_count BIGINT NOT NULL DEFAULT 0,
    last_clicked_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE processed_events (
    event_id UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

For local raw-event experiments, optionally add:

```sql
CREATE TABLE click_events (
    event_id UUID PRIMARY KEY,
    code VARCHAR(16) NOT NULL REFERENCES urls(code),
    occurred_at TIMESTAMPTZ NOT NULL,
    referrer_host TEXT,
    user_agent_family TEXT,
    country_code CHAR(2)
);

CREATE INDEX click_events_code_time_idx
    ON click_events (code, occurred_at DESC);
```

Do not store raw IP addresses or full user-agent strings without a clear need and retention policy. Prefer coarse metadata. Raw click storage can become large; partitioning and retention are later database experiments.

### 5.3 Why code is the primary key

Redirect lookup is overwhelmingly by short code. Making `code` the primary key gives us a unique B-tree index for exact lookup and enforces uniqueness in the database.

Do not add indexes without a workload reason. Each extra index consumes storage and adds write cost. We will compare `EXPLAIN (ANALYZE, BUFFERS)` results before/after index changes.

### 5.4 Query examples

Lookup:

```sql
SELECT code, destination_url, expires_at, disabled_at
FROM urls
WHERE code = $1;
```

Insert a generated code safely:

```sql
INSERT INTO urls (code, destination_url, owner_id, is_custom, expires_at)
VALUES ($1, $2, $3, FALSE, $4)
ON CONFLICT (code) DO NOTHING
RETURNING code, destination_url, created_at, expires_at;
```

A returned row means success. No returned row means the code collided; generate another code and retry. This avoids a racy `SELECT`-then-`INSERT` sequence.

Custom alias insert:

```sql
INSERT INTO urls (code, destination_url, owner_id, is_custom, expires_at)
VALUES ($1, $2, $3, TRUE, $4)
ON CONFLICT (code) DO NOTHING
RETURNING code;
```

No returned row means HTTP 409. The database constraint is authoritative.

---

## 6. Short-code generation and collision handling

### 6.1 Alphabet and code length

Use Base62:

```text
0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz
```

Start with an eight-character generated code. The keyspace is:

```text
62^8 = 218,340,105,584,896 possible codes
```

Codes are case-sensitive. The generated alphabet is URL-path safe.

### 6.2 Cryptographic randomness and modulo bias

Use a cryptographically secure random source. Do not use `Math.random()` for production code generation.

A naive `randomByte % 62` is slightly biased because 256 is not divisible by 62. Use rejection sampling: accept only byte values below 248, because 248 is divisible by 62, then map `byte % 62` to the alphabet.

Pseudocode:

```ts
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function generateCode(length = 8): string {
  let result = "";
  while (result.length < length) {
    const bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);

    for (const byte of bytes) {
      if (byte >= 248) continue; // reject the biased tail
      result += ALPHABET[byte % 62];
      if (result.length === length) break;
    }
  }
  return result;
}
```

This uses Web Crypto, which is available in Node.js and Cloudflare Workers. The code should live in a small, separately tested package.

### 6.3 Birthday-paradox interpretation

For a keyspace of size `M`, the approximate probability of at least one collision among `n` independent generated codes is:

```text
P(collision) ≈ 1 - exp(-n(n-1) / (2M))
```

At one million generated eight-character codes, the probability of having seen at least one pair collision across the whole set is approximately 0.23%. This does not mean each insertion has a 0.23% collision probability. With one million codes already occupied, the chance that the next random candidate hits an occupied code is only about `1,000,000 / 62^8`, approximately 4.6 × 10^-9.

This is why a unique database constraint plus retry is sufficient for the first design. We will still measure collisions by forcing the generator to return repeated candidates in tests.

### 6.4 Retry policy

1. Generate a code.
2. Try the insert with `ON CONFLICT DO NOTHING RETURNING`.
3. If a row returns, success.
4. If no row returns, treat it as a collision and generate another candidate.
5. Retry a small bounded number of times, for example five.
6. If all retries fail, return a controlled `503`/internal retryable error and log the exhaustion.

Do not introduce a global lock around code generation. It would serialize requests unnecessarily.

### 6.5 Why not auto-increment IDs and Base62?

Auto-increment plus Base62 is easy and collision-free but makes code enumeration easier and can expose rough creation order. Random codes are less predictable. We will use random codes for the product and can implement ID-to-Base62 as a benchmark comparison.

---

## 7. Concurrency, duplicate requests and idempotency

We have several different concurrency problems. They need different solutions.

### 7.1 Same destination URL submitted by multiple users

Default behavior: create separate short links. There is no global uniqueness constraint on `destination_url`.

This keeps ownership, expiration and analytics independent.

### 7.2 Same custom alias submitted concurrently

The unique primary key on `urls.code` ensures exactly one request wins. All other requests get no returned row and become `409 Conflict`.

Never rely on:

```text
SELECT whether alias exists
if not:
    INSERT alias
```

Two concurrent requests can both observe that the alias is free. The database unique constraint closes that race.

### 7.3 Same client request retried due to timeout

Use an `Idempotency-Key` header on `POST /api/v1/urls`.

The idempotency scope is a stable principal identity (account ID after authentication; for anonymous mode use a server-issued client scope rather than trusting a caller-supplied arbitrary identity). Store:

- principal/scope key;
- idempotency key;
- SHA-256 hash of the normalized request payload;
- resulting HTTP status and response body;
- creation and expiration timestamps.

Within one PostgreSQL transaction:

1. Attempt to insert `(principal_key, idempotency_key, request_hash)`.
2. If inserted, create the URL and save the response in the idempotency row.
3. Commit the transaction.
4. If another request already owns the key, wait for its transaction outcome, read the existing record and compare request hashes.
5. Same hash: return the recorded response.
6. Different hash: return `409 Conflict`.

A unique constraint on `(principal_key, idempotency_key)` is the concurrency guarantee. Keep the idempotency record longer than the maximum client retry window; seven days is a reasonable initial policy for this project, but it is a product setting.

### 7.4 Concurrent reads

Many clients can resolve the same short code. PostgreSQL handles concurrent reads; Redis should take most repeated lookups after the cache is warm. Do not create one database connection per request. Use bounded pools locally and Hyperdrive for the Worker deployment.

### 7.5 Do not use distributed locks for correctness that belongs in SQL

The database unique constraint protects code uniqueness and alias claims. A Redis lock is not the source of truth for uniqueness. Redis locks are only an optimization for reducing duplicate work, such as stampede protection during a popular cache miss.

---

## 8. Redis caching design

Redis is a performance layer. PostgreSQL remains authoritative.

### 8.1 Cache key and value

Key:

```text
url:{code}
```

Value (JSON):

```json
{
  "code": "aB3dE9kP",
  "destinationUrl": "https://example.com/article",
  "expiresAt": null,
  "disabled": false
}
```

For an expiring URL, Redis TTL must never exceed the remaining lifetime of the URL. For a non-expiring URL, use a configured cache TTL, for example 15 minutes initially. This is a benchmark setting, not a universal optimum.

### 8.2 Cache-aside redirect flow

```text
GET /:code
   |
   v
Redis GET url:{code}
   |
   +-- HIT --> validate cached expiry/disabled state --> HTTP 302
   |
   +-- MISS --> SELECT from PostgreSQL
                    |
                    +-- absent --> 404
                    |
                    +-- expired/disabled --> 410
                    |
                    +-- active --> SET Redis with TTL --> HTTP 302
```

Cache-aside is simple and fits this workload. A cache miss reads PostgreSQL and populates Redis. Cache entries are not authoritative.

### 8.3 Invalidation

When a link is disabled or its destination/expiration is changed:

1. Commit the PostgreSQL update.
2. Delete `url:{code}` from Redis.
3. If deletion fails, rely on bounded TTL as a fallback and retry invalidation if required.

This design has a small possible stale window if Redis invalidation fails. Keep TTLs bounded. If immediate revocation becomes a hard requirement, the cache design needs stronger coordination or an authoritative status check.

### 8.4 Cache stampede

A cache stampede occurs when many requests miss the same key at the same time and all issue the same database query.

First implement process-local single-flight:

```ts
const inFlight = new Map<string, Promise<UrlRecord | null>>();

async function getOrLoad(code: string) {
  const cached = await cache.get(code);
  if (cached) return cached;

  const existing = inFlight.get(code);
  if (existing) return existing;

  const promise = loadFromPostgresAndPopulateCache(code)
    .finally(() => inFlight.delete(code));

  inFlight.set(code, promise);
  return promise;
}
```

This collapses duplicate misses within one Node process. It does not coordinate different replicas. Later, experiment with a Redis lock using `SET lock:{code} token NX PX <lease>` and a Lua compare-and-delete release script. Always use unique lock tokens and leases. Never make the lock the correctness mechanism.

### 8.5 Multi-level cache experiments

- L0: optional process-local LRU + TTL cache that we implement ourselves.
- L1: Redis shared cache.
- L2: PostgreSQL.

The process-local LRU is an experiment, not a distributed cache. Each Node process has separate memory. A cache entry updated in process A does not automatically update process B. For correctness, use bounded local TTL and/or invalidation messages.

### 8.6 Redis outage behavior

- Redis healthy: use cache-aside.
- Redis timeout/error: log a bounded error and fall back to PostgreSQL.
- Protect PostgreSQL from a sudden cache outage with a concurrency limiter and bounded connection pool.
- If PostgreSQL also fails, return `503`.
- Do not wait indefinitely for Redis. Configure client command timeouts.

### 8.7 Rate limiting

Implement rate limiting as a separate module. Start with a fixed-window counter for simplicity, then implement token bucket or sliding window.

For a fixed window, use an atomic Lua script or a Redis transaction/script that performs increment and first-write expiry together. Avoid separate `INCR` and `EXPIRE` calls without atomicity; a process failure between them can leave a counter without an expiry.

Rate-limit link creation by IP and, when accounts exist, by account. Redirect reads should have a more generous limit. If Redis is unavailable, choose an explicit failure policy: for link creation, fail closed with a temporary error or use a conservative local fallback; for redirects, prefer serving valid links when the database is healthy.

---

## 9. Redirect behavior and HTTP/networking

### 9.1 Redirect status

Use 302 in the initial product. It avoids clients caching a permanent mapping when the service needs to track clicks, disable a link or change its destination. Return `Cache-Control: no-store` initially so intermediate/browser caches do not bypass the service.

We will compare 301, 302 and 307 in a networking experiment. A 301 is appropriate only when the mapping is truly permanent and cache behavior is understood.

### 9.2 Avoid blocking work in the redirect path

The redirect critical path should be:

1. Parse and validate the code format.
2. Read Redis.
3. On miss, query PostgreSQL.
4. Check expiry and disabled status.
5. Send `302` with `Location`.

Do not synchronously aggregate analytics or perform expensive geolocation/URL-preview work before returning the redirect. Analytics should be handed to a queue using a bounded background mechanism. Event loss is acceptable in the first analytics iteration; a durable outbox is a later option if analytics correctness becomes a product requirement.

### 9.3 HTTP behavior to test

- HTTP/1.1 keep-alive versus connection-per-request.
- HTTP/2 multiplexing when available at the edge.
- Request and response timeouts.
- Slow clients and slow upstream dependencies.
- Headers and payload sizes.
- TCP connection setup/teardown.
- TLS handshake overhead.
- Backpressure and event-loop delay.
- Concurrent requests on a single connection versus many connections.

Node is I/O-oriented, but CPU-intensive synchronous JavaScript can block the event loop. The URL redirect should remain small and asynchronous. We will measure event-loop delay under load rather than assuming concurrency is free.

---

## 10. RabbitMQ and asynchronous analytics

### 10.1 Why RabbitMQ first

RabbitMQ is a good fit for a background-work queue. It gives us hands-on exposure to:

- Exchanges and bindings.
- Queue durability.
- Persistent messages.
- Publisher confirms.
- Manual acknowledgement.
- Prefetch and consumer concurrency.
- Redelivery and retry behavior.
- Dead-letter exchanges/queues.
- Consumer idempotency.

Kafka/Redpanda is deferred. It is more valuable when we need a retained event log, partitions, replay and multiple independent consumer groups. We do not need both brokers to launch a URL shortener.

### 10.2 Event schema

```json
{
  "eventId": "c1f6c5d0-5ddc-4e88-bc65-9e1a9a8e2e1f",
  "type": "url.click",
  "code": "aB3dE9kP",
  "occurredAt": "2026-11-10T09:00:00.000Z",
  "referrerHost": "example.org",
  "userAgentFamily": "Chrome",
  "countryCode": "IN"
}
```

Do not include raw IP by default. Add a schema version if the event evolves.

### 10.3 Local RabbitMQ topology

```text
Express redirect handler
       |
       v
Publisher confirm channel
       |
       v
Topic exchange: analytics.events
       |
       | routing key: url.click
       v
Durable queue: url.clicks.v1
       |
       v
Consumer (prefetch, manual ack)
       |
       v
PostgreSQL transaction
  - insert processed_events(event_id)
  - if new event: increment url_stats
       |
       v
ACK message after commit
```

Use a durable exchange and durable queue. Publish persistent messages. Use publisher confirms for the local RabbitMQ publisher. Keep a long-lived connection and channels; do not create a broker connection for every click. Configure reconnect with bounded exponential backoff and jitter.

Consumer behavior:

1. Receive a message.
2. Validate the event schema.
3. Begin a DB transaction.
4. Insert `event_id` into `processed_events` with `ON CONFLICT DO NOTHING`.
5. If the insert succeeds, update `url_stats`.
6. Commit.
7. ACK only after commit.

If the message is redelivered, the `processed_events` primary key prevents double counting. This is at-least-once delivery plus idempotent processing, not exactly-once delivery.

Use prefetch (start around 50-100 and benchmark). For failed messages, distinguish transient failures from poison messages. Retry transient failures with bounded delay; route exhausted/invalid messages to a dead-letter queue. Avoid immediate infinite requeue loops.

### 10.4 Public queue adapter

Cloudflare Queues is the selected public adapter because it integrates with Workers and supports retry and dead-letter-queue configurations. The free plan currently has 10,000 operations/day and 24-hour maximum message retention. Queue writes, reads and deletes count as operations, so the message quota is not the same as the operation quota.

A `ClickEventPublisher` interface hides the transport:

```ts
export interface ClickEventPublisher {
  publish(event: ClickEvent): Promise<void>;
}
```

Implement:

- `RabbitMqClickEventPublisher` for local Node/Docker.
- `CloudflareQueueClickEventPublisher` for public Worker deployment.

The consumer has the same validation and idempotent database update logic, with environment-specific entry points.

### 10.5 Hosted RabbitMQ option

CloudAMQP currently lists a free shared RabbitMQ plan with up to 1 million messages/month, 20 connections and 10,000 queued messages. It is suitable for development and small demos, not a capacity target. Shared brokers are multi-tenant and have idle-instance deletion rules. It is an optional way to test a hosted RabbitMQ broker; the public default remains Cloudflare Queues because it integrates directly with the Worker deployment.

---

## 11. Security and abuse controls

A public shortener can be abused for phishing, malware distribution and spam. Security and abuse handling are required before exposing unrestricted public link creation.

### 11.1 URL validation

- Parse using the standard `URL` parser.
- Allow only `http:` and `https:`.
- Reject `javascript:`, `data:`, `file:`, `ftp:` and other non-HTTP schemes.
- Reject empty hostnames, malformed URLs and embedded credentials unless explicitly supported.
- Enforce a maximum destination length (start with 4,096 characters and benchmark/storage-test it).
- Normalize only where semantics are preserved; do not casually lowercase paths or query parameters.
- Validate custom aliases against a restricted pattern, for example `[A-Za-z0-9_-]{3,32}`.
- Block reserved routes and aliases.

The application does not fetch the destination URL. Do not add link-preview fetching without a separate SSRF design. If the backend fetches user-controlled URLs later, it must defend against private IP ranges, loopback, DNS rebinding, redirects to internal addresses and metadata endpoints.

### 11.2 Redirect abuse

- Add an abuse-report endpoint.
- Keep a way for administrators to disable a malicious link.
- Apply creation rate limits.
- Consider CAPTCHA or account verification before public unrestricted creation.
- Maintain a blocklist process and clear user reporting path.
- Do not expose internal database errors or secrets.

### 11.3 Proxy and client IP handling

Express may run behind Cloudflare. Do not set `trust proxy = true` blindly. Configure the trusted proxy chain according to the actual deployment. Incorrect trust-proxy configuration can allow spoofed forwarding headers to affect IP-based rate limiting. Cloudflare documents this issue in its Express proxy guide.

### 11.4 Secrets

Never commit `DATABASE_URL`, Redis tokens, queue credentials, auth secrets or API keys. Use local `.env` files ignored by Git and Cloudflare/Vercel secret stores for deployment.

---

## 12. Containerization: Docker

We use Docker to create reproducible local environments. We do not use Kubernetes or a cluster orchestrator.

### 12.1 Containers to run locally

- `postgres`: stores URL records and analytics tables.
- `redis`: shared cache and rate limiter.
- `rabbitmq`: event broker and management UI.
- `api`: Express service (can run on host during early development or in a container later).
- `consumer`: RabbitMQ analytics consumer.
- `web`: Next.js development server, optional container.

### 12.2 Concepts to implement and inspect

- Multi-stage Docker builds.
- Image layers and build cache.
- Non-root runtime user.
- `.dockerignore`.
- Container DNS and bridge networking.
- Port publishing versus container-to-container ports.
- Named volumes for PostgreSQL, Redis and RabbitMQ data.
- Health checks and service start dependencies.
- CPU/memory constraints.
- Restart behavior and graceful shutdown.
- Logs through stdout/stderr.

### 12.3 Docker Compose

Use Compose only as a local service launcher and network definition. It is not the production orchestration strategy.

Example service topology:

```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_DB: shortener
      POSTGRES_USER: shortener
      POSTGRES_PASSWORD: local-dev-only
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U shortener -d shortener"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: ["redis-server", "--appendonly", "yes"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  rabbitmq:
    image: rabbitmq:4-management
    ports:
      - "5672:5672"
      - "15672:15672"
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 10

volumes:
  postgres_data:
  redis_data:
  rabbitmq_data:
```

Pin image versions/digests after verifying them. The example is a starting point; do not use the sample database password outside local development. In Compose, application containers connect to `postgres:5432`, `redis:6379` and `rabbitmq:5672`, not `localhost`.

---

## 13. Deployment plan

### 13.1 Frontend: Vercel

- Push the monorepo to GitHub.
- Configure the Next.js project root/build settings.
- Set `NEXT_PUBLIC_API_BASE_URL` to the deployed API base URL.
- Configure allowed origin in the Express CORS middleware.
- Deploy from the main branch; use preview deployments for changes.

Vercel Hobby is free and supports Next.js, but its terms limit use to personal and non-commercial projects. It is appropriate for the personal portfolio version. Re-check the plan terms before commercial use.

### 13.2 Backend: Cloudflare Workers + Express 5

Cloudflare has an official Express deployment tutorial. The approach:

1. Create a Worker project with Wrangler.
2. Add Express and TypeScript types.
3. Enable the compatibility configuration appropriate to the current compatibility date (Cloudflare's current Express tutorial uses `nodejs_compat`).
4. Initialize the Express application.
5. Export it through `httpServerHandler` from `cloudflare:node`.
6. Deploy with Wrangler.

Illustrative Worker entry point based on the official integration:

```ts
import { httpServerHandler } from "cloudflare:node";
import express from "express";

const app = express();
app.use(express.json({ limit: "16kb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

app.listen(3000);
export default httpServerHandler({ port: 3000 });
```

Our actual project will use a shared `createApp(services)` factory so routes/controllers are not duplicated. The Node entry point starts Express normally. The Worker entry point supplies Worker-specific database, Redis and queue adapters and then exports the Cloudflare HTTP handler.

Important compatibility caveat: Cloudflare Workers supports a subset of Node.js APIs, not every behavior of a traditional Node.js process. Avoid native addons and packages that depend on unsupported APIs in the Worker entry point. Keep the core business logic portable and test the actual production bundle locally with Wrangler before deploying.

### 13.3 PostgreSQL: Neon + Hyperdrive

- Create a Neon PostgreSQL project.
- Apply the same SQL migration files used locally.
- Create a Cloudflare Hyperdrive configuration using the Neon connection string.
- Bind it to the Worker.
- Use `pg` with a version compatible with Hyperdrive (Cloudflare currently documents `pg` newer than 8.16.3).
- In Workers, create a short-lived `pg.Client` from the Hyperdrive connection string per request/operation as shown in Cloudflare's integration guide; Hyperdrive maintains the underlying connection pool.
- Locally, use a bounded `pg.Pool`.

This preserves PostgreSQL in both environments and gives us the same SQL schema. Still run integration tests because the Worker/Hyperdrive connection path differs from a local direct TCP connection.

### 13.4 Redis: Upstash

- Create one Upstash Redis database.
- Store its REST URL and token as Worker secrets.
- Use `@upstash/redis` in the Worker; it uses HTTP/REST and is designed for edge/serverless environments.
- Locally, use `node-redis` against the Redis Docker container.
- Keep a shared `CacheRepository` interface so the cache policy and key format remain consistent.

Do not send Redis credentials to the browser. All cache operations happen in the backend.

### 13.5 Queue: Cloudflare Queues in public deployment

- Create a click-event queue and a dead-letter queue.
- Bind the producer to the Express Worker.
- Deploy a separate consumer Worker for the queue.
- Configure retry count, batch size and dead-letter routing.
- Reuse the same event schema and idempotent database-update logic as the RabbitMQ consumer.

### 13.6 GitHub Actions

Minimum CI pipeline:

1. Install dependencies with frozen lockfile.
2. Run formatting/lint check.
3. Run TypeScript type checking.
4. Run unit and property-based tests.
5. Start local dependencies for integration tests.
6. Run integration tests.
7. Build Next.js and Worker bundles.
8. Deploy only after checks pass; keep deployment secrets in repository/environment secrets.

Do not put provider tokens into source code or build logs.

---

## 14. Current free-tier limits and practical consequences

These values were checked on 10 November 2026. Providers can change quotas and terms; re-check their live pricing/limits pages before deployment.

| Provider | Current free allowance / behavior | Consequence for this project |
|---|---|---|
| Cloudflare Workers | 100,000 requests/day; 10 ms CPU per request on Free | Public demo is possible, but it is not the load-test target. |
| Cloudflare Queues | 10,000 operations/day; 24-hour max retention on Free | A message publish, delivery/read and delete can consume multiple operations. |
| Neon | 1 GB storage/project, 100 compute-hours/project/month, 5 GB public transfer; scale-to-zero after 5 minutes idle | Good for a portfolio deployment; first query can be slower after idle. |
| Upstash Redis | 256 MB, 500,000 commands/month, 10 GB monthly bandwidth | Free quota can become a bottleneck well before a million-user benchmark. |
| Vercel Hobby | Free plan for personal/non-commercial use; quotas apply | Good for a personal portfolio app, not a commercial service. |
| CloudAMQP Little Lemur | Shared RabbitMQ; 1 million messages/month, 20 connections, 10,000 queued messages | Optional hosted RabbitMQ for small experiments, not a stress target. |

### 14.1 Why we do not stress-test public free services

The objective of the million-user experiment is to measure our own application and infrastructure. The free public deployment has strict daily/monthly quotas and external resource limits. Sending an extreme test to it would mostly measure provider throttling, plan limits and quota exhaustion.

Run large tests against local infrastructure we control or an explicitly provisioned test environment. Do not run a high-volume test against a third-party endpoint without authorization and sufficient quota.

### 14.2 Render fallback

If we decide we want a conventional long-running Node.js Express server instead of the Workers adapter, Render has a free web-service option. Its free web service spins down after 15 minutes without inbound traffic and can take about a minute to wake. The filesystem is ephemeral. This is convenient for a simple Node deployment, but gives a cold-start experience and is not our primary choice. It is a fallback, not an always-on production host.

---

## 15. Authentication and ownership scope

The first milestone focuses on anonymous link creation in local development, plus rate limits and abuse controls. Before unrestricted public link creation, we must add either authentication or a controlled creation policy (for example, signed-in accounts, per-IP quotas and abuse reporting).

The schema includes `users` and `owner_id` so ownership can be added without redesigning the URL table. When authentication is implemented:

- Use a vetted identity/session library or identity provider rather than inventing password storage/cryptography.
- Express must verify the signed identity/session on every protected operation.
- Authorize access by checking `owner_id` in the database, not by trusting a code supplied by the client.
- Keep API secrets and signing keys in deployment secret stores.
- Add account-level rate limits in addition to IP-based controls.

This is an explicit later milestone. Do not claim that anonymous public creation is abuse-resistant merely because a rate limiter exists.

---

## 16. Testing strategy

Browser automation is removed. We will use unit tests, integration tests, property-based tests, concurrency tests, fault tests and a custom HTTP load generator.

### 16.1 Unit tests

Test pure logic:

- Base62 alphabet and output length.
- Random byte rejection sampling.
- URL validation and normalization.
- Alias validation and reserved names.
- Expiration calculation.
- Cache TTL calculation.
- Rate-limiter token math.
- HTTP error mapping.
- Event schema validation.

### 16.2 Property-based tests

Use `fast-check` to generate many inputs and test invariants:

- Every generated code has expected length and valid alphabet.
- Generated codes contain no invalid characters.
- Encode/decode round trips for the ID-based comparison implementation.
- URL validator never accepts non-HTTP(S) schemes.
- Expired URLs never resolve as active.
- Idempotent repeat submissions produce the same response.

Property tests do not prove cryptographic randomness. Statistical randomness tests are separate and do not replace using a cryptographic source.

### 16.3 Integration tests

Run against real PostgreSQL, Redis and RabbitMQ containers.

- Create URL and read it back.
- Unique-code constraint.
- Custom alias conflict.
- Transaction rollback.
- Idempotency record and URL commit atomically.
- Redis hit/miss and TTL.
- Cache invalidation after disable.
- RabbitMQ publisher/consumer flow.
- Manual ACK and redelivery.
- Duplicate event handling.

### 16.4 Concurrency tests

| Scenario | Starting test size | Expected invariant |
|---|---:|---|
| Same custom alias | 10,000 concurrent attempts | Exactly one success |
| Same destination | 10,000 creates | Independent codes under default policy |
| Same idempotency key and body | 10,000 retries | One logical record and identical response |
| Same idempotency key, different body | Concurrent requests | One request wins; conflicting body receives 409 |
| Forced code collision | Repeated candidate values | No duplicate code in database |
| Popular cache miss | 10,000 concurrent lookups | Single-flight reduces duplicate DB queries per process |
| Concurrent reads | 100,000 requests in test ramp | Correct destination and bounded errors |

Run concurrency tests first at modest scale and increase gradually. Use timeouts and teardown so a failed test cannot leave thousands of requests running.

### 16.5 Fault-injection tests

- Stop Redis while the API is running.
- Stop PostgreSQL during creation.
- Restart RabbitMQ with messages queued.
- Kill the consumer after database commit but before ACK to simulate redelivery.
- Introduce artificial network latency and packet loss in the local lab.
- Exhaust the DB pool.
- Return malformed queue messages.
- Fill a queue and observe producer/backpressure behavior.
- Test application shutdown while requests are in progress.

### 16.6 What does one million concurrent users mean?

Keep these terms separate:

- Virtual users: simulated independent user sessions.
- In-flight requests: requests currently executing.
- Concurrent TCP connections: open transport connections.
- RPS: request arrival/completion rate.

One million virtual users do not equal one million simultaneous TCP connections or one million RPS.

Use two workload models:

**Closed model:** each virtual user sends a request, waits for its response, pauses, and sends another. Useful for user-journey simulation.

**Open model:** schedule arrivals at a target rate independent of response completion. Useful for overload and saturation tests because rising latency does not automatically reduce the arrival rate.

Build the generator in TypeScript using Undici. It should record scheduled arrival time, actual start time, end time, status, timeout and error. Use a histogram with appropriate buckets/HDR-style measurement rather than keeping every latency sample in memory for huge runs.

Suggested ramp:

1. 100 virtual users.
2. 1,000.
3. 10,000.
4. 50,000.
5. 100,000.
6. 1,000,000 virtual users across multiple generator machines, if the available hardware and test target permit it.

A single laptop is not expected to generate one million independent live TCP connections. The generator itself must be tested and profiled. Report generator CPU, RSS, network and file-descriptor/socket limits alongside server metrics.

---

## 17. Repository structure

Use a pnpm monorepo. Keep product code separate from experiments.

```text
url-shortener/
├── apps/
│   ├── web/                       # Next.js App Router
│   ├── api-node/                  # Express 5 on Node.js
│   ├── api-worker/                # Express on Cloudflare Workers
│   └── queue-consumer-worker/     # Cloudflare Queues consumer
│
├── packages/
│   ├── core/                      # URL/code domain logic
│   ├── code-generator/            # crypto randomness + Base62
│   ├── validation/                # Zod schemas
│   ├── database/                  # SQL and repository contracts
│   ├── cache/                     # cache contract + custom LRU
│   ├── events/                    # event schema + publisher interface
│   ├── rate-limiter/              # token bucket/sliding-window logic
│   └── shared-types/              # API and event types
│
├── adapters/
│   ├── postgres-node/             # pg Pool
│   ├── postgres-hyperdrive/       # Worker pg Client
│   ├── redis-node/                # node-redis adapter
│   ├── redis-upstash/             # REST adapter
│   ├── rabbitmq/                  # amqplib adapter
│   └── cloudflare-queues/         # Queue adapter
│
├── migrations/                    # versioned SQL migrations
├── testing/
│   ├── unit/
│   ├── integration/
│   ├── concurrency/
│   ├── fault-injection/
│   └── load-generator/
│
├── infrastructure/
│   ├── docker/
│   └── cloudflare/
│
├── docs/
│   ├── architecture/
│   ├── database/
│   ├── caching/
│   ├── networking/
│   └── experiments/
│
├── docker-compose.yml
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

This is the target organization, not a requirement to create every folder on day one. Add modules as the corresponding milestone begins.

---

## 18. Package list

### Root / monorepo

- `pnpm` workspaces.
- TypeScript strict mode.
- ESLint and Prettier.
- `tsx` for local TypeScript development scripts.

### Backend

- `express` 5.x.
- `@types/express`.
- `zod`.
- `pg`.
- `redis` (node-redis) for local Redis.
- `@upstash/redis` for Worker-compatible Redis REST.
- `amqplib` and its type definitions for RabbitMQ.
- `vitest`.
- `fast-check`.
- `undici` for the load generator.

### Frontend

- `next`.
- `react` and `react-dom`.
- `tailwindcss`.
- A lightweight charting library only when analytics is implemented; do not add it to the first build.

### Cloudflare

- `wrangler` as a development dependency.
- Cloudflare Workers types generated from the Wrangler configuration.
- `@cloudflare/workers-types` only if required by the selected setup; prefer generated environment types from Wrangler.

### Avoid initially

- Prisma, Drizzle and TypeORM.
- Express rate-limit middleware that hides the algorithm we intend to study.
- A large dependency injection framework.
- A distributed cache library that owns our policy.
- Kubernetes tooling.
- Prometheus/Grafana/OpenTelemetry packages.
- Playwright.

Pin versions through the package lockfile. Use the currently supported stable versions when creating the repository rather than copying version numbers from an old tutorial.

---

## 19. Implementation roadmap

### Phase 0 — Architecture and repository setup

Deliverables:

- Requirements document.
- API contract.
- Architecture diagram.
- pnpm monorepo.
- TypeScript strict config.
- Docker Compose for PostgreSQL, Redis and RabbitMQ.
- Environment-variable template.

Exit criteria: all local dependencies start and health checks pass.

### Phase 1 — Core URL service

Implement:

- URL validation.
- Random Base62 code generation.
- Code creation transaction.
- Custom aliases.
- Redirect endpoint.
- Correct 302/404/410/409 behavior.
- Basic SQL migrations.

Exit criteria: unit and integration tests pass; no duplicate codes under forced collision tests.

### Phase 2 — Database concurrency and idempotency

Implement:

- Unique constraints.
- Idempotency records.
- Transaction boundaries.
- Retry logic.
- Concurrent custom-alias tests.
- Pool sizing and connection-wait benchmarks.

Exit criteria: simultaneous requests satisfy all defined invariants.

### Phase 3 — Redis

Implement:

- Cache repository interface.
- Redis adapter.
- Cache-aside redirect lookup.
- TTL calculation.
- Disable/update invalidation.
- Custom LRU + TTL cache for comparison.
- Single-flight.
- Redis outage fallback.

Exit criteria: cache correctness tests pass; benchmark shows cache hit/miss behavior and DB query reduction.

### Phase 4 — Node/networking experiments

Implement experiments for:

- Keep-alive and connection reuse.
- Concurrent requests.
- Event-loop delay.
- Slow DB/cache behavior.
- Timeouts and cancellation.
- Backpressure.
- One versus multiple manually started API containers.

Exit criteria: a reproducible benchmark report exists for every experiment.

### Phase 5 — RabbitMQ and analytics

Implement:

- Click event schema.
- Publisher confirms.
- Durable exchange/queue.
- Consumer prefetch and manual ACK.
- DLQ/retry behavior.
- `processed_events` idempotency.
- `url_stats` aggregation.

Exit criteria: redelivery does not double-count a click; failed messages are recoverable or reach the DLQ.

### Phase 6 — Docker hardening

Implement:

- Multi-stage Dockerfiles for API and consumer.
- Non-root runtime users.
- Health checks.
- Persistent volumes.
- Resource limits.
- Graceful shutdown.
- Reproducible local startup.

Exit criteria: a fresh clone can start the lab with documented commands.

### Phase 7 — Custom load generator

Implement:

- Open and closed workloads.
- Configurable arrival rate and virtual users.
- Connection reuse and connection-count settings.
- Latency histogram.
- RPS, status counts, timeouts and errors.
- Warm-up and fixed measurement interval.
- CSV/JSON result output.

Exit criteria: repeatable results, and the load generator itself is profiled.

### Phase 8 — Public deployment

Implement:

- Express Worker adapter.
- Hyperdrive -> Neon.
- Upstash Redis adapter.
- Cloudflare Queues publisher/consumer.
- Vercel Next.js frontend.
- CORS and secrets.
- Deployment pipeline.

Exit criteria: public demo works within free quotas; deployment smoke tests pass.

### Phase 9 — Reliability and security hardening

Implement:

- Authentication or controlled account-based creation.
- Abuse-report and link-disable flow.
- Rate-limit policies.
- Queue outage behavior.
- DB outage behavior.
- Cache outage behavior.
- Dependency timeouts and graceful error responses.

Exit criteria: documented failure behavior and no uncontrolled resource exhaustion in tests.

---

## 20. Local developer workflow

Expected local startup:

```bash
# 1. Start dependencies
 docker compose up -d postgres redis rabbitmq

# 2. Install dependencies
 pnpm install

# 3. Apply SQL migrations
 pnpm db:migrate

# 4. Start the API
 pnpm --filter api-node dev

# 5. Start the frontend
 pnpm --filter web dev

# 6. Run tests
 pnpm test
 pnpm test:integration
```

The scripts above are the intended interface; their exact command definitions are added when the monorepo is created.

Local environment variables (example names only):

```dotenv
NODE_ENV=development
PORT=3001
DATABASE_URL=postgres://shortener:local-dev-only@localhost:5432/shortener
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://guest:guest@localhost:5672
PUBLIC_SHORT_DOMAIN=http://localhost:3001
WEB_ORIGIN=http://localhost:3000
```

Use a local `.env` file and add it to `.gitignore`. Never reuse the sample local password for a hosted system.

---

## 21. Deployment environment variables and secrets

| Variable/binding | Local | Public Worker / frontend |
|---|---|---|
| `DATABASE_URL` | Local PostgreSQL URL | Prefer Hyperdrive binding; never expose to browser |
| `REDIS_URL` | Local Redis URL | Upstash REST URL as a secret |
| `UPSTASH_REDIS_REST_TOKEN` | Not needed locally | Worker secret |
| `HYPERDRIVE` | Not applicable | Cloudflare Hyperdrive binding |
| `CLICK_EVENTS` | RabbitMQ adapter | Cloudflare Queue binding |
| `WEB_ORIGIN` | Local Next origin | Exact deployed Vercel origin |
| `PUBLIC_SHORT_DOMAIN` | Local URL | Public short-link domain |
| `NODE_ENV` | `development` | `production` |

Do not prefix private credentials with `NEXT_PUBLIC_`. Any variable prefixed that way may be included in client-side bundles.

---

## 22. Failure-mode policy

| Failure | Expected behavior |
|---|---|
| Redis unavailable | Fall back to PostgreSQL with bounded concurrency; log the cache failure |
| PostgreSQL unavailable | Return 503; do not fabricate a destination |
| RabbitMQ unavailable locally | Redirect still succeeds if analytics is best-effort; event may be lost and failure is recorded |
| Cloudflare Queue send fails | Redirect still succeeds in best-effort analytics mode; queue error is logged |
| Analytics consumer crashes | Broker retries/redelivers; event ID prevents double-counting |
| URL expired | Return 410; delete/avoid stale cache entry |
| URL disabled | Return 410; invalidate Redis entry |
| Code collision | Retry generated code; custom alias conflict returns 409 |
| Idempotency duplicate | Return previous response for same request hash; different hash returns 409 |
| Rate limiter unavailable | Explicit policy: conservative local fallback or fail closed for creation; keep valid redirects available when safe |
| App shutdown | Stop accepting new work, drain bounded in-flight requests and close DB/Redis/AMQP clients gracefully |

Do not create unbounded retry loops. Every dependency call needs a timeout and a bounded retry policy. Retries should use exponential backoff with jitter where appropriate.

---

## 23. Architecture decisions and reasons

| Decision | Reason |
|---|---|
| Express 5 | Familiar to the developer; suitable for REST APIs; official Cloudflare Workers integration now exists |
| Next.js | Full-featured React frontend and straightforward deployment |
| PostgreSQL | Strong relational model, unique constraints, transactions, indexing and excellent learning value |
| Redis | Real shared cache for multiple API instances and a rich set of cache/coordination experiments |
| RabbitMQ locally | Direct hands-on learning of traditional message-broker mechanics |
| Cloudflare Queues publicly | Native integration with Worker deployment and a free allowance |
| Raw SQL, no ORM | Make database behavior, query plans and transactions visible |
| Docker Compose, no Kubernetes | Reproducible dependencies without introducing cluster operations |
| Custom load generator | Understand scheduling, sockets, latency measurement and generator bottlenecks |
| 302 + no-store initially | Keep redirect lifecycle controllable and preserve click visibility |
| Independent short links for duplicate destinations | Keep ownership and lifecycle independent |
| DB unique constraint | Correctness under concurrent code/alias creation |
| Idempotency key | Safe client retries after uncertain network outcomes |
| Best-effort analytics initially | Keep analytics from becoming a hard dependency of redirect correctness/latency |

---

## 24. Official references and live limits

The following official documentation was checked on 10 November 2026. Quotas and product terms can change, so re-check before deploying.

1. **Express 5 API reference** — https://expressjs.com/en/api/  
   Express 5 request/response and application APIs. Express 5 requires Node.js 18 or newer.
2. **Express middleware guide** — https://expressjs.com/en/guide/writing-middleware/  
   Middleware ordering and Promise rejection forwarding in Express 5.
3. **Express behind proxies** — https://expressjs.com/en/guide/behind-proxies/  
   Correct `trust proxy` configuration and client IP handling.
4. **Cloudflare: Deploy an Express.js application on Workers** — https://developers.cloudflare.com/workers/tutorials/deploy-an-express-app/  
   Official Express + `nodejs_compat` + `httpServerHandler` integration.
5. **Cloudflare: Neon integration** — https://developers.cloudflare.com/workers/databases/third-party-integrations/neon/  
   Neon connectivity and Hyperdrive with `pg`.
6. **Cloudflare Workers limits** — https://developers.cloudflare.com/workers/platform/limits/  
   Free plan request and CPU limits.
7. **Cloudflare Queues limits** — https://developers.cloudflare.com/queues/platform/limits/  
   Queue throughput, message size, retries, retention and free-plan queue limits.
8. **Cloudflare Queues free-plan announcement** — https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/  
   10,000 operations/day and 24-hour free retention.
9. **Neon free plan limits** — https://neon.com/pricing  
   Check current Neon plan documentation for compute/storage/transfer details.
10. **Upstash Redis pricing** — https://upstash.com/pricing/redis  
    Current free allowance and command/bandwidth limits.
11. **Upstash Redis REST API** — https://upstash.com/docs/redis/features/restapi  
    HTTP-based Redis access for serverless/edge deployments.
12. **Vercel Hobby plan** — https://vercel.com/docs/plans/hobby  
    Current included usage and non-commercial/personal-use restriction.
13. **CloudAMQP pricing** — https://www.cloudamqp.com/plans/  
    Free shared RabbitMQ Little Lemur plan and its limits.
14. **Node.js release schedule** — https://nodejs.org/en/about/previous-releases  
    Current release/LTS status. Node.js 26 is Active LTS as of the reference date.
15. **Next.js deployment guide** — https://nextjs.org/docs/app/getting-started/deploying  
    Supported Node.js, Docker and static deployment approaches.

---

## 25. Final project definition

**We are building a TypeScript URL shortener with Next.js, Express 5, PostgreSQL, Redis and asynchronous click analytics.**

The public product will use Vercel for Next.js and Cloudflare Workers for the Express application, with Neon PostgreSQL through Hyperdrive, Upstash Redis and Cloudflare Queues. The local engineering lab will use Docker Compose to run PostgreSQL, Redis and RabbitMQ, with the same business logic and explicit adapters.

The project will not include Kubernetes, clustering, Prometheus, Grafana, OpenTelemetry or browser automation in its initial scope. It will include Docker, careful concurrency design, raw SQL, cache algorithms, queue semantics, fault injection and a custom TypeScript load generator.

The million-user goal is a staged laboratory objective. We will first validate correctness, then measure 100, 1,000, 10,000, 50,000 and 100,000 virtual users, and only then consider a distributed million-virtual-user test. A million virtual users is not the same as a million simultaneous TCP connections or one million requests per second. Large tests must target infrastructure we own or have explicit permission to test; free hosted services are not the benchmark target.

**This document is the project's baseline reference.** Any later change to the selected stack or behavior should be recorded as an Architecture Decision Record (ADR) rather than silently changing the design.


---

## 26. Express 5 implementation skeleton

The Express application must be independent of the environment that starts it. This is the key to running the same routes locally on Node.js and publicly through the Cloudflare Worker adapter.

### 26.1 Application factory

Use dependency injection at the application boundary. The route/controller logic receives interfaces; the Node and Worker entry points supply different adapters.

```ts
// packages/api/src/app.ts
import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import type { Services } from "./services";
import { createUrlRouter } from "./routes/url.routes";
import { createRedirectRouter } from "./routes/redirect.routes";
import { notFound } from "./middleware/not-found";
import { errorHandler } from "./middleware/error-handler";

export function createApp(services: Services): Express {
  const app = express();
  app.disable("x-powered-by");

  app.use(helmet());
  app.use(cors({
    origin: services.config.allowedWebOrigins,
    credentials: false,
  }));
  app.use(express.json({ limit: "16kb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get("/ready", async (_req, res) => {
    await services.health.checkRequiredDependencies();
    res.status(200).json({ ready: true });
  });

  // Reserve /api before the one-segment redirect route.
  app.use("/api/v1", createUrlRouter(services));
  app.use("/", createRedirectRouter(services));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
```

`Services` is a typed object containing the URL service, repositories, cache, rate limiter, event publisher, health checks and runtime configuration. Do not put database or Redis credentials in this object if it can reach browser code; it is backend-only.

### 26.2 Middleware order

Use this order deliberately:

1. Security headers.
2. CORS.
3. Request body parsing with a small limit.
4. Health/readiness endpoints.
5. API router.
6. Redirect router.
7. Not-found middleware.
8. Error middleware.

Authentication and rate-limiting middleware should be attached to the route groups that need them. Avoid parsing large bodies on redirect routes.

### 26.3 Async error handling

Express 5 forwards rejected Promises from async route handlers to error middleware. Use a central error mapper that returns a safe public message and logs the internal error. Never return database connection strings, SQL, stack traces or credentials to clients.

Illustrative error middleware:

```ts
import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = Number(err?.statusCode ?? 500);
  const safeStatus = status >= 400 && status < 600 ? status : 500;

  // Keep logs useful but never log passwords, auth tokens or full secrets.
  console.error(JSON.stringify({
    level: "error",
    message: err?.message ?? "unknown_error",
    status: safeStatus,
  }));

  res.status(safeStatus).json({
    error: safeStatus === 500 ? "internal_error" : (err?.code ?? "request_failed"),
  });
};
```

This is ordinary application logging, not a centralized instrumentation stack.

### 26.4 Redirect controller behavior

The redirect controller should call one service method and remain thin:

```ts
router.get("/:code", async (req, res) => {
  const destination = await services.urls.resolve(req.params.code);

  if (!destination) {
    return res.status(404).json({ error: "not_found" });
  }
  if (destination.state === "expired" || destination.state === "disabled") {
    return res.status(410).json({ error: "link_unavailable" });
  }

  res.set("Cache-Control", "no-store");
  res.set("Referrer-Policy", "no-referrer");
  return res.redirect(302, destination.url);
});
```

The actual route should distinguish unknown, expired and disabled records according to the product policy. `HEAD` should return the same status and headers without a response body.

---

## 27. Creation transaction and idempotency implementation

### 27.1 Generated-code insert loop

```ts
async function createWithGeneratedCode(input: CreateUrlInput) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode(8);
    const result = await db.query(
      `INSERT INTO urls
         (code, destination_url, owner_id, is_custom, expires_at)
       VALUES ($1, $2, $3, FALSE, $4)
       ON CONFLICT (code) DO NOTHING
       RETURNING code, destination_url, created_at, expires_at`,
      [code, input.destinationUrl, input.ownerId, input.expiresAt],
    );

    if (result.rowCount === 1) return result.rows[0];
    // A unique-key collision occurred. Generate a new candidate.
  }

  throw new RetryableAllocationError("Could not allocate a unique code");
}
```

A bounded loop prevents an unexpected generator or database problem from causing an infinite request. The retry count and collision count should be visible in test output.

### 27.2 Custom alias

A custom alias is validated before SQL, then inserted once. If `RETURNING` produces no row, return HTTP 409. Do not regenerate a custom alias; the client explicitly requested that value.

### 27.3 Idempotency transaction pseudocode

```text
BEGIN

Try to INSERT idempotency row with:
  principal_key, idempotency_key, request_hash, expires_at
ON CONFLICT DO NOTHING
RETURNING key

IF a row was inserted:
  Create URL (generated code retry or alias conflict handling)
  Build canonical response
  UPDATE idempotency row with response_status and response_body
  COMMIT
  Return canonical response
ELSE:
  SELECT existing idempotency row FOR UPDATE
  IF stored request_hash differs:
    COMMIT
    Return 409 idempotency_key_reused_with_different_request
  IF stored response exists:
    COMMIT
    Return the stored response
  Otherwise handle an incomplete/expired row by a defined recovery path

END
```

The unique key `(principal_key, idempotency_key)` serializes competing claims. Because the first transaction stores the URL and response before committing, a second request that conflicts waits and then reads the first committed result. Ensure the application does not commit the URL while leaving the idempotency record incomplete.

### 27.4 Database connection policy

For local Node.js, use one bounded `pg.Pool` per application process:

```ts
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
  statement_timeout: 3_000,
});
```

These are starting values for experiments, not final sizing. Measure pool wait time and database capacity. Across replicas, total possible connections are approximately `pool.max × replica_count`, so do not set a huge pool on every process.

In the Cloudflare Worker environment, use Hyperdrive. Follow Cloudflare's recommended pattern: create a `pg.Client` with the Hyperdrive connection string for the operation/request and let Hyperdrive maintain the underlying pool. Do not assume that a long-lived local Node `Pool` should be copied unchanged into the Worker runtime.

---

## 28. Cache implementation details and rate-limit script

### 28.1 Custom LRU data structure

Build an LRU cache with:

- A `Map<string, Node>` for key-to-node lookup.
- A doubly linked list ordered from most-recently-used to least-recently-used.
- `get(key)`: map lookup, move node to list head, return value if not expired.
- `set(key, value)`: update/move existing node or add a new head node.
- `delete(key)`: remove from map and linked list.
- Evict the tail when capacity is exceeded.

Expected average operations are O(1). Add TTL metadata to each node. Expiration can be checked on access first; a background sweeper is optional and must not create unbounded timers.

This cache is process-local. It is not the Redis cache and is not shared between instances.

### 28.2 Cache adapter contract

Keep cache policy in the URL service and provider-specific commands in adapters:

```ts
export interface CacheRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
}
```

Node adapter: `node-redis`. Worker adapter: `@upstash/redis` REST client. The key format and TTL policy remain the same.

### 28.3 TTL calculation

```ts
function cacheTtlSeconds(expiresAt: Date | null, now = Date.now()): number {
  const configuredMax = 15 * 60;
  if (!expiresAt) return configuredMax;
  const remaining = Math.floor((expiresAt.getTime() - now) / 1000);
  return Math.max(0, Math.min(configuredMax, remaining));
}
```

If the resulting TTL is zero, do not cache the record. Never cache an expiring link longer than its remaining lifetime.

### 28.4 Fixed-window rate limit script

For a first implementation, use an atomic Lua script in Redis:

```lua
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
```

The key might be `rate:create:ip:<ip>:<window>`. The script increments and sets the expiry atomically. Compare fixed window, sliding window and token bucket later. Upstash's REST API supports Redis commands through its documented client; test the selected script/command path in both adapters.

### 28.5 Distributed stampede lock

Optional advanced experiment:

```text
SET lock:url:<code> <random-token> NX PX 3000
```

Only the request that obtains the lock loads the destination from PostgreSQL. Other requests wait briefly, then re-check Redis. Release with a Lua compare-and-delete operation that deletes only if the stored token matches. This prevents one process from deleting another process's lock.

A lock can expire while its owner is still working. Always use a lease, timeouts and a fallback path. The database remains authoritative.

---

## 29. Queue consumer transaction and delivery guarantees

### 29.1 Idempotent aggregation SQL

A click event can be delivered more than once. Use the event ID as the idempotency key. The following transaction increments statistics only when the event ID is new:

```sql
BEGIN;

WITH new_event AS (
  INSERT INTO processed_events (event_id)
  VALUES ($1)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id
)
INSERT INTO url_stats (code, click_count, last_clicked_at, updated_at)
SELECT $2, 1, $3, now()
FROM new_event
ON CONFLICT (code) DO UPDATE
SET click_count = url_stats.click_count + 1,
    last_clicked_at = GREATEST(url_stats.last_clicked_at, EXCLUDED.last_clicked_at),
    updated_at = now();

COMMIT;
```

If `event_id` already exists, `new_event` is empty and the `url_stats` insert/update affects zero rows. The consumer can then ACK the duplicate safely.

### 29.2 RabbitMQ consumer pseudocode

```ts
await channel.prefetch(50);

await channel.consume("url.clicks.v1", async (message) => {
  if (!message) return;

  try {
    const event = parseAndValidateClickEvent(message.content);
    await analyticsService.processIdempotently(event);
    channel.ack(message);
  } catch (error) {
    // With the queue configured for a dead-letter exchange, requeue=false
    // routes terminal failures to the configured DLQ.
    channel.nack(message, false, false);
  }
});
```

The production implementation must distinguish transient DB/network errors from invalid payloads. Do not send every transient failure straight to a DLQ. Use a bounded retry topology (for example, retry queues with TTL + dead-letter routing) and eventually move poison messages to a DLQ for inspection.

### 29.3 RabbitMQ publisher

- Keep one connection per application process, not one connection per request.
- Use a confirm channel.
- Assert durable exchange/queue/binding during service startup.
- Mark messages persistent.
- Set `messageId` to `eventId` and content type to JSON.
- Handle connection close/error and reconnect with bounded exponential backoff plus jitter.
- Keep a bounded pending-publish buffer; never accumulate unlimited click events in application memory.

### 29.4 Delivery guarantee

The intended guarantee is at-least-once delivery with idempotent processing. A consumer may crash after the database commits but before the broker receives the ACK. RabbitMQ can redeliver the message; `processed_events` prevents the second delivery from incrementing click counts again. Do not call this exactly-once delivery.

---

## 30. Cloudflare Worker wiring for Express, PostgreSQL and Redis

### 30.1 Express Worker entry

The official Cloudflare integration uses `httpServerHandler` from `cloudflare:node`. The Worker entry point should compose Worker-specific adapters and expose the shared Express application:

```ts
import { httpServerHandler } from "cloudflare:node";
import { env } from "cloudflare:workers";
import { createApp } from "@shortener/api";
import { createWorkerServices } from "./worker-services";

const services = createWorkerServices(env);
const app = createApp(services);

app.listen(3000);
export default httpServerHandler({ port: 3000 });
```

This is an integration outline based on Cloudflare's documented pattern. The actual Worker configuration and environment types must be generated by Wrangler. Keep the shared Express routes independent of Worker-specific imports.

### 30.2 Wrangler configuration outline

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "url-shortener-api",
  "main": "src/worker.ts",
  "compatibility_date": "2026-11-10",
  "compatibility_flags": ["nodejs_compat"],
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "<created-hyperdrive-id>"
    }
  ],
  "queues": {
    "producers": [
      {
        "binding": "CLICK_EVENTS",
        "queue": "url-shortener-clicks"
      }
    ]
  }
}
```

Cloudflare's compatibility behavior evolves. Use the compatibility date and flags recommended by the current Wrangler/Cloudflare documentation when creating the project; the example is a checked-date illustration, not a file to copy blindly later.

### 30.3 Hyperdrive adapter outline

Cloudflare's Neon integration documents `pg` with Hyperdrive and requires a sufficiently recent `pg` version (currently newer than 8.16.3). The Worker uses the Hyperdrive binding's connection string:

```ts
import { Client } from "pg";

export async function withWorkerDb<T>(env: Env, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}
```

The repository/transaction layer should use this helper or an equivalent adapter. Do not expose the Hyperdrive connection string to the frontend.

### 30.4 Worker Redis adapter outline

```ts
import { Redis } from "@upstash/redis/cloudflare";

const redis = Redis.fromEnv(env);
```

The Upstash client uses HTTP/REST, which avoids relying on a long-lived raw Redis TCP connection from an edge/serverless environment. Local Node uses the standard Redis protocol through `node-redis`.

### 30.5 Queue bindings

The public Worker receives the click queue binding and publishes a validated event. A separate queue-consumer Worker processes batches, validates each event, calls the same idempotent analytics service and acknowledges/retries according to the queue consumer API. Configure a dead-letter queue explicitly; Cloudflare documents that messages reaching the retry limit are deleted if no DLQ is configured.

---

## 31. Custom load generator design

### 31.1 Why build our own

A load generator is itself a concurrent network program. Building it teaches:

- How to schedule work at a target rate.
- How connection pools and keep-alive work.
- How to distinguish offered load from completed throughput.
- How queueing delay grows when the service saturates.
- How to measure tail latency without retaining every sample.
- How generator CPU/network/socket limits distort results.

### 31.2 Components

```text
Scenario config
      |
      v
Arrival scheduler
      |
      v
Bounded in-flight request queue
      |
      v
Undici Pool / Agent
      |
      v
Target API
      |
      v
Result recorder
      |
      +--> latency histogram
      +--> status/error counters
      +--> request rate
      +--> timeout count
      +--> JSON/CSV report
```

### 31.3 Open workload scheduling

An open workload schedules arrivals according to a target rate, not according to previous response completion. Use a monotonic clock such as `performance.now()` and record scheduled start time, actual dispatch time and completion time. If the scheduler falls behind, record the missed/late arrivals rather than silently reducing the offered load.

Use a bounded in-flight limit so the generator does not exhaust its own memory. If it cannot dispatch the planned arrivals, record generator saturation. Avoid allocating one Promise and one socket for every virtual user in a million-user scenario.

### 31.4 Closed workload scheduling

A closed workload uses a fixed number of simulated users. Each user sends a request, waits for the response, pauses for a configurable think time and then sends another. This is useful for modeling user journeys but can hide overload because higher latency naturally reduces the request arrival rate.

### 31.5 Result format

Every run should produce a machine-readable result with:

```json
{
  "scenario": "redirect-hot-key",
  "targetRps": 5000,
  "durationSeconds": 120,
  "virtualUsers": 10000,
  "requestsScheduled": 600000,
  "requestsStarted": 598900,
  "requestsCompleted": 598500,
  "timeouts": 120,
  "httpErrors": 280,
  "latencyMs": {
    "p50": 8.1,
    "p95": 22.7,
    "p99": 54.2,
    "max": 180.4
  },
  "generator": {
    "cpuPercent": 65,
    "rssMb": 420,
    "networkMbps": 180
  }
}
```

Numbers above are illustrative only, not expected performance results. Record hardware, OS, Node version, app commit, DB settings, Redis settings, cache warm/cold state, test distribution and network placement for every benchmark.

---

## 32. Benchmark experiment catalogue

| Experiment | Procedure | Main observation |
|---|---|---|
| Code collisions | Inject a deterministic generator that repeats candidates | DB uniqueness, retry correctness |
| Custom alias race | Concurrently attempt one alias from many clients | Exactly one winner, all others 409 |
| Idempotency race | Replay same idempotency key concurrently | One logical URL, stable response |
| SQL index | Compare indexed and unindexed lookup plans | Scan type, buffers, latency |
| Connection pool | Gradually increase clients and vary pool size | Wait time, active connections, DB saturation |
| Cache warm-up | Compare cold and warm redirects | Hit ratio, DB query reduction |
| Cache stampede | Evict one hot key and send concurrent requests | Duplicate DB lookups before/after single-flight |
| Redis outage | Stop Redis during redirect traffic | Fallback behavior and DB pressure |
| Hot-key distribution | Send most requests to a small subset of codes | Cache locality and key contention |
| Queue prefetch | Vary consumer prefetch and consumer count | Throughput, backlog and memory |
| Duplicate queue delivery | Crash consumer after commit before ACK | Event idempotency |
| DB pool exhaustion | Constrain pool and raise request concurrency | Queueing, timeout and recovery |
| Keep-alive | Compare persistent and fresh connections | Handshake overhead and throughput |
| Open vs closed workload | Run same target with each model | Offered load and saturation behavior |
| Payload size | Vary URL lengths and request sizes | Parsing, network and memory impact |

Do not optimize from one noisy run. Use warm-up, repeated runs, a fixed measurement window and a baseline comparison. Report variance and environment details.
