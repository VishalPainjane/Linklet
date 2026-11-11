"""Redirect service implementing cache-aside resolution with stampede mitigation,
negative caching, lifecycle tombstones, and async analytics dispatch.
"""

import asyncio
import logging
from datetime import UTC, datetime
from urllib.parse import urlparse

from sqlalchemy.ext.asyncio import AsyncSession

from linklet.cache.interface import CachedUrl, CacheEntryStatus, UrlCache
from linklet.cache.redis_cache import RedisUrlCache
from linklet.config import settings
from linklet.errors import UrlGoneError, UrlNotFoundError
from linklet.messaging.events import ClickEventMessage
from linklet.messaging.publisher import EventPublisher
from linklet.repositories.url_repository import UrlRepository

logger = logging.getLogger(__name__)


class RedirectService:
    """Service resolving short links to destinations and queueing click telemetry."""

    def __init__(
        self,
        session: AsyncSession,
        cache: UrlCache,
        publisher: EventPublisher,
    ) -> None:
        self.session = session
        self.cache = cache
        self.publisher = publisher
        self.repo = UrlRepository(session=session)

    async def _handle_cached_entry(
        self, code: str, cached: CachedUrl, now: datetime
    ) -> str:
        """Handle cached entry by evaluating status and expiration."""
        if cached.status == CacheEntryStatus.DELETED or cached.disabled:
            raise UrlGoneError(code, reason="disabled")

        if cached.status == CacheEntryStatus.EXPIRED:
            raise UrlGoneError(code, reason="expired")

        if cached.status == CacheEntryStatus.NOT_FOUND:
            raise UrlNotFoundError(code)

        if cached.status == CacheEntryStatus.ACTIVE:
            if cached.expires_at is not None:
                exp_dt = (
                    cached.expires_at.astimezone(UTC)
                    if cached.expires_at.tzinfo
                    else cached.expires_at.replace(tzinfo=UTC)
                )
                if exp_dt <= now:
                    # Replace expired entry with tombstone rather than deleting key
                    await self.cache.set_tombstone(
                        code=code,
                        status=CacheEntryStatus.EXPIRED,
                        ttl_seconds=settings.cache_tombstone_ttl_seconds,
                    )
                    raise UrlGoneError(code, reason="expired")

            if not cached.destination_url:
                raise UrlNotFoundError(code)

            return cached.destination_url

        raise UrlNotFoundError(code)

    async def resolve(
        self,
        code: str,
        referrer: str | None = None,
        user_agent: str | None = None,
        country: str | None = None,
    ) -> str:
        """Resolve short code to destination URL."""
        now = datetime.now(UTC)

        # 1. Check cache
        cached = await self.cache.get(code)
        if cached is not None:
            destination = await self._handle_cached_entry(code, cached, now)
        else:
            # 2. Cache miss: use single-flight coalescing if available
            lock: asyncio.Lock | None = None
            if isinstance(self.cache, RedisUrlCache):
                lock = await self.cache.get_lock_for_key(code)

            if lock:
                async with lock:
                    # Double-checked locking
                    cached_retry = await self.cache.get(code)
                    if cached_retry is not None:
                        destination = await self._handle_cached_entry(code, cached_retry, now)
                    else:
                        destination = await self._fetch_from_db_and_cache(code, now)
            else:
                destination = await self._fetch_from_db_and_cache(code, now)

        # 3. Asynchronously enqueue click event (non-blocking Mode A)
        referrer_host = urlparse(referrer).hostname if referrer else None
        event = ClickEventMessage(
            code=code,
            occurred_at=now,
            referrer_host=referrer_host,
            user_agent_family=user_agent[:64] if user_agent else None,
            country_code=country[:2].upper() if country else None,
        )
        self.publisher.enqueue_click(event)

        return destination

    async def _fetch_from_db_and_cache(self, code: str, now: datetime) -> str:
        """Query PostgreSQL, populate cache with active URL or negative/tombstone result."""
        record = await self.repo.get_by_code(code)
        if record is None:
            # Negative cache: cache NOT_FOUND so scanners/bots don't hammer PostgreSQL
            await self.cache.set_tombstone(
                code=code,
                status=CacheEntryStatus.NOT_FOUND,
                ttl_seconds=settings.cache_negative_ttl_seconds,
            )
            raise UrlNotFoundError(code)

        if record.disabled_at is not None:
            # Tombstone: cache DELETED so subsequent requests return 410 without DB hit
            await self.cache.set_tombstone(
                code=code,
                status=CacheEntryStatus.DELETED,
                ttl_seconds=settings.cache_tombstone_ttl_seconds,
            )
            raise UrlGoneError(code, reason="disabled")

        if record.expires_at is not None:
            exp_dt = (
                record.expires_at.astimezone(UTC)
                if record.expires_at.tzinfo
                else record.expires_at.replace(tzinfo=UTC)
            )
            if exp_dt <= now:
                # Tombstone: cache EXPIRED
                await self.cache.set_tombstone(
                    code=code,
                    status=CacheEntryStatus.EXPIRED,
                    ttl_seconds=settings.cache_tombstone_ttl_seconds,
                )
                raise UrlGoneError(code, reason="expired")

        # Cache active link
        await self.cache.set(
            code=code,
            destination_url=record.destination_url,
            expires_at=record.expires_at,
        )
        return record.destination_url
