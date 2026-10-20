INSERT INTO device_command_history
  (operation_id,node_id,operation_type,revision,event,attempt,summary,created_at)
SELECT gen_random_uuid(),dc.node_id,
       CASE WHEN dc.payload::jsonb ? 'wireguard' THEN 'wireguard' ELSE 'desired_config' END,
       dc.revision,'published',1,
       'Existing revision imported from controller history; original publisher is unavailable.',
       dc.created_at
FROM desired_configs dc
WHERE dc.created_at >= now() - interval '365 days'
  AND NOT EXISTS (
    SELECT 1 FROM device_command_history h
    WHERE h.node_id=dc.node_id AND h.revision=dc.revision AND h.event='published'
  )
ON CONFLICT(node_id,revision,event,attempt) DO NOTHING;

INSERT INTO device_command_history
  (operation_id,node_id,operation_type,revision,event,attempt,summary,created_at)
SELECT publication.operation_id,wo.node_id,publication.operation_type,wo.revision,wo.status,1,
       CASE wo.status
         WHEN 'applied' THEN 'Existing WireGuard observation imported; agent reported this revision applied.'
         WHEN 'failed' THEN 'Existing WireGuard observation imported; detailed failure reason unavailable.'
         ELSE 'Existing WireGuard observation imported; agent reported WireGuard disabled.'
       END,
       wo.received_at
FROM wireguard_observed wo
JOIN device_command_history publication
  ON publication.node_id=wo.node_id AND publication.revision=wo.revision AND publication.event='published'
WHERE wo.received_at >= now() - interval '365 days'
ON CONFLICT(node_id,revision,event,attempt) DO NOTHING;
