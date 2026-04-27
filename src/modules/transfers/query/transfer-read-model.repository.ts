import { TransferStatus } from '../domain/transfer-status.enum';

export interface TransferSummaryReadModel {
  transferId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountMinorUnits: string;
  amount: number;
  currency: string;
  status: TransferStatus;
  failureReason?: string;
  failureStage?: 'DEBIT' | 'CREDIT';
  sourceDebitTransactionId?: string;
  destinationCreditTransactionId?: string;
  compensationTransactionId?: string;
  debitAttempts: number;
  creditAttempts: number;
  compensationAttempts: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertTransferSummaryInput extends TransferSummaryReadModel {}

export interface TransferReadModelRepository {
  getTransferSummary(transferId: string): Promise<TransferSummaryReadModel | null>;
  upsertTransferSummary(summary: UpsertTransferSummaryInput): Promise<void>;
  listPendingTransfers(limit?: number): Promise<TransferSummaryReadModel[]>;
  listStuckTransfers(olderThanSeconds: number, limit?: number): Promise<TransferSummaryReadModel[]>;
  resetTransfer(transferId: string): Promise<void>;
  resetAll(): Promise<void>;
}

export const TRANSFER_READ_MODEL_REPOSITORY = Symbol('TRANSFER_READ_MODEL_REPOSITORY');
