ALTER TABLE device_command_history
  ADD COLUMN raw_config TEXT CHECK (raw_config IS NULL OR octet_length(raw_config) <= 131072);

UPDATE device_command_history history
SET raw_config=desired.payload
FROM desired_configs desired
WHERE history.node_id=desired.node_id
  AND history.revision=desired.revision
  AND history.event='published'
  AND history.created_at >= now() - interval '365 days';
