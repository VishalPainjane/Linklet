"""Unit tests for cache model extensions, lifecycle statuses, and tombstones."""

import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from linklet.cache.interface import CacheEntryStatus
from linklet.cache.local_lru import LocalUrlCacheAdapter
from linklet.cache.redis_cache import RedisUrlCache


@pytest.mark.asyncio
async def test_redis_cache_active_url() -> None:
    mock_redis = MagicMock()
    mock_redis.register_script.return_value = AsyncMock()
    cache = RedisUrlCache(mock_redis)

    payload = {
        "code": "test1",
        "destination_url": "https://example.com/dest",
        "expires_at": None,
        "disabled": False,
        "status": "active",
    }
    mock_redis.get = AsyncMock(return_value=json.dumps(payload))

    entry = await cache.get("test1")
    assert entry is not None
    assert entry.code == "test1"
    assert entry.status == CacheEntryStatus.ACTIVE
    assert entry.destination_url == "https://example.com/dest"
    assert entry.is_active is True


@pytest.mark.asyncio
async def test_redis_cache_tombstone_deleted() -> None:
    mock_redis = MagicMock()
    mock_redis.register_script.return_value = AsyncMock()
    cache = RedisUrlCache(mock_redis)

    payload = {
        "code": "del1",
        "destination_url": None,
        "expires_at": None,
        "disabled": True,
        "status": "deleted",
    }
    mock_redis.get = AsyncMock(return_value=json.dumps(payload))

    entry = await cache.get("del1")
    assert entry is not None
    assert entry.status == CacheEntryStatus.DELETED
    assert entry.disabled is True
    assert entry.is_active is False


@pytest.mark.asyncio
async def test_redis_cache_tombstone_not_found() -> None:
    mock_redis = MagicMock()
    mock_redis.register_script.return_value = AsyncMock()
    cache = RedisUrlCache(mock_redis)

    payload = {
        "code": "missing1",
        "destination_url": None,
        "expires_at": None,
        "disabled": False,
        "status": "not_found",
    }
    mock_redis.get = AsyncMock(return_value=json.dumps(payload))

    entry = await cache.get("missing1")
    assert entry is not None
    assert entry.status == CacheEntryStatus.NOT_FOUND
    assert entry.is_active is False


@pytest.mark.asyncio
async def test_redis_cache_legacy_compatibility() -> None:
    mock_redis = MagicMock()
    mock_redis.register_script.return_value = AsyncMock()
    cache = RedisUrlCache(mock_redis)

    # Legacy payload without "status" field
    legacy_payload = {
        "code": "legacy1",
        "destination_url": "https://example.com/legacy",
        "expires_at": None,
        "disabled": False,
    }
    mock_redis.get = AsyncMock(return_value=json.dumps(legacy_payload))

    entry = await cache.get("legacy1")
    assert entry is not None
    assert entry.status == CacheEntryStatus.ACTIVE
    assert entry.is_active is True


@pytest.mark.asyncio
async def test_redis_cache_set_tombstone_writes_correct_payload() -> None:
    mock_redis = MagicMock()
    mock_redis.register_script.return_value = AsyncMock()
    mock_redis.set = AsyncMock()
    cache = RedisUrlCache(mock_redis)

    await cache.set_tombstone("tomb1", CacheEntryStatus.NOT_FOUND, ttl_seconds=60)

    mock_redis.set.assert_called_once()
    key, val = mock_redis.set.call_args[0]
    kwargs = mock_redis.set.call_args[1]

    assert key == "url:tomb1"
    data = json.loads(val)
    assert data["code"] == "tomb1"
    assert data["status"] == "not_found"
    assert kwargs.get("ex") == 60


@pytest.mark.asyncio
async def test_local_lru_tombstones() -> None:
    cache = LocalUrlCacheAdapter(capacity=10)

    # 1. Set tombstone
    await cache.set_tombstone("code404", CacheEntryStatus.NOT_FOUND, ttl_seconds=10)
    cached = await cache.get("code404")
    assert cached is not None
    assert cached.status == CacheEntryStatus.NOT_FOUND
    assert cached.is_active is False

    # 2. Set active replaces tombstone
    await cache.set("code404", "https://example.com/now-exists")
    active = await cache.get("code404")
    assert active is not None
    assert active.status == CacheEntryStatus.ACTIVE
    assert active.destination_url == "https://example.com/now-exists"
    assert active.is_active is True

