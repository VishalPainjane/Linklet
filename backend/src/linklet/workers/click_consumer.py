"""RabbitMQ click analytics consumer with manual acknowledgements and idempotent aggregation."""

import json
import logging
from datetime import UTC, datetime
from uuid import UUID

from aio_pika.abc import AbstractIncomingMessage
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from linklet.messaging.rabbitmq import RabbitMQTopology

logger = logging.getLogger(__name__)

IDEMPOTENT_CLICK_SQL = text("""
WITH newly_processed AS (
    INSERT INTO processed_events (event_id, processed_at)
    VALUES (:event_id, :processed_at)
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id
)
INSERT INTO url_stats (code, click_count, last_clicked_at, updated_at)
SELECT :code, 1, :occurred_at, :processed_at
FROM newly_processed
ON CONFLICT (code) DO UPDATE
SET click_count = url_stats.click_count + 1,
    last_clicked_at = CASE 
        WHEN url_stats.last_clicked_at IS NULL THEN EXCLUDED.last_clicked_at
        WHEN EXCLUDED.last_clicked_at > url_stats.last_clicked_at THEN EXCLUDED.last_clicked_at
        ELSE url_stats.last_clicked_at
    END,
    updated_at = EXCLUDED.updated_at
RETURNING code;
""")


class ClickConsumer:
    """Consumes click events from RabbitMQ and updates PostgreSQL counters idempotently."""

    def __init__(
        self,
        topology: RabbitMQTopology,
        session_factory: async_sessionmaker[AsyncSession],
    ) -> None:
        self.topology = topology
        self.session_factory = session_factory
        self._consumer_tag: str | None = None
        self._running = False
        self._processed_count = 0
        self._duplicate_count = 0

    async def start(self) -> None:
        """Start listening to the queue."""
        if not self.topology.queue:
            raise RuntimeError("RabbitMQ queue not declared.")

        self._running = True
        self._consumer_tag = await self.topology.queue.consume(self._handle_message)
        logger.info("Click consumer registered on queue %s", self.topology.queue.name)

    async def _handle_message(self, message: AbstractIncomingMessage) -> None:
        """Process incoming click event with manual ACK upon successful DB commit."""
        async with message.process(requeue=True, reject_on_redelivered=True):
            try:
                body = json.loads(message.body.decode("utf-8"))
                event_id = UUID(body["event_id"])
                code = body["code"]
                occurred_at = datetime.fromisoformat(body["occurred_at"])
                now = datetime.now(UTC)

                async with self.session_factory() as session:
                    async with session.begin():
                        result = await session.execute(
                            IDEMPOTENT_CLICK_SQL,
                            {
                                "event_id": event_id,
                                "processed_at": now,
                                "code": code,
                                "occurred_at": occurred_at,
                            },
                        )
                        row = result.fetchone()

                    # aio-pika message.process context manager calls ack() upon normal block exit
                    if row is not None:
                        self._processed_count += 1
                    else:
                        self._duplicate_count += 1
                        logger.debug(
                            "Duplicate click event %s for code %s safely skipped.",
                            event_id,
                            code,
                        )

            except Exception as exc:
                logger.error("Error processing message %s: %s", message.message_id, exc)
                raise  # Re-raise so message.process triggers nack/requeue or DLQ

    async def stop(self) -> None:
        """Cancel consumer subscription."""
        if self._consumer_tag and self.topology.queue:
            try:
                await self.topology.queue.cancel(self._consumer_tag)
            except Exception as exc:
                logger.warning("Error cancelling consumer tag: %s", exc)
        self._running = False
        logger.info(
            "Click consumer stopped. Processed: %d, Duplicates: %d",
            self._processed_count,
            self._duplicate_count,
        )
