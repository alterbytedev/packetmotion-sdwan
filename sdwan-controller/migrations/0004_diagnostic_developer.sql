CREATE TABLE diagnostic_developer (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  password_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
