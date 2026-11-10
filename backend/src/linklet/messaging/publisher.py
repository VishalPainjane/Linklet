"""Click event publisher with bounded in-memory buffer and publisher confirms."""

import asyncio
import json
import logging
from typing import Protocol

import aio_pika

from linklet.config import settings
from linklet.messaging.events import ClickEventMessage
from linklet.messaging.rabbitmq import RabbitMQTopology

logger = logging.getLogger(__name__)


class EventPublisher(Protocol):
    """Protocol for dispatching click analytics events."""

    def enqueue_click(self, event: ClickEventMessage) -> bool:
        """Enqueue click event non-blockingly."""
        ...

    async def publish_direct(self, event: ClickEventMessage) -> None:
        """Publish event directly to message broker."""
        ...


class BoundedAsyncClickPublisher(EventPublisher):
    """Production AMQP click event publisher with a bounded in-memory buffer (Mode A)."""

    def __init__(
        self,
        topology: RabbitMQTopology,
        buffer_size: int = 10000,
    ) -> None:
        self.topology = topology
        self.buffer: asyncio.Queue[ClickEventMessage] = asyncio.Queue(maxsize=buffer_size)
        self._worker_task: asyncio.Task[None] | None = None
        self._dropped_count = 0
        self._published_count = 0
        self._stopping = False

    def start(self) -> None:
        """Start the background drain worker."""
        if self._worker_task is None or self._worker_task.done():
            self._stopping = False
            self._worker_task = asyncio.create_task(
                self._drain_loop(), name="click-publisher-drain"
            )
            logger.info("Click publisher background drain worker started.")

    def enqueue_click(self, event: ClickEventMessage) -> bool:
        """Non-blocking enqueue for critical path redirects."""
        try:
            self.buffer.put_nowait(event)
            return True
        except asyncio.QueueFull:
            self._dropped_count += 1
            if self._dropped_count % 100 == 1:
                logger.warning(
                    "Click event buffer full (%d items); dropped event for %s (total dropped: %d)",
                    self.buffer.maxsize,
                    event.code,
                    self._dropped_count,
                )
            return False

    async def publish_direct(self, event: ClickEventMessage) -> None:
        """Publish event with publisher confirm to RabbitMQ exchange."""
        if not self.topology.exchange or not self.topology.channel:
            raise RuntimeError("RabbitMQ topology not initialized.")

        body = json.dumps(event.to_dict()).encode("utf-8")
        message = aio_pika.Message(
            body=body,
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            content_type="application/json",
            message_id=str(event.event_id),
            timestamp=event.occurred_at,
        )

        await self.topology.exchange.publish(
            message,
            routing_key=settings.amqp_routing_key,
            timeout=5.0,
        )
        self._published_count += 1

    async def _drain_loop(self) -> None:
        """Drains events from memory buffer to RabbitMQ."""
        while not self._stopping or not self.buffer.empty():
            try:
                try:
                    event = await asyncio.wait_for(self.buffer.get(), timeout=1.0)
                except TimeoutError:
                    continue

                try:
                    if self.topology.exchange:
                        await self.publish_direct(event)
                except Exception as exc:
                    logger.error("Failed to publish click event %s: %s", event.event_id, exc)
                finally:
                    self.buffer.task_done()
            except asyncio.CancelledError:
                break
            except Exception as loop_exc:
                logger.error("Unexpected error in click publisher loop: %s", loop_exc)

    async def stop(self) -> None:
        """Signal stop and drain remaining messages."""
        self._stopping = True
        if self._worker_task and not self._worker_task.done():
            try:
                await asyncio.wait_for(self._worker_task, timeout=5.0)
            except (TimeoutError, asyncio.CancelledError):
                self._worker_task.cancel()
        logger.info(
            "Click publisher stopped. Total published: %d, dropped: %d",
            self._published_count,
            self._dropped_count,
        )


class MockEventPublisher(EventPublisher):
    """In-memory event publisher for unit and integration testing without RabbitMQ."""

    def __init__(self) -> None:
        self.published_events: list[ClickEventMessage] = []

    def enqueue_click(self, event: ClickEventMessage) -> bool:
        self.published_events.append(event)
        return True

    async def publish_direct(self, event: ClickEventMessage) -> None:
        self.published_events.append(event)
