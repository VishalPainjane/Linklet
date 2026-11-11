"""Standalone background daemon for RabbitMQ click analytics aggregation."""

import asyncio
import logging
import signal
import sys
import time
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from linklet.config import settings
from linklet.messaging.rabbitmq import RabbitMQTopology
from linklet.workers.click_consumer import ClickConsumer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("click_consumer_daemon")


async def main() -> None:
    logger.info("Initializing Linklet Click Consumer Daemon...")
    engine = create_async_engine(
        settings.database_url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout,
        pool_recycle=settings.db_pool_recycle,
        echo=False,
    )
    session_factory = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    topology = RabbitMQTopology(
        amqp_url=settings.amqp_url,
    )
    await topology.connect()

    consumer = ClickConsumer(
        topology=topology,
        session_factory=session_factory,
    )
    await consumer.start()
    logger.info("ClickConsumer registered and processing messages from queue: %s", settings.amqp_queue)

    stop_event = asyncio.Event()

    def handle_signal(*_: object) -> None:
        logger.info("Shutdown signal received.")
        stop_event.set()

    if sys.platform != "win32":
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, handle_signal)

    last_count = 0
    last_time = time.time()

    try:
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=5.0)
            except TimeoutError:
                now = time.time()
                dt = now - last_time
                processed = consumer._processed_count
                duplicates = consumer._duplicate_count
                rate = (processed - last_count) / dt if dt > 0 else 0.0
                last_count = processed
                last_time = now
                logger.info(
                    "ClickConsumer Progress: %d processed (+%d dupes) | Current Rate: %.1f msg/s",
                    processed,
                    duplicates,
                    rate,
                )
    except (asyncio.CancelledError, KeyboardInterrupt):
        pass
    finally:
        logger.info("Stopping ClickConsumer...")
        await consumer.stop()
        await topology.close()
        await engine.dispose()
        logger.info("ClickConsumer daemon cleanly terminated.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
