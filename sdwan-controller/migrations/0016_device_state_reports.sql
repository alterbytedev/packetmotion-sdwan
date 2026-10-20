CREATE TABLE device_state_reports (
  node_id UUID PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'unsupported', 'unavailable')),
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  report JSONB,
  CHECK ((status = 'completed') = (report IS NOT NULL))
);

CREATE INDEX device_state_reports_expiry ON device_state_reports(expires_at);
