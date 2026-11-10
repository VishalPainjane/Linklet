import type { ClickEvent } from "@linklet/shared-types";
import type { ClickEventPublisher } from "@linklet/events";

export interface QueueBinding {
  send(message: unknown): Promise<void>;
}

export class CloudflareQueueClickEventPublisher implements ClickEventPublisher {
  private readonly queue: QueueBinding;

  constructor(queue: QueueBinding) {
    this.queue = queue;
  }

  public async publish(event: ClickEvent): Promise<void> {
    await this.queue.send(event);
  }
}

