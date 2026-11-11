"""FastAPI application factory and lifespan lifecycle management."""

import asyncio
import logging
import os
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

from linklet.api.routes import auth, health, redirects, urls
from linklet.cache.local_lru import LocalUrlCacheAdapter
from linklet.cache.redis_cache import RedisUrlCache
from linklet.config import settings
from linklet.database import create_engine_and_session_factory
from linklet.errors import LinkletError
from linklet.messaging.publisher import (
    BoundedAsyncClickPublisher,
    MockEventPublisher,
)
from linklet.messaging.rabbitmq import RabbitMQTopology
from linklet.workers.click_consumer import ClickConsumer
from linklet.workers.outbox_worker import OutboxWorker

logging.basicConfig(
    level=logging.INFO if not settings.debug else logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("linklet")


class ResponseTimingMiddleware:
    """Pure ASGI middleware measuring total server-side response-send latency for GET /{code}."""

    def __init__(self, app: Any) -> None:
        self.app = app
        self._samples: list[float] = []
        self._stats: dict[str, Any] = {
            "total": 0,
            "le_10": 0,
            "le_25": 0,
            "le_50": 0,
            "le_100": 0,
            "le_250": 0,
            "le_500": 0,
            "le_1000": 0,
            "gt_1000": 0,
            "max_ms": 0.0,
            "min_ms": 0.0,
        }
        GLOBAL_ASGI_TIMINGS.append(self)

    def reset(self) -> None:
        self._samples.clear()
        self._stats = {
            "total": 0,
            "le_10": 0,
            "le_25": 0,
            "le_50": 0,
            "le_100": 0,
            "le_250": 0,
            "le_500": 0,
            "le_1000": 0,
            "gt_1000": 0,
            "max_ms": 0.0,
            "min_ms": 0.0,
        }

    def get_percentiles(self) -> dict[str, float]:
        if not self._samples:
            return {"p50": 0.0, "p90": 0.0, "p95": 0.0, "p99": 0.0, "max": 0.0}
        s = sorted(self._samples)
        n = len(s)
        return {
            "p50": round(s[int(n * 0.50)], 2),
            "p90": round(s[int(n * 0.90)], 2),
            "p95": round(s[int(n * 0.95)], 2),
            "p99": round(s[int(n * 0.99)], 2),
            "max": round(s[-1], 2),
        }

    def log_summary(self) -> None:
        pct = self.get_percentiles()
        logger.warning(
            "ASGI_HISTOGRAM pid=%s total=%d le_10=%d le_25=%d le_50=%d le_100=%d "
            "le_250=%d le_500=%d le_1000=%d gt_1000=%d | "
            "p50=%.2f p90=%.2f p95=%.2f p99=%.2f max=%.2f",
            os.getpid(),
            self._stats["total"],
            self._stats["le_10"],
            self._stats["le_25"],
            self._stats["le_50"],
            self._stats["le_100"],
            self._stats["le_250"],
            self._stats["le_500"],
            self._stats["le_1000"],
            self._stats["gt_1000"],
            pct["p50"],
            pct["p90"],
            pct["p95"],
            pct["p99"],
            pct["max"],
        )

    async def __call__(
        self,
        scope: dict[str, Any],
        receive: Callable[..., Any],
        send: Callable[..., Any],
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = scope.get("method", "")
        path = scope.get("path", "")
        # Filter strictly for GET /{code} (excluding API and diagnostic paths)
        is_redirect_get = (
            method == "GET"
            and not path.startswith("/api/")
            and path not in ("/health", "/ready", "/diagnostics/asgi", "/diagnostics/cache")
        )

        if not is_redirect_get:
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        status_code: int | None = None

        async def measured_send(message: dict[str, Any]) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message.get("status")
            await send(message)
            if (
                message["type"] == "http.response.body"
                and not message.get("more_body", False)
            ):
                elapsed_ms = (time.perf_counter() - started) * 1000
                self._samples.append(elapsed_ms)
                self._stats["total"] += 1
                if self._stats["total"] == 1 or elapsed_ms < self._stats["min_ms"]:
                    self._stats["min_ms"] = elapsed_ms
                if elapsed_ms > self._stats["max_ms"]:
                    self._stats["max_ms"] = elapsed_ms

                if elapsed_ms < 10.0:
                    self._stats["le_10"] += 1
                elif elapsed_ms < 25.0:
                    self._stats["le_25"] += 1
                elif elapsed_ms < 50.0:
                    self._stats["le_50"] += 1
                elif elapsed_ms < 100.0:
                    self._stats["le_100"] += 1
                elif elapsed_ms < 250.0:
                    self._stats["le_250"] += 1
                elif elapsed_ms < 500.0:
                    self._stats["le_500"] += 1
                elif elapsed_ms < 1000.0:
                    self._stats["le_1000"] += 1
                else:
                    self._stats["gt_1000"] += 1
                    logger.warning(
                        "SLOW_ASGI_RESPONSE pid=%s method=%s path=%s status=%s server_ms=%.2f",
                        os.getpid(),
                        method,
                        path,
                        status_code,
                        elapsed_ms,
                    )

        await self.app(scope, receive, measured_send)


GLOBAL_ASGI_TIMINGS: list[ResponseTimingMiddleware] = []


async def monitor_event_loop() -> None:
    """Monitor asyncio event loop scheduling lag."""
    loop = asyncio.get_running_loop()
    interval = 0.1
    deadline = loop.time() + interval
    while True:
        await asyncio.sleep(max(0.0, deadline - loop.time()))
        now = loop.time()
        lag_ms = max(0.0, now - deadline) * 1000
        if lag_ms >= 50:
            logger.warning(
                "EVENT_LOOP_LAG pid=%s lag_ms=%.2f",
                os.getpid(),
                lag_ms,
            )
        deadline = now + interval


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Manages resource allocation and graceful shutdown."""
    logger.info("Initializing Linklet application resources...")
    loop_monitor_task = asyncio.create_task(monitor_event_loop())

    # 1. Database engine & sessionmaker (preserve test injection if present)
    engine = getattr(app.state, "engine", None)
    session_factory = getattr(app.state, "session_factory", None)
    own_engine = False

    if session_factory is None:
        engine, session_factory = create_engine_and_session_factory()
        app.state.engine = engine
        app.state.session_factory = session_factory
        own_engine = True

    # 2. Redis Cache
    redis_client: Redis | None = None
    if not hasattr(app.state, "cache"):
        try:
            candidate_redis = Redis.from_url(
                settings.redis_url,
                decode_responses=True,
                socket_connect_timeout=0.5,
                socket_timeout=0.5,
                health_check_interval=30,
                max_connections=settings.redis_max_connections,
            )
            # Verify connectivity immediately
            await asyncio.wait_for(candidate_redis.ping(), timeout=0.5)
            redis_client = candidate_redis
            app.state.redis = redis_client
            app.state.cache = RedisUrlCache(redis_client)
            logger.info("Connected to Redis at %s", settings.redis_url)
        except Exception as exc:
            if redis_client:
                await redis_client.aclose()
                redis_client = None
            logger.info(
                "Redis unavailable (%s); using high-performance in-process O(1) LRU cache.",
                exc,
            )
            app.state.cache = LocalUrlCacheAdapter(capacity=50000)

    # 3. RabbitMQ Topology & Publisher
    topology: RabbitMQTopology | None = None
    publisher: BoundedAsyncClickPublisher | MockEventPublisher
    consumer: ClickConsumer | None = None

    if not hasattr(app.state, "publisher"):
        try:
            topology = RabbitMQTopology(amqp_url=settings.amqp_url)
            await topology.connect()
            app.state.topology = topology

            pub = BoundedAsyncClickPublisher(topology=topology)
            pub.start()
            publisher = pub
            app.state.publisher = publisher

            # Optional consumer in same process for single-service deployments
            if settings.run_click_consumer:
                consumer = ClickConsumer(
                    topology=topology,
                    session_factory=session_factory,
                )
                await consumer.start()
                app.state.consumer = consumer
                logger.info("In-process ClickConsumer started.")

            logger.info("RabbitMQ messaging initialized.")
        except Exception as exc:
            logger.warning(
                "Could not connect to RabbitMQ (%s); using in-memory mock event publisher.",
                exc,
            )
            publisher = MockEventPublisher()
            app.state.publisher = publisher
    else:
        publisher = app.state.publisher

    # 4. Transactional Outbox Relay Worker
    outbox_worker: OutboxWorker | None = None
    if settings.run_outbox_worker and session_factory and hasattr(app.state, "cache"):
        try:
            outbox_worker = OutboxWorker(
                session_factory=session_factory,
                cache=app.state.cache,
                poll_interval_seconds=settings.outbox_poll_interval_seconds,
            )
            outbox_worker.start()
            app.state.outbox_worker = outbox_worker
            logger.info("Transactional OutboxWorker started.")
        except Exception as exc:
            logger.warning("Could not start OutboxWorker: %s", exc)

    yield

    # Teardown / Graceful Shutdown
    logger.info("Shutting down Linklet resources...")

    for timing_mw in GLOBAL_ASGI_TIMINGS:
        timing_mw.log_summary()

    loop_monitor_task.cancel()
    try:
        await loop_monitor_task
    except asyncio.CancelledError:
        pass

    if outbox_worker:
        await outbox_worker.stop()

    if hasattr(app.state, "cache") and hasattr(app.state.cache, "log_summary"):
        try:
            app.state.cache.log_summary()
        except Exception:
            pass

    if consumer:
        await consumer.stop()

    if isinstance(publisher, BoundedAsyncClickPublisher):
        await publisher.stop()

    if topology:
        await topology.close()

    if redis_client:
        await redis_client.aclose()

    if own_engine and engine:
        await engine.dispose()
    logger.info("Linklet cleanup complete.")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Linklet API",
        version="0.1.0",
        description="High-performance URL shortener and systems engineering laboratory.",
        lifespan=lifespan,
    )

    # CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_cors_origins,
        allow_origin_regex=r"^https://.*\.vercel\.app$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Pure ASGI Response Timing Middleware (Outermost layer)
    app.add_middleware(ResponseTimingMiddleware)

    # Exception Handlers
    @app.exception_handler(LinkletError)
    async def linklet_error_handler(request: Request, exc: LinkletError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": exc.__class__.__name__,
                "message": exc.message,
                "details": exc.details,
            },
        )

    # Register Routers in order:
    # 1. Health & probes
    app.include_router(health.router)
    # 2. REST API v1
    app.include_router(auth.router)
    app.include_router(urls.router)
    # 3. Public redirect /{code} (Must be after reserved routes!)
    app.include_router(redirects.router)

    return app


app = create_app()
