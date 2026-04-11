export type IdempotencyStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';

export interface IdempotencyRecord<TResponse = Record<string, unknown>> {
  idempotencyKey: string;
  operation: string;
  requestHash: string;
  status: IdempotencyStatus;
  responsePayload?: TResponse | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReserveIdempotencyInput {
  idempotencyKey: string;
  operation: string;
  requestHash: string;
}

export interface IdempotencyRecordRepository {
  reserve(input: ReserveIdempotencyInput): Promise<{ created: boolean; record: IdempotencyRecord | null }>;
  markCompleted<TResponse extends Record<string, unknown>>(idempotencyKey: string, responsePayload: TResponse): Promise<void>;
  markFailed(idempotencyKey: string, errorMessage: string): Promise<void>;
}

export const IDEMPOTENCY_RECORD_REPOSITORY = Symbol('IDEMPOTENCY_RECORD_REPOSITORY');
