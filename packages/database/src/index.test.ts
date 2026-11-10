import { describe, it, expect } from "vitest";
import { InMemoryDatabase } from "./index.js";
import type { ClickEvent } from "@linklet/shared-types";

describe("InMemoryDatabase", () => {
  it("enforces unique code constraint and returns null on conflict", async () => {
    const db = new InMemoryDatabase();
    const row1 = await db.insert({
      code: "code1",
      destinationUrl: "https://example.com/1",
      ownerId: null,
      isCustom: false,
      expiresAt: null,
    });
    expect(row1).not.toBeNull();
    expect(row1?.code).toBe("code1");

    // Second insert with same code fails
    const row2 = await db.insert({
      code: "code1",
      destinationUrl: "https://example.com/2",
      ownerId: null,
      isCustom: true,
      expiresAt: null,
    });
    expect(row2).toBeNull();
  });

  it("handles idempotency key insert and lookup", async () => {
    const db = new InMemoryDatabase();
    const inserted = await db.insertKey({
      principalKey: "user:1",
      idempotencyKey: "req-abc-123",
      requestHash: "hash-001",
      expiresAt: new Date(Date.now() + 86400000),
    });
    expect(inserted).toBe(true);

    const duplicateInsert = await db.insertKey({
      principalKey: "user:1",
      idempotencyKey: "req-abc-123",
      requestHash: "hash-002",
      expiresAt: new Date(Date.now() + 86400000),
    });
    expect(duplicateInsert).toBe(false);

    await db.updateResponse("user:1", "req-abc-123", 201, { code: "abc" });
    const record = await db.getKey("user:1", "req-abc-123");
    expect(record?.responseStatus).toBe(201);
    expect(record?.responseBody).toEqual({ code: "abc" });
  });

  it("processes click events idempotently without double-counting clicks", async () => {
    const db = new InMemoryDatabase();
    const event: ClickEvent = {
      eventId: "e0000000-0000-0000-0000-000000000001",
      type: "url.click",
      code: "testcode",
      occurredAt: new Date().toISOString(),
      referrerHost: null,
      userAgentFamily: null,
      countryCode: null,
    };

    const firstTime = await db.processClickEventIdempotently(event);
    expect(firstTime).toBe(true);

    const stats1 = await db.getStats("testcode");
    expect(stats1?.clickCount).toBe(1);

    // Redelivery of the exact same event
    const secondTime = await db.processClickEventIdempotently(event);
    expect(secondTime).toBe(false);

    const stats2 = await db.getStats("testcode");
    expect(stats2?.clickCount).toBe(1); // not incremented
  });
});

