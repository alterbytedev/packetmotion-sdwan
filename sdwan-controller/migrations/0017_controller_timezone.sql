CREATE TABLE controller_timezone (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by BIGINT REFERENCES operators(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO controller_timezone(singleton, time_zone, version) VALUES(TRUE, 'UTC', 1);

ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (
  action IN (
    'site.created','node.created','enrollment.issued','device.enrolled',
    'device.enrollment_reset','device.revoked','device.renewed','config.published',
    'controller.insecure_http_hosts_updated','wireguard.settings_updated',
    'wireguard.device_updated','wireguard.key_registered','device.archived',
    'routing.settings_updated','lan.updated','node.renamed','controller.timezone_updated'
  )
);
