import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { WrongExpectedVersionError } from '../infrastructure/event-store/event-store.interface';
import { InMemoryEventStore } from '../infrastructure/event-store/in-memory-event-store';
import { InMemoryOutboxStore } from '../infrastructure/outbox/in-memory-outbox-store';
import { InMemorySnapshotStore } from '../infrastructure/snapshots/in-memory-snapshot-store';
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

describe('Concurrency hardening', () => {
  it('all concurrent writes for the same account succeed without conflicts', async () => {
    const { repository } = buildStack();
    const accountId = 'acc-concurrent';

    await repository.executeWithRetry(accountId, (acc) =>
      acc.create(accountId, 'owner-1', 'NGN', ctx()),
    );

    const depositCount = 10;
    await Promise.all(
      Array.from({ length: depositCount }, (_, i) =>
        repository.executeWithRetry(accountId, (acc) =>
          acc.deposit(100, 'NGN', `txn-${i}`, ctx()),
        ),
      ),
    );

    const loaded = await repository.getById(accountId);
    expect(loaded.balance).toBe(depositCount * 100);
    expect(loaded.version).toBe(depositCount + 1); // create + N deposits
  });

  it('retries and succeeds after a single WrongExpectedVersionError', async () => {
    const { repository, eventStore } = buildStack();
    const accountId = 'acc-retry';

    await repository.executeWithRetry(accountId, (acc) =>
      acc.create(accountId, 'owner-1', 'NGN', ctx()),
    );
    await repository.executeWithRetry(accountId, (acc) =>
      acc.deposit(1000, 'NGN', 'init', ctx()),
    );
    // account now at v2, balance 1000

    // Simulate a competing instance winning the first write attempt.
    // The mock fails on the first call then calls through on subsequent attempts.
    const original = eventStore.append.bind(eventStore);
    let appendCalls = 0;
    jest.spyOn(eventStore, 'append').mockImplementation(async (streamId, events, options) => {
      if (++appendCalls === 1) {
        throw new WrongExpectedVersionError(streamId, options.expectedVersion, options.expectedVersion + 1);
      }
      return original(streamId, events, options);
    });

    await repository.executeWithRetry(accountId, (acc) =>
      acc.deposit(500, 'NGN', 'txn-retry', ctx()),
    );

    expect(appendCalls).toBe(2);
    const loaded = await repository.getById(accountId);
    expect(loaded.balance).toBe(1500);
  });

  it('throws ConflictException only after all three write attempts are exhausted', async () => {
    const { repository, eventStore } = buildStack();
    const accountId = 'acc-exhausted';

    await repository.executeWithRetry(accountId, (acc) =>
      acc.create(accountId, 'owner-1', 'NGN', ctx()),
    );

    const appendMock = jest
      .spyOn(eventStore, 'append')
      .mockRejectedValue(new WrongExpectedVersionError('account-acc-exhausted', 1, 2));

    await expect(
      repository.executeWithRetry(accountId, (acc) =>
        acc.deposit(100, 'NGN', 'txn-fail', ctx()),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(appendMock).toHaveBeenCalledTimes(3);
  });

  it('domain errors propagate immediately without triggering a retry', async () => {
    const { repository, eventStore } = buildStack();
    const accountId = 'acc-domain-err';

    // Create with zero balance — any withdrawal is a domain error.
    await repository.executeWithRetry(accountId, (acc) =>
      acc.create(accountId, 'owner-1', 'NGN', ctx()),
    );

    const appendSpy = jest.spyOn(eventStore, 'append');

    await expect(
      repository.executeWithRetry(accountId, (acc) =>
        acc.withdraw(100, 'NGN', 'txn-bad', ctx()),
      ),
    ).rejects.toThrow('Insufficient funds');

    // The domain guard threw before save() was reached, so append was never called.
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it('concurrent writes to different accounts do not block each other', async () => {
    const { repository } = buildStack();
    const accountIds = ['acc-a', 'acc-b', 'acc-c', 'acc-d', 'acc-e'];

    await Promise.all(
      accountIds.map((id) =>
        repository.executeWithRetry(id, (acc) => acc.create(id, 'owner-1', 'NGN', ctx())),
      ),
    );

    await Promise.all(
      accountIds.map((id) =>
        repository.executeWithRetry(id, (acc) => acc.deposit(500, 'NGN', `txn-${id}`, ctx())),
      ),
    );

    const loaded = await Promise.all(accountIds.map((id) => repository.getById(id)));
    loaded.forEach((acc) => expect(acc.balance).toBe(500));
  });
});
