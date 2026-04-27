import { Inject, Injectable } from '@nestjs/common';
import { minorUnitsToNumber, parseMoneyToMinorUnits } from '../../../common/money/money';
import { DomainEvent } from '../../../common/domain/domain-event';
import { TransferEventTypes } from '../application/events/transfer.events';
import { TransferStatus } from '../domain/transfer-status.enum';
import {
  TRANSFER_READ_MODEL_REPOSITORY,
  TransferReadModelRepository,
} from './transfer-read-model.repository';

@Injectable()
export class TransferProjector {
  constructor(
    @Inject(TRANSFER_READ_MODEL_REPOSITORY)
    private readonly readModels: TransferReadModelRepository,
  ) {}

  async project(event: DomainEvent): Promise<boolean> {
    switch (event.eventType) {
      case TransferEventTypes.TransferInitiated:
      case TransferEventTypes.TransferDebitStarted:
      case TransferEventTypes.TransferDebited:
      case TransferEventTypes.TransferCreditStarted:
      case TransferEventTypes.TransferCompleted:
      case TransferEventTypes.TransferFailed:
      case TransferEventTypes.TransferCompensationStarted:
      case TransferEventTypes.TransferCompensated:
        await this.projectTransferEvent(event);
        return true;
      default:
        return false;
    }
  }

  private async projectTransferEvent(event: DomainEvent): Promise<void> {
    const transferId = event.data.transferId as string;
    const existing = await this.readModels.getTransferSummary(transferId);

    if (event.eventType === TransferEventTypes.TransferInitiated) {
      const amountMinorUnits = parseMoneyToMinorUnits(event.data.amount as string);
      await this.readModels.upsertTransferSummary({
        transferId,
        sourceAccountId: event.data.sourceAccountId as string,
        destinationAccountId: event.data.destinationAccountId as string,
        amountMinorUnits: amountMinorUnits.toString(),
        amount: minorUnitsToNumber(amountMinorUnits),
        currency: event.data.currency as string,
        status: TransferStatus.INITIATED,
        debitAttempts: 0,
        creditAttempts: 0,
        compensationAttempts: 0,
        createdAt: event.occurredAt,
        updatedAt: event.occurredAt,
      });
      return;
    }

    if (!existing) {
      throw new Error(`Projection missing transfer summary for transfer ${transferId}`);
    }

    switch (event.eventType) {
      case TransferEventTypes.TransferDebitStarted:
        await this.readModels.upsertTransferSummary({
          ...existing,
          status: TransferStatus.DEBIT_IN_PROGRESS,
          sourceDebitTransactionId: event.data.transactionId as string,
          debitAttempts: Number(event.data.debitAttempts),
          failureReason: undefined,
          failureStage: undefined,
          updatedAt: event.occurredAt,
        });
        return;
      case TransferEventTypes.TransferDebited:
        await this.readModels.upsertTransferSummary({
          ...existing,
          status: TransferStatus.DEBITED,
          updatedAt: event.occurredAt,
        });
        return;
      case TransferEventTypes.TransferCreditStarted:
        await this.readModels.upsertTransferSummary({
          ...existing,
          status: TransferStatus.CREDIT_IN_PROGRESS,
          destinationCreditTransactionId: event.data.transactionId as string,
          creditAttempts: Number(event.data.creditAttempts),
          failureReason: undefined,
          failureStage: undefined,
          updatedAt: event.occurredAt,
        });
        return;
      case TransferEventTypes.TransferCompleted:
        await this.readModels.upsertTransferSummary({
          ...existing,
          status: TransferStatus.COMPLETED,
          updatedAt: event.occurredAt,
        });
        return;
      case TransferEventTypes.TransferFailed:
        await this.readModels.upsertTransferSummary({
          ...existing,
          status: TransferStatus.FAILED,
          failureReason: event.data.reason as string,
          failureStage: event.data.stage as 'DEBIT' | 'CREDIT',
          updatedAt: event.occurredAt,
        });
        return;
      case TransferEventTypes.TransferCompensationStarted:
        await this.readModels.upsertTransferSummary({
          ...existing,
          status: TransferStatus.COMPENSATION_IN_PROGRESS,
          compensationTransactionId: event.data.transactionId as string,
          compensationAttempts: Number(event.data.compensationAttempts),
          updatedAt: event.occurredAt,
        });
        return;
      case TransferEventTypes.TransferCompensated:
        await this.readModels.upsertTransferSummary({
          ...existing,
          status: TransferStatus.COMPENSATED,
          updatedAt: event.occurredAt,
        });
        return;
      default:
        return;
    }
  }
}
