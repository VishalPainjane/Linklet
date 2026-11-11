"""Cache abstraction interface for Linklet."""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Protocol


class CacheEntryStatus(StrEnum):
    """Lifecycle state of a cached URL entry."""

    ACTIVE = "active"
    DELETED = "deleted"
    EXPIRED = "expired"
    NOT_FOUND = "not_found"


@dataclass(frozen=True)
class CachedUrl:
    """Cached representation of a URL entry or negative/tombstone result."""

    code: str
    destination_url: str | None = None
    expires_at: datetime | None = None
    disabled: bool = False
    status: CacheEntryStatus = CacheEntryStatus.ACTIVE

    @property
    def is_active(self) -> bool:
        return self.status == CacheEntryStatus.ACTIVE and not self.disabled


class UrlCache(Protocol):
    """Protocol for short URL caching."""

    async def get(self, code: str) -> CachedUrl | None:
        """Retrieve URL or tombstone from cache."""
        ...

    async def set(
        self,
        code: str,
        destination_url: str,
        expires_at: datetime | None = None,
        ttl_seconds: int | None = None,
    ) -> None:
        """Save active URL into cache with appropriate TTL."""
        ...

    async def set_tombstone(
        self,
        code: str,
        status: CacheEntryStatus,
        ttl_seconds: int | None = None,
    ) -> None:
        """Save negative result or tombstone (deleted, expired, not_found) with TTL."""
        ...

    async def delete(self, code: str) -> None:
        """Invalidate URL in cache."""
        ...
