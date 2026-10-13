ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN ('site.created','node.created','enrollment.issued','device.enrolled','device.revoked','device.renewed','config.published'));
ALTER TABLE nodes ADD COLUMN enrolled_at TIMESTAMPTZ;
ALTER TABLE nodes ADD COLUMN revoked_at TIMESTAMPTZ;
ALTER TABLE nodes ADD COLUMN last_seen_at TIMESTAMPTZ;
CREATE TABLE enrollment_tokens (
  node_id UUID PRIMARY KEY REFERENCES nodes(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE TABLE device_certificates (
  serial TEXT PRIMARY KEY,
  node_id UUID NOT NULL REFERENCES nodes(id),
  certificate_pem TEXT NOT NULL,
  public_key_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX device_certificates_node ON device_certificates(node_id);
CREATE TABLE desired_configs (
  node_id UUID NOT NULL REFERENCES nodes(id),
  revision INTEGER NOT NULL CHECK (revision > 0),
  payload TEXT NOT NULL CHECK (jsonb_typeof(payload::jsonb) = 'object'),
  checksum TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(node_id,revision)
);
CREATE TABLE config_acknowledgements (
  node_id UUID NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('received','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(node_id,revision),
  FOREIGN KEY(node_id,revision) REFERENCES desired_configs(node_id,revision)
);
CREATE TABLE device_telemetry (
  node_id UUID NOT NULL REFERENCES nodes(id),
  event_id UUID NOT NULL,
  snapshot JSONB NOT NULL,
  checksum TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(node_id,event_id)
);
CREATE INDEX device_telemetry_latest ON device_telemetry(node_id,received_at DESC);
CREATE TABLE enrollment_attempts (
  attempt_key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL
);
