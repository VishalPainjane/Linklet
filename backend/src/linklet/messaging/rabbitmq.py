"""RabbitMQ robust connection and topology declaration."""

import logging
from typing import Any

import aio_pika
from aio_pika.abc import (
    AbstractChannel,
    AbstractExchange,
    AbstractQueue,
    AbstractRobustConnection,
)

from linklet.config import settings

logger = logging.getLogger(__name__)


class RabbitMQTopology:
    """Manages AMQP robust connection, exchange, and queue topology."""

    def __init__(self, amqp_url: str = settings.amqp_url) -> None:
        self.amqp_url = amqp_url
        self.connection: AbstractRobustConnection | None = None
        self.channel: AbstractChannel | None = None
        self.exchange: AbstractExchange | None = None
        self.queue: AbstractQueue | None = None

    async def connect(self) -> None:
        """Establish robust connection and declare exchange/queue."""
        logger.info("Connecting to RabbitMQ at %s", self.amqp_url.split("@")[-1])
        self.connection = await aio_pika.connect_robust(
            self.amqp_url,
            timeout=5.0,
        )
        # Open channel with publisher confirms enabled
        self.channel = await self.connection.channel(publisher_confirms=True)
        await self.channel.set_qos(prefetch_count=settings.amqp_prefetch)

        # Declare durable topic exchange
        self.exchange = await self.channel.declare_exchange(
            name=settings.amqp_exchange,
            type=aio_pika.ExchangeType.TOPIC,
            durable=True,
        )

        # Declare durable queue with DLX (Dead Letter Exchange) configuration
        # For dead-letter topology: analytics.dlx -> url.clicks.dlq
        dlx = await self.channel.declare_exchange(
            name="analytics.dlx",
            type=aio_pika.ExchangeType.FANOUT,
            durable=True,
        )
        dlq = await self.channel.declare_queue(
            name="url.clicks.dlq",
            durable=True,
        )
        await dlq.bind(dlx)

        queue_args: dict[str, Any] = {
            "x-dead-letter-exchange": "analytics.dlx",
        }

        self.queue = await self.channel.declare_queue(
            name=settings.amqp_queue,
            durable=True,
            arguments=queue_args,
        )

        await self.queue.bind(self.exchange, routing_key=settings.amqp_routing_key)
        logger.info("RabbitMQ topology declared successfully.")

    async def close(self) -> None:
        """Close AMQP channel and connection cleanly."""
        if self.channel and not self.channel.is_closed:
            await self.channel.close()
        if self.connection and not self.connection.is_closed:
            await self.connection.close()
        logger.info("RabbitMQ connection closed.")
