import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  UrlRecord,
  UrlStats,
  ClickEvent,
  IdempotencyRecord,
} from "@linklet/shared-types";
import type {
  UrlRepository,
  IdempotencyRepository,
  AnalyticsRepository,
  InsertUrlParams,
  InsertIdempotencyParams,
} from "@linklet/database";

const { Pool } = pg;

export interface PgPoolConfig {
  connectionString: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  statement_timeout?: number;
}

export function createPgPool(config: PgPoolConfig): pg.Pool {
  return new Pool({
    connectionString: config.connectionString,
    max: config.max ?? 10,
    idleTimeoutMillis: config.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: config.connectionTimeoutMillis ?? 2_000,
    statement_timeout: config.statement_timeout ?? 3_000,
  });
}

export class PostgresUrlRepository implements UrlRepository {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  public async insert(params: InsertUrlParams): Promise<UrlRecord | null> {
    const query = `
      INSERT INTO urls (code, destination_url, owner_id, is_custom, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (code) DO NOTHING
      RETURNING code, destination_url, owner_id, is_custom, created_at, expires_at, disabled_at;
    `;
    const values = [
      params.code,
      params.destinationUrl,
      params.ownerId,
      params.isCustom,
      params.expiresAt,
    ];

    const result = await this.pool.query(query, values);
    if (result.rowCount === 0 || !result.rows[0]) {
      return null;
    }
    return this.mapRowToRecord(result.rows[0]);
  }

  public async findByCode(code: string): Promise<UrlRecord | null> {
    const query = `
      SELECT code, destination_url, owner_id, is_custom, created_at, expires_at, disabled_at
      FROM urls
      WHERE code = $1;
    `;
    const result = await this.pool.query(query, [code]);
    if (result.rowCount === 0 || !result.rows[0]) {
      return null;
    }
    return this.mapRowToRecord(result.rows[0]);
  }

  public async disable(code: string, ownerId?: string | null): Promise<boolean> {
    let query: string;
    let values: unknown[];

    if (ownerId !== undefined && ownerId !== null) {
      query = `
        UPDATE urls
        SET disabled_at = now()
        WHERE code = $1 AND owner_id = $2 AND disabled_at IS NULL;
      `;
      values = [code, ownerId];
    } else {
      query = `
        UPDATE urls
        SET disabled_at = now()
        WHERE code = $1 AND disabled_at IS NULL;
      `;
      values = [code];
    }

    const result = await this.pool.query(query, values);
    return (result.rowCount ?? 0) > 0;
  }

  public async listByOwner(
    ownerId: string,
    limit: number,
    offset: number,
  ): Promise<UrlRecord[]> {
    const query = `
      SELECT code, destination_url, owner_id, is_custom, created_at, expires_at, disabled_at
      FROM urls
      WHERE owner_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3;
    `;
    const result = await this.pool.query(query, [ownerId, limit, offset]);
    return result.rows.map((row) => this.mapRowToRecord(row));
  }

