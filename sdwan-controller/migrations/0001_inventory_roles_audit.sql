ALTER TABLE operators ADD COLUMN role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'viewer'));
CREATE TABLE sites (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  mode TEXT NOT NULL CHECK (mode IN ('gateway', 'subnet-router')),
  lan_prefix CIDR CHECK (family(lan_prefix) = 4 AND masklen(lan_prefix) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sites_name_unique ON sites (lower(name));
CREATE TABLE nodes (
  id UUID PRIMARY KEY,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  kind TEXT NOT NULL CHECK (kind IN ('hub', 'branch')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (site_id, name)
);
CREATE INDEX nodes_site_id ON nodes (site_id);
CREATE TABLE audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id BIGINT REFERENCES operators(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('site.created', 'node.created')),
  resource_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_created_at ON audit_events (created_at);
