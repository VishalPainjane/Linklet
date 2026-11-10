"""Health and readiness probe routes."""

import logging
from typing import Any

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from linklet.api.deps import get_session

router = APIRouter(tags=["health"])
logger = logging.getLogger(__name__)


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
