import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { EVENT_STORE, EventStore, WrongExpectedVersionError } from '../../../infrastructure/event-store/event-store.interface';
import { SNAPSHOT_STORE, SnapshotStore } from '../../../infrastructure/snapshots/snapshot-store.interface';
import { AccountAggregate, AccountSnapshotState } from './account.aggregate';

const SNAPSHOT_INTERVAL = 50;
const MAX_WRITE_ATTEMPTS = 3;

@Injectable()
export class AccountRepository {
  /**
   * Per-account mutex using promise chaining.
   *
   * Each entry holds the promise of the currently-running (or last-queued) operation for that
   * account. A new waiter chains onto that promise, so operations for the same account execute
   * one at a time inside this process. The entry is removed once the last queued operation
   * completes, keeping the map bounded by accounts with in-flight requests rather than total
   * account count.
   *
   * This eliminates optimistic-lock conflicts for concurrent requests within the same process.
   * The retry loop in executeWithRetry handles the residual cross-instance case.
   */
  private readonly accountLocks = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    @Inject(SNAPSHOT_STORE) private readonly snapshotStore: SnapshotStore,
  ) {}

  /**
   * Get an account aggregate by ID, reconstructing its state from the latest snapshot (if available)
   * and subsequent events.
   */
  async getById(accountId: string): Promise<AccountAggregate> {
    const streamId = `account-${accountId}`;
    const aggregate = new AccountAggregate();

    const snapshot = await this.snapshotStore.getLatest<AccountSnapshotState>(streamId);
    if (snapshot) {
      aggregate.restoreSnapshot(snapshot.state, snapshot.version);
    }

    const events = await this.eventStore.readStream(streamId, snapshot?.version ?? 0);
    // Replay the remaining stream tail after the latest snapshot, if one exists.
    aggregate.loadFromHistory(events);
    return aggregate;
  }

  /**
   * Execute a domain operation on an account with automatic retry on write conflicts.
   *
   * By the time a command reaches here it has already passed idempotency and transaction-registry
   * checks, so two requests that arrive concurrently are genuinely distinct operations. If the first
   * writer commits and bumps the stream version, the second writer should re-read the latest state
   * and re-apply its operation rather than failing with a 409 that leaks infrastructure noise to the
   * client.
   *
   * The per-account mutex ensures in-process requests are serialised before they reach the DB,
   * so conflicts only occur across separate instances. The retry loop handles that residual case.
   *
   * Only WrongExpectedVersionError triggers a retry. Domain errors (insufficient funds, frozen
   * account, etc.) propagate immediately — they are not race conditions.
   */
  async executeWithRetry(
    accountId: string,
    operation: (account: AccountAggregate) => void,
  ): Promise<void> {
    await this.withAccountLock(accountId, async () => {
      for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
        try {
          const account = await this.getById(accountId);
          operation(account);
          await this.save(accountId, account);
          return;
        } catch (error) {
          if (error instanceof WrongExpectedVersionError && attempt < MAX_WRITE_ATTEMPTS) {
            // Another instance committed between our read and write. Wait a short random
            // interval to spread out retries, then re-read.
            await new Promise<void>((r) => setTimeout(r, Math.random() * 30));
            continue;
          }

          if (error instanceof WrongExpectedVersionError) {
            throw new ConflictException(
              `Concurrent modification detected for account ${accountId}. All ${MAX_WRITE_ATTEMPTS} write attempts failed.`,
            );
          }

          throw error;
        }
      }
    });
  }

  /**
   * Acquire a per-account in-process lock before running fn.
   *
   * New waiters chain onto the previous lock promise for that accountId. When the previous
   * holder resolves, the next waiter runs. The map entry is deleted by whichever waiter was
   * last to register, keeping memory bounded to accounts with active in-flight requests.
   */
  private async withAccountLock<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.accountLocks.get(accountId) ?? Promise.resolve();

    let release!: () => void;
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.accountLocks.set(accountId, lock);

    try {
      await prev;
      return await fn();
    } finally {
      release();
      if (this.accountLocks.get(accountId) === lock) {
        this.accountLocks.delete(accountId);
      }
    }
  }

  async save(accountId: string, aggregate: AccountAggregate): Promise<void> {
    const streamId = `account-${accountId}`;
    const events = aggregate.pullUncommittedEvents();
    if (events.length === 0) {
      return;
    }

    const expectedVersion = aggregate.version - events.length;

    await this.eventStore.append(streamId, events, { expectedVersion });

    const previousSnapshotBoundary = Math.floor(expectedVersion / SNAPSHOT_INTERVAL);
    const currentSnapshotBoundary = Math.floor(aggregate.version / SNAPSHOT_INTERVAL);
    // Only save a new snapshot if we've crossed a snapshot boundary since the last one.
    if (currentSnapshotBoundary > previousSnapshotBoundary) {
      await this.snapshotStore.save({
        streamId,
        version: aggregate.version,
        state: aggregate.getSnapshotState(),
      });
    }
  }
}
