CREATE TABLE controller_insecure_http_hosts (
  host TEXT PRIMARY KEY,
  updated_by BIGINT REFERENCES operators(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (
  action IN (
    'site.created', 'node.created', 'enrollment.issued', 'device.enrolled',
    'device.enrollment_reset', 'device.revoked', 'device.renewed', 'config.published',
    'controller.insecure_http_hosts_updated'
  )
);
