CREATE TABLE network_interface_commits (
 id UUID PRIMARY KEY,
 node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 draft_version INTEGER NOT NULL CHECK(draft_version>0),
 interface_name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('physical','vlan')),
 payload TEXT NOT NULL CHECK(octet_length(payload)<=8192 AND jsonb_typeof(payload::jsonb)='object'),
 checksum TEXT NOT NULL CHECK(checksum ~ '^[0-9a-f]{64}$'),
 actor_email TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','applying','awaiting_confirmation','applied','rolled_back','rejected','rollback_failed')),
 sequence INTEGER NOT NULL DEFAULT 0 CHECK(sequence>=0),
 reason TEXT NOT NULL DEFAULT '',
 nonce TEXT NOT NULL DEFAULT '',
 deadline TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reported_at TIMESTAMPTZ
);
CREATE INDEX network_interface_commits_history ON network_interface_commits(node_id,created_at DESC);
CREATE UNIQUE INDEX network_interface_commits_active ON network_interface_commits(node_id)
 WHERE status IN ('queued','applying','awaiting_confirmation','rollback_failed');
CREATE TABLE network_interface_commit_events (
 commit_id UUID NOT NULL REFERENCES network_interface_commits(id) ON DELETE CASCADE,
 sequence INTEGER NOT NULL CHECK(sequence>0),
 report JSONB NOT NULL CHECK(jsonb_typeof(report)='object'),
 received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(commit_id,sequence)
);
-- Intent confirmed as installed is separate from the inactive draft and the
-- transaction's requested state. Failed/rolled-back commits never replace it.
CREATE TABLE network_interface_applied (
 node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 interface_name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('physical','vlan')),
 commit_id UUID NOT NULL REFERENCES network_interface_commits(id),
 interfaces JSONB NOT NULL CHECK(jsonb_typeof(interfaces)='array'),
 PRIMARY KEY(node_id,interface_name,kind)
);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (
 action IN (
 'site.created','node.created','enrollment.issued','device.enrolled',
 'device.enrollment_reset','device.revoked','device.renewed','config.published',
 'controller.insecure_http_hosts_updated','wireguard.settings_updated',
 'wireguard.device_updated','wireguard.key_registered','routing.settings_updated',
 'lan.updated','node.renamed','device.archived','device.permanently_deleted',
 'wireguard.draft_saved','controller.timezone_updated','network.draft_saved','network.apply_requested'
 )
);
