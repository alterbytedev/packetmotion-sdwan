import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const oldId = '12345678-1234-1234-1234-123456789abc';
const newId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const source = readFileSync('../sdwan-edge/install/edge.sh','utf8').split('while (($#)); do')[0];

for (const accepted of [false,true]) {
 test(`reset terminal confirmation ${accepted ? 'accepts exact old ID' : 'declines by default without consuming stdin token'}`, () => {
  const result = spawnSync('bash',['-c',`${source}
IDENTITY_NODE_ID=${oldId}
EXPECTED_NODE_ID=${newId}
read_reset_confirmation() { ${accepted ? 'return 0' : 'return 1'}; }
confirm_identity_reset
read -r remaining
[[ "$remaining" == secret-token-sentinel ]]
`],{encoding:'utf8',input:'secret-token-sentinel\n'});
  assert.equal(result.status,accepted ? 0 : 1);
  assert.doesNotMatch(result.stdout+result.stderr,/secret-token-sentinel/);
  if (!accepted) assert.match(result.stderr,/reset cancelled/);
 });
}

test('real reset confirmation refuses absent controlling terminal', () => {
 const result = spawnSync('bash',['-c',`${source}\nIDENTITY_NODE_ID=${oldId}\nEXPECTED_NODE_ID=${newId}\nconfirm_identity_reset`],{encoding:'utf8',input:'RESET '+oldId+'\n'});
 assert.equal(result.status,1);
 assert.match(result.stderr,/reset cancelled/);
});

for (const failure of ['none','cleanup','service','unsupported','auth','rollbackstop','backup']) {
 test(`reset orchestration ${failure} preserves backups and uses signed helper without touching host services`, () => {
  const root = mkdtempSync(join(tmpdir(),'fabric-installer-reset-'));
  const state=join(root,'state'); const unit=join(root,'fabric-agent.service');const bin=join(root,'fabric-agent');const work=join(root,'work');const trace=join(root,'trace');
  mkdirSync(state);mkdirSync(work);mkdirSync(unit+'.d');
  writeFileSync(join(state,'identity.json'),JSON.stringify({nodeId:oldId,privateKey:'private-old-sentinel'}),{mode:0o600});
  writeFileSync(join(state,'network-applied.json'),'old-journal');
  writeFileSync(unit,'old-unit');writeFileSync(bin,'old-binary');writeFileSync(join(unit+'.d','90-wireguard-lab.conf'),'old-override');writeFileSync(join(work,'fabric-agent.service'),'new-unit');
  writeFileSync(join(work,'agent'),`#!/bin/bash
printf '%s\\n' "$1" >> "$TRACE"
if [[ "$1" == status && "$FAILURE" == auth ]]; then exit 1;fi
if [[ "$1" == reset-network && "\${2:-}" == --help && "$FAILURE" == unsupported ]]; then exit 1;fi
if [[ "$1" == reset-network && "\${2:-}" != --help && ( "$FAILURE" == cleanup || "$FAILURE" == rollbackstop ) ]]; then exit 1; fi
exit 0
`,{mode:0o755});
  const program=`${source}
STATE_DIR="$TEST_ROOT/state"
UNIT="$TEST_ROOT/fabric-agent.service"
BIN="$TEST_ROOT/fabric-agent"
WORK="$TEST_ROOT/work"
ASSET=agent
IDENTITY_NODE_ID=${oldId}
EXPECTED_NODE_ID=${newId}
SERVER_CA_FILE=''
STOP_COUNT=0
read_reset_confirmation() { return 0; }
interface_guard_reset_preflight() { :; }
read_enrollment_token() { TOKEN=secret-token-sentinel; }
enroll_directory() { printf '%s' '{"nodeId":"${newId}","privateKey":"private-new-sentinel"}' > "$1/identity.json"; unset TOKEN; }
chown() { :; }
cp() {
 if [[ "$FAILURE" == backup && "$*" == *'/state '* ]]; then return 1;fi
 command cp "$@"
}
install() {
 local args=()
 while (($#)); do
  case "$1" in -o|-g) shift 2;; *) args+=("$1");shift;; esac
 done
 command install "\${args[@]}"
}
systemctl() {
 if [[ "$*" == 'stop fabric-agent.service' ]]; then
  STOP_COUNT=$((STOP_COUNT+1))
  if [[ "$FAILURE" == rollbackstop && $STOP_COUNT -gt 1 ]]; then return 1;fi
 fi
 printf 'systemctl %s\\n' "$*" >> "$TRACE"
 if [[ "$*" == *MainPID* ]]; then printf '0\\n';fi
 if [[ "$*" == *'enable --now'* && "$FAILURE" == service ]]; then return 1;fi
 return 0
}
replace_enrolled_identity
`;
  try {
   const result=spawnSync('bash',['-c',program],{encoding:'utf8',env:{...process.env,TEST_ROOT:root,TRACE:trace,FAILURE:failure}});
   assert.equal(result.status,failure==='none'?0:1,result.stderr);
   if (failure==='unsupported' || failure==='auth') {
    assert.equal(existsSync(state+'-backups'),false);
    assert.equal(JSON.parse(readFileSync(join(state,'identity.json'))).nodeId,oldId);
    assert.equal(readFileSync(unit,'utf8'),'old-unit');
    assert.ok(!readFileSync(trace,'utf8').includes('systemctl stop'));
    return;
   }
   if (failure==='backup') {
    assert.equal(JSON.parse(readFileSync(join(state,'identity.json'))).nodeId,oldId);
    assert.equal(readFileSync(unit,'utf8'),'old-unit');
    const operations=readFileSync(trace,'utf8');
    assert.match(operations,/systemctl start fabric-agent.service/);
    assert.equal(operations.split('\n').filter(line=>line==='reset-network').length,1); // capability check only
    assert.match(result.stderr,/backup failed; cleanup not attempted/);
    return;
   }
   const backups=readdirSync(state+'-backups');assert.equal(backups.length,1);
   const backup=join(state+'-backups',backups[0]);
   assert.equal(readFileSync(join(backup,'state','network-applied.json'),'utf8'),'old-journal');
   assert.equal(JSON.parse(readFileSync(join(backup,'state','identity.json'))).nodeId,oldId);
   if (failure==='none') {
    assert.equal(JSON.parse(readFileSync(join(state,'identity.json'))).nodeId,newId);
    assert.equal(existsSync(unit+'.d'),false);
    assert.equal(readFileSync(unit,'utf8'),'new-unit');
    assert.equal(readFileSync(join(backup,'retired-dropins','90-wireguard-lab.conf'),'utf8'),'old-override');
   } else {
    assert.equal(JSON.parse(readFileSync(join(state,'identity.json'))).nodeId,oldId);
    assert.equal(readFileSync(unit,'utf8'),'old-unit');
    assert.equal(readFileSync(bin,'utf8'),'old-binary');
    assert.equal(readFileSync(join(unit+'.d','90-wireguard-lab.conf'),'utf8'),'old-override');
   }
   if (failure==='rollbackstop') assert.match(result.stderr,/Automatic file rollback failed/);
   assert.doesNotMatch(result.stdout+result.stderr,/private-old-sentinel|private-new-sentinel|secret-token-sentinel/);
   const operations=readFileSync(trace,'utf8');
   assert.ok(operations.indexOf('systemctl stop')<operations.lastIndexOf('reset-network'));
  } finally {rmSync(root,{recursive:true,force:true});}
 });
}

