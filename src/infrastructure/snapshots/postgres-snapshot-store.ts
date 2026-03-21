import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { Snapshot, SnapshotStore } from './snapshot-store.interface';

@Injectable()
export class PostgresSnapshotStore implements SnapshotStore {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  async getLatest<TState extends object = Record<string, unknown>>(
    streamId: string,
  ): Promise<Snapshot<TState> | null> {
    const result = await this.pool.query<{
      stream_id: string;
      stream_version: number;
      snapshot_data: TState;
      created_at: Date;
    }>(
      `SELECT stream_id, stream_version, snapshot_data, created_at
       FROM snapshots
       WHERE stream_id = $1
       ORDER BY stream_version DESC
       LIMIT 1`,
      [streamId],
    );

    const row = result.rows[0];
    if (!row) {
      return null;
    }

    return {
      streamId: row.stream_id,
      version: Number(row.stream_version),
      state: row.snapshot_data,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async save<TState extends object = Record<string, unknown>>(
    snapshot: Snapshot<TState>,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO snapshots (stream_id, stream_version, snapshot_data, created_at)
       VALUES ($1, $2, $3::jsonb, COALESCE($4::timestamptz, NOW()))
       ON CONFLICT (stream_id, stream_version) DO NOTHING`,
      [
        snapshot.streamId,
        snapshot.version,
        JSON.stringify(snapshot.state),
        snapshot.createdAt ?? null,
      ],
    );
  }
}
