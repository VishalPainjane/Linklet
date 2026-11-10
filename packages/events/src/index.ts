import { randomUUID } from "node:crypto";
import type { ClickEvent } from "@linklet/shared-types";
import { clickEventSchema, validate } from "@linklet/validation";

export interface ClickEventPublisher {
  publish(event: ClickEvent): Promise<void>;
  close?(): Promise<void>;
}

export interface CreateClickEventParams {
  code: string;
  referrer?: string | null | undefined;
  userAgent?: string | null | undefined;
  countryCode?: string | null | undefined;
  occurredAt?: Date | undefined;
}

/**
 * Extracts coarse metadata from referrer and user-agent according to privacy-conscious engineering rules.
 * Never stores raw IP or entire arbitrary user-agent strings.
 */
export function extractReferrerHost(referrer?: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    return url.hostname.slice(0, 255);
  } catch {
    return null;
  }
}

export function extractUserAgentFamily(ua?: string | null | undefined): string | null {
  if (!ua) return null;
  const lower = ua.toLowerCase();
  if (lower.includes("edg/")) return "Edge";
  if (lower.includes("chrome/") && !lower.includes("edg/")) return "Chrome";
  if (lower.includes("firefox/")) return "Firefox";
  if (lower.includes("safari/") && !lower.includes("chrome/")) return "Safari";
  if (lower.includes("curl/")) return "cURL";
  if (lower.includes("undici")) return "Undici";
  if (lower.includes("python-requests")) return "PythonRequests";
  return "Other";
}

export function createClickEvent(params: CreateClickEventParams): ClickEvent {
  const event = {
    eventId: randomUUID(),
    type: "url.click" as const,
    code: params.code,
    occurredAt: (params.occurredAt ?? new Date()).toISOString(),
    referrerHost: extractReferrerHost(params.referrer),
    userAgentFamily: extractUserAgentFamily(params.userAgent),
    countryCode: params.countryCode ? params.countryCode.slice(0, 2).toUpperCase() : null,
  };

  const validated = validate(clickEventSchema, event);
  return {
    eventId: validated.eventId,
    type: "url.click",
    code: validated.code,
    occurredAt: validated.occurredAt,
    referrerHost: validated.referrerHost,
    userAgentFamily: validated.userAgentFamily,
    countryCode: validated.countryCode,
  };
}

/**
 * In-memory publisher for unit testing and local decoupled operation
 */
export class InMemoryClickEventPublisher implements ClickEventPublisher {
  public readonly publishedEvents: ClickEvent[] = [];

  public async publish(event: ClickEvent): Promise<void> {
    this.publishedEvents.push(event);
  }

  public clear(): void {
    this.publishedEvents.length = 0;
  }
}

/**
 * Null publisher for scenarios where analytics is explicitly disabled or in fail-open mode
 */
export class NullClickEventPublisher implements ClickEventPublisher {
  public async publish(): Promise<void> {
    // no-op
  }
}

