import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = readFileSync(new URL('../sdwan-edge/sdwan-provisioning-scripts/packetmotion-fabric-bootstrap-v1.8.sh', import.meta.url), 'utf8');
const helper = script.split("<<'PM_INTERFACE_HELPER'\n")[1]?.split('\nPM_INTERFACE_HELPER')[0];
assert.ok(helper, 'standalone bootstrap must embed naming helper');

test('bootstrap syntax is valid', () => {
  const result = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('MAC ordering, migration, rollback, conflicts and boot failure safety', () => {
  const directory = mkdtempSync(join(tmpdir(), 'packetmotion-naming-'));
  try {
    const module = join(directory, 'naming.py');
    writeFileSync(module, helper);
    const cases = String.raw`
import importlib.util, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('naming', '${module.replaceAll('\\', '\\\\')}')
naming = importlib.util.module_from_spec(spec); spec.loader.exec_module(naming)

class NamingTests(unittest.TestCase):
 def setUp(self):
  self.directory = tempfile.TemporaryDirectory(); self.root = Path(self.directory.name)
  self.nic('ens34', '00:50:56:00:00:02'); self.nic('ens33', '00:50:56:00:00:01')
  virtual = self.root/'sys/class/net/lo'; virtual.mkdir(); (virtual/'type').write_text('772')
  self.config = self.root/'etc/network/interfaces'; self.config.parent.mkdir(parents=True)
  self.original = 'source /etc/network/interfaces.d/*\nauto ens33 ens34\niface ens33 inet dhcp\n# ens33-extra stays\n'
  self.config.write_text(self.original); self.config.chmod(0o640)
 def tearDown(self): self.directory.cleanup()
 def nic(self, name, mac):
  path = self.root/'sys/class/net'/name; path.mkdir(parents=True); (path/'device').mkdir()
  (path/'address').write_text(mac); (path/'type').write_text('1'); (path/'addr_assign_type').write_text('0')
 def test_sort_migrate_idempotence_and_rollback(self):
  mapping = naming.scan(self.root); self.assertEqual([(e['current'],e['target']) for e in mapping],[('ens33','eth0'),('ens34','eth1')])
  naming.stage(self.root); self.assertIn('auto eth0 eth1',self.config.read_text()); self.assertIn('ens33-extra',self.config.read_text())
  self.assertEqual(self.config.stat().st_mode & 0o777,0o640)
  record = self.root/naming.STATE/'transaction.json'; before=record.read_bytes(); naming.stage(self.root); self.assertEqual(before,record.read_bytes())
  naming.restore(self.root,json.loads(before)); self.assertEqual(self.config.read_text(),self.original); self.assertFalse((self.root/naming.SERVICE).exists())
 def test_simultaneous_swaps_and_vlan_alias_suffixes(self):
  mapping=[{'current':'eth0','target':'eth1'},{'current':'eth1','target':'eth0'}]
  self.assertEqual(naming.rewrite('eth0 eth1 eth0.100 eth1:1 eth0-extra',mapping),'eth1 eth0 eth1.100 eth0:1 eth0-extra')
 def test_duplicate_and_changed_macs(self):
  (self.root/'sys/class/net/ens34/address').write_text('00:50:56:00:00:01')
  with self.assertRaises(ValueError): naming.stage(self.root)
  self.assertEqual(self.config.read_text(),self.original)
 def test_foreign_rules_wildcards_symlinks(self):
  self.config.write_text('auto ens*\n')
  with self.assertRaisesRegex(ValueError,'Wildcard'): naming.stage(self.root)
  self.config.write_text(self.original)
  rule=self.root/'etc/systemd/network/10-wan.link'; rule.parent.mkdir(parents=True);rule.write_text('[Link]\nName=wan0\n')
  with self.assertRaisesRegex(ValueError,'Competing'): naming.stage(self.root)
  rule.unlink();self.config.unlink(); self.config.symlink_to(self.root/'elsewhere');(self.root/'elsewhere').write_text(self.original)
  with self.assertRaisesRegex(ValueError,'Symlink'): naming.stage(self.root)
 def test_config_edits_and_hardware_changes_are_not_overwritten(self):
  naming.stage(self.root); self.config.write_text('operator edit')
  with self.assertRaises(ValueError): naming.stage(self.root)
  record=json.loads((self.root/naming.STATE/'transaction.json').read_text())
  with self.assertRaises(ValueError): naming.restore(self.root,record)
  self.assertEqual(self.config.read_text(),'operator edit')
 def test_stage_write_failure_restores_files(self):
  real=naming.atomic; calls=0
  def fail(path,data,mode=0o600):
   nonlocal calls; calls+=1
   if calls==4: raise OSError('simulated disk failure')
   real(path,data,mode)
  with patch.object(naming,'atomic',side_effect=fail):
   with self.assertRaises(OSError): naming.stage(self.root)
  self.assertEqual(self.config.read_text(),self.original);self.assertFalse((self.root/naming.STATE/'transaction.json').exists())
 def test_new_hardware_requires_mapping_review(self):
  naming.stage(self.root); self.nic('ens35','00:50:56:00:00:03')
  with self.assertRaisesRegex(ValueError,'Hardware'): naming.stage(self.root)
 def test_incomplete_transaction_rollback_accepts_unwritten_file(self):
  naming.stage(self.root); path=self.root/naming.STATE/'transaction.json';record=json.loads(path.read_text())
  record['status']='staging';entry=record['files'][-1];(self.root/entry['path']).unlink()
  naming.restore(self.root,record);self.assertEqual(self.config.read_text(),self.original)
 def test_boot_rejects_occupied_virtual_target(self):
  links=json.loads(self.boot_fixture());links.append({'ifname':'eth0','flags':[]})
  with patch.object(naming.subprocess,'check_output',return_value=json.dumps(links).encode()), patch.object(naming.subprocess,'run') as run:
   with self.assertRaisesRegex(ValueError,'nonphysical'):naming.boot(self.root)
   run.assert_not_called()
 def test_boot_already_correct_mapping_does_not_rename(self):
  naming.stage(self.root)
  for old,new in [('ens33','eth0'),('ens34','eth1')]: (self.root/'sys/class/net'/old).rename(self.root/'sys/class/net'/new)
  links=json.dumps([{'ifname':'eth0','flags':['UP']},{'ifname':'eth1','flags':['UP']}]).encode()
  with patch.object(naming.subprocess,'check_output',return_value=links), patch.object(naming.subprocess,'run') as run:
   naming.boot(self.root);run.assert_not_called()
 def boot_fixture(self,up=False):
  naming.stage(self.root)
  links=[{'ifname':'ens33','flags':['UP'] if up else []},{'ifname':'ens34','flags':[]}]
  return json.dumps(links).encode()
 def test_boot_two_phase_rename(self):
  links=self.boot_fixture()
  with patch.object(naming.subprocess,'check_output',return_value=links), patch.object(naming.subprocess,'run') as run:
   naming.boot(self.root)
   moves=[call.args[0][-3:] for call in run.call_args_list]
   self.assertEqual(moves,[['ens33','name','pmnic0'],['ens34','name','pmnic1'],['pmnic0','name','eth0'],['pmnic1','name','eth1']])
 def test_boot_refuses_live_network(self):
  links=self.boot_fixture(up=True)
  with patch.object(naming.subprocess,'check_output',return_value=links), patch.object(naming.subprocess,'run') as run:
   with self.assertRaisesRegex(ValueError,'live'): naming.boot(self.root)
   run.assert_not_called()
 def test_boot_rename_failure_reverses_completed_moves(self):
  links=self.boot_fixture(); calls=[]
  def fail(command,check):
   calls.append(command[-3:])
   if len(calls)==3: raise naming.subprocess.CalledProcessError(1,command)
  with patch.object(naming.subprocess,'check_output',return_value=links), patch.object(naming.subprocess,'run',side_effect=fail):
   with self.assertRaises(naming.subprocess.CalledProcessError): naming.boot(self.root)
  self.assertEqual(calls[-2:],[['pmnic1','name','ens34'],['pmnic0','name','ens33']])

unittest.main()
`;
    const result = spawnSync('python3', ['-c', cases], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
