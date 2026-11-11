"""Redis-backed distributed cache adapter with single-flight stampede protection
and atomic Lua rate limiter.
"""

import asyncio
import json
import logging
import time
from datetime import UTC, datetime
from typing import Any

from redis.asyncio import Redis

from linklet.cache.interface import CachedUrl, CacheEntryStatus, UrlCache
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
        self._get_stats: dict[str, int] = {
            "hits": 0,
            "misses": 0,
            "errors": 0,
        }

    def _format_key(self, code: str) -> str:
        return f"url:{code}"

    async def get_lock_for_key(self, code: str) -> asyncio.Lock:
        """Process-local single-flight stampede lock."""
        async with self._meta_lock:
            if code not in self._single_flight_locks:
                self._single_flight_locks[code] = asyncio.Lock()
            return self._single_flight_locks[code]

    def log_summary(self) -> None:
        """Log cumulative cache statistics and connection pool utilization."""
        pool = getattr(self.redis, "connection_pool", None)
        in_use = len(getattr(pool, "_in_use_connections", [])) if pool else 0
        avail = len(getattr(pool, "_available_connections", [])) if pool else 0
        total_reqs = self._get_stats["hits"] + self._get_stats["misses"] + self._get_stats["errors"]
        logger.warning(
            "REDIS_GET_SUMMARY hits=%d misses=%d errors=%d total=%d in_use=%d avail=%d",
            self._get_stats["hits"],
            self._get_stats["misses"],
            self._get_stats["errors"],
            total_reqs,
            in_use,
            avail,
        )

    async def get(self, code: str) -> CachedUrl | None:
        """Fetch cached URL metadata with diagnostics."""
        started = time.perf_counter()
        redis_ms = 0.0
        decode_ms = 0.0
        outcome = "error"
        try:
            redis_started = time.perf_counter()
            raw = await self.redis.get(self._format_key(code))
            redis_ms = (time.perf_counter() - redis_started) * 1000
            if not raw:
                outcome = "miss"
                self._get_stats["misses"] += 1
                return None
            decode_started = time.perf_counter()
            data = json.loads(raw)
            expires_at = (
                datetime.fromisoformat(data["expires_at"]) if data.get("expires_at") else None
            )
            raw_status = data.get("status")
            if raw_status:
                try:
                    entry_status = CacheEntryStatus(raw_status)
                except ValueError:
                    entry_status = CacheEntryStatus.ACTIVE
            else:
                entry_status = (
                    CacheEntryStatus.DELETED
                    if data.get("disabled")
                    else CacheEntryStatus.ACTIVE
                )

            cached = CachedUrl(
                code=data.get("code", code),
                destination_url=data.get("destination_url"),
                expires_at=expires_at,
                disabled=bool(
                    data.get("disabled", False) or entry_status == CacheEntryStatus.DELETED
                ),
                status=entry_status,
            )
            decode_ms = (time.perf_counter() - decode_started) * 1000
            outcome = "hit"
            self._get_stats["hits"] += 1
            return cached
        except Exception as exc:
            outcome = "error"
            self._get_stats["errors"] += 1
            pool = getattr(self.redis, "connection_pool", None)
            in_use = len(getattr(pool, "_in_use_connections", [])) if pool else 0
            avail = len(getattr(pool, "_available_connections", [])) if pool else 0
            logger.warning(
                "REDIS_GET_ERROR code=%s error_type=%s err=%s in_use=%d avail=%d redis_ms=%.2fms",
                code,
                type(exc).__name__,
                exc,
                in_use,
                avail,
                redis_ms,
            )
            return None
        finally:
            total_ms = (time.perf_counter() - started) * 1000
            if redis_ms > 10.0:
                pool = getattr(self.redis, "connection_pool", None)
                in_use = len(getattr(pool, "_in_use_connections", [])) if pool else 0
                avail = len(getattr(pool, "_available_connections", [])) if pool else 0
                logger.warning(
                    "SLOW_REDIS_GET code=%s redis_ms=%.2fms decode_ms=%.2fms "
                    "total_ms=%.2fms outcome=%s in_use=%d avail=%d",
                    code,
                    redis_ms,
                    decode_ms,
                    total_ms,
                    outcome,
                    in_use,
                    avail,
                )
            total_reqs = (
                self._get_stats["hits"] + self._get_stats["misses"] + self._get_stats["errors"]
            )
            if total_reqs > 0 and total_reqs % 1000 == 0:
                self.log_summary()

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
                "status": CacheEntryStatus.ACTIVE.value,
            }
            await self.redis.set(
                self._format_key(code),
                json.dumps(payload),
                ex=effective_ttl,
            )
        except Exception as exc:
            logger.warning("Redis SET url:%s failed: %s", code, exc)

    async def set_tombstone(
        self,
        code: str,
        status: CacheEntryStatus,
        ttl_seconds: int | None = None,
    ) -> None:
        """Cache negative lookup or tombstone (deleted, expired, not_found) with bounded TTL."""
        try:
            if ttl_seconds is not None:
                effective_ttl = ttl_seconds
            elif status == CacheEntryStatus.NOT_FOUND:
                effective_ttl = settings.cache_negative_ttl_seconds
            else:
                effective_ttl = settings.cache_tombstone_ttl_seconds

            payload: dict[str, Any] = {
                "code": code,
                "destination_url": None,
                "expires_at": None,
                "disabled": (status == CacheEntryStatus.DELETED),
                "status": status.value,
            }
            await self.redis.set(
                self._format_key(code),
                json.dumps(payload),
                ex=effective_ttl,
            )
        except Exception as exc:
            logger.warning("Redis SET_TOMBSTONE url:%s status:%s failed: %s", code, status, exc)

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
