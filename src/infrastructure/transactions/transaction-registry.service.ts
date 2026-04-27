import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { parseMoneyToMinorUnits } from '../../common/money/money';
import {
  ReserveTransactionInput,
  TRANSACTION_RECORD_REPOSITORY,
  TransactionRecordRepository,
} from './transaction-record.repository';

@Injectable()
export class TransactionRegistryService {
  private readonly logger = new Logger(TransactionRegistryService.name);
  constructor(
    @Inject(TRANSACTION_RECORD_REPOSITORY)
    private readonly repository: TransactionRecordRepository,
  ) {}

  async execute(
    input: ReserveTransactionInput,
    handler: () => Promise<{ status: string }>,
    options?: {
      retryFailed?: boolean;
      isRetryableError?: (error: unknown) => boolean;
    },
  ): Promise<{ status: string }> {
    const { created, record } = await this.repository.reserve(input);

    if (!created && record) {
      this.ensureSameTransactionIntent(input, record);

      if (record.status === 'COMPLETED') {
        this.logger.warn(
          `Transaction ${input.transactionId} has already been completed. Returning cached response.`,
        );
        return { status: 'accepted' };
      }

      if (record.status === 'PENDING') {
        this.logger.warn(
          `Transaction ${input.transactionId} is already in progress. Rejecting duplicate request.`,
        );
        throw new ConflictException(
          `Transaction ${input.transactionId} is already in progress`,
        );
      }

      if (record.status === 'FAILED_RETRYABLE' && options?.retryFailed) {
        this.logger.warn(
          `Transaction ${input.transactionId} previously failed with a retryable error. Reopening for another attempt.`,
        );
        await this.repository.markPending(input.transactionId);
      } else if (record.status === 'FAILED_RETRYABLE') {
        throw new ConflictException(
          `Transaction ${input.transactionId} previously failed. Retry with a new transactionId.`,
        );
      } else {
      this.logger.error(
        `Transaction ${input.transactionId} previously failed with error: ${record.errorMessage}. Rejecting retry attempt.`,
      );
      throw new ConflictException(
        `Transaction ${input.transactionId} previously failed. Retry with a new transactionId.`,
      );
      }
    }

    try {
      const response = await handler();
      await this.repository.markCompleted(input.transactionId);
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = options?.isRetryableError?.(error) ? 'FAILED_RETRYABLE' : 'FAILED_TERMINAL';
      await this.repository.markFailed(input.transactionId, message, status);
      throw error;
    }
  }

  private ensureSameTransactionIntent(input: ReserveTransactionInput, record: {
    accountId: string;
    operationType: string;
    amountMinorUnits: string;
    amount: number;
    currency: string;
  }): void {
    if (
      input.accountId !== record.accountId ||
      input.operationType !== record.operationType ||
      parseMoneyToMinorUnits(input.amount).toString() !== record.amountMinorUnits ||
      input.currency !== record.currency
    ) {
      this.logger.error(
        `Transaction ${input.transactionId} has already been used for a different money movement. Existing record - accountId: ${record.accountId}, operationType: ${record.operationType}, amount: ${record.amount}, currency: ${record.currency}. Incoming request - accountId: ${input.accountId}, operationType: ${input.operationType}, amount: ${input.amount}, currency: ${input.currency}`,
      );
      throw new ConflictException(
        `Transaction ${input.transactionId} has already been used for a different money movement`,
      );
    }
  }
}
