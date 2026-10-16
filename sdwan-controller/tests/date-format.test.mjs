import assert from 'node:assert/strict';
import test from 'node:test';
import loader from './support/load-ts.cjs';

const { formatDateTimeUtc, formatDateUtc } = loader({})('src/lib/date-format.ts');

test('date display is stable across server and browser time zones', (t) => {
  const originalTimezone = process.env.TZ;
  t.after(() => {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });

  process.env.TZ = 'Pacific/Kiritimati';
  const instant = '2026-10-15T12:25:18.000Z';
  assert.equal(formatDateUtc(instant), '10/15/2026');
  assert.equal(formatDateTimeUtc(instant), '10/15/2026, 12:25:18 PM UTC');
});
