-- Inactive candidates only: never read by desired-revision generation.
CREATE TABLE network_drafts (
 node_id UUID PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK (version > 0),
 base_revision BIGINT NOT NULL CHECK (base_revision >= 0),
 base_lan_version INTEGER NOT NULL CHECK (base_lan_version >= 0),
 interfaces JSONB NOT NULL CHECK (jsonb_typeof(interfaces)='array' AND jsonb_array_length(interfaces)<=16),
 safe_commit_seconds INTEGER NOT NULL DEFAULT 60 CHECK (safe_commit_seconds=60),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (
 action IN (
  'site.created','node.created','enrollment.issued','device.enrolled',
  'device.enrollment_reset','device.revoked','device.renewed','config.published',
  'controller.insecure_http_hosts_updated','wireguard.settings_updated',
  'wireguard.device_updated','wireguard.key_registered','routing.settings_updated',
  'lan.updated','node.renamed','device.archived','device.permanently_deleted',
  'wireguard.draft_saved','controller.timezone_updated','network.draft_saved'
 )
);
