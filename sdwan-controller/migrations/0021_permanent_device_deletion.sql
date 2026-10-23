ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (
  action IN (
    'site.created','node.created','enrollment.issued','device.enrolled',
    'device.enrollment_reset','device.revoked','device.renewed','config.published',
    'controller.insecure_http_hosts_updated','wireguard.settings_updated',
    'wireguard.device_updated','wireguard.key_registered','routing.settings_updated',
    'lan.updated','node.renamed','device.archived','device.permanently_deleted',
    'wireguard.draft_saved','controller.timezone_updated'
  )
);
