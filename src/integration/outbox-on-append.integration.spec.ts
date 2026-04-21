import { randomUUID } from 'crypto';
import { WrongExpectedVersionError } from '../infrastructure/event-store/event-store.interface';
import { InMemoryEventStore } from '../infrastructure/event-store/in-memory-event-store';
import { InMemoryOutboxStore } from '../infrastructure/outbox/in-memory-outbox-store';
import { InMemorySnapshotStore } from '../infrastructure/snapshots/in-memory-snapshot-store';
import { AccountEventTypes } from '../modules/accounts/application/events/account.events';
import { AccountRepository } from '../modules/accounts/domain/account.repository';

function buildStack() {
  const outboxStore = new InMemoryOutboxStore();
  const eventStore = new InMemoryEventStore(outboxStore);
  const snapshotStore = new InMemorySnapshotStore();
  const repository = new AccountRepository(eventStore, snapshotStore);
  return { outboxStore, eventStore, snapshotStore, repository };
}

function ctx() {
  return { commandId: randomUUID(), correlationId: randomUUID() };
}

describe('Outbox row creation on append', () => {
  it('stages exactly one outbox row when a single event is appended', async () => {
    const { outboxStore, repository } = buildStack();
    const accountId = 'acc-outbox-one';

    await repository.executeWithRetry(accountId, (acc) =>
      acc.create(accountId, 'owner-1', 'NGN', ctx()),
    );

    const pending = await outboxStore.claimPending(100);
    expect(pending).toHaveLength(1);
  });

  it('stages outbox rows with the correct topic, message key, and event payload', async () => {
    const { outboxStore, repository } = buildStack();
    const accountId = 'acc-outbox-fields';
    const streamId = `account-${accountId}`;

    await repository.executeWithRetry(accountId, (acc) =>
      acc.create(accountId, 'owner-1', 'NGN', ctx()),
    );

    const [message] = await outboxStore.claimPending(100);

    expect(message.topic).toBe('account-events');
    expect(message.messageKey).toBe(streamId);

    const event = message.payload as Record<string, unknown>;
    expect(event.eventType).toBe(AccountEventTypes.AccountCreated);
    expect(event.streamId).toBe(streamId);
    expect(event.streamVersion).toBe(1);
  });

  it('does not stage an outbox row when the version check fails', async () => {
    const { outboxStore, repository } = buildStack();
    const accountId = 'acc-outbox-atomic';

    // Create the account — advances stream to v1.
    await repository.executeWithRetry(accountId, (acc) =>
      acc.create(accountId, 'owner-1', 'NGN', ctx()),
    );

    // Load a stale view of the account and queue a deposit on it.
    const staleAggregate = await repository.getById(accountId);
    staleAggregate.deposit(100, 'NGN', 'txn-stale', ctx());

    // A competing writer advances the stream to v2 before the stale save.
    await repository.executeWithRetry(accountId, (acc) =>
      acc.deposit(200, 'NGN', 'txn-winner', ctx()),
    );

    // Capture the stage call count after the legitimate writes above.
    const stageSpy = jest.spyOn(outboxStore, 'stage');

    // The stale save should fail the version check and must not stage any outbox row.
    await expect(repository.save(accountId, staleAggregate)).rejects.toBeInstanceOf(
      WrongExpectedVersionError,
    );

    expect(stageSpy).not.toHaveBeenCalled();
  });

  it('stages one outbox row per event when multiple events are appended in one call', async () => {
    const { outboxStore, eventStore } = buildStack();
    const streamId = 'account-acc-multi';
    const now = new Date().toISOString();

    // Append two events in a single call, bypassing the aggregate, to exercise multi-event staging.
    await eventStore.append(
      streamId,
      [
        {
          eventId: randomUUID(),
          streamId,
          streamVersion: 1,
          eventType: AccountEventTypes.AccountCreated,
          data: { accountId: 'acc-multi', ownerId: 'owner-1', currency: 'NGN' },
          metadata: { commandId: randomUUID(), correlationId: randomUUID() },
          occurredAt: now,
        },
        {
          eventId: randomUUID(),
          streamId,
          streamVersion: 2,
          eventType: AccountEventTypes.MoneyDeposited,
          data: { accountId: 'acc-multi', amount: '100.00', currency: 'NGN', transactionId: 'txn-1' },
          metadata: { commandId: randomUUID(), correlationId: randomUUID() },
          occurredAt: now,
        },
      ],
      { expectedVersion: 0 },
    );

    const pending = await outboxStore.claimPending(100);
    expect(pending).toHaveLength(2);
    expect(pending[0].payload).toMatchObject({ eventType: AccountEventTypes.AccountCreated });
    expect(pending[1].payload).toMatchObject({ eventType: AccountEventTypes.MoneyDeposited });
  });

  it('staging the same event id twice is idempotent', async () => {
    const { outboxStore } = buildStack();
    const eventId = randomUUID();
    const message = {
      id: eventId,
      topic: 'account-events',
      messageKey: 'account-acc-idem',
      payload: { eventId },
      createdAt: new Date().toISOString(),
      attempts: 0,
      publishedAt: null as null,
      lastError: null as null,
    };

    await outboxStore.stage([message]);
    await outboxStore.stage([message]); // duplicate — should be a no-op

    const pending = await outboxStore.claimPending(100);
    expect(pending).toHaveLength(1);
  });
});
