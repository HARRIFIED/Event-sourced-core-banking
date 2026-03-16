import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { DomainEvent } from '../../common/domain/domain-event';
import { AppendOptions, EventStore } from './event-store.interface';

@Injectable()
export class PostgresEventStore implements EventStore, OnModuleDestroy {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  async append(streamId: string, events: DomainEvent[], options: AppendOptions): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Serialize writers per stream inside the transaction.
      // This avoids invalid SQL patterns like FOR UPDATE with aggregate functions
      // while still providing safe optimistic concurrency checks.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [streamId]);

      const versionResult = await client.query<{ version: number }>(
        `SELECT COALESCE(MAX(stream_version), 0) as version FROM events WHERE stream_id = $1`,
        [streamId],
      );

      const currentVersion = Number(versionResult.rows[0]?.version ?? 0);
      if (currentVersion !== options.expectedVersion) {
        throw new Error(
          `WrongExpectedVersion for stream ${streamId}. Expected ${options.expectedVersion}, actual ${currentVersion}`,
        );
      }

      for (let i = 0; i < events.length; i += 1) {
        const event = events[i];
        await client.query(
          `INSERT INTO events (
            event_id, stream_id, stream_version, event_type, event_data, event_metadata, occurred_at
          ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::timestamptz)`,
          [
            event.eventId,
            streamId,
            currentVersion + i + 1,
            event.eventType,
            JSON.stringify(event.data),
            JSON.stringify(event.metadata),
            event.occurredAt,
          ],
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async readStream(streamId: string, fromVersion = 0): Promise<DomainEvent[]> {
    const result = await this.pool.query(
      `SELECT event_id, stream_id, stream_version, event_type, event_data, event_metadata, occurred_at
       FROM events
       WHERE stream_id = $1 AND stream_version > $2
       ORDER BY stream_version ASC`,
      [streamId, fromVersion],
    );

    return result.rows.map((row) => ({
      eventId: row.event_id,
      streamId: row.stream_id,
      streamVersion: row.stream_version,
      eventType: row.event_type,
      data: row.event_data,
      metadata: row.event_metadata,
      occurredAt: new Date(row.occurred_at).toISOString(),
    }));
  }

  async readAll(fromPosition = 0, maxCount = 1000): Promise<(DomainEvent & { position: number })[]> {
    const result = await this.pool.query(
      `SELECT id as position, event_id, stream_id, stream_version, event_type, event_data, event_metadata, occurred_at
       FROM events
       WHERE id > $1
       ORDER BY id ASC
       LIMIT $2`,
      [fromPosition, maxCount],
    );

    return result.rows.map((row) => ({
      position: Number(row.position),
      eventId: row.event_id,
      streamId: row.stream_id,
      streamVersion: row.stream_version,
      eventType: row.event_type,
      data: row.event_data,
      metadata: row.event_metadata,
      occurredAt: new Date(row.occurred_at).toISOString(),
    }));
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
