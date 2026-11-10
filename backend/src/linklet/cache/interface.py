"""Cache abstraction interface for Linklet."""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True)
class CachedUrl:
    """Cached representation of an active URL."""

    code: str
    destination_url: str
    expires_at: datetime | None
    disabled: bool = False


class UrlCache(Protocol):
    """Protocol for short URL caching."""

    async def get(self, code: str) -> CachedUrl | None:
        """Retrieve URL from cache."""
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

    async def delete(self, code: str) -> None:
        """Invalidate URL in cache."""
        ...

