import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  IDEMPOTENCY_RECORD_REPOSITORY,
  IdempotencyRecordRepository,
} from './idempotency-record.repository';

@Injectable()
export class IdempotencyService {
  constructor(
    @Inject(IDEMPOTENCY_RECORD_REPOSITORY)
    private readonly repository: IdempotencyRecordRepository,
  ) {}

  async execute<TResponse extends Record<string, unknown>>(
    idempotencyKey: string | undefined,
    operation: string,
    payload: object,
    handler: () => Promise<TResponse>,
  ): Promise<TResponse> {
    if (!idempotencyKey) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const requestHash = this.hashRequest(operation, payload);
    const { created, record } = await this.repository.reserve({
      idempotencyKey,
      operation,
      requestHash,
    });

    if (!created && record) {
      if (record.operation !== operation || record.requestHash !== requestHash) {
        throw new ConflictException(
          `Idempotency key ${idempotencyKey} has already been used for a different request`,
        );
      }

      if (record.status === 'COMPLETED' && record.responsePayload) {
        return record.responsePayload as TResponse;
      }

      if (record.status === 'IN_PROGRESS') {
        throw new ConflictException(
          `Request with Idempotency-Key ${idempotencyKey} is already in progress`,
        );
      }

      throw new ConflictException(
        `Request with Idempotency-Key ${idempotencyKey} previously failed. Retry with a new key.`,
      );
    }

    try {
      const response = await handler();
      await this.repository.markCompleted(idempotencyKey, response);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.repository.markFailed(idempotencyKey, message);
      throw error;
    }
  }

  private hashRequest(operation: string, payload: object): string {
    return createHash('sha256')
      .update(JSON.stringify({ operation, payload }))
      .digest('hex');
  }
}
