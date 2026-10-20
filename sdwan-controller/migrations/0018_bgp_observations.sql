ALTER TABLE wireguard_observed ADD COLUMN bgp_peers JSONB NOT NULL DEFAULT '[]'::jsonb;
