ALTER TABLE operators DROP CONSTRAINT IF EXISTS operators_role_check;
ALTER TABLE operators ADD CONSTRAINT operators_role_check
  CHECK (role IN ('superadmin', 'admin', 'viewer'));

CREATE TABLE controller_branding (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  logo_mime TEXT NOT NULL CHECK (logo_mime IN ('image/png', 'image/jpeg', 'image/webp')),
  logo_data BYTEA NOT NULL CHECK (octet_length(logo_data) BETWEEN 1 AND 2097152),
  updated_by BIGINT REFERENCES operators(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
