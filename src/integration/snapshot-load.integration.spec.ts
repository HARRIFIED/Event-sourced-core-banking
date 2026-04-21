import { randomUUID } from 'crypto';
import { InMemoryEventStore } from '../infrastructure/event-store/in-memory-event-store';
import { InMemoryOutboxStore } from '../infrastructure/outbox/in-memory-outbox-store';
import { InMemorySnapshotStore } from '../infrastructure/snapshots/in-memory-snapshot-store';
import { AccountRepository } from '../modules/accounts/domain/account.repository';

// Must match SNAPSHOT_INTERVAL in account.repository.ts
const SNAPSHOT_INTERVAL = 50;

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

/**
 * Seed an account up to the given version.
 * version=1  → create only
 * version=N  → create + (N-1) deposits of 100 NGN each
 */
async function seedToVersion(
  repository: AccountRepository,
  accountId: string,
  version: number,
): Promise<void> {
  const c = ctx();
  await repository.executeWithRetry(accountId, (acc) =>
    acc.create(accountId, 'owner-1', 'NGN', c),
  );
  for (let i = 1; i < version; i++) {
    await repository.executeWithRetry(accountId, (acc) =>
      acc.deposit(100, 'NGN', `txn-${i}`, { commandId: randomUUID(), correlationId: randomUUID() }),
    );
  }
}

describe('Snapshot load path', () => {
  it('reads only the tail of the stream after the snapshot version on load', async () => {
    const { repository, eventStore, snapshotStore } = buildStack();
    const accountId = 'acc-snap-load';

    // Reach the first snapshot boundary: create + 49 deposits = v50.
    await seedToVersion(repository, accountId, SNAPSHOT_INTERVAL);

    // Confirm the snapshot was auto-saved by the repository after crossing v50.
    const snapshot = await snapshotStore.getLatest(`account-${accountId}`);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.version).toBe(SNAPSHOT_INTERVAL);

    // Add one more deposit after the snapshot so there is a tail to replay.
    await repository.executeWithRetry(accountId, (acc) =>
      acc.deposit(100, 'NGN', 'txn-tail', ctx()),
    );

    // Spy on readStream to confirm the snapshot version is used as the starting point.
    const readStreamSpy = jest.spyOn(eventStore, 'readStream');
    const loaded = await repository.getById(accountId);

    expect(readStreamSpy).toHaveBeenCalledWith(
      `account-${accountId}`,
      SNAPSHOT_INTERVAL, // fromVersion matches the saved snapshot version
    );
    expect(loaded.version).toBe(SNAPSHOT_INTERVAL + 1);
    // 49 deposits of 100 + 1 tail deposit = 50 deposits total
    expect(loaded.balance).toBe(SNAPSHOT_INTERVAL * 100);
  });

  it('saves a snapshot when the stream crosses the snapshot boundary', async () => {
    const { repository, snapshotStore } = buildStack();
    const accountId = 'acc-snap-save';

    const saveSpy = jest.spyOn(snapshotStore, 'save');

    // One event short of the boundary: create + 48 deposits = v49.
    await seedToVersion(repository, accountId, SNAPSHOT_INTERVAL - 1);
    expect(saveSpy).not.toHaveBeenCalled();

    // The next deposit crosses v50, triggering a snapshot save.
    await repository.executeWithRetry(accountId, (acc) =>
      acc.deposit(100, 'NGN', 'txn-boundary', ctx()),
    );

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        streamId: `account-${accountId}`,
        version: SNAPSHOT_INTERVAL,
      }),
    );
  });

  it('does not save a snapshot before reaching the boundary', async () => {
    const { repository, snapshotStore } = buildStack();
    const accountId = 'acc-no-snap';

    const saveSpy = jest.spyOn(snapshotStore, 'save');

    // Stay one below the boundary.
    await seedToVersion(repository, accountId, SNAPSHOT_INTERVAL - 1);

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('aggregate state from snapshot load matches state from full event replay', async () => {
    const { repository, eventStore, snapshotStore } = buildStack();
    const accountId = 'acc-state-match';

    // Reach v50 (snapshot saved) then add a few more events.
    await seedToVersion(repository, accountId, SNAPSHOT_INTERVAL);
    const c = ctx();
    await repository.executeWithRetry(accountId, (acc) => acc.deposit(200, 'NGN', 'extra-1', c));
    await repository.executeWithRetry(accountId, (acc) => acc.deposit(300, 'NGN', 'extra-2', c));

    // Load with snapshot (normal path).
    const fromSnapshot = await repository.getById(accountId);

    // Simulate a cold-start load with no snapshot by wiping the snapshot store and
    // replaying from the raw event stream.
    jest.spyOn(snapshotStore, 'getLatest').mockResolvedValue(null);
    const fromFullReplay = await repository.getById(accountId);

    expect(fromSnapshot.balance).toBe(fromFullReplay.balance);
    expect(fromSnapshot.version).toBe(fromFullReplay.version);
    expect(fromSnapshot.status).toBe(fromFullReplay.status);
    expect(fromSnapshot.accountId).toBe(fromFullReplay.accountId);
    expect(fromSnapshot.currency).toBe(fromFullReplay.currency);
  });
});
