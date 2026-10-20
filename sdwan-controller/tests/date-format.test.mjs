import assert from 'node:assert/strict';
import test from 'node:test';
import loader from './support/load-ts.cjs';

const { formatDateTime, formatDate } = loader({})('src/lib/date-format.ts');

test('date display is stable across server and browser time zones', (t) => {
  const originalTimezone = process.env.TZ;
  t.after(() => {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });

  process.env.TZ = 'Pacific/Kiritimati';
  const instant = '2026-10-15T12:25:18.000Z';
  assert.equal(formatDate(instant), '10/15/2026');
  assert.equal(formatDateTime(instant), '10/15/2026, 12:25:18 PM UTC');
  assert.equal(formatDate('2026-10-15T01:00:00.000Z', 'America/Los_Angeles'), '10/14/2026');
  assert.equal(formatDateTime(instant, 'America/Los_Angeles'), '10/15/2026, 5:25:18 AM PDT');
});
