export interface Snapshot<TState extends object = Record<string, unknown>> {
  streamId: string;
  version: number;
  state: TState;
  createdAt?: string;
}

export interface SnapshotStore {
  getLatest<TState extends object = Record<string, unknown>>(
    streamId: string,
  ): Promise<Snapshot<TState> | null>;
  save<TState extends object = Record<string, unknown>>(
    snapshot: Snapshot<TState>,
  ): Promise<void>;
}

export const SNAPSHOT_STORE = Symbol('SNAPSHOT_STORE');
