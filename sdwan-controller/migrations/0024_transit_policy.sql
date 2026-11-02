-- Global transit allow rules between saved LAN prefixes. Drafts never reach
-- plan generation until an explicit deployment copies them into rules.
CREATE TABLE transit_policy (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  rules JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(rules)='array'),
  draft_rules JSONB CHECK (draft_rules IS NULL OR jsonb_typeof(draft_rules)='array'),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO transit_policy(singleton) VALUES (TRUE);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (
 action IN (
 'site.created','node.created','enrollment.issued','device.enrolled',
 'device.enrollment_reset','device.revoked','device.renewed','config.published',
 'controller.insecure_http_hosts_updated','wireguard.settings_updated',
 'wireguard.device_updated','wireguard.key_registered','routing.settings_updated',
 'lan.updated','node.renamed','device.archived','device.permanently_deleted',
 'wireguard.draft_saved','controller.timezone_updated','network.draft_saved','network.apply_requested',
 'transit.draft_saved','transit.deployed'
 )
);
