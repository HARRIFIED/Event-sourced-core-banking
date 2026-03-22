import { randomUUID } from 'crypto';
import { AggregateRoot } from '../../../common/domain/aggregate-root';
import { CommandContext } from '../../../common/cqrs/command-context';
import { DomainEvent } from '../../../common/domain/domain-event';
import { AccountEventTypes } from '../application/events/account.events';
import { BadRequestException } from '@nestjs/common';

export interface AccountSnapshotState {
  accountId: string;
  ownerId: string;
  currency: string;
  status: 'ACTIVE' | 'FROZEN';
  balance: number;
}
export class AccountAggregate extends AggregateRoot {
  //current account state
  accountId!: string;
  ownerId!: string;
  currency!: string;
  status: 'ACTIVE' | 'FROZEN' = 'ACTIVE';
  balance = 0;
  version = 0;

  create(accountId: string, ownerId: string, currency: string, context: CommandContext): void {
    if (this.accountId) {
      throw new BadRequestException('Account already exists');
    }

    this.apply(
      this.makeEvent(AccountEventTypes.AccountCreated, {
        accountId,
        ownerId,
        currency,
      }, context, `account-${accountId}`),
    );
  }

  deposit(amount: number, currency: string, transactionId: string, context: CommandContext): void {
    this.ensureActive();
    this.ensureCurrency(currency);
    if (amount <= 0) throw new BadRequestException('Deposit amount must be positive');

    this.apply(
      this.makeEvent(AccountEventTypes.MoneyDeposited, {
        accountId: this.accountId,
        amount,
        currency,
        transactionId,
      }, context, `account-${this.accountId}`),
    );
  }

  withdraw(amount: number, currency: string, transactionId: string, context: CommandContext): void {
    this.ensureActive();
    this.ensureCurrency(currency);
    if (amount <= 0) throw new BadRequestException('Withdraw amount must be positive');
    if (this.balance < amount) throw new BadRequestException('Insufficient funds');

    this.apply(
      this.makeEvent(AccountEventTypes.MoneyWithdrawn, {
        accountId: this.accountId,
        amount,
        currency,
        transactionId,
      }, context, `account-${this.accountId}`),
    );
  }

  freeze(reason: string, context: CommandContext): void {
    if (!reason) throw new BadRequestException('Freeze reason is required');
    if (this.status === 'FROZEN') throw new BadRequestException('Account already frozen');

    this.apply(
      this.makeEvent(AccountEventTypes.AccountFrozen, {
        accountId: this.accountId,
        reason,
      }, context, `account-${this.accountId}`),
    );
  }

  getSnapshotState(): AccountSnapshotState {
    return {
      accountId: this.accountId,
      ownerId: this.ownerId,
      currency: this.currency,
      status: this.status,
      balance: this.balance,
    };
  }

  restoreSnapshot(state: AccountSnapshotState, version: number): void {
    this.accountId = state.accountId;
    this.ownerId = state.ownerId;
    this.currency = state.currency;
    this.status = state.status;
    this.balance = state.balance;
    this.version = version;
  }
  
  protected when(event: DomainEvent): void {
    this.version = event.streamVersion;

    switch (event.eventType) {
      case AccountEventTypes.AccountCreated:
        this.accountId = event.data.accountId as string;
        this.ownerId = event.data.ownerId as string;
        this.currency = event.data.currency as string;
        this.status = 'ACTIVE';
        break;
      case AccountEventTypes.MoneyDeposited:
        this.balance += Number(event.data.amount);
        break;
      case AccountEventTypes.MoneyWithdrawn:
        this.balance -= Number(event.data.amount);
        break;
      case AccountEventTypes.AccountFrozen:
        this.status = 'FROZEN';
        break;
      default:
        break;
    }
  }

  private ensureCurrency(currency: string): void {
    if (this.currency !== currency) {
      throw new BadRequestException(`Currency mismatch. Account currency=${this.currency}, request=${currency}`);
    }
  }

  private ensureActive(): void {
    if (this.status !== 'ACTIVE') {
      throw new BadRequestException('Account is not active');
    }
  }

  private makeEvent(
    eventType: string,
    data: Record<string, unknown>,
    context: CommandContext,
    streamId: string,
  ): DomainEvent {
    return {
      eventId: randomUUID(),
      streamId,
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
