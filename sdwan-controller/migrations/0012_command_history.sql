CREATE TABLE device_command_history (
  id BIGSERIAL PRIMARY KEY,
  operation_id UUID NOT NULL,
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('desired_config', 'wireguard', 'frr', 'nftables')),
  revision INTEGER NOT NULL CHECK (revision > 0),
  event TEXT NOT NULL CHECK (event IN ('published', 'delivered', 'received', 'rejected', 'applied', 'failed', 'disabled')),
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  actor_email TEXT,
  summary TEXT NOT NULL CHECK (length(summary) <= 240),
  error_summary TEXT CHECK (error_summary IS NULL OR length(error_summary) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(node_id, revision, event, attempt)
);

CREATE INDEX device_command_history_node_time
  ON device_command_history(node_id, created_at DESC, id DESC);
CREATE INDEX device_command_history_operation
  ON device_command_history(operation_id, created_at, id);
CREATE INDEX device_command_history_retention
  ON device_command_history(created_at);
