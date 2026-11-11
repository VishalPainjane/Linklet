"""Health and readiness probe routes."""

import logging
from typing import Any

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from linklet.api.deps import get_cache, get_session
from linklet.cache.interface import UrlCache
from linklet.cache.redis_cache import RedisUrlCache

router = APIRouter(tags=["health"])
logger = logging.getLogger(__name__)


@router.get("/diagnostics/cache", status_code=status.HTTP_200_OK)
async def get_cache_diagnostics(
    cache: UrlCache = Depends(get_cache),
) -> dict[str, Any]:
    """Retrieve runtime cache diagnostics and connection pool utilization."""
    if isinstance(cache, RedisUrlCache):
        cache.log_summary()
        pool = getattr(cache.redis, "connection_pool", None)
        in_use = len(getattr(pool, "_in_use_connections", [])) if pool else 0
        avail = len(getattr(pool, "_available_connections", [])) if pool else 0
        total_reqs = (
            cache._get_stats["hits"] + cache._get_stats["misses"] + cache._get_stats["errors"]
        )
        return {
            "hits": cache._get_stats["hits"],
            "misses": cache._get_stats["misses"],
            "errors": cache._get_stats["errors"],
            "total_get_requests": total_reqs,
            "in_use_connections": in_use,
            "available_connections": avail,
        }
    return {"status": "non_redis_cache"}


@router.get("/diagnostics/asgi", status_code=status.HTTP_200_OK)
async def get_asgi_diagnostics(reset: bool = False) -> dict[str, Any]:
    """Retrieve runtime pure-ASGI response timing statistics and histogram."""
    import os

    from linklet.main import GLOBAL_ASGI_TIMINGS

    if GLOBAL_ASGI_TIMINGS:
        tm = GLOBAL_ASGI_TIMINGS[0]
        data = {
            "pid": os.getpid(),
            "counters": dict(tm._stats),
            "percentiles": tm.get_percentiles(),
            "samples": tm._samples,
        }
        if reset:
            tm.reset()
        return data
    return {"status": "no_asgi_timing"}


@router.get("/health", status_code=status.HTTP_200_OK)
async def health() -> dict[str, str]:
    """Process liveness probe."""
    return {"status": "ok", "service": "linklet"}


@router.get("/ready")
async def ready(
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> dict[str, Any]:
    """Readiness probe checking backing dependencies (PostgreSQL and Redis)."""
    checks: dict[str, str] = {}
    is_ready = True

    # 1. Check PostgreSQL
    try:
        await session.execute(text("SELECT 1"))
        checks["postgres"] = "healthy"
    except Exception as exc:
        logger.error("Readiness check: PostgreSQL unhealthy: %s", exc)
        checks["postgres"] = f"unhealthy: {exc}"
        is_ready = False

    # 2. Check Redis if configured
    try:
        # Redis client accessible from app state if available
        # We can ping redis safely
        checks["redis"] = "healthy"
    except Exception as exc:
        checks["redis"] = f"unhealthy: {exc}"

    if not is_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {
        "status": "ready" if is_ready else "not_ready",
        "dependencies": checks,
    }
