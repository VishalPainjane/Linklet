"""In-process O(1) LRU Cache implemented with a Doubly-Linked List and Hash Map."""

import time
from datetime import UTC, datetime
from typing import TypeVar

from linklet.cache.interface import CachedUrl

T = TypeVar("T")


class Node[T]:
    """Doubly-linked list node holding key and value."""

    __slots__ = ("key", "val", "expires_at_timestamp", "prev", "next")

    def __init__(
        self,
        key: str,
        val: T,
        expires_at_timestamp: float | None = None,
    ) -> None:
        self.key = key
        self.val = val
        self.expires_at_timestamp = expires_at_timestamp
        self.prev: Node[T] | None = None
        self.next: Node[T] | None = None


class LocalLRUCache[T]:
    """Process-local LRU Cache with O(1) get, put, delete, and TTL eviction."""

    def __init__(self, capacity: int = 1000) -> None:
        if capacity <= 0:
            raise ValueError("Capacity must be positive.")
        self.capacity = capacity
        self._map: dict[str, Node[T]] = {}

        # Sentinel head and tail
        self._head: Node[T] = Node("", None)  # type: ignore[arg-type]
        self._tail: Node[T] = Node("", None)  # type: ignore[arg-type]
        self._head.next = self._tail
        self._tail.prev = self._head

    def _remove(self, node: Node[T]) -> None:
        """Unlink node from list."""
        assert node.prev is not None and node.next is not None
        node.prev.next = node.next
        node.next.prev = node.prev
        node.prev = None
        node.next = None

    def _add_to_head(self, node: Node[T]) -> None:
        """Link node right after head (most recently used)."""
        node.next = self._head.next
        node.prev = self._head
        assert self._head.next is not None
        self._head.next.prev = node
        self._head.next = node

    def get(self, key: str) -> T | None:
        """Fetch item by key. Returns None if absent or expired."""
        node = self._map.get(key)
        if node is None:
            return None

        # Check expiry
        now = time.time()
        if node.expires_at_timestamp is not None and now >= node.expires_at_timestamp:
            self.delete(key)
            return None

        # Move to head
        self._remove(node)
        self._add_to_head(node)
        return node.val

    def put(self, key: str, val: T, ttl_seconds: float | None = None) -> None:
        """Insert or update item. Evicts least recently used if at capacity."""
        expires_at_timestamp = (time.time() + ttl_seconds) if ttl_seconds is not None else None

        if key in self._map:
            node = self._map[key]
            node.val = val
            node.expires_at_timestamp = expires_at_timestamp
            self._remove(node)
            self._add_to_head(node)
            return

        if len(self._map) >= self.capacity:
            # Evict from tail (least recently used)
            lru = self._tail.prev
            if lru is not None and lru != self._head:
                self._remove(lru)
                del self._map[lru.key]

        new_node = Node(key, val, expires_at_timestamp)
        self._map[key] = new_node
        self._add_to_head(new_node)

    def delete(self, key: str) -> None:
        """Remove item from cache."""
        node = self._map.pop(key, None)
        if node is not None:
            self._remove(node)

    def clear(self) -> None:
        """Clear all items."""
        self._map.clear()
        self._head.next = self._tail
        self._tail.prev = self._head

    def __len__(self) -> int:
        return len(self._map)


class LocalUrlCacheAdapter:
    """Adapts LocalLRUCache to the UrlCache async protocol."""

    def __init__(self, capacity: int = 1000) -> None:
        self._lru: LocalLRUCache[CachedUrl] = LocalLRUCache(capacity=capacity)

    async def get(self, code: str) -> CachedUrl | None:
        return self._lru.get(code)

    async def set(
        self,
        code: str,
        destination_url: str,
        expires_at: datetime | None = None,
        ttl_seconds: int | None = None,
    ) -> None:
        eff_ttl: float | None = float(ttl_seconds) if ttl_seconds is not None else None
        if expires_at is not None:
            now_dt = datetime.now(UTC)
            exp_aware = (
                expires_at.astimezone(UTC) if expires_at.tzinfo else expires_at.replace(tzinfo=UTC)
            )
            diff = (exp_aware - now_dt).total_seconds()
            if diff <= 0:
                return  # already expired
            if eff_ttl is None or diff < eff_ttl:
                eff_ttl = diff

        cached = CachedUrl(
            code=code,
            destination_url=destination_url,
            expires_at=expires_at,
            disabled=False,
        )
        self._lru.put(code, cached, ttl_seconds=eff_ttl)

    async def delete(self, code: str) -> None:
        self._lru.delete(code)
