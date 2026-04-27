import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { minorUnitsToNumber, parseMoneyToMinorUnits } from '../../common/money/money';
import {
  ReserveTransactionInput,
  TransactionRecord,
  TransactionRecordRepository,
} from './transaction-record.repository';

@Injectable()
export class PostgresTransactionRecordRepository implements TransactionRecordRepository {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  async reserve(input: ReserveTransactionInput): Promise<{ created: boolean; record: TransactionRecord | null }> {
    const amountMinorUnits = parseMoneyToMinorUnits(input.amount);
    const insertResult = await this.pool.query<{
      transaction_id: string;
      account_id: string;
      operation_type: 'DEPOSIT' | 'WITHDRAW';
      status: 'PENDING' | 'COMPLETED' | 'FAILED_RETRYABLE' | 'FAILED_TERMINAL';
      amount_minor_units: string;
      amount: string | number;
      currency: string;
      idempotency_key: string | null;
      error_message: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO transaction_records (
         transaction_id, account_id, operation_type, status, amount, amount_minor_units, currency, idempotency_key, created_at, updated_at
       ) VALUES ($1, $2, $3, 'PENDING', $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (transaction_id) DO NOTHING
       RETURNING transaction_id, account_id, operation_type, status, amount_minor_units, amount, currency, idempotency_key, error_message, created_at, updated_at`,
      [
        input.transactionId,
        input.accountId,
        input.operationType,
        minorUnitsToNumber(amountMinorUnits),
        amountMinorUnits.toString(),
        input.currency,
        input.idempotencyKey ?? null,
      ],
    );

    const inserted = insertResult.rows[0];
    if (inserted) {
      return {
        created: true,
        record: this.mapRow(inserted),
      };
    }

    const existingResult = await this.pool.query<{
      transaction_id: string;
      account_id: string;
      operation_type: 'DEPOSIT' | 'WITHDRAW';
      status: 'PENDING' | 'COMPLETED' | 'FAILED_RETRYABLE' | 'FAILED_TERMINAL';
      amount_minor_units: string;
      amount: string | number;
      currency: string;
      idempotency_key: string | null;
      error_message: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT transaction_id, account_id, operation_type, status, amount_minor_units, amount, currency, idempotency_key, error_message, created_at, updated_at
       FROM transaction_records
       WHERE transaction_id = $1`,
      [input.transactionId],
    );

    return {
      created: false,
      record: existingResult.rows[0] ? this.mapRow(existingResult.rows[0]) : null,
    };
  }

  async markCompleted(transactionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE transaction_records
       SET status = 'COMPLETED',
           error_message = NULL,
           updated_at = NOW()
       WHERE transaction_id = $1`,
      [transactionId],
    );
  }

  async markPending(transactionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE transaction_records
       SET status = 'PENDING',
           updated_at = NOW()
       WHERE transaction_id = $1`,
      [transactionId],
    );
  }

  async markFailed(
    transactionId: string,
    errorMessage: string,
    status: 'FAILED_RETRYABLE' | 'FAILED_TERMINAL',
  ): Promise<void> {
    await this.pool.query(
      `UPDATE transaction_records
       SET status = $2,
           error_message = $3,
           updated_at = NOW()
       WHERE transaction_id = $1`,
      [transactionId, status, errorMessage],
    );
  }

  private mapRow(row: {
    transaction_id: string;
    account_id: string;
    operation_type: 'DEPOSIT' | 'WITHDRAW';
    status: 'PENDING' | 'COMPLETED' | 'FAILED_RETRYABLE' | 'FAILED_TERMINAL';
    amount_minor_units: string;
    amount: string | number;
    currency: string;
    idempotency_key: string | null;
    error_message: string | null;
    created_at: Date;
    updated_at: Date;
  }): TransactionRecord {
    return {
      transactionId: row.transaction_id,
      accountId: row.account_id,
      operationType: row.operation_type,
      status: row.status,
      amountMinorUnits: row.amount_minor_units,
      amount: minorUnitsToNumber(BigInt(row.amount_minor_units)),
      currency: row.currency,
      idempotencyKey: row.idempotency_key,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
