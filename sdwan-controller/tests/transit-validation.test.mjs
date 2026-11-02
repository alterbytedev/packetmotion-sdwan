import assert from 'node:assert/strict';
import test from 'node:test';
import loader from './support/load-ts.cjs';

const load = loader({
  './authorization': {
    FabricError: class FabricError extends Error {
      constructor(status, message) {
        super(message);
        this.status = status;
      }
    },
  },
});
const { transitRulesInput } = load('src/lib/fabric/transit-validation.ts');
const rule = { source: '10.61.0.0/24', destination: '10.62.0.0/24', protocol: 'any' };

test('transit rules get stable IDs from list order', () => {
  const result = transitRulesInput({ expectedVersion: 1, rules: [rule, { ...rule, source: '10.62.0.0/24', destination: '10.61.0.0/24', protocol: 'icmp' }] });
  assert.deepEqual(result.rules.map((entry) => entry.id), ['rule-1', 'rule-2']);
  assert.equal(result.expectedVersion, 1);
  assert.deepEqual(transitRulesInput({ expectedVersion: 1, rules: [] }).rules, []);
});

test('transit rules reject malformed, duplicate and oversized input', () => {
  const bad = [
    { ...rule, source: '10.61.0.5/24' },
    { ...rule, destination: rule.source },
    { ...rule, protocol: 'gre' },
    { ...rule, ports: '80' },
    'any',
  ];
  for (const entry of bad) assert.throws(() => transitRulesInput({ expectedVersion: 1, rules: [entry] }));
  assert.throws(() => transitRulesInput({ expectedVersion: 1, rules: [rule, rule] }));
  assert.throws(() => transitRulesInput({ expectedVersion: 1, rules: Array.from({ length: 65 }, (_, i) => ({ ...rule, destination: `10.${i}.0.0/24` })) }));
  assert.throws(() => transitRulesInput({ rules: [rule] }));
  assert.throws(() => transitRulesInput({ expectedVersion: 1, rules: [rule], extra: true }));
});
