"""Redis-backed distributed cache adapter with single-flight stampede protection
and atomic Lua rate limiter.
"""

import asyncio
import json
import logging
from datetime import UTC, datetime
from typing import Any

from redis.asyncio import Redis

from linklet.cache.interface import CachedUrl, UrlCache
from linklet.config import settings

logger = logging.getLogger(__name__)

# Atomic Rate Limiter Lua Script
# Ensures counter initialization and TTL expiration are atomic to prevent orphaned counters.
RATE_LIMIT_LUA = """
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
"""


class RedisUrlCache(UrlCache):
    """Production Redis URL cache implementing cache-aside with SingleFlight coalescing."""

    def __init__(self, redis_client: Redis) -> None:
        self.redis = redis_client
        self._single_flight_locks: dict[str, asyncio.Lock] = {}
        self._meta_lock = asyncio.Lock()
        self._rate_limit_script = self.redis.register_script(RATE_LIMIT_LUA)

    def _format_key(self, code: str) -> str:
        return f"url:{code}"

    async def get_lock_for_key(self, code: str) -> asyncio.Lock:
        """Process-local single-flight stampede lock."""
        async with self._meta_lock:
            if code not in self._single_flight_locks:
                self._single_flight_locks[code] = asyncio.Lock()
            return self._single_flight_locks[code]

    async def get(self, code: str) -> CachedUrl | None:
        """Fetch cached URL metadata. Returns None on cache miss or Redis error."""
        try:
            raw = await self.redis.get(self._format_key(code))
            if not raw:
                return None
            data = json.loads(raw)
            expires_at = (
                datetime.fromisoformat(data["expires_at"]) if data.get("expires_at") else None
            )
            return CachedUrl(
                code=data["code"],
                destination_url=data["destination_url"],
                expires_at=expires_at,
                disabled=bool(data.get("disabled", False)),
            )
        except Exception as exc:
            logger.warning("Redis GET url:%s failed, falling back to database: %s", code, exc)
            return None

    async def set(
        self,
        code: str,
        destination_url: str,
        expires_at: datetime | None = None,
        ttl_seconds: int | None = None,
    ) -> None:
        """Cache an active URL with a bounded TTL capped by link expiration."""
        try:
            max_ttl = ttl_seconds if ttl_seconds is not None else settings.cache_default_ttl_seconds
            effective_ttl = max_ttl

            if expires_at is not None:
                now_dt = datetime.now(UTC)
                exp_dt = (
                    expires_at.astimezone(UTC)
                    if expires_at.tzinfo
                    else expires_at.replace(tzinfo=UTC)
                )
                remaining = int((exp_dt - now_dt).total_seconds())
                if remaining <= 0:
                    # Link has already expired; do not cache
                    return
                effective_ttl = min(max_ttl, remaining)

            payload: dict[str, Any] = {
                "code": code,
                "destination_url": destination_url,
                "expires_at": expires_at.isoformat() if expires_at else None,
                "disabled": False,
            }
            await self.redis.set(
                self._format_key(code),
                json.dumps(payload),
                ex=effective_ttl,
            )
        except Exception as exc:
            logger.warning("Redis SET url:%s failed: %s", code, exc)

    async def delete(self, code: str) -> None:
        """Invalidate URL in Redis."""
        try:
            await self.redis.delete(self._format_key(code))
        except Exception as exc:
            logger.warning("Redis DELETE url:%s failed: %s", code, exc)

    async def check_rate_limit(
        self,
        key: str,
        max_requests: int,
        window_seconds: int,
    ) -> tuple[bool, int]:
        """Atomic rate limit check using Lua. Returns (is_allowed, current_count)."""
        try:
            count = await self._rate_limit_script(keys=[key], args=[window_seconds])
            is_allowed = int(count) <= max_requests
            return is_allowed, int(count)
        except Exception as exc:
            logger.warning("Redis rate limiter check failed for %s: %s", key, exc)
            # Fail open if Redis is down, or fail closed based on strictness;
            # systems engineering standard: log and allow traffic while backing store recovers.
            return True, 1
