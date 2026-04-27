import { Injectable } from '@nestjs/common';
import { minorUnitsToNumber, parseMoneyToMinorUnits } from '../../common/money/money';
import {
  ReserveTransactionInput,
  TransactionRecord,
  TransactionRecordRepository,
} from './transaction-record.repository';

@Injectable()
export class InMemoryTransactionRecordRepository implements TransactionRecordRepository {
  private readonly records = new Map<string, TransactionRecord>();

  async reserve(input: ReserveTransactionInput): Promise<{ created: boolean; record: TransactionRecord | null }> {
    const existing = this.records.get(input.transactionId);
    if (existing) {
      return { created: false, record: existing };
    }

    const amountMinorUnits = parseMoneyToMinorUnits(input.amount);
    const record: TransactionRecord = {
      transactionId: input.transactionId,
      accountId: input.accountId,
      operationType: input.operationType,
      status: 'PENDING',
      amountMinorUnits: amountMinorUnits.toString(),
      amount: minorUnitsToNumber(amountMinorUnits),
      currency: input.currency,
      idempotencyKey: input.idempotencyKey ?? null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.records.set(input.transactionId, record);
    return { created: true, record };
  }

  async markPending(transactionId: string): Promise<void> {
    const current = this.records.get(transactionId);
    if (!current) {
      return;
    }

    this.records.set(transactionId, {
      ...current,
      status: 'PENDING',
      updatedAt: new Date().toISOString(),
    });
  }

  async markCompleted(transactionId: string): Promise<void> {
    const current = this.records.get(transactionId);
    if (!current) {
      return;
    }

    this.records.set(transactionId, {
      ...current,
      status: 'COMPLETED',
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    });
  }

  async markFailed(
    transactionId: string,
    errorMessage: string,
    status: 'FAILED_RETRYABLE' | 'FAILED_TERMINAL',
  ): Promise<void> {
    const current = this.records.get(transactionId);
    if (!current) {
      return;
    }

    this.records.set(transactionId, {
      ...current,
      status,
      errorMessage,
      updatedAt: new Date().toISOString(),
    });
  }
}