test('installer lock excludes another process and releases after exit', async () => {
 const root=mkdtempSync(join(tmpdir(),'fabric-installer-lock-'));
 const lockPath=join(root,'lock');
 const block=readFileSync('../sdwan-edge/install/edge.sh','utf8').match(/# Serialize identity[\s\S]*?# End installer lock\./)[0].replaceAll('/run/packetmotion-installer',lockPath);
 const prelude=`fail() { printf '%s' "$1" >&2;exit 1; }
install() { mkdir -p -- "${lockPath}"; }
${block}
`;
 const first=spawn('bash',['-c',prelude+'printf "ready\\n";read -r release'],{stdio:['pipe','pipe','pipe']});
 try {
  await new Promise((resolve,reject)=>{
   first.stdout.once('data',resolve);
   first.once('error',reject);
   first.once('exit',code=>reject(new Error('lock holder exited before ready: '+code)));
  });
  const denied=spawnSync('bash',['-c',prelude],{encoding:'utf8'});
  assert.equal(denied.status,1);assert.match(denied.stderr,/another PacketMotion installer/);
  const exited=new Promise(resolve=>first.once('exit',resolve));
  first.stdin.end('release\n');await exited;
  assert.equal(spawnSync('bash',['-c',prelude],{encoding:'utf8'}).status,0);
 } finally {first.kill();rmSync(root,{recursive:true,force:true});}
});

test('active interface guard blocks identity replacement before reset or enrollment', () => {
 const result=spawnSync('bash',['-c',`${source}
systemctl() { return 0; }
interface_guard_reset_preflight
printf unexpected-success
`],{encoding:'utf8'});
 assert.equal(result.status,1);
 assert.match(result.stderr,/interface guard/);
 assert.doesNotMatch(result.stdout,/unexpected-success/);
});
