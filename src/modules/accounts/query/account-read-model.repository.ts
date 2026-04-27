export interface AccountSummaryReadModel {
  accountId: string;
  ownerId: string;
  currency: string;
  status: 'ACTIVE' | 'FROZEN';
  balanceMinorUnits: string;
  balance: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AccountStatementEntryReadModel {
  eventId: string;
  accountId: string;
  streamVersion: number;
  eventType: string;
  entryKind?: 'ACCOUNT_OPERATION' | 'TRANSFER';
  amountMinorUnits?: string;
  amount?: number;
  currency?: string;
  transactionId?: string;
  transferId?: string;
  transferDirection?: 'INCOMING' | 'OUTGOING' | 'REVERSAL';
  sourceAccountId?: string;
  destinationAccountId?: string;
  counterpartyAccountId?: string;
  description?: string;
  reason?: string;
  occurredAt: string;
}

export interface UpsertAccountSummaryInput extends AccountSummaryReadModel {}

export interface AppendAccountStatementEntryInput extends AccountStatementEntryReadModel {}

export interface AccountReadModelRepository {
  getAccountSummary(accountId: string): Promise<AccountSummaryReadModel | null>;
  getAccountStatement(accountId: string, limit?: number, offset?: number): Promise<AccountStatementEntryReadModel[]>;
  upsertAccountSummary(summary: UpsertAccountSummaryInput): Promise<void>;
  appendAccountStatement(entry: AppendAccountStatementEntryInput): Promise<void>;
  resetAccount(accountId: string): Promise<void>;
  resetAll(): Promise<void>;
  getCheckpoint(projectionName: string): Promise<number>;
  saveCheckpoint(projectionName: string, position: number): Promise<void>;
}

export const ACCOUNT_READ_MODEL_REPOSITORY = Symbol('ACCOUNT_READ_MODEL_REPOSITORY');
