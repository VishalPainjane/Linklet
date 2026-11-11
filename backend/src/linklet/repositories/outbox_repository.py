"""Repository for transactional outbox persistence and retrieval."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from linklet.models.outbox import OutboxEvent


class OutboxRepository:
    """Data access layer for OutboxEvent records."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def create_event(
        self,
        event_type: str,
        aggregate_id: str,
        payload: dict[str, Any],
        aggregate_type: str = "URL",
    ) -> OutboxEvent:
        """Add an outbox event to the current transaction."""
        event = OutboxEvent(
            event_type=event_type,
            aggregate_type=aggregate_type,
            aggregate_id=aggregate_id,
            payload=payload,
        )
        self.session.add(event)
        return event

    async def fetch_pending_events(self, limit: int = 50) -> list[OutboxEvent]:
        """Fetch uncommitted or unprocessed outbox events."""
        stmt = (
            select(OutboxEvent)
            .where(OutboxEvent.processed_at.is_(None))
            .order_by(OutboxEvent.created_at.asc())
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def mark_processed(self, event_ids: list[UUID]) -> None:
        """Mark events as processed with current timestamp."""
        if not event_ids:
            return
        now = datetime.now(UTC)
        stmt = (
            update(OutboxEvent)
            .where(OutboxEvent.id.in_(event_ids))
            .values(processed_at=now)
        )
        await self.session.execute(stmt)

    async def mark_failed(self, event_id: UUID, error: str) -> None:
        """Record retry attempt and failure message."""
        stmt = (
            update(OutboxEvent)
            .where(OutboxEvent.id == event_id)
            .values(
                retry_count=OutboxEvent.retry_count + 1,
                last_error=error[:512],
            )
        )
        await self.session.execute(stmt)

