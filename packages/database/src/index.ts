import type {
  UrlRecord,
  UrlStats,
  ClickEvent,
  IdempotencyRecord,
} from "@linklet/shared-types";

export interface InsertUrlParams {
  code: string;
  destinationUrl: string;
  ownerId: string | null;
  isCustom: boolean;
  expiresAt: Date | null;
}

export interface UrlRepository {
  insert(params: InsertUrlParams): Promise<UrlRecord | null>;
  findByCode(code: string): Promise<UrlRecord | null>;
  disable(code: string, ownerId?: string | null): Promise<boolean>;
  listByOwner(ownerId: string, limit: number, offset: number): Promise<UrlRecord[]>;
}

export interface InsertIdempotencyParams {
  principalKey: string;
  idempotencyKey: string;
  requestHash: string;
  expiresAt: Date;
}

export interface IdempotencyRepository {
  insertKey(params: InsertIdempotencyParams): Promise<boolean>;
  getKey(principalKey: string, idempotencyKey: string): Promise<IdempotencyRecord | null>;
  updateResponse(
    principalKey: string,
    idempotencyKey: string,
    status: number,
    body: unknown,
  ): Promise<void>;
}

export interface AnalyticsRepository {
  processClickEventIdempotently(event: ClickEvent): Promise<boolean>;
  getStats(code: string): Promise<UrlStats | null>;
}

/**
 * In-Memory Database Harness
 * Accurately models PostgreSQL's unique constraints, ON CONFLICT DO NOTHING semantics,
 * and foreign key cascade rules for tests and headless verification.
 */
export class InMemoryDatabase
  implements UrlRepository, IdempotencyRepository, AnalyticsRepository
{
  private urls = new Map<string, UrlRecord>();
  private idempotency = new Map<string, IdempotencyRecord>();
  private processedEvents = new Set<string>();
  private stats = new Map<string, UrlStats>();
  private clickEvents: ClickEvent[] = [];

  // --- UrlRepository ---

  public async insert(params: InsertUrlParams): Promise<UrlRecord | null> {
    if (this.urls.has(params.code)) {
      // ON CONFLICT (code) DO NOTHING -> rowCount === 0 -> null
      return null;
    }

    const record: UrlRecord = {
      code: params.code,
      destinationUrl: params.destinationUrl,
      ownerId: params.ownerId,
      isCustom: params.isCustom,
      createdAt: new Date(),
      expiresAt: params.expiresAt,
      disabledAt: null,
    };

    this.urls.set(params.code, record);
    return record;
  }

  public async findByCode(code: string): Promise<UrlRecord | null> {
    return this.urls.get(code) ?? null;
  }

  public async disable(code: string, ownerId?: string | null): Promise<boolean> {
    const record = this.urls.get(code);
    if (!record) return false;
    if (ownerId !== undefined && record.ownerId !== ownerId) {
      return false;
    }
    record.disabledAt = new Date();
    return true;
  }

  public async listByOwner(
    ownerId: string,
    limit: number,
    offset: number,
  ): Promise<UrlRecord[]> {
    return Array.from(this.urls.values())
      .filter((r) => r.ownerId === ownerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);
  }

  // --- IdempotencyRepository ---

  public async insertKey(params: InsertIdempotencyParams): Promise<boolean> {
    const compoundKey = `${params.principalKey}:${params.idempotencyKey}`;
    if (this.idempotency.has(compoundKey)) {
      return false;
    }
    this.idempotency.set(compoundKey, {
      principalKey: params.principalKey,
      idempotencyKey: params.idempotencyKey,
      requestHash: params.requestHash,
      responseStatus: null,
      responseBody: null,
      createdAt: new Date(),
      expiresAt: params.expiresAt,
    });
    return true;
  }

  public async getKey(
    principalKey: string,
    idempotencyKey: string,
  ): Promise<IdempotencyRecord | null> {
    const compoundKey = `${principalKey}:${idempotencyKey}`;
    return this.idempotency.get(compoundKey) ?? null;
  }

  public async updateResponse(
    principalKey: string,
    idempotencyKey: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    const compoundKey = `${principalKey}:${idempotencyKey}`;
    const record = this.idempotency.get(compoundKey);
    if (record) {
      record.responseStatus = status;
      record.responseBody = body;
    }
  }

  // --- AnalyticsRepository ---

  public async processClickEventIdempotently(event: ClickEvent): Promise<boolean> {
    if (this.processedEvents.has(event.eventId)) {
      // Event already processed; do not double count
      return false;
    }

    this.processedEvents.add(event.eventId);
    this.clickEvents.push(event);

    const existingStats = this.stats.get(event.code);
    const eventTime = new Date(event.occurredAt);

    if (existingStats) {
      existingStats.clickCount += 1;
      if (!existingStats.lastClickedAt || eventTime > existingStats.lastClickedAt) {
        existingStats.lastClickedAt = eventTime;
      }
      existingStats.updatedAt = new Date();
    } else {
      this.stats.set(event.code, {
        code: event.code,
        clickCount: 1,
        lastClickedAt: eventTime,
        updatedAt: new Date(),
      });
    }

    return true;
  }

  public async getStats(code: string): Promise<UrlStats | null> {
    return this.stats.get(code) ?? null;
  }

  public clear(): void {
    this.urls.clear();
    this.idempotency.clear();
    this.processedEvents.clear();
    this.stats.clear();
    this.clickEvents.length = 0;
  }
}

