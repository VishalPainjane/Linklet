import amqp from "amqplib";
import type { ClickEvent } from "@linklet/shared-types";
import type { ClickEventPublisher } from "@linklet/events";
import type { AnalyticsRepository } from "@linklet/database";
import { clickEventSchema, validate } from "@linklet/validation";

export interface RabbitMqTopologyConfig {
  url: string;
  exchange?: string;
  queue?: string;
  routingKey?: string;
  prefetch?: number;
}

export class RabbitMqClickEventPublisher implements ClickEventPublisher {
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.ConfirmChannel | null = null;
  private readonly config: Required<RabbitMqTopologyConfig>;
  private isClosing = false;

  constructor(config: RabbitMqTopologyConfig) {
    this.config = {
      url: config.url,
      exchange: config.exchange ?? "analytics.events",
      queue: config.queue ?? "url.clicks.v1",
      routingKey: config.routingKey ?? "url.click",
      prefetch: config.prefetch ?? 50,
    };
  }

  public async connect(): Promise<void> {
    this.connection = await amqp.connect(this.config.url);
    this.channel = await this.connection.createConfirmChannel();

    // Assert durable topic exchange
    await this.channel.assertExchange(this.config.exchange, "topic", {
      durable: true,
    });

    // Assert durable queue
    await this.channel.assertQueue(this.config.queue, {
      durable: true,
    });

    // Bind queue to exchange
    await this.channel.bindQueue(
      this.config.queue,
      this.config.exchange,
      this.config.routingKey,
    );

    this.connection.on("error", (err) => {
      if (!this.isClosing) {
        console.error(JSON.stringify({
          level: "error",
          message: "RabbitMQ publisher connection error",
          error: (err as Error).message,
        }));
      }
    });
  }

  public async publish(event: ClickEvent): Promise<void> {
    if (!this.channel) {
      throw new Error("RabbitMQ publisher is not connected");
    }

    const payload = Buffer.from(JSON.stringify(event));

    return new Promise<void>((resolve, reject) => {
      this.channel!.publish(
        this.config.exchange,
        this.config.routingKey,
        payload,
        {
          persistent: true,
          contentType: "application/json",
          messageId: event.eventId,
          timestamp: Date.now(),
        },
        (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
      );
    });
  }

  public async close(): Promise<void> {
    this.isClosing = true;
    if (this.channel) {
      await this.channel.close();
      this.channel = null;
    }
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
  }
}

export class RabbitMqAnalyticsConsumer {
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private readonly config: Required<RabbitMqTopologyConfig>;
  private readonly analyticsRepo: AnalyticsRepository;
  private isConsuming = false;

  constructor(config: RabbitMqTopologyConfig, analyticsRepo: AnalyticsRepository) {
    this.config = {
      url: config.url,
      exchange: config.exchange ?? "analytics.events",
      queue: config.queue ?? "url.clicks.v1",
      routingKey: config.routingKey ?? "url.click",
      prefetch: config.prefetch ?? 50,
    };
    this.analyticsRepo = analyticsRepo;
  }

  public async start(): Promise<void> {
    this.connection = await amqp.connect(this.config.url);
    this.channel = await this.connection.createChannel();

    await this.channel.assertQueue(this.config.queue, { durable: true });
    await this.channel.prefetch(this.config.prefetch);

    this.isConsuming = true;

    await this.channel.consume(this.config.queue, async (msg) => {
      if (!msg) return;

      try {
        const raw = JSON.parse(msg.content.toString("utf-8"));
        const validated = validate(clickEventSchema, raw);
        const event: ClickEvent = {
          eventId: validated.eventId,
          type: "url.click",
          code: validated.code,
          occurredAt: validated.occurredAt,
          referrerHost: validated.referrerHost,
          userAgentFamily: validated.userAgentFamily,
          countryCode: validated.countryCode,
        };

        // Process idempotently inside DB transaction
        await this.analyticsRepo.processClickEventIdempotently(event);

        // ACK only after commit
        this.channel?.ack(msg);
      } catch (err) {
        console.error(JSON.stringify({
          level: "error",
          message: "Failed to process analytics event message",
          error: (err as Error).message,
        }));

        // In a terminal failure, nack with requeue=false (moves to DLQ if configured)
        this.channel?.nack(msg, false, false);
      }
    });
  }

  public get consuming(): boolean {
    return this.isConsuming;
  }

  public async stop(): Promise<void> {
    this.isConsuming = false;
    if (this.channel) {
      await this.channel.close();
      this.channel = null;
    }
    if (this.connection) {
      await this.connection.close();
      this.connection = null;
    }
  }
}

