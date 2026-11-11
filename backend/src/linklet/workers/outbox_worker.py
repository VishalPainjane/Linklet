"""Transactional Outbox background relay worker for resilient cache synchronization."""

import asyncio
import logging
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from linklet.cache.interface import CacheEntryStatus, UrlCache
from linklet.repositories.outbox_repository import OutboxRepository

logger = logging.getLogger(__name__)


class OutboxWorker:
    """Asynchronous background worker draining and dispatching pending outbox events."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        cache: UrlCache,
        poll_interval_seconds: float = 0.5,
        batch_size: int = 50,
    ) -> None:
        self.session_factory = session_factory
        self.cache = cache
        self.poll_interval_seconds = poll_interval_seconds
        self.batch_size = batch_size
        self._running = False
        self._task: asyncio.Task[None] | None = None
        self._processed_count = 0

    async def process_batch(self) -> int:
        """Process a single batch of pending outbox events. Returns count of processed events."""
        async with self.session_factory() as session:
            repo = OutboxRepository(session=session)
            events = await repo.fetch_pending_events(limit=self.batch_size)
            if not events:
                return 0

            processed_ids: list[UUID] = []

            for event in events:
                try:
                    payload: dict[str, Any] = event.payload or {}
                    if event.event_type == "URL_DELETED":
                        code = payload.get("code") or event.aggregate_id
                        ttl = payload.get("ttl_seconds")
                        await self.cache.set_tombstone(
                            code=code,
                            status=CacheEntryStatus.DELETED,
                            ttl_seconds=ttl,
                        )
                    elif event.event_type == "URL_ENABLED":
                        code = payload.get("code") or event.aggregate_id
                        await self.cache.delete(code)

                    processed_ids.append(event.id)
                except Exception as exc:
                    logger.error("Failed to process outbox event %s: %s", event.id, exc)
                    await repo.mark_failed(event.id, str(exc))

            if processed_ids:
                await repo.mark_processed(processed_ids)
                await session.commit()
                self._processed_count += len(processed_ids)
                logger.debug("Outbox worker processed %d events.", len(processed_ids))

            return len(processed_ids)

    async def run_forever(self) -> None:
        """Continuous polling loop."""
        self._running = True
        logger.info("OutboxWorker started with poll interval %.2fs.", self.poll_interval_seconds)
        while self._running:
            try:
                processed = await self.process_batch()
                if processed == 0:
                    await asyncio.sleep(self.poll_interval_seconds)
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Error in outbox processing loop: %s", exc)
                await asyncio.sleep(self.poll_interval_seconds)

    def start(self) -> None:
        """Start outbox processing as a background task."""
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self.run_forever(), name="outbox-worker")

    async def stop(self) -> None:
        """Gracefully stop the background worker."""
        self._running = False
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("OutboxWorker stopped. Total processed: %d", self._processed_count)

