import { z } from "zod";
import { ValidationError } from "@linklet/shared-types";

export const MAX_URL_LENGTH = 4096;
export const MIN_ALIAS_LENGTH = 3;
export const MAX_ALIAS_LENGTH = 32;

export const RESERVED_WORDS = new Set([
  "api",
  "health",
  "ready",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  "static",
  "public",
  "admin",
  "metrics",
  "dashboard",
  "login",
  "signup",
  "auth",
  "logout",
  "docs",
]);

/**
 * Validates a destination URL according to strict system engineering rules:
 * - Scheme MUST be http: or https:
 * - Hostname cannot be empty
 * - No embedded credentials (username/password)
 * - Maximum 4096 characters
 */
export const destinationUrlSchema = z
  .string()
  .min(1, "URL is required")
  .max(MAX_URL_LENGTH, `URL cannot exceed ${MAX_URL_LENGTH} characters`)
  .refine(
    (val) => {
      try {
        const parsed = new URL(val);
        // Only http and https
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return false;
        }
        // Hostname must exist and not be empty
        if (!parsed.hostname || parsed.hostname.trim() === "") {
          return false;
        }
        // Reject embedded credentials for security
        if (parsed.username !== "" || parsed.password !== "") {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    },
    {
      message: "Destination URL must be a valid http or https URL without embedded credentials",
    },
  );

/**
 * Custom alias validation:
 * - 3 to 32 characters
 * - Only A-Z, a-z, 0-9, _, -
 * - Cannot be a reserved system route
 */
export const customAliasSchema = z
  .string()
  .min(MIN_ALIAS_LENGTH, `Custom alias must be at least ${MIN_ALIAS_LENGTH} characters`)
  .max(MAX_ALIAS_LENGTH, `Custom alias cannot exceed ${MAX_ALIAS_LENGTH} characters`)
  .regex(/^[A-Za-z0-9_-]+$/, "Custom alias can only contain alphanumeric characters, underscores, and hyphens")
  .refine((val) => !RESERVED_WORDS.has(val.toLowerCase()), {
    message: "Custom alias conflicts with a reserved system route",
  });

export const codeParamSchema = z
  .string()
  .min(1, "Code is required")
  .max(MAX_ALIAS_LENGTH, `Code cannot exceed ${MAX_ALIAS_LENGTH} characters`)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid code format");

export const createUrlRequestSchema = z
  .object({
    url: destinationUrlSchema,
    customAlias: customAliasSchema.optional(),
    expiresAt: z
      .union([z.string().datetime(), z.null(), z.undefined()])
      .transform((val) => (val ? new Date(val) : null))
      .refine((val) => val === null || val.getTime() > Date.now(), {
        message: "Expiration timestamp must be in the future",
      })
      .optional()
      .default(null),
  })
  .strict();

export const clickEventSchema = z
  .object({
    eventId: z.string().uuid("eventId must be a valid UUID v4"),
    type: z.literal("url.click"),
    code: z.string().min(1).max(MAX_ALIAS_LENGTH),
    occurredAt: z.string().datetime(),
    referrerHost: z.string().max(255).nullable().default(null),
    userAgentFamily: z.string().max(100).nullable().default(null),
    countryCode: z.string().length(2).nullable().default(null),
  })
  .strict();

export const idempotencyKeyHeaderSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\x21-\x7E]+$/, "Idempotency key must be ASCII printable without spaces")
  .optional();

/**
 * Helper to validate data using a Zod schema and throw typed ValidationError
 */
export function validate<TOut, TDef extends z.ZodTypeDef = z.ZodTypeDef, TIn = any>(
  schema: z.ZodType<TOut, TDef, TIn>,
  data: unknown,
): TOut {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new ValidationError("Input validation failed", issues);
  }
  return result.data;
}

