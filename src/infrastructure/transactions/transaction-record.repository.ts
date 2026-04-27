export type TransactionRecordStatus = 'PENDING' | 'COMPLETED' | 'FAILED_RETRYABLE' | 'FAILED_TERMINAL';
export type TransactionOperationType = 'DEPOSIT' | 'WITHDRAW';

export interface TransactionRecord {
  transactionId: string;
  accountId: string;
  operationType: TransactionOperationType;
  status: TransactionRecordStatus;
  amountMinorUnits: string;
  amount: number;
  currency: string;
  idempotencyKey?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReserveTransactionInput {
  transactionId: string;
  accountId: string;
  operationType: TransactionOperationType;
  amount: number | string;
  currency: string;
  idempotencyKey?: string | null;
}

export interface TransactionRecordRepository {
  reserve(input: ReserveTransactionInput): Promise<{ created: boolean; record: TransactionRecord | null }>;
  markPending(transactionId: string): Promise<void>;
  markCompleted(transactionId: string): Promise<void>;
  markFailed(transactionId: string, errorMessage: string, status: Extract<TransactionRecordStatus, 'FAILED_RETRYABLE' | 'FAILED_TERMINAL'>): Promise<void>;
}

export const TRANSACTION_RECORD_REPOSITORY = Symbol('TRANSACTION_RECORD_REPOSITORY');
