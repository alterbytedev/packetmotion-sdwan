CREATE TABLE wireguard_observed (
  node_id UUID PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('disabled','applied','failed')),
  handshakes JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(node_id,revision) REFERENCES desired_configs(node_id,revision)
);
