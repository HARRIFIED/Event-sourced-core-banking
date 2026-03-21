import { Inject, Injectable } from '@nestjs/common';
import { EVENT_STORE, EventStore } from '../../../infrastructure/event-store/event-store.interface';
import { SNAPSHOT_STORE, SnapshotStore } from '../../../infrastructure/snapshots/snapshot-store.interface';
import { AccountAggregate, AccountSnapshotState } from './account.aggregate';

const SNAPSHOT_INTERVAL = 100;

@Injectable()
export class AccountRepository {
  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    @Inject(SNAPSHOT_STORE) private readonly snapshotStore: SnapshotStore,
  ) {}
  /**
   * Get an account aggregate by ID, reconstructing its state from the latest snapshot (if available)
   * and subsequent events.
   * @param accountId 
   * @returns 
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

  async save(accountId: string, aggregate: AccountAggregate): Promise<void> {
    const streamId = `account-${accountId}`;
    const events = aggregate.pullUncommittedEvents();
    if (events.length === 0) {
      return;
    }

    const expectedVersion = aggregate.version - events.length;

    await this.eventStore.append(streamId, events, {
      expectedVersion,
    });

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
