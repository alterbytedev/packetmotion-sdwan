CREATE TABLE runtime_errors (
  reference_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  route_path TEXT,
  method TEXT,
  error_name TEXT NOT NULL,
  error_code TEXT,
  message TEXT NOT NULL,
  stack TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  occurrence_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX runtime_errors_last_seen_idx ON runtime_errors (last_seen_at DESC);
