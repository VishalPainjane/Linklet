import { createHash } from "node:crypto";
import type {
  CreateUrlInput,
  CreateUrlResult,
  UrlRecord,
  UrlResolution,
} from "@linklet/shared-types";
import {
  ConflictError,
  NotFoundError,
  RetryableAllocationError,
} from "@linklet/shared-types";
import type { UrlRepository, IdempotencyRepository } from "@linklet/database";
import type { CacheRepository } from "@linklet/cache";
import { SingleFlight, calculateCacheTtlSeconds } from "@linklet/cache";
import type { CodeGenerator } from "@linklet/code-generator";
import { defaultCodeGenerator } from "@linklet/code-generator";
import type { ClickEventPublisher } from "@linklet/events";
import { createClickEvent } from "@linklet/events";
import { validate, createUrlRequestSchema, codeParamSchema } from "@linklet/validation";

export interface UrlServiceConfig {
  publicShortDomain: string;
  defaultCacheTtlSeconds: number;
  maxAllocationRetries: number;
}

export interface CachedUrlPayload {
  code: string;
  destinationUrl: string;
  expiresAt: string | null;
  disabled: boolean;
}

export interface ResolveClickMeta {
  referrer?: string | null | undefined;
  userAgent?: string | null | undefined;
  countryCode?: string | null | undefined;
}

export class UrlService {
  private readonly urlRepo: UrlRepository;
  private readonly idempotencyRepo: IdempotencyRepository | undefined;
  private readonly cacheRepo: CacheRepository;
  private readonly codeGenerator: CodeGenerator;
  private readonly eventPublisher: ClickEventPublisher;
  private readonly config: UrlServiceConfig;
  private readonly singleFlight = new SingleFlight<UrlRecord | null>();
  private readonly idempotencyFlight = new SingleFlight<CreateUrlResult>();

  constructor(deps: {
    urlRepo: UrlRepository;
    idempotencyRepo?: IdempotencyRepository | undefined;
    cacheRepo: CacheRepository;
    codeGenerator?: CodeGenerator | undefined;
    eventPublisher: ClickEventPublisher;
    config?: Partial<UrlServiceConfig> | undefined;
  }) {
    this.urlRepo = deps.urlRepo;
    this.idempotencyRepo = deps.idempotencyRepo;
    this.cacheRepo = deps.cacheRepo;
    this.codeGenerator = deps.codeGenerator ?? defaultCodeGenerator;
    this.eventPublisher = deps.eventPublisher;
    this.config = {
      publicShortDomain: deps.config?.publicShortDomain ?? "http://localhost:3001",
      defaultCacheTtlSeconds: deps.config?.defaultCacheTtlSeconds ?? 900,
      maxAllocationRetries: deps.config?.maxAllocationRetries ?? 5,
    };
  }

  /**
   * Creates a short URL with either a generated code or a custom alias.
   * Supports transactional idempotency if Idempotency-Key is provided.
   */
  public async create(input: CreateUrlInput): Promise<CreateUrlResult> {
    const validated = validate(createUrlRequestSchema, {
      url: input.destinationUrl,
      customAlias: input.customAlias,
      expiresAt: input.expiresAt ? input.expiresAt.toISOString() : null,
    });

    const principal = input.principalKey ?? "anonymous";

    if (input.idempotencyKey && this.idempotencyRepo) {
      const compoundKey = `${principal}:${input.idempotencyKey}`;
      return this.idempotencyFlight.do(compoundKey, async () => {
        return this.executeCreateWithIdempotency(input, validated, principal, input.idempotencyKey!);
      });
    }

    return this.executeCreateUrl(input, validated);
  }

