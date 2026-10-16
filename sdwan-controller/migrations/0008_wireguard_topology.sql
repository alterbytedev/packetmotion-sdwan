CREATE TABLE wireguard_settings (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  pool CIDR NOT NULL CHECK (family(pool)=4 AND masklen(pool) BETWEEN 16 AND 30),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version>0)
);
CREATE TABLE wireguard_devices (
  node_id UUID PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  public_key TEXT UNIQUE,
  endpoint INET CHECK (endpoint IS NULL OR (family(endpoint)=4 AND masklen(endpoint)=32)),
  base_port INTEGER NOT NULL DEFAULT 20000 CHECK (base_port BETWEEN 1024 AND 65408),
  version INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE wireguard_links (
  id UUID PRIMARY KEY,
  edge_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  hub_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  network CIDR NOT NULL UNIQUE CHECK (family(network)=4 AND masklen(network)=31),
  hub_port INTEGER NOT NULL CHECK (hub_port BETWEEN 1024 AND 65535),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(edge_id,hub_id),
  UNIQUE(hub_id,hub_port),
  CHECK (edge_id<>hub_id)
);
ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (
  action IN (
    'site.created','node.created','enrollment.issued','device.enrolled',
    'device.enrollment_reset','device.revoked','device.renewed','config.published',
    'controller.insecure_http_hosts_updated','wireguard.settings_updated',
    'wireguard.device_updated','wireguard.key_registered'
  )
);
