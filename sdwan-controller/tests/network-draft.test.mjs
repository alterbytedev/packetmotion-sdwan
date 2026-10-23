import assert from 'node:assert/strict';
import test from 'node:test';
import loader from './support/load-ts.cjs';
const { networkDraftInput } = loader({ 'next/headers': {}, 'next/navigation': {} })('src/lib/fabric/network-validation.ts');
const lan = { interfaceName: 'ens36', vlanId: 100, role: 'lan', mode: 'static', address: '10.61.100.1/24', gateway: null, advertisedPrefix: '10.61.100.0/24', enabled: true, mtu: 1500 };
const draft = { expectedVersion: 0, baseRevision: 1, baseLanVersion: 0, interfaces: [lan], safeCommitSeconds: 60 };
test('network drafts validate routed VLANs and require safe commit', () => {
  assert.equal(networkDraftInput(draft).interfaces[0].vlanId, 100);
  for (const mutation of [
    { safeCommitSeconds: 0 }, { interfaces: [{ ...lan, vlanId: 0 }] }, { interfaces: [{ ...lan, vlanId: 4095 }] },
    { interfaces: [{ ...lan, interfaceName: 'pmv123' }] },
    { interfaces: [{ ...lan, advertisedPrefix: '0.0.0.0/0' }] }, { interfaces: [{ ...lan, gateway: '10.61.100.2' }] },
    { interfaces: [{ ...lan, address: '10.61.100.0/24' }] }, { interfaces: [{ ...lan, address: '10.61.100.255/24' }] },
    { interfaces: [{ ...lan, mode: 'dhcp' }] }, { interfaces: [lan, lan] }, { interfaces: [lan, { ...lan, vlanId: 200 }] },
    { interfaces: [{ ...lan, mtu: 9001 }] }, { interfaces: [{ ...lan, command: 'arbitrary' }] },
  ]) assert.throws(() => networkDraftInput({ ...draft, ...mutation }));
});
test('WAN candidates exclude advertisements and validate DHCP/static gateway', () => {
  const wan = { ...lan, role: 'wan', vlanId: null, mode: 'dhcp', address: null, gateway: null, advertisedPrefix: null };
  assert.equal(networkDraftInput({ ...draft, interfaces: [wan] }).interfaces[0].mode, 'dhcp');
  assert.throws(() => networkDraftInput({ ...draft, interfaces: [{ ...wan, advertisedPrefix: lan.advertisedPrefix }] }));
  assert.throws(() => networkDraftInput({ ...draft, interfaces: [wan, { ...wan, interfaceName: 'ens35' }] }));
  const staticWan = { ...wan, mode: 'static', address: '192.0.2.2/24', gateway: '192.0.2.1' };
  assert.equal(networkDraftInput({ ...draft, interfaces: [staticWan] }).interfaces[0].gateway, '192.0.2.1');
  for (const gateway of ['192.0.3.1', '192.0.2.2', '192.0.2.0', '192.0.2.255'])
    assert.throws(() => networkDraftInput({ ...draft, interfaces: [{ ...staticWan, gateway }] }));
});
