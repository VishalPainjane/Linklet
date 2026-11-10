"""Unit tests for the custom O(1) LRU Cache."""

import time

import pytest

from linklet.cache.local_lru import LocalLRUCache


def test_lru_basic_put_and_get() -> None:
    cache: LocalLRUCache[str] = LocalLRUCache(capacity=3)
    cache.put("k1", "v1")
    cache.put("k2", "v2")

    assert cache.get("k1") == "v1"
    assert cache.get("k2") == "v2"
    assert cache.get("missing") is None
    assert len(cache) == 2


def test_lru_eviction_policy() -> None:
    cache: LocalLRUCache[str] = LocalLRUCache(capacity=3)
    cache.put("a", "1")
    cache.put("b", "2")
    cache.put("c", "3")

    # Access 'a' to make it most recently used; order from LRU to MRU: b, c, a
    assert cache.get("a") == "1"

    # Insert 'd'; 'b' should be evicted
    cache.put("d", "4")

    assert cache.get("b") is None  # Evicted!
    assert cache.get("a") == "1"
    assert cache.get("c") == "3"
    assert cache.get("d") == "4"
    assert len(cache) == 3


def test_lru_update_existing_key() -> None:
    cache: LocalLRUCache[str] = LocalLRUCache(capacity=2)
    cache.put("x", "old")
    cache.put("y", "val")
    cache.put("x", "new")

    assert cache.get("x") == "new"
    assert len(cache) == 2

    # Inserting 'z' should evict 'y' because 'x' was just updated
    cache.put("z", "val3")
    assert cache.get("y") is None
    assert cache.get("x") == "new"
    assert cache.get("z") == "val3"


def test_lru_ttl_expiration() -> None:
    cache: LocalLRUCache[str] = LocalLRUCache(capacity=5)
    # Insert with short 0.05s TTL
    cache.put("temp", "val", ttl_seconds=0.05)
    assert cache.get("temp") == "val"

    time.sleep(0.06)
    assert cache.get("temp") is None
    assert len(cache) == 0


def test_lru_delete_and_clear() -> None:
    cache: LocalLRUCache[str] = LocalLRUCache(capacity=5)
    cache.put("a", "1")
    cache.put("b", "2")

    cache.delete("a")
    assert cache.get("a") is None
    assert cache.get("b") == "2"
    assert len(cache) == 1

    cache.clear()
    assert cache.get("b") is None
    assert len(cache) == 0


def test_invalid_capacity() -> None:
    with pytest.raises(ValueError, match="Capacity must be positive"):
        LocalLRUCache(capacity=0)
