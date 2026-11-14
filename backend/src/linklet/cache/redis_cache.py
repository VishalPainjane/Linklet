"""Standard Redis cache adapter for Linklet short URLs."""

import json
import logging
from datetime import UTC, datetime
from typing import Any

from redis.asyncio import Redis

from linklet.cache.interface import CachedUrl, CacheEntryStatus, UrlCache
from linklet.config import settings

logger = logging.getLogger(__name__)


class RedisUrlCache(UrlCache):
    """Clean Redis cache adapter using standard redis.asyncio."""

    def __init__(self, redis_client: Redis) -> None:
        self.redis = redis_client

    def _format_key(self, code: str) -> str:
        return f"url:{code}"

    async def get(self, code: str) -> CachedUrl | None:
        """Fetch cached URL metadata."""
        try:
            raw = await self.redis.get(self._format_key(code))
            if not raw:
                return None

            data = json.loads(raw)
            expires_at = (
                datetime.fromisoformat(data["expires_at"]) if data.get("expires_at") else None
            )
            raw_status = data.get("status")
            try:
                entry_status = (
                    CacheEntryStatus(raw_status) if raw_status else CacheEntryStatus.ACTIVE
                )
            except ValueError:
                entry_status = CacheEntryStatus.ACTIVE

            return CachedUrl(
                code=data.get("code", code),
                destination_url=data.get("destination_url"),
                expires_at=expires_at,
                disabled=bool(
                    data.get("disabled", False) or entry_status == CacheEntryStatus.DELETED
                ),
                status=entry_status,
            )
        except Exception as exc:
            logger.warning("Redis GET url:%s failed: %s", code, exc)
            return None

    async def set(
        self,
        code: str,
        destination_url: str,
        expires_at: datetime | None = None,
        ttl_seconds: int | None = None,
    ) -> None:
        """Cache an active URL with TTL."""
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
        """Cache tombstone (deleted, expired, not_found)."""
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
