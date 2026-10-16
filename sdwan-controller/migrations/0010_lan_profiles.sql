CREATE TABLE routing_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  protected_prefixes CIDR[] NOT NULL,
  version INTEGER NOT NULL CHECK (version>0)
);
CREATE TABLE lan_profiles (
  node_id UUID PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  interface_name TEXT NOT NULL,
  address INET NOT NULL CHECK (family(address)=4 AND masklen(address) BETWEEN 8 AND 30),
  advertised_prefix CIDR NOT NULL CHECK (family(advertised_prefix)=4),
  version INTEGER NOT NULL CHECK (version>0),
  CHECK (network(address)=advertised_prefix)
);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (
 action IN (
 'site.created','node.created','enrollment.issued','device.enrolled',
 'device.enrollment_reset','device.revoked','device.renewed','config.published',
 'controller.insecure_http_hosts_updated','wireguard.settings_updated',
 'wireguard.device_updated','wireguard.key_registered','routing.settings_updated','lan.updated'
 )
);
