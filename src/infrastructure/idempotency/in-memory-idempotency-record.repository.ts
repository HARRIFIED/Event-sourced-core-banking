import { Injectable } from '@nestjs/common';
import {
  IdempotencyRecord,
  IdempotencyRecordRepository,
  ReserveIdempotencyInput,
} from './idempotency-record.repository';

@Injectable()
export class InMemoryIdempotencyRecordRepository implements IdempotencyRecordRepository {
  private readonly records = new Map<string, IdempotencyRecord>();

  async reserve(input: ReserveIdempotencyInput): Promise<{ created: boolean; record: IdempotencyRecord | null }> {
    const existing = this.records.get(input.idempotencyKey);
    if (existing) {
      return { created: false, record: existing };
    }

    const record: IdempotencyRecord = {
      idempotencyKey: input.idempotencyKey,
      operation: input.operation,
      requestHash: input.requestHash,
      status: 'IN_PROGRESS',
      responsePayload: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.records.set(input.idempotencyKey, record);
    return { created: true, record };
  }

  async markCompleted<TResponse extends Record<string, unknown>>(
    idempotencyKey: string,
    responsePayload: TResponse,
  ): Promise<void> {
    const current = this.records.get(idempotencyKey);
    if (!current) {
      return;
    }

    this.records.set(idempotencyKey, {
      ...current,
      status: 'COMPLETED',
      responsePayload,
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    });
  }

  async markFailed(idempotencyKey: string, errorMessage: string): Promise<void> {
    const current = this.records.get(idempotencyKey);
    if (!current) {
      return;
    }

    this.records.set(idempotencyKey, {
      ...current,
      status: 'FAILED',
      errorMessage,
      updatedAt: new Date().toISOString(),
    });
  }
}
