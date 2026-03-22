import { Inject, Injectable } from '@nestjs/common';
import { DomainEvent } from '../../../common/domain/domain-event';
import { AccountEventTypes } from '../application/events/account.events';
import {
  ACCOUNT_READ_MODEL_REPOSITORY,
  AccountReadModelRepository,
  AccountSummaryReadModel,
} from './account-read-model.repository';

@Injectable()
export class AccountProjector {
  constructor(
    @Inject(ACCOUNT_READ_MODEL_REPOSITORY)
    private readonly readModels: AccountReadModelRepository,
  ) {}

  async project(event: DomainEvent & { position: number }): Promise<boolean> {
    switch (event.eventType) {
      case AccountEventTypes.AccountCreated:
        await this.projectAccountCreated(event);
        return true;
      case AccountEventTypes.MoneyDeposited:
        await this.projectMoneyDeposited(event);
        return true;
      case AccountEventTypes.MoneyWithdrawn:
        await this.projectMoneyWithdrawn(event);
        return true;
      case AccountEventTypes.AccountFrozen:
        await this.projectAccountFrozen(event);
        return true;
      default:
        return false;
    }
  }

  private async projectAccountCreated(event: DomainEvent & { position: number }): Promise<void> {
    const accountId = event.data.accountId as string;
    const occurredAt = event.occurredAt;
    const existing = await this.readModels.getAccountSummary(accountId);
    if (existing && existing.version >= event.streamVersion) {
      return;
    }

    await this.readModels.upsertAccountSummary({
      accountId,
      ownerId: event.data.ownerId as string,
      currency: event.data.currency as string,
      status: 'ACTIVE',
      balance: 0,
      version: event.streamVersion,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });

    await this.readModels.appendAccountStatement({
      eventId: event.eventId,
      accountId,
      streamVersion: event.streamVersion,
      eventType: event.eventType,
      occurredAt,
    });
  }

  private async projectMoneyDeposited(event: DomainEvent & { position: number }): Promise<void> {
    const accountId = event.data.accountId as string;
    const summary = await this.getRequiredSummary(accountId);
    if (summary.version >= event.streamVersion) {
      return;
    }

    const amount = Number(event.data.amount);

    await this.readModels.upsertAccountSummary({
      ...summary,
      balance: summary.balance + amount,
      version: event.streamVersion,
      updatedAt: event.occurredAt,
    });

    await this.readModels.appendAccountStatement({
      eventId: event.eventId,
      accountId,
      streamVersion: event.streamVersion,
      eventType: event.eventType,
      amount,
      currency: event.data.currency as string,
      transactionId: event.data.transactionId as string,
      occurredAt: event.occurredAt,
    });
  }

  private async projectMoneyWithdrawn(event: DomainEvent & { position: number }): Promise<void> {
    const accountId = event.data.accountId as string;
    const summary = await this.getRequiredSummary(accountId);
    if (summary.version >= event.streamVersion) {
      return;
    }

    const amount = Number(event.data.amount);

    await this.readModels.upsertAccountSummary({
      ...summary,
      balance: summary.balance - amount,
      version: event.streamVersion,
      updatedAt: event.occurredAt,
    });

    await this.readModels.appendAccountStatement({
      eventId: event.eventId,
      accountId,
      streamVersion: event.streamVersion,
      eventType: event.eventType,
      amount,
      currency: event.data.currency as string,
      transactionId: event.data.transactionId as string,
      occurredAt: event.occurredAt,
    });
  }

  private async projectAccountFrozen(event: DomainEvent & { position: number }): Promise<void> {
    const accountId = event.data.accountId as string;
    const summary = await this.getRequiredSummary(accountId);
    if (summary.version >= event.streamVersion) {
      return;
    }

    await this.readModels.upsertAccountSummary({
      ...summary,
      status: 'FROZEN',
      version: event.streamVersion,
      updatedAt: event.occurredAt,
    });

    await this.readModels.appendAccountStatement({
      eventId: event.eventId,
      accountId,
      streamVersion: event.streamVersion,
      eventType: event.eventType,
      reason: event.data.reason as string,
      occurredAt: event.occurredAt,
    });
  }

  private async getRequiredSummary(accountId: string): Promise<AccountSummaryReadModel> {
    const summary = await this.readModels.getAccountSummary(accountId);
    if (!summary) {
      throw new Error(`Projection missing account summary for account ${accountId}`);
    }

    return summary;
  }
}
