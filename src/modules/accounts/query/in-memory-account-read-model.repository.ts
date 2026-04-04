import { Injectable } from '@nestjs/common';
import {
  AccountReadModelRepository,
  AccountStatementEntryReadModel,
  AccountSummaryReadModel,
  AppendAccountStatementEntryInput,
  UpsertAccountSummaryInput,
} from './account-read-model.repository';

@Injectable()
export class InMemoryAccountReadModelRepository implements AccountReadModelRepository {
  private readonly summaries = new Map<string, AccountSummaryReadModel>();
  private readonly statements = new Map<string, AccountStatementEntryReadModel[]>();
  private readonly checkpoints = new Map<string, number>();

  async getAccountSummary(accountId: string): Promise<AccountSummaryReadModel | null> {
    return this.summaries.get(accountId) ?? null;
  }

  async getAccountStatement(
    accountId: string,
    limit = 100,
    offset = 0,
  ): Promise<AccountStatementEntryReadModel[]> {
    return (this.statements.get(accountId) ?? []).slice(offset, offset + limit);
  }

  async upsertAccountSummary(summary: UpsertAccountSummaryInput): Promise<void> {
    const current = this.summaries.get(summary.accountId);
    if (current && current.version >= summary.version) {
      return;
    }

    this.summaries.set(summary.accountId, summary);
  }

  async appendAccountStatement(entry: AppendAccountStatementEntryInput): Promise<void> {
    const current = this.statements.get(entry.accountId) ?? [];
    if (current.some((item) => item.eventId === entry.eventId)) {
      return;
    }

    const next = [...current, entry].sort((left, right) => left.streamVersion - right.streamVersion);
    this.statements.set(entry.accountId, next);
  }

  async resetAccount(accountId: string): Promise<void> {
    this.summaries.delete(accountId);
    this.statements.delete(accountId);
  }

  async resetAll(): Promise<void> {
    this.summaries.clear();
    this.statements.clear();
    this.checkpoints.clear();
  }

  async getCheckpoint(projectionName: string): Promise<number> {
    return this.checkpoints.get(projectionName) ?? 0;
  }

  async saveCheckpoint(projectionName: string, position: number): Promise<void> {
    const current = this.checkpoints.get(projectionName) ?? 0;
    if (position > current) {
      this.checkpoints.set(projectionName, position);
    }
  }
}
