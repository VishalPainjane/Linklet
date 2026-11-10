/**
 * Core domain types and system interfaces for Linklet
 */

// --- Domain Models ---

export interface UrlRecord {
  code: string;
  destinationUrl: string;
  ownerId: string | null;
  isCustom: boolean;
  createdAt: Date;
  expiresAt: Date | null;
  disabledAt: Date | null;
}

export type UrlState = "active" | "expired" | "disabled" | "not_found";

export interface UrlResolution {
  state: UrlState;
  url?: string;
  code: string;
}

export interface CreateUrlInput {
  destinationUrl: string;
  customAlias?: string | undefined;
  ownerId?: string | null | undefined;
  expiresAt?: Date | null | undefined;
  idempotencyKey?: string | undefined;
  principalKey?: string | undefined;
}

export interface CreateUrlResult {
  code: string;
  shortUrl: string;
  destinationUrl: string;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface UrlStats {
  code: string;
  clickCount: number;
  lastClickedAt: Date | null;
  updatedAt: Date;
}

export interface ClickEvent {
  eventId: string;
  type: "url.click";
  code: string;
  occurredAt: string; // ISO 8601
  referrerHost: string | null;
  userAgentFamily: string | null;
  countryCode: string | null;
}

export interface IdempotencyRecord {
  principalKey: string;
  idempotencyKey: string;
  requestHash: string;
  responseStatus: number | null;
  responseBody: unknown | null;
  createdAt: Date;
  expiresAt: Date;
}

export type AbuseReason = "phishing" | "malware" | "spam" | "illegal" | "other";

export interface AbuseReport {
  id: string;
  code: string;
  reason: AbuseReason;
  comment?: string | null | undefined;
  reporterIp?: string | null | undefined;
  reportedAt: Date;
}

// --- System Errors ---

export class DomainError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends DomainError {
  constructor(message = "Resource not found") {
    super(message, "not_found", 404);
  }
}

export class ConflictError extends DomainError {
  constructor(message = "Resource conflict") {
    super(message, "conflict", 409);
  }
}

export class ValidationError extends DomainError {
  public readonly details?: unknown;

  constructor(message = "Validation failed", details?: unknown) {
    super(message, "validation_error", 422);
    this.details = details;
  }
}

export class LinkUnavailableError extends DomainError {
  constructor(message = "Link is expired or disabled") {
    super(message, "link_unavailable", 410);
  }
}

export class RetryableAllocationError extends DomainError {
  constructor(message = "Could not allocate a unique short code after maximum retries") {
    super(message, "allocation_failed", 503);
  }
}

export class RateLimitExceededError extends DomainError {
  public readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds = 60, message = "Rate limit exceeded") {
    super(message, "rate_limit_exceeded", 429);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

