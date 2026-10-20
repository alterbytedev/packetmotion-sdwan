ALTER TABLE device_state_reports
  ADD COLUMN unavailable_reason TEXT CHECK (unavailable_reason IS NULL OR unavailable_reason IN ('timeout','collection_failed'));
