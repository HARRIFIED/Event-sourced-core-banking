import { SqlMigration } from './migration.interface';

export const schemaMigrations: SqlMigration[] = [
  {
    version: 1,
    name: 'create-core-event-store-schema',
    sql: `
      CREATE TABLE IF NOT EXISTS events (
        id BIGSERIAL PRIMARY KEY,
        event_id UUID NOT NULL UNIQUE,
        stream_id VARCHAR(255) NOT NULL,
        stream_version INT NOT NULL,
        event_type VARCHAR(255) NOT NULL,
        event_data JSONB NOT NULL,
        event_metadata JSONB NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(stream_id, stream_version)
      );

      CREATE INDEX IF NOT EXISTS idx_events_stream_id_version ON events(stream_id, stream_version);
      CREATE INDEX IF NOT EXISTS idx_events_recorded_at ON events(recorded_at);

      CREATE TABLE IF NOT EXISTS snapshots (
        id BIGSERIAL PRIMARY KEY,
        stream_id VARCHAR(255) NOT NULL,
        stream_version INT NOT NULL,
        snapshot_data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(stream_id, stream_version)
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_stream_id_version
        ON snapshots(stream_id, stream_version DESC);

      CREATE TABLE IF NOT EXISTS account_summary (
        account_id VARCHAR(255) PRIMARY KEY,
        owner_id VARCHAR(255) NOT NULL,
        currency VARCHAR(16) NOT NULL,
        status VARCHAR(32) NOT NULL,
        balance NUMERIC(19, 2) NOT NULL,
        version INT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );

      CREATE TABLE IF NOT EXISTS account_statement (
        event_id UUID PRIMARY KEY,
        account_id VARCHAR(255) NOT NULL,
        stream_version INT NOT NULL,
        event_type VARCHAR(255) NOT NULL,
        amount NUMERIC(19, 2),
        currency VARCHAR(16),
        transaction_id VARCHAR(255),
        reason TEXT,
        occurred_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_account_statement_account_id_version
        ON account_statement(account_id, stream_version);

      CREATE TABLE IF NOT EXISTS projection_checkpoints (
        projection_name VARCHAR(255) PRIMARY KEY,
        position BIGINT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    version: 2,
    name: 'create-outbox-events-table',
    sql: `
      CREATE TABLE IF NOT EXISTS outbox_events (
        id UUID PRIMARY KEY,
        topic VARCHAR(255) NOT NULL,
        message_key VARCHAR(255) NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        published_at TIMESTAMPTZ NULL,
        attempts INT NOT NULL DEFAULT 0,
        last_error TEXT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_outbox_events_pending_created_at
        ON outbox_events(published_at, created_at);
    `,
  },
  {
    version: 3,
    name: 'add-outbox-processing-lock-columns',
    sql: `
      ALTER TABLE outbox_events
      ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ NULL;

      CREATE INDEX IF NOT EXISTS idx_outbox_events_processing_started_at
        ON outbox_events(processing_started_at);
    `,
  },
  {
    version: 4,
    name: 'enforce-account-statement-stream-version-uniqueness',
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS uq_account_statement_account_version
        ON account_statement(account_id, stream_version);
    `,
  },
];
