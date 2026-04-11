export type TransactionRecordStatus = 'PENDING' | 'COMPLETED' | 'FAILED';
export type TransactionOperationType = 'DEPOSIT' | 'WITHDRAW';

export interface TransactionRecord {
  transactionId: string;
  accountId: string;
  operationType: TransactionOperationType;
  status: TransactionRecordStatus;
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
  amount: number;
  currency: string;
  idempotencyKey?: string | null;
}

export interface TransactionRecordRepository {
  reserve(input: ReserveTransactionInput): Promise<{ created: boolean; record: TransactionRecord | null }>;
  markCompleted(transactionId: string): Promise<void>;
  markFailed(transactionId: string, errorMessage: string): Promise<void>;
}

export const TRANSACTION_RECORD_REPOSITORY = Symbol('TRANSACTION_RECORD_REPOSITORY');
