import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  destinationUrlSchema,
  customAliasSchema,
  createUrlRequestSchema,
  clickEventSchema,
  validate,
  RESERVED_WORDS,
} from "./index.js";
import { ValidationError } from "@linklet/shared-types";

describe("destinationUrlSchema", () => {
  it("accepts valid http and https URLs", () => {
    const valid = [
      "http://example.com",
      "https://example.com/path",
      "https://sub.domain.co.uk:8080/nested/path?key=val&x=1#section",
      "https://example.org/search?q=typescript+systems+engineering",
    ];
    for (const url of valid) {
      expect(destinationUrlSchema.safeParse(url).success).toBe(true);
    }
  });

  it("rejects non-http/https protocols", () => {
    const invalid = [
      "ftp://example.com/file.txt",
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "file:///etc/passwd",
      "ws://example.com",
      "ssh://git@github.com",
    ];
    for (const url of invalid) {
      expect(destinationUrlSchema.safeParse(url).success).toBe(false);
    }
  });

  it("rejects embedded credentials in URL", () => {
    const credentials = [
      "https://user:pass@example.com",
      "http://admin@example.org/secret",
    ];
    for (const url of credentials) {
      expect(destinationUrlSchema.safeParse(url).success).toBe(false);
    }
  });

  it("rejects malformed or empty URLs", () => {
    const malformed = ["", "   ", "not-a-url", "https://", "http:// "];
    for (const url of malformed) {
      expect(destinationUrlSchema.safeParse(url).success).toBe(false);
    }
  });

  it("rejects URLs exceeding 4096 characters", () => {
    const longUrl = "https://example.com/" + "a".repeat(4090);
    expect(longUrl.length).toBeGreaterThan(4096);
    expect(destinationUrlSchema.safeParse(longUrl).success).toBe(false);
  });

  it("property test: non-http protocols are never parsed as valid", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("ftp", "gopher", "file", "data", "blob", "javascript"),
        fc.webPath(),
        (scheme, path) => {
          const fakeUrl = `${scheme}://example.com${path}`;
          return destinationUrlSchema.safeParse(fakeUrl).success === false;
        },
      ),
    );
  });
});

describe("customAliasSchema", () => {
  it("accepts valid aliases (3-32 chars alphanumeric, dash, underscore)", () => {
    const valid = ["abc", "my-link", "project_2026", "Link1234-567_abc"];
    for (const alias of valid) {
      expect(customAliasSchema.safeParse(alias).success).toBe(true);
    }
  });

  it("rejects aliases that are too short or too long", () => {
    expect(customAliasSchema.safeParse("ab").success).toBe(false);
    expect(customAliasSchema.safeParse("a".repeat(33)).success).toBe(false);
  });

  it("rejects reserved system route words", () => {
    for (const reserved of RESERVED_WORDS) {
      expect(customAliasSchema.safeParse(reserved).success).toBe(false);
      expect(customAliasSchema.safeParse(reserved.toUpperCase()).success).toBe(false);
    }
  });

  it("rejects invalid characters (spaces, special chars, slashes)", () => {
    const invalid = ["my alias", "link/slash", "test?query", "hello@world", "code#1"];
    for (const alias of invalid) {
      expect(customAliasSchema.safeParse(alias).success).toBe(false);
    }
  });
});

describe("createUrlRequestSchema", () => {
  it("validates request payload and transforms valid ISO future date", () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const result = validate(createUrlRequestSchema, {
      url: "https://example.com/test",
      customAlias: "my-alias",
      expiresAt: futureDate,
    });
    expect(result.url).toBe("https://example.com/test");
    expect(result.customAlias).toBe("my-alias");
    expect(result.expiresAt).toBeInstanceOf(Date);
  });

  it("throws ValidationError when past expiration date is supplied", () => {
    const pastDate = new Date(Date.now() - 100000).toISOString();
    expect(() =>
      validate(createUrlRequestSchema, {
        url: "https://example.com/test",
        expiresAt: pastDate,
      }),
    ).toThrow(ValidationError);
  });
});

describe("clickEventSchema", () => {
  it("validates valid click event payload", () => {
    const payload = {
      eventId: "a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d",
      type: "url.click",
      code: "aB3dE9kP",
      occurredAt: new Date().toISOString(),
      referrerHost: "github.com",
      userAgentFamily: "Firefox",
      countryCode: "US",
    };
    expect(clickEventSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects non-uuid eventId", () => {
    const payload = {
      eventId: "not-a-uuid",
      type: "url.click",
      code: "aB3dE9kP",
      occurredAt: new Date().toISOString(),
    };
    expect(clickEventSchema.safeParse(payload).success).toBe(false);
  });
});

