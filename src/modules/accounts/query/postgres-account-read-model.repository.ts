import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { parseMoneyToMinorUnits, minorUnitsToNumber } from '../../../common/money/money';
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
      balance_minor_units: string;
      resolved_balance_minor_units: string;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT account_id, owner_id, currency, status, balance, balance_minor_units,
              CASE
                WHEN balance_minor_units IS NULL OR (balance_minor_units = '0' AND balance <> 0)
                  THEN ((balance * 100)::bigint)::text
                ELSE balance_minor_units
              END AS resolved_balance_minor_units,
              version, created_at, updated_at
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
      balanceMinorUnits: row.resolved_balance_minor_units,
      balance: minorUnitsToNumber(BigInt(row.resolved_balance_minor_units)),
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
      entry_kind: 'ACCOUNT_OPERATION' | 'TRANSFER' | null;
      amount: string | number | null;
      amount_minor_units: string | null;
      resolved_amount_minor_units: string | null;
      currency: string | null;
      transaction_id: string | null;
      transfer_id: string | null;
      transfer_direction: 'INCOMING' | 'OUTGOING' | 'REVERSAL' | null;
      source_account_id: string | null;
      destination_account_id: string | null;
      counterparty_account_id: string | null;
      description: string | null;
      reason: string | null;
      occurred_at: Date;
    }>(
      `SELECT event_id, account_id, stream_version, event_type, entry_kind, amount, amount_minor_units,
              CASE
                WHEN amount_minor_units IS NULL AND amount IS NOT NULL
                  THEN ((amount * 100)::bigint)::text
                ELSE amount_minor_units
              END AS resolved_amount_minor_units,
              currency, transaction_id, transfer_id, transfer_direction, source_account_id,
              destination_account_id, counterparty_account_id, description, reason, occurred_at
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
      entryKind: row.entry_kind ?? undefined,
      amountMinorUnits: row.resolved_amount_minor_units ?? undefined,
      amount: row.resolved_amount_minor_units === null ? undefined : minorUnitsToNumber(BigInt(row.resolved_amount_minor_units)),
      currency: row.currency ?? undefined,
      transactionId: row.transaction_id ?? undefined,
      transferId: row.transfer_id ?? undefined,
      transferDirection: row.transfer_direction ?? undefined,
      sourceAccountId: row.source_account_id ?? undefined,
      destinationAccountId: row.destination_account_id ?? undefined,
      counterpartyAccountId: row.counterparty_account_id ?? undefined,
      description: row.description ?? undefined,
      reason: row.reason ?? undefined,
      occurredAt: new Date(row.occurred_at).toISOString(),
    }));
  }

  async upsertAccountSummary(summary: UpsertAccountSummaryInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO account_summary (
         account_id, owner_id, currency, status, balance, balance_minor_units, version, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)
       ON CONFLICT (account_id) DO UPDATE
       SET owner_id = EXCLUDED.owner_id,
           currency = EXCLUDED.currency,
           status = EXCLUDED.status,
           balance = EXCLUDED.balance,
           balance_minor_units = EXCLUDED.balance_minor_units,
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
        summary.balanceMinorUnits,
        summary.version,
        summary.createdAt,
        summary.updatedAt,
      ],
    );
  }

  async appendAccountStatement(entry: AppendAccountStatementEntryInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO account_statement (
         event_id, account_id, stream_version, event_type, entry_kind, amount, amount_minor_units, currency, transaction_id,
         transfer_id, transfer_direction, source_account_id, destination_account_id, counterparty_account_id, description, reason, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::timestamptz)
        ON CONFLICT (event_id) DO NOTHING`,
      [
        entry.eventId,
        entry.accountId,
        entry.streamVersion,
        entry.eventType,
        entry.entryKind ?? null,
        entry.amount ?? null,
        entry.amountMinorUnits ?? (entry.amount === undefined ? null : parseMoneyToMinorUnits(entry.amount).toString()),
        entry.currency ?? null,
        entry.transactionId ?? null,
        entry.transferId ?? null,
        entry.transferDirection ?? null,
        entry.sourceAccountId ?? null,
        entry.destinationAccountId ?? null,
        entry.counterpartyAccountId ?? null,
        entry.description ?? null,
        entry.reason ?? null,
        entry.occurredAt,
      ],
    );
  }

  async resetAccount(accountId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM account_statement WHERE account_id = $1', [accountId]);
      await client.query('DELETE FROM account_summary WHERE account_id = $1', [accountId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resetAll(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('TRUNCATE TABLE account_statement, account_summary, projection_checkpoints');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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
