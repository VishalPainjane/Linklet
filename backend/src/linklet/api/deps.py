"""FastAPI dependency injection providers."""

from collections.abc import AsyncIterator

from fastapi import Request
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
