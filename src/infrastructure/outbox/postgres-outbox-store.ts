import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { OutboxMessage, OutboxStore, PendingOutboxMessage } from './outbox-store.interface';

@Injectable()
export class PostgresOutboxStore implements OutboxStore {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  async stage(messages: OutboxMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const message of messages) {
        await client.query(
          `INSERT INTO outbox_events (
             id, topic, message_key, payload, created_at, attempts, published_at, last_error
           ) VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, $6, $7::timestamptz, $8)
           ON CONFLICT (id) DO NOTHING`,
          [
            message.id,
            message.topic,
            message.messageKey,
            JSON.stringify(message.payload),
            message.createdAt,
            message.attempts,
            message.publishedAt ?? null,
            message.lastError ?? null,
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

  async claimPending(limit = 100): Promise<PendingOutboxMessage[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query<{
        id: string;
        topic: string;
        message_key: string;
        payload: object;
        created_at: Date;
        published_at: Date | null;
        attempts: number;
        last_error: string | null;
      }>(
        `WITH next_batch AS (
           SELECT id
           FROM outbox_events
           WHERE published_at IS NULL
             AND processing_started_at IS NULL
           ORDER BY created_at ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         UPDATE outbox_events AS target
         SET processing_started_at = NOW()
         FROM next_batch
         WHERE target.id = next_batch.id
         RETURNING target.id, target.topic, target.message_key, target.payload,
                   target.created_at, target.published_at, target.attempts, target.last_error`,
        [limit],
      );

      await client.query('COMMIT');

      return result.rows.map((row) => ({
        id: row.id,
        topic: row.topic,
        messageKey: row.message_key,
        payload: row.payload,
        createdAt: new Date(row.created_at).toISOString(),
        publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
        attempts: Number(row.attempts),
        lastError: row.last_error,
      }));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async markPublished(id: string, publishedAt = new Date().toISOString()): Promise<void> {
    await this.pool.query(
      `UPDATE outbox_events
       SET published_at = $2::timestamptz,
           processing_started_at = NULL,
           last_error = NULL
       WHERE id = $1`,
      [id, publishedAt],
    );
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE outbox_events
       SET attempts = attempts + 1,
           processing_started_at = NULL,
           last_error = $2
       WHERE id = $1`,
      [id, error],
    );
  }
}
