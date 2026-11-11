"""FastAPI dependency injection providers."""

import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from linklet.cache.interface import UrlCache
from linklet.cache.redis_cache import RedisUrlCache
from linklet.config import settings
from linklet.errors import RateLimitExceededError
from linklet.messaging.publisher import EventPublisher


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Provide a scoped async database session per request."""
    session_factory = request.app.state.session_factory
    async with session_factory() as session:
        yield session


def get_cache(request: Request) -> UrlCache:
    """Provide the application cache instance."""
    return request.app.state.cache  # type: ignore[no-any-return]


def get_publisher(request: Request) -> EventPublisher:
    """Provide the event publisher instance."""
    return request.app.state.publisher  # type: ignore[no-any-return]


async def rate_limit_create_url(request: Request) -> None:
    """Rate limit guard for URL creation."""
    client_ip = request.client.host if request.client else "127.0.0.1"
    cache_instance: UrlCache = request.app.state.cache

    if isinstance(cache_instance, RedisUrlCache):
        key = f"rate:create:{client_ip}"
        allowed, count = await cache_instance.check_rate_limit(
            key=key,
            max_requests=settings.rate_limit_create_max_requests,
            window_seconds=settings.rate_limit_create_window_seconds,
        )
        if not allowed:
            raise RateLimitExceededError(retry_after=settings.rate_limit_create_window_seconds)


async def get_current_user_optional(request: Request) -> dict[str, Any] | None:
    """Extract authenticated user session from Bearer header or session cookie."""
    auth_header = request.headers.get("Authorization")
    token: str | None = None
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    elif "linklet_session" in request.cookies:
        token = request.cookies.get("linklet_session")

    if not token:
        return None

    redis_client = getattr(request.app.state, "redis", None)
    if redis_client:
        try:
            raw = await redis_client.get(f"session:{token}")
            if raw:
                return json.loads(raw)  # type: ignore[no-any-return]
        except Exception:
            pass

    in_memory_sessions = getattr(request.app.state, "sessions", None)
    if in_memory_sessions and f"session:{token}" in in_memory_sessions:
        try:
            return json.loads(in_memory_sessions[f"session:{token}"])  # type: ignore[no-any-return]
        except Exception:
            return None

    return None


async def get_current_user(
    user: dict[str, Any] | None = Depends(get_current_user_optional),
) -> dict[str, Any]:
    """Require valid authenticated user session."""
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please sign in.",
        )
    return user

