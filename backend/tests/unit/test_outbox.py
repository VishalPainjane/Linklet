"""Unit tests for Transactional Outbox pattern, repository, and relay worker."""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from linklet.cache.interface import CacheEntryStatus
from linklet.models.outbox import OutboxEvent
from linklet.workers.outbox_worker import OutboxWorker


@pytest.mark.asyncio
async def test_outbox_worker_processes_deleted_event() -> None:
    mock_session = AsyncMock()
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__.return_value = mock_session

    mock_cache = AsyncMock()

    event = OutboxEvent(
        id=uuid4(),
        event_type="URL_DELETED",
        aggregate_type="URL",
        aggregate_id="outboxCode1",
        payload={"code": "outboxCode1", "ttl_seconds": 3600},
    )

    # Mock fetching pending events
    mock_scalars = MagicMock()
    mock_scalars.all.return_value = [event]
    mock_result = MagicMock()
    mock_result.scalars.return_value = mock_scalars
    mock_session.execute = AsyncMock(return_value=mock_result)

    worker = OutboxWorker(
        session_factory=mock_session_factory,
        cache=mock_cache,
    )

    processed_count = await worker.process_batch()
    assert processed_count == 1

    # Verify cache tombstone was set by the outbox worker
    mock_cache.set_tombstone.assert_called_once_with(
        code="outboxCode1",
        status=CacheEntryStatus.DELETED,
        ttl_seconds=3600,
    )


@pytest.mark.asyncio
async def test_outbox_worker_empty_batch_returns_zero() -> None:
    mock_session = AsyncMock()
    mock_session_factory = MagicMock()
    mock_session_factory.return_value.__aenter__.return_value = mock_session

    mock_cache = AsyncMock()

    # Empty pending events
    mock_scalars = MagicMock()
    mock_scalars.all.return_value = []
    mock_result = MagicMock()
    mock_result.scalars.return_value = mock_scalars
    mock_session.execute = AsyncMock(return_value=mock_result)

    worker = OutboxWorker(
        session_factory=mock_session_factory,
        cache=mock_cache,
    )

    processed_count = await worker.process_batch()
    assert processed_count == 0
    mock_cache.set_tombstone.assert_not_called()

