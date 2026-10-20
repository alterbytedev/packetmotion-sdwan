WITH ordered_reports AS (
  SELECT id,
         lag(event) OVER (PARTITION BY operation_id ORDER BY created_at, id) AS previous_event
  FROM device_command_history
  WHERE operation_type = 'wireguard'
    AND event IN ('applied', 'failed', 'disabled')
)
DELETE FROM device_command_history history
USING ordered_reports reports
WHERE history.id = reports.id
  AND history.event = reports.previous_event;
