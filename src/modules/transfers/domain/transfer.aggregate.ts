import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AggregateRoot } from '../../../common/domain/aggregate-root';
import { CommandContext } from '../../../common/cqrs/command-context';
import { DomainEvent } from '../../../common/domain/domain-event';
import { formatMinorUnitsToMoney, parseMoneyToMinorUnits } from '../../../common/money/money';
import { TransferEventTypes } from '../application/events/transfer.events';
import { TransferStatus } from './transfer-status.enum';

export class TransferAggregate extends AggregateRoot {
  transferId!: string;
  sourceAccountId!: string;
  destinationAccountId!: string;
  amountMinorUnits = 0n;
  currency!: string;
  status?: TransferStatus;
  version = 0;
  failureReason?: string;
  failureStage?: 'DEBIT' | 'CREDIT';
  sourceDebitTransactionId?: string;
  destinationCreditTransactionId?: string;
  compensationTransactionId?: string;
  debitAttempts = 0;
  creditAttempts = 0;
  compensationAttempts = 0;
  createdAt?: string;
  updatedAt?: string;

  initiate(
    transferId: string,
    sourceAccountId: string,
    destinationAccountId: string,
    amount: number | string,
    currency: string,
    context: CommandContext,
  ): void {
    if (this.transferId) {
      throw new BadRequestException('Transfer already exists');
    }
    if (sourceAccountId === destinationAccountId) {
      throw new BadRequestException('Source and destination accounts must be different');
    }

    const amountMinorUnits = parseMoneyToMinorUnits(amount);
    if (amountMinorUnits <= 0n) {
      throw new BadRequestException('Transfer amount must be positive');
    }

    this.apply(
      this.makeEvent(
        TransferEventTypes.TransferInitiated,
        {
          transferId,
          sourceAccountId,
          destinationAccountId,
          amount: formatMinorUnitsToMoney(amountMinorUnits),
          currency,
        },
        context,
      ),
    );
  }

  startDebit(transactionId: string, context: CommandContext): void {
    if (![TransferStatus.INITIATED, TransferStatus.DEBIT_IN_PROGRESS].includes(this.status!)) {
      throw new BadRequestException(`Cannot start debit from status ${this.status ?? 'UNKNOWN'}`);
    }

    this.apply(
      this.makeEvent(
        TransferEventTypes.TransferDebitStarted,
        {
          transferId: this.transferId,
          transactionId,
          debitAttempts: this.debitAttempts + 1,
        },
        context,
      ),
    );
  }

  markDebited(context: CommandContext): void {
    if (this.status !== TransferStatus.DEBIT_IN_PROGRESS) {
      throw new BadRequestException(`Cannot mark transfer debited from status ${this.status ?? 'UNKNOWN'}`);
    }

    this.apply(
      this.makeEvent(
        TransferEventTypes.TransferDebited,
        {
          transferId: this.transferId,
          transactionId: this.sourceDebitTransactionId,
        },
        context,
      ),
    );
  }

  startCredit(transactionId: string, context: CommandContext): void {
    if (![TransferStatus.DEBITED, TransferStatus.CREDIT_IN_PROGRESS].includes(this.status!)) {
      throw new BadRequestException(`Cannot start credit from status ${this.status ?? 'UNKNOWN'}`);
    }

    this.apply(
      this.makeEvent(
        TransferEventTypes.TransferCreditStarted,
        {
          transferId: this.transferId,
          transactionId,
          creditAttempts: this.creditAttempts + 1,
        },
        context,
      ),
    );
  }

  complete(context: CommandContext): void {
    if (this.status !== TransferStatus.CREDIT_IN_PROGRESS) {
      throw new BadRequestException(`Cannot complete transfer from status ${this.status ?? 'UNKNOWN'}`);
    }

    this.apply(
      this.makeEvent(
        TransferEventTypes.TransferCompleted,
        {
          transferId: this.transferId,
        },
        context,
      ),
    );
  }

  fail(reason: string, stage: 'DEBIT' | 'CREDIT', context: CommandContext): void {
    if (![TransferStatus.DEBIT_IN_PROGRESS, TransferStatus.CREDIT_IN_PROGRESS].includes(this.status!)) {
      throw new BadRequestException(`Cannot fail transfer from status ${this.status ?? 'UNKNOWN'}`);
    }
    if (!reason) {
      throw new BadRequestException('Failure reason is required');
    }

    this.apply(
      this.makeEvent(
        TransferEventTypes.TransferFailed,
        {
          transferId: this.transferId,
          reason,
          stage,
        },
        context,
      ),
    );
  }

