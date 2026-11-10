import dotenv from "dotenv";
import { createPgPool, PostgresAnalyticsRepository } from "@linklet/adapter-postgres-node";
import { RabbitMqAnalyticsConsumer } from "@linklet/adapter-rabbitmq";
import { InMemoryDatabase } from "@linklet/database";
import type { AnalyticsRepository } from "@linklet/database";

dotenv.config();

async function startConsumerDaemon() {
  const dbUrl = process.env["DATABASE_URL"];
  const rabbitmqUrl = process.env["RABBITMQ_URL"] ?? "amqp://guest:guest@localhost:5672";
  const queue = process.env["RABBITMQ_QUEUE"] ?? "url.clicks.v1";
  const exchange = process.env["RABBITMQ_EXCHANGE"] ?? "analytics.events";
  const routingKey = process.env["RABBITMQ_ROUTING_KEY"] ?? "url.click";
  const prefetch = Number(process.env["RABBITMQ_PREFETCH"] ?? 50);

  console.log(`[consumer] Starting Linklet Analytics Worker Daemon...`);
  console.log(`[consumer] Topology: queue=${queue}, exchange=${exchange}, routingKey=${routingKey}, prefetch=${prefetch}`);

  let analyticsRepo: AnalyticsRepository;
  let pgPool: ReturnType<typeof createPgPool> | null = null;

  if (dbUrl) {
    try {
      console.log(`[consumer] Connecting to PostgreSQL pool...`);
      pgPool = createPgPool({
        connectionString: dbUrl,
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
        statement_timeout: 5000,
      });
      analyticsRepo = new PostgresAnalyticsRepository(pgPool);
      console.log(`[consumer] PostgreSQL pool initialized.`);
    } catch (err) {
      console.warn(`[consumer] PostgreSQL connection failed: ${(err as Error).message}. Falling back to In-Memory DB.`);
      analyticsRepo = new InMemoryDatabase();
    }
  } else {
    console.log(`[consumer] DATABASE_URL not set. Using In-Memory Database.`);
    analyticsRepo = new InMemoryDatabase();
  }

  const consumer = new RabbitMqAnalyticsConsumer(
    {
      url: rabbitmqUrl,
      queue,
      exchange,
      routingKey,
      prefetch,
    },
    analyticsRepo,
  );

  try {
    await consumer.start();
    console.log(`[consumer] RabbitMQ consumer actively listening on queue "${queue}".`);
  } catch (err) {
    console.error(`[consumer] Failed to start RabbitMQ consumer: ${(err as Error).message}`);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    console.log(`\n[consumer] Received ${signal}. Draining messages and shutting down...`);
    try {
      await consumer.stop();
      if (pgPool) {
        await pgPool.end();
      }
      console.log(`[consumer] Worker cleanly terminated.`);
      process.exit(0);
    } catch (err) {
      console.error(`[consumer] Error during shutdown:`, err);
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

startConsumerDaemon().catch((err) => {
  console.error(`[consumer] Fatal daemon error:`, err);
  process.exit(1);
});

