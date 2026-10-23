-- Drafts never participate in plan generation until an explicit deployment.
CREATE TABLE wireguard_drafts (
  node_id UUID PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  base_version INTEGER NOT NULL CHECK (base_version >= 0),
  payload JSONB CHECK (payload IS NULL OR jsonb_typeof(payload)='object'),
  deployment_targets UUID[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (
  action IN (
    'site.created','node.created','enrollment.issued','device.enrolled',
    'device.enrollment_reset','device.revoked','device.renewed','config.published',
    'controller.insecure_http_hosts_updated','wireguard.settings_updated',
    'wireguard.device_updated','wireguard.key_registered','routing.settings_updated',
    'lan.updated','node.renamed','device.archived','wireguard.draft_saved','controller.timezone_updated'
  )
);
