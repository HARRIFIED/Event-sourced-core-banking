import { Injectable } from '@nestjs/common';
import {
  TransferReadModelRepository,
  TransferSummaryReadModel,
  UpsertTransferSummaryInput,
} from './transfer-read-model.repository';
import { TransferStatus } from '../domain/transfer-status.enum';

@Injectable()
export class InMemoryTransferReadModelRepository implements TransferReadModelRepository {
  private readonly summaries = new Map<string, TransferSummaryReadModel>();

  async getTransferSummary(transferId: string): Promise<TransferSummaryReadModel | null> {
    return this.summaries.get(transferId) ?? null;
  }

  async upsertTransferSummary(summary: UpsertTransferSummaryInput): Promise<void> {
    const current = this.summaries.get(summary.transferId);
    if (current && new Date(current.updatedAt).getTime() > new Date(summary.updatedAt).getTime()) {
      return;
    }

    this.summaries.set(summary.transferId, summary);
  }

  async listPendingTransfers(limit = 100): Promise<TransferSummaryReadModel[]> {
    return [...this.summaries.values()]
      .filter(
        (summary) =>
          ![TransferStatus.COMPLETED, TransferStatus.COMPENSATED, TransferStatus.FAILED].includes(summary.status) ||
          summary.failureStage === 'CREDIT',
      )
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .slice(0, limit);
  }

  async listStuckTransfers(olderThanSeconds: number, limit = 100): Promise<TransferSummaryReadModel[]> {
    const threshold = Date.now() - olderThanSeconds * 1000;
    return (await this.listPendingTransfers(limit))
      .filter((summary) => new Date(summary.updatedAt).getTime() <= threshold)
      .slice(0, limit);
  }

  async resetTransfer(transferId: string): Promise<void> {
    this.summaries.delete(transferId);
  }

  async resetAll(): Promise<void> {
    this.summaries.clear();
  }
}
