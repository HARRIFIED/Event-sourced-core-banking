import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { minorUnitsToNumber, parseMoneyToMinorUnits } from '../../../common/money/money';
import { TransferStatus } from '../domain/transfer-status.enum';
import {
  TransferReadModelRepository,
  TransferSummaryReadModel,
  UpsertTransferSummaryInput,
} from './transfer-read-model.repository';

@Injectable()
export class PostgresTransferReadModelRepository implements TransferReadModelRepository {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  async getTransferSummary(transferId: string): Promise<TransferSummaryReadModel | null> {
    const result = await this.pool.query(
      `SELECT transfer_id, source_account_id, destination_account_id, amount_minor_units, amount, currency, status,
              failure_reason, failure_stage, source_debit_transaction_id, destination_credit_transaction_id,
              compensation_transaction_id, debit_attempts, credit_attempts, compensation_attempts, created_at, updated_at
       FROM transfer_summary
       WHERE transfer_id = $1`,
      [transferId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      transferId: row.transfer_id,
      sourceAccountId: row.source_account_id,
      destinationAccountId: row.destination_account_id,
      amountMinorUnits: row.amount_minor_units,
      amount: minorUnitsToNumber(BigInt(row.amount_minor_units)),
      currency: row.currency,
      status: row.status as TransferStatus,
      failureReason: row.failure_reason ?? undefined,
      failureStage: row.failure_stage ?? undefined,
      sourceDebitTransactionId: row.source_debit_transaction_id ?? undefined,
      destinationCreditTransactionId: row.destination_credit_transaction_id ?? undefined,
      compensationTransactionId: row.compensation_transaction_id ?? undefined,
      debitAttempts: Number(row.debit_attempts),
      creditAttempts: Number(row.credit_attempts),
      compensationAttempts: Number(row.compensation_attempts),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async upsertTransferSummary(summary: UpsertTransferSummaryInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO transfer_summary (
         transfer_id, source_account_id, destination_account_id, amount, amount_minor_units, currency, status,
         failure_reason, failure_stage, source_debit_transaction_id, destination_credit_transaction_id,
         compensation_transaction_id, debit_attempts, credit_attempts, compensation_attempts, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::timestamptz, $17::timestamptz)
       ON CONFLICT (transfer_id) DO UPDATE
       SET source_account_id = EXCLUDED.source_account_id,
           destination_account_id = EXCLUDED.destination_account_id,
           amount = EXCLUDED.amount,
           amount_minor_units = EXCLUDED.amount_minor_units,
           currency = EXCLUDED.currency,
           status = EXCLUDED.status,
           failure_reason = EXCLUDED.failure_reason,
           failure_stage = EXCLUDED.failure_stage,
           source_debit_transaction_id = EXCLUDED.source_debit_transaction_id,
           destination_credit_transaction_id = EXCLUDED.destination_credit_transaction_id,
           compensation_transaction_id = EXCLUDED.compensation_transaction_id,
           debit_attempts = EXCLUDED.debit_attempts,
           credit_attempts = EXCLUDED.credit_attempts,
           compensation_attempts = EXCLUDED.compensation_attempts,
           created_at = EXCLUDED.created_at,
           updated_at = EXCLUDED.updated_at
       WHERE transfer_summary.updated_at <= EXCLUDED.updated_at`,
      [
        summary.transferId,
        summary.sourceAccountId,
        summary.destinationAccountId,
        summary.amount,
        summary.amountMinorUnits ?? parseMoneyToMinorUnits(summary.amount).toString(),
        summary.currency,
        summary.status,
        summary.failureReason ?? null,
        summary.failureStage ?? null,
        summary.sourceDebitTransactionId ?? null,
        summary.destinationCreditTransactionId ?? null,
        summary.compensationTransactionId ?? null,
        summary.debitAttempts,
        summary.creditAttempts,
        summary.compensationAttempts,
        summary.createdAt,
        summary.updatedAt,
      ],
    );
  }

  async listPendingTransfers(limit = 100): Promise<TransferSummaryReadModel[]> {
    const result = await this.pool.query(
      `SELECT transfer_id
       FROM transfer_summary
       WHERE status NOT IN ($2, $3)
        ORDER BY updated_at ASC
        LIMIT $1`,
      [limit, TransferStatus.COMPLETED, TransferStatus.COMPENSATED],
    );

    const summaries = await Promise.all(
      result.rows.map((row) => this.getTransferSummary(row.transfer_id as string)),
    );
    return summaries.filter((summary): summary is TransferSummaryReadModel => summary !== null);
  }

  async listStuckTransfers(olderThanSeconds: number, limit = 100): Promise<TransferSummaryReadModel[]> {
    const result = await this.pool.query(
      `SELECT transfer_id
       FROM transfer_summary
       WHERE status NOT IN ($3, $4)
          AND updated_at <= NOW() - ($1 * INTERVAL '1 second')
        ORDER BY updated_at ASC
        LIMIT $2`,
      [olderThanSeconds, limit, TransferStatus.COMPLETED, TransferStatus.COMPENSATED],
    );

    const summaries = await Promise.all(
      result.rows.map((row) => this.getTransferSummary(row.transfer_id as string)),
    );
    return summaries.filter((summary): summary is TransferSummaryReadModel => summary !== null);
  }

  async resetTransfer(transferId: string): Promise<void> {
    await this.pool.query(`DELETE FROM transfer_summary WHERE transfer_id = $1`, [transferId]);
  }

  async resetAll(): Promise<void> {
    await this.pool.query(`TRUNCATE TABLE transfer_summary`);
  }
}
