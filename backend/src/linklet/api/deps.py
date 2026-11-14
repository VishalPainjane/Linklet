"""FastAPI dependency injection providers."""

from collections.abc import AsyncIterator
from typing import Any

import jwt
from fastapi import Depends, HTTPException, Request, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from linklet.cache.interface import UrlCache
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
    """Rate limit guard for URL creation using standard Redis pipeline."""
    redis_client: Redis | None = getattr(request.app.state, "redis", None)
    if not redis_client:
        return

    client_ip = request.client.host if request.client else "127.0.0.1"
    key = f"rate:create:{client_ip}"
    try:
        pipe = redis_client.pipeline()
        pipe.incr(key)
        pipe.expire(key, settings.rate_limit_create_window_seconds)
        results = await pipe.execute()
        count = int(results[0])
        if count > settings.rate_limit_create_max_requests:
            raise RateLimitExceededError(retry_after=settings.rate_limit_create_window_seconds)
    except RateLimitExceededError:
        raise
    except Exception:
        # Fail open on temporary cache failure
        pass


async def get_current_user_optional(request: Request) -> dict[str, Any] | None:
    """Extract authenticated user identity from Bearer JWT header."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None

    token = auth_header[7:].strip()
    if not token:
        return None

    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.PyJWTError:
        return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    return {
        "id": user_id,
        "email": payload.get("email"),
        "created_at": payload.get("created_at"),
    }


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