  private async executeCreateWithIdempotency(
    input: CreateUrlInput,
    validated: { url: string; customAlias?: string | undefined; expiresAt: Date | null },
    principal: string,
    idempotencyKey: string,
  ): Promise<CreateUrlResult> {
    const repo = this.idempotencyRepo!;
    const requestHash = this.computeRequestHash(validated);

    const existing = await repo.getKey(principal, idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictError("Idempotency key reused with different request payload");
      }
      if (existing.responseBody) {
        return existing.responseBody as CreateUrlResult;
      }

      // Record exists but response is pending from in-flight winner: wait for completion
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 10));
        const rec = await repo.getKey(principal, idempotencyKey);
        if (rec?.responseBody) {
          return rec.responseBody as CreateUrlResult;
        }
      }
      throw new ConflictError("Concurrent idempotency operation timed out");
    }

    const inserted = await repo.insertKey({
      principalKey: principal,
      idempotencyKey,
      requestHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days retention
    });

    if (!inserted) {
      // Lost the race to insert: wait for winner to populate responseBody
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 10));
        const rec = await repo.getKey(principal, idempotencyKey);
        if (rec?.responseBody) {
          return rec.responseBody as CreateUrlResult;
        }
      }
      throw new ConflictError("Concurrent idempotency operation timed out");
    }

    const result = await this.executeCreateUrl(input, validated);

    await repo.updateResponse(
      principal,
      idempotencyKey,
      201,
      result,
    );

    return result;
  }

  private async executeCreateUrl(
    input: CreateUrlInput,
    validated: { url: string; customAlias?: string | undefined; expiresAt: Date | null },
  ): Promise<CreateUrlResult> {
    let record: UrlRecord | null = null;

    if (validated.customAlias) {
      record = await this.urlRepo.insert({
        code: validated.customAlias,
        destinationUrl: validated.url,
        ownerId: input.ownerId ?? null,
        isCustom: true,
        expiresAt: validated.expiresAt,
      });

      if (!record) {
        throw new ConflictError(`Custom alias '${validated.customAlias}' is already in use`);
      }
    } else {
      // Bounded retry loop for random generated codes
      for (let attempt = 0; attempt < this.config.maxAllocationRetries; attempt++) {
        const candidate = this.codeGenerator.generate();
        record = await this.urlRepo.insert({
          code: candidate,
          destinationUrl: validated.url,
          ownerId: input.ownerId ?? null,
          isCustom: false,
          expiresAt: validated.expiresAt,
        });

        if (record) {
          break;
        }
      }

      if (!record) {
        throw new RetryableAllocationError();
      }
    }

    return {
      code: record.code,
      shortUrl: `${this.config.publicShortDomain}/${record.code}`,
      destinationUrl: record.destinationUrl,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
    };
  }

  /**
   * Resolves a short code using SingleFlight cache-aside, checks expiration/disable state,
   * and asynchronously enqueues analytics events.
   */
  public async resolve(code: string, meta?: ResolveClickMeta): Promise<UrlResolution> {
    const validatedCode = validate(codeParamSchema, code);
    const cacheKey = `url:${validatedCode}`;

    // 1. L1 Cache Check
    const cachedJson = await this.safeCacheGet(cacheKey);
    if (cachedJson) {
      try {
        const cached = JSON.parse(cachedJson) as CachedUrlPayload;
        const state = this.evaluateUrlState(
          cached.expiresAt ? new Date(cached.expiresAt) : null,
          cached.disabled,
        );

        if (state === "active") {
          this.recordClickAsync(validatedCode, meta);
          return { state: "active", url: cached.destinationUrl, code: validatedCode };
        }
        return { state, code: validatedCode };
      } catch {
        // Corrupted cache entry; proceed to database
      }
    }

    // 2. Database Lookup with SingleFlight Stampede Protection
    const record = await this.singleFlight.do(cacheKey, async () => {
      return this.urlRepo.findByCode(validatedCode);
    });

    if (!record) {
      return { state: "not_found", code: validatedCode };
    }

    const state = this.evaluateUrlState(record.expiresAt, record.disabledAt !== null);

    if (state === "active") {
      const ttl = calculateCacheTtlSeconds(
        record.expiresAt,
        this.config.defaultCacheTtlSeconds,
      );
      if (ttl > 0) {
        const payload: CachedUrlPayload = {
          code: record.code,
          destinationUrl: record.destinationUrl,
          expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
          disabled: false,
        };
        await this.safeCacheSet(cacheKey, JSON.stringify(payload), ttl);
      }

      this.recordClickAsync(validatedCode, meta);
      return { state: "active", url: record.destinationUrl, code: validatedCode };
    }

    // If disabled or expired, update cache with small negative TTL or invalidate
    await this.safeCacheDelete(cacheKey);
    return { state, code: validatedCode };
  }

  /**
   * Disables a URL and synchronously invalidates its Redis cache entry.
   */
  public async disable(code: string, ownerId?: string | null): Promise<boolean> {
    const validatedCode = validate(codeParamSchema, code);
    const disabled = await this.urlRepo.disable(validatedCode, ownerId);
    if (disabled) {
      await this.safeCacheDelete(`url:${validatedCode}`);
    }
    return disabled;
  }

  /**
   * Retrieves link metadata without redirecting or tracking clicks.
   */
  public async getMetadata(code: string): Promise<UrlRecord> {
    const validatedCode = validate(codeParamSchema, code);
    const record = await this.urlRepo.findByCode(validatedCode);
    if (!record) {
      throw new NotFoundError(`Short URL with code '${validatedCode}' does not exist`);
    }
    return record;
  }

  private evaluateUrlState(expiresAt: Date | null, isDisabled: boolean): "active" | "expired" | "disabled" {
    if (isDisabled) return "disabled";
    if (expiresAt !== null && expiresAt.getTime() <= Date.now()) return "expired";
    return "active";
  }

  private recordClickAsync(code: string, meta?: ResolveClickMeta): void {
    // Non-blocking background publish: does not block redirect latency
    setImmediate(async () => {
      try {
        const event = createClickEvent({
          code,
          referrer: meta?.referrer,
          userAgent: meta?.userAgent,
          countryCode: meta?.countryCode,
        });
        await this.eventPublisher.publish(event);
      } catch (err) {
        // Log background publish error without affecting redirect response
        console.error(JSON.stringify({
          level: "warn",
          message: "Failed to publish click event",
          code,
          error: (err as Error).message,
        }));
      }
    });
  }

  private computeRequestHash(payload: unknown): string {
    return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  }

  private async safeCacheGet(key: string): Promise<string | null> {
    try {
      return await this.cacheRepo.get(key);
    } catch {
      return null; // Graceful cache degradation to DB
    }
  }

  private async safeCacheSet(key: string, value: string, ttl: number): Promise<void> {
    try {
      await this.cacheRepo.set(key, value, ttl);
    } catch {
      // Cache set error suppressed; DB remains authoritative
    }
  }

  private async safeCacheDelete(key: string): Promise<void> {
    try {
      await this.cacheRepo.delete(key);
    } catch {
      // Invalidation error suppressed; bounded TTL serves as backstop
    }
  }
}

