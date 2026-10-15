ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN (
  'site.created', 'node.created', 'enrollment.issued', 'device.enrolled', 'device.revoked',
  'device.renewed', 'config.published', 'device.enrollment_reset'
));
