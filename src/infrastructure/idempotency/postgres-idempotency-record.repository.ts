import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import {
  IdempotencyRecord,
  IdempotencyRecordRepository,
  ReserveIdempotencyInput,
} from './idempotency-record.repository';

@Injectable()
export class PostgresIdempotencyRecordRepository implements IdempotencyRecordRepository {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  async reserve(input: ReserveIdempotencyInput): Promise<{ created: boolean; record: IdempotencyRecord | null }> {
    const result = await this.pool.query<{
      idempotency_key: string;
      operation: string;
      request_hash: string;
      status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
      response_payload: Record<string, unknown> | null;
      error_message: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO idempotency_records (
         idempotency_key, operation, request_hash, status, created_at, updated_at
       ) VALUES ($1, $2, $3, 'IN_PROGRESS', NOW(), NOW())
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING idempotency_key, operation, request_hash, status, response_payload, error_message, created_at, updated_at`,
      [input.idempotencyKey, input.operation, input.requestHash],
    );

    const inserted = result.rows[0];
    if (inserted) {
      return {
        created: true,
        record: this.mapRow(inserted),
      };
    }

    const existingResult = await this.pool.query<{
      idempotency_key: string;
      operation: string;
      request_hash: string;
      status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
      response_payload: Record<string, unknown> | null;
      error_message: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT idempotency_key, operation, request_hash, status, response_payload, error_message, created_at, updated_at
       FROM idempotency_records
       WHERE idempotency_key = $1`,
      [input.idempotencyKey],
    );

    return {
      created: false,
      record: existingResult.rows[0] ? this.mapRow(existingResult.rows[0]) : null,
    };
  }

  async markCompleted<TResponse extends Record<string, unknown>>(
    idempotencyKey: string,
    responsePayload: TResponse,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE idempotency_records
       SET status = 'COMPLETED',
           response_payload = $2::jsonb,
           error_message = NULL,
           updated_at = NOW()
       WHERE idempotency_key = $1`,
      [idempotencyKey, JSON.stringify(responsePayload)],
    );
  }

  async markFailed(idempotencyKey: string, errorMessage: string): Promise<void> {
    await this.pool.query(
      `UPDATE idempotency_records
       SET status = 'FAILED',
           error_message = $2,
           updated_at = NOW()
       WHERE idempotency_key = $1`,
      [idempotencyKey, errorMessage],
    );
  }

  private mapRow(row: {
    idempotency_key: string;
    operation: string;
    request_hash: string;
    status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
    response_payload: Record<string, unknown> | null;
    error_message: string | null;
    created_at: Date;
    updated_at: Date;
  }): IdempotencyRecord {
    return {
      idempotencyKey: row.idempotency_key,
      operation: row.operation,
      requestHash: row.request_hash,
      status: row.status,
      responsePayload: row.response_payload,
      errorMessage: row.error_message,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
