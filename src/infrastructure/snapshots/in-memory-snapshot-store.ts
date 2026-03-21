import { Injectable } from '@nestjs/common';
import { Snapshot, SnapshotStore } from './snapshot-store.interface';

@Injectable()
export class InMemorySnapshotStore implements SnapshotStore {
  private readonly snapshots = new Map<string, Snapshot<object>>();

  async getLatest<TState extends object = Record<string, unknown>>(
    streamId: string,
  ): Promise<Snapshot<TState> | null> {
    return (this.snapshots.get(streamId) as Snapshot<TState> | undefined) ?? null;
  }

  async save<TState extends object = Record<string, unknown>>(
    snapshot: Snapshot<TState>,
  ): Promise<void> {
    const current = await this.getLatest<TState>(snapshot.streamId);
    if (current && current.version >= snapshot.version) {
      return;
    }

    this.snapshots.set(snapshot.streamId, {
      ...snapshot,
      createdAt: snapshot.createdAt ?? new Date().toISOString(),
    });
  }
}