  private mapRowToRecord(row: any): UrlRecord {
    return {
      code: row.code,
      destinationUrl: row.destination_url,
      ownerId: row.owner_id,
      isCustom: Boolean(row.is_custom),
      createdAt: new Date(row.created_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      disabledAt: row.disabled_at ? new Date(row.disabled_at) : null,
    };
  }
}

export class PostgresIdempotencyRepository implements IdempotencyRepository {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  public async insertKey(params: InsertIdempotencyParams): Promise<boolean> {
    const query = `
      INSERT INTO idempotency_keys
        (principal_key, idempotency_key, request_hash, expires_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (principal_key, idempotency_key) DO NOTHING
      RETURNING principal_key;
    `;
    const result = await this.pool.query(query, [
      params.principalKey,
      params.idempotencyKey,
      params.requestHash,
      params.expiresAt,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  public async getKey(
    principalKey: string,
    idempotencyKey: string,
  ): Promise<IdempotencyRecord | null> {
    const query = `
      SELECT principal_key, idempotency_key, request_hash, response_status, response_body, created_at, expires_at
      FROM idempotency_keys
      WHERE principal_key = $1 AND idempotency_key = $2;
    `;
    const result = await this.pool.query(query, [principalKey, idempotencyKey]);
    if (result.rowCount === 0 || !result.rows[0]) {
      return null;
    }
    const row = result.rows[0];
    return {
      principalKey: row.principal_key,
      idempotencyKey: row.idempotency_key,
      requestHash: row.request_hash,
      responseStatus: row.response_status ? Number(row.response_status) : null,
      responseBody: row.response_body,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
    };
  }

  public async updateResponse(
    principalKey: string,
    idempotencyKey: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    const query = `
      UPDATE idempotency_keys
      SET response_status = $3, response_body = $4
      WHERE principal_key = $1 AND idempotency_key = $2;
    `;
    await this.pool.query(query, [principalKey, idempotencyKey, status, JSON.stringify(body)]);
  }
}

export class PostgresAnalyticsRepository implements AnalyticsRepository {
  private readonly pool: pg.Pool;

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  /**
   * Section 29.1: Idempotent aggregation SQL inside transaction
   * Uses WITH new_event AS (INSERT INTO processed_events ... ON CONFLICT DO NOTHING)
   * Prevents double counting on broker redeliveries.
   */
  public async processClickEventIdempotently(event: ClickEvent): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN;");

      const query = `
        WITH new_event AS (
          INSERT INTO processed_events (event_id)
          VALUES ($1::uuid)
          ON CONFLICT (event_id) DO NOTHING
          RETURNING event_id
        )
        INSERT INTO url_stats (code, click_count, last_clicked_at, updated_at)
        SELECT $2, 1, $3::timestamptz, now()
        FROM new_event
        ON CONFLICT (code) DO UPDATE
        SET click_count = url_stats.click_count + 1,
            last_clicked_at = GREATEST(url_stats.last_clicked_at, EXCLUDED.last_clicked_at),
            updated_at = now()
        RETURNING code;
      `;

      const result = await client.query(query, [
        event.eventId,
        event.code,
        event.occurredAt,
      ]);

      // Also record coarse click event for local experiment table
      if ((result.rowCount ?? 0) > 0) {
        await client.query(
          `INSERT INTO click_events (event_id, code, occurred_at, referrer_host, user_agent_family, country_code)
           VALUES ($1::uuid, $2, $3::timestamptz, $4, $5, $6)
           ON CONFLICT DO NOTHING;`,
          [
            event.eventId,
            event.code,
            event.occurredAt,
            event.referrerHost,
            event.userAgentFamily,
            event.countryCode,
          ],
        );
      }

      await client.query("COMMIT;");
      return (result.rowCount ?? 0) > 0;
    } catch (err) {
      await client.query("ROLLBACK;");
      throw err;
    } finally {
      client.release();
    }
  }

  public async getStats(code: string): Promise<UrlStats | null> {
    const query = `
      SELECT code, click_count, last_clicked_at, updated_at
      FROM url_stats
      WHERE code = $1;
    `;
    const result = await this.pool.query(query, [code]);
    if (result.rowCount === 0 || !result.rows[0]) {
      return null;
    }
    const row = result.rows[0];
    return {
      code: row.code,
      clickCount: Number(row.click_count),
      lastClickedAt: row.last_clicked_at ? new Date(row.last_clicked_at) : null,
      updatedAt: new Date(row.updated_at),
    };
  }
}

/**
 * Migration runner executing SQL migrations in version order within transactions
 */
export async function runPostgresMigrations(
  pool: pg.Pool,
  migrationsDirectory: string,
): Promise<string[]> {
  const client = await pool.connect();
  const appliedMigrations: string[] = [];

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    const files = await readdir(migrationsDirectory);
    const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();

    for (const file of sqlFiles) {
      const alreadyApplied = await client.query(
        "SELECT 1 FROM _migrations WHERE name = $1;",
        [file],
      );
      if ((alreadyApplied.rowCount ?? 0) > 0) {
        continue;
      }

      const filePath = join(migrationsDirectory, file);
      const sql = await readFile(filePath, "utf-8");

      console.log(`[migration] Applying migration: ${file}`);
      await client.query("BEGIN;");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1);", [file]);
        await client.query("COMMIT;");
        appliedMigrations.push(file);
      } catch (err) {
        await client.query("ROLLBACK;");
        throw new Error(`Failed to apply migration ${file}: ${(err as Error).message}`);
      }
    }
  } finally {
    client.release();
  }

  return appliedMigrations;
}

