"""FastAPI application factory and lifespan lifecycle management."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

from linklet.api.routes import health, redirects, urls
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

logging.basicConfig(
    level=logging.INFO if not settings.debug else logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("linklet")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Manages resource allocation and graceful shutdown."""
    logger.info("Initializing Linklet application resources...")

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
            import asyncio
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

    yield

    # Teardown / Graceful Shutdown
    logger.info("Shutting down Linklet resources...")

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
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

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
    app.include_router(urls.router)
    # 3. Public redirect /{code} (Must be after reserved routes!)
    app.include_router(redirects.router)

    return app


app = create_app()
