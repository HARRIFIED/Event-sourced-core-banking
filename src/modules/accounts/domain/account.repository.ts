import { Inject, Injectable } from '@nestjs/common';
import { EVENT_STORE, EventStore } from '../../../infrastructure/event-store/event-store.interface';
import { AccountAggregate } from './account.aggregate';

@Injectable()
export class AccountRepository {
  constructor(@Inject(EVENT_STORE) private readonly eventStore: EventStore) {}

  async getById(accountId: string): Promise<AccountAggregate> {
    const aggregate = new AccountAggregate();
    const events = await this.eventStore.readStream(`account-${accountId}`);
    aggregate.loadFromHistory(events);
    return aggregate;
  }

  async save(accountId: string, aggregate: AccountAggregate): Promise<void> {
    const events = aggregate.pullUncommittedEvents();
    if (events.length === 0) {
      return;
    }

    await this.eventStore.append(`account-${accountId}`, events, {
      expectedVersion: aggregate.version - events.length,
    });
  }
}