  startCompensation(transactionId: string, context: CommandContext): void {
    if (![TransferStatus.FAILED, TransferStatus.COMPENSATION_IN_PROGRESS].includes(this.status!)) {
      throw new BadRequestException(`Cannot start compensation from status ${this.status ?? 'UNKNOWN'}`);
    }
    if (this.failureStage !== 'CREDIT') {
      throw new BadRequestException('Compensation is only allowed after a debited transfer fails during credit');
    }

    this.apply(
      this.makeEvent(
        TransferEventTypes.TransferCompensationStarted,
        {
          transferId: this.transferId,
          transactionId,
          compensationAttempts: this.compensationAttempts + 1,
        },
        context,
      ),
    );
  }

  markCompensated(context: CommandContext): void {
    if (this.status !== TransferStatus.COMPENSATION_IN_PROGRESS) {
      throw new BadRequestException(`Cannot mark transfer compensated from status ${this.status ?? 'UNKNOWN'}`);
    }

    this.apply(
      this.makeEvent(
        TransferEventTypes.TransferCompensated,
        {
          transferId: this.transferId,
          transactionId: this.compensationTransactionId,
        },
        context,
      ),
    );
  }

  protected when(event: DomainEvent): void {
    this.version = event.streamVersion;
    this.updatedAt = event.occurredAt;

    switch (event.eventType) {
      case TransferEventTypes.TransferInitiated:
        this.transferId = event.data.transferId as string;
        this.sourceAccountId = event.data.sourceAccountId as string;
        this.destinationAccountId = event.data.destinationAccountId as string;
        this.amountMinorUnits = parseMoneyToMinorUnits(event.data.amount as string);
        this.currency = event.data.currency as string;
        this.status = TransferStatus.INITIATED;
        this.createdAt = event.occurredAt;
        this.failureReason = undefined;
        this.failureStage = undefined;
        break;
      case TransferEventTypes.TransferDebitStarted:
        this.status = TransferStatus.DEBIT_IN_PROGRESS;
        this.sourceDebitTransactionId = event.data.transactionId as string;
        this.debitAttempts = Number(event.data.debitAttempts);
        this.failureReason = undefined;
        this.failureStage = undefined;
        break;
      case TransferEventTypes.TransferDebited:
        this.status = TransferStatus.DEBITED;
        break;
      case TransferEventTypes.TransferCreditStarted:
        this.status = TransferStatus.CREDIT_IN_PROGRESS;
        this.destinationCreditTransactionId = event.data.transactionId as string;
        this.creditAttempts = Number(event.data.creditAttempts);
        this.failureReason = undefined;
        this.failureStage = undefined;
        break;
      case TransferEventTypes.TransferCompleted:
        this.status = TransferStatus.COMPLETED;
        break;
      case TransferEventTypes.TransferFailed:
        this.status = TransferStatus.FAILED;
        this.failureReason = event.data.reason as string;
        this.failureStage = event.data.stage as 'DEBIT' | 'CREDIT';
        break;
      case TransferEventTypes.TransferCompensationStarted:
        this.status = TransferStatus.COMPENSATION_IN_PROGRESS;
        this.compensationTransactionId = event.data.transactionId as string;
        this.compensationAttempts = Number(event.data.compensationAttempts);
        break;
      case TransferEventTypes.TransferCompensated:
        this.status = TransferStatus.COMPENSATED;
        break;
      default:
        break;
    }
  }

  private makeEvent(
    eventType: string,
    data: Record<string, unknown>,
    context: CommandContext,
  ): DomainEvent {
    return {
      eventId: randomUUID(),
      streamId: `transfer-${this.transferId || data.transferId}`,
      streamVersion: this.version + 1,
      eventType,
      occurredAt: new Date().toISOString(),
      data,
      metadata: {
        correlationId: context.correlationId,
        causationId: context.causationId,
        commandId: context.commandId,
        actor: context.actor,
        traceId: context.traceId,
      },
    };
  }
}
