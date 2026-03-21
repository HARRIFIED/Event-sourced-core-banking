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

CREATE INDEX IF NOT EXISTS idx_snapshots_stream_id_version ON snapshots(stream_id, stream_version DESC);
