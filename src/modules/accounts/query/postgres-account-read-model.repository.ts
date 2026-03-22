import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import {
  AccountReadModelRepository,
  AccountStatementEntryReadModel,
  AccountSummaryReadModel,
  AppendAccountStatementEntryInput,
  UpsertAccountSummaryInput,
} from './account-read-model.repository';

@Injectable()
export class PostgresAccountReadModelRepository implements AccountReadModelRepository {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  async getAccountSummary(accountId: string): Promise<AccountSummaryReadModel | null> {
    const result = await this.pool.query<{
      account_id: string;
      owner_id: string;
      currency: string;
      status: 'ACTIVE' | 'FROZEN';
      balance: string | number;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT account_id, owner_id, currency, status, balance, version, created_at, updated_at
       FROM account_summary
       WHERE account_id = $1`,
      [accountId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      accountId: row.account_id,
      ownerId: row.owner_id,
      currency: row.currency,
      status: row.status,
      balance: Number(row.balance),
      version: Number(row.version),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async getAccountStatement(
    accountId: string,
    limit = 100,
    offset = 0,
  ): Promise<AccountStatementEntryReadModel[]> {
    const result = await this.pool.query<{
      event_id: string;
      account_id: string;
      stream_version: number;
      event_type: string;
      amount: string | number | null;
      currency: string | null;
      transaction_id: string | null;
      reason: string | null;
      occurred_at: Date;
    }>(
      `SELECT event_id, account_id, stream_version, event_type, amount, currency, transaction_id, reason, occurred_at
       FROM account_statement
       WHERE account_id = $1
       ORDER BY stream_version ASC
       LIMIT $2 OFFSET $3`,
      [accountId, limit, offset],
    );

    return result.rows.map((row) => ({
      eventId: row.event_id,
      accountId: row.account_id,
      streamVersion: Number(row.stream_version),
      eventType: row.event_type,
      amount: row.amount === null ? undefined : Number(row.amount),
      currency: row.currency ?? undefined,
      transactionId: row.transaction_id ?? undefined,
      reason: row.reason ?? undefined,
      occurredAt: new Date(row.occurred_at).toISOString(),
    }));
  }

  async upsertAccountSummary(summary: UpsertAccountSummaryInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO account_summary (
         account_id, owner_id, currency, status, balance, version, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)
       ON CONFLICT (account_id) DO UPDATE
       SET owner_id = EXCLUDED.owner_id,
           currency = EXCLUDED.currency,
           status = EXCLUDED.status,
           balance = EXCLUDED.balance,
           version = EXCLUDED.version,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at
       WHERE account_summary.version < EXCLUDED.version`,
      [
        summary.accountId,
        summary.ownerId,
        summary.currency,
        summary.status,
        summary.balance,
        summary.version,
        summary.createdAt,
        summary.updatedAt,
      ],
    );
  }

  async appendAccountStatement(entry: AppendAccountStatementEntryInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO account_statement (
         event_id, account_id, stream_version, event_type, amount, currency, transaction_id, reason, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        entry.eventId,
        entry.accountId,
        entry.streamVersion,
        entry.eventType,
        entry.amount ?? null,
        entry.currency ?? null,
        entry.transactionId ?? null,
        entry.reason ?? null,
        entry.occurredAt,
      ],
    );
  }

  async getCheckpoint(projectionName: string): Promise<number> {
    const result = await this.pool.query<{ position: string | number }>(
      `SELECT position FROM projection_checkpoints WHERE projection_name = $1`,
      [projectionName],
    );

    return Number(result.rows[0]?.position ?? 0);
  }

  async saveCheckpoint(projectionName: string, position: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO projection_checkpoints (projection_name, position, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (projection_name) DO UPDATE
       SET position = EXCLUDED.position,
           updated_at = NOW()
       WHERE projection_checkpoints.position < EXCLUDED.position`,
      [projectionName, position],
    );
  }
}
