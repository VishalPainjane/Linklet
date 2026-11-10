import { HyperdriveAnalyticsRepository } from "@linklet/adapter-postgres-hyperdrive";
import type { ClickEvent } from "@linklet/shared-types";
import { clickEventSchema, validate } from "@linklet/validation";

export interface Env {
  HYPERDRIVE: {
    connectionString: string;
  };
}

export default {
  async queue(batch: MessageBatch<ClickEvent>, env: Env): Promise<void> {
    const analyticsRepo = new HyperdriveAnalyticsRepository(env.HYPERDRIVE.connectionString);

    for (const msg of batch.messages) {
      try {
        const validated = validate(clickEventSchema, msg.body);
        const event: ClickEvent = {
          eventId: validated.eventId,
          type: "url.click",
          code: validated.code,
          occurredAt: validated.occurredAt,
          referrerHost: validated.referrerHost,
          userAgentFamily: validated.userAgentFamily,
          countryCode: validated.countryCode,
        };

        // Idempotent insertion/aggregation in Neon PostgreSQL via Hyperdrive
        await analyticsRepo.processClickEventIdempotently(event);
        msg.ack();
      } catch (err) {
        console.error(JSON.stringify({
          level: "error",
          message: "Failed to process message in worker queue batch",
          error: (err as Error).message,
        }));
        // Retry message up to queue retry limit, then routes to DLQ
        msg.retry();
      }
    }
  },
};

