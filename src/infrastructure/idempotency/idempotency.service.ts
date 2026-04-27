import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  IDEMPOTENCY_RECORD_REPOSITORY,
  IdempotencyRecordRepository,
} from './idempotency-record.repository';

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
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
        this.logger.error(
          `Idempotency key ${idempotencyKey} has already been used for a different request. Existing operation: ${record.operation}, incoming operation: ${operation}`,
        );
        throw new ConflictException(
          `Idempotency key ${idempotencyKey} has already been used for a different request`,
        );
      }

      if (record.status === 'COMPLETED' && record.responsePayload) {
        this.logger.warn(
          `Idempotent request with key ${idempotencyKey} has already been completed. Returning cached response.`,
        );
        return record.responsePayload as TResponse;
      }

      if (record.status === 'IN_PROGRESS') {
        this.logger.warn(
          `Request with Idempotency-Key ${idempotencyKey} is already in progress. Rejecting duplicate request.`,
        );
        throw new ConflictException(
          `Request with Idempotency-Key ${idempotencyKey} is already in progress`,
        );
      }
      this.logger.error(
        `Request with Idempotency-Key ${idempotencyKey} previously failed with error: ${record.errorMessage}. Rejecting retry attempt.`,
      );
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
