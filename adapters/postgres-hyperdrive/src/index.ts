import pg from "pg";
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

const { Client } = pg;

export async function withWorkerDb<T>(
  connectionString: string,
  work: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export class HyperdriveUrlRepository implements UrlRepository {
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  public async insert(params: InsertUrlParams): Promise<UrlRecord | null> {
    return withWorkerDb(this.connectionString, async (client) => {
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

      const result = await client.query(query, values);
      if (result.rowCount === 0 || !result.rows[0]) {
        return null;
      }
      return this.mapRowToRecord(result.rows[0]);
    });
  }

  public async findByCode(code: string): Promise<UrlRecord | null> {
    return withWorkerDb(this.connectionString, async (client) => {
      const query = `
        SELECT code, destination_url, owner_id, is_custom, created_at, expires_at, disabled_at
        FROM urls
        WHERE code = $1;
      `;
      const result = await client.query(query, [code]);
      if (result.rowCount === 0 || !result.rows[0]) {
        return null;
      }
      return this.mapRowToRecord(result.rows[0]);
    });
  }

  public async disable(code: string, ownerId?: string | null): Promise<boolean> {
    return withWorkerDb(this.connectionString, async (client) => {
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

      const result = await client.query(query, values);
      return (result.rowCount ?? 0) > 0;
    });
  }

  public async listByOwner(
    ownerId: string,
    limit: number,
    offset: number,
  ): Promise<UrlRecord[]> {
    return withWorkerDb(this.connectionString, async (client) => {
      const query = `
        SELECT code, destination_url, owner_id, is_custom, created_at, expires_at, disabled_at
        FROM urls
        WHERE owner_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3;
      `;
      const result = await client.query(query, [ownerId, limit, offset]);
      return result.rows.map((row) => this.mapRowToRecord(row));
    });
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

export class HyperdriveIdempotencyRepository implements IdempotencyRepository {
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  public async insertKey(params: InsertIdempotencyParams): Promise<boolean> {
    return withWorkerDb(this.connectionString, async (client) => {
      const query = `
        INSERT INTO idempotency_keys
          (principal_key, idempotency_key, request_hash, expires_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (principal_key, idempotency_key) DO NOTHING
        RETURNING principal_key;
      `;
      const result = await client.query(query, [
        params.principalKey,
        params.idempotencyKey,
        params.requestHash,
        params.expiresAt,
      ]);
      return (result.rowCount ?? 0) > 0;
    });
  }

  public async getKey(
    principalKey: string,
    idempotencyKey: string,
  ): Promise<IdempotencyRecord | null> {
    return withWorkerDb(this.connectionString, async (client) => {
      const query = `
        SELECT principal_key, idempotency_key, request_hash, response_status, response_body, created_at, expires_at
        FROM idempotency_keys
        WHERE principal_key = $1 AND idempotency_key = $2;
      `;
      const result = await client.query(query, [principalKey, idempotencyKey]);
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
    });
  }

  public async updateResponse(
    principalKey: string,
    idempotencyKey: string,
    status: number,
    body: unknown,
  ): Promise<void> {
    return withWorkerDb(this.connectionString, async (client) => {
      const query = `
        UPDATE idempotency_keys
        SET response_status = $3, response_body = $4
        WHERE principal_key = $1 AND idempotency_key = $2;
      `;
      await client.query(query, [principalKey, idempotencyKey, status, JSON.stringify(body)]);
    });
  }
}

export class HyperdriveAnalyticsRepository implements AnalyticsRepository {
  private readonly connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
  }

  public async processClickEventIdempotently(event: ClickEvent): Promise<boolean> {
    return withWorkerDb(this.connectionString, async (client) => {
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
      }
    });
  }

  public async getStats(code: string): Promise<UrlStats | null> {
    return withWorkerDb(this.connectionString, async (client) => {
      const query = `
        SELECT code, click_count, last_clicked_at, updated_at
        FROM url_stats
        WHERE code = $1;
      `;
      const result = await client.query(query, [code]);
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
    });
  }
}

