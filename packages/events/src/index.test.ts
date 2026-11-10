import { describe, it, expect } from "vitest";
import {
  createClickEvent,
  extractReferrerHost,
  extractUserAgentFamily,
  InMemoryClickEventPublisher,
} from "./index.js";

describe("ClickEvent", () => {
  it("extracts hostname from valid referrer", () => {
    expect(extractReferrerHost("https://news.ycombinator.com/item?id=123")).toBe(
      "news.ycombinator.com",
    );
    expect(extractReferrerHost("not-a-url")).toBeNull();
    expect(extractReferrerHost(null)).toBeNull();
  });

  it("extracts coarse user agent families", () => {
    expect(extractUserAgentFamily("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")).toBe("Chrome");
    expect(extractUserAgentFamily("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0")).toBe("Firefox");
    expect(extractUserAgentFamily("curl/7.68.0")).toBe("cURL");
    expect(extractUserAgentFamily("")).toBeNull();
  });

  it("creates and validates ClickEvent with UUID", () => {
    const event = createClickEvent({
      code: "aB3dE9kP",
      referrer: "https://google.com/search",
      userAgent: "curl/7.88.1",
      countryCode: "in",
    });

    expect(event.type).toBe("url.click");
    expect(event.code).toBe("aB3dE9kP");
    expect(event.countryCode).toBe("IN");
    expect(event.referrerHost).toBe("google.com");
    expect(event.userAgentFamily).toBe("cURL");
    expect(typeof event.eventId).toBe("string");
    expect(event.eventId).toHaveLength(36);
  });

  it("in-memory publisher records published events", async () => {
    const publisher = new InMemoryClickEventPublisher();
    const event = createClickEvent({ code: "test1234" });
    await publisher.publish(event);

    expect(publisher.publishedEvents).toHaveLength(1);
    expect(publisher.publishedEvents[0]?.code).toBe("test1234");
  });
});

