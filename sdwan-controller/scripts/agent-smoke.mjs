import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawn,execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash,randomBytes } from 'node:crypto';
import https from 'node:https';
import pg from 'pg';

assert.equal(process.env.FABRIC_TEST_ISOLATED,'1');
const require=createRequire(import.meta.url);
const {signSession}=require('../tests/support/session.cjs');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
const directory=await mkdtemp(join(tmpdir(),'fabric-agent-smoke-'));
const name=`fabric-mtls-${randomBytes(6).toString('hex')}`;
let next;
let container=false;
const processes=[];
async function run(command,args,env=process.env){await new Promise((resolveResult,reject)=>{const child=spawn(command,args,{env,stdio:['ignore','pipe','pipe']});let failure='';child.stderr.on('data',chunk=>{failure+=chunk;});child.on('error',reject);child.on('exit',code=>code===0?resolveResult():reject(new Error(`Command ${command} failed (${code}); output suppressed to protect credentials`)));});}
function request(address,path,{certificate,key,body,headers={},agent}={}){
 return new Promise((resolveResult,reject)=>{const req=https.request(`${address}${path}`,{ca:serverCA,cert:certificate,key,agent,method:body?'POST':'GET',headers:{...headers,...(body?{'content-type':'application/json'}:{})}},res=>{let data='';res.on('data',chunk=>{data+=chunk;});res.on('end',()=>resolveResult({status:res.statusCode,reusedSocket:req.reusedSocket,body:data && String(res.headers['content-type']).includes('application/json')?JSON.parse(data):null}));});req.on('error',reject);if(body)req.write(JSON.stringify(body));req.end();});
}
let serverCA;
try{
 execFileSync(process.execPath,['scripts/init-device-ca.mjs',directory],{stdio:'pipe'});
 const ca=join(directory,'device-ca.crt');const caKey=join(directory,'device-ca.key');
 const serverKey=join(directory,'server.key');const serverCSR=join(directory,'server.csr');
 execFileSync('openssl',['req','-new','-newkey','rsa:2048','-noenc','-keyout',serverKey,'-out',serverCSR,'-subj','/CN=localhost'],{stdio:'pipe'});
 await writeFile(join(directory,'server.ext'),'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\n');
 execFileSync('openssl',['x509','-req','-in',serverCSR,'-CA',ca,'-CAkey',caKey,'-set_serial','0x1234','-days','1','-extfile',join(directory,'server.ext'),'-out',join(directory,'server.crt')],{stdio:'pipe'});
 serverCA=await readFile(ca,'utf8');
 const secret=randomBytes(32).toString('hex');
 const environment={...process.env,CONTROLLER_DEVICE_CA_CERT:ca,CONTROLLER_DEVICE_CA_KEY:caKey,CONTROLLER_AGENT_PROXY_SECRET:secret,FABRIC_TEST_BUILD_DIR:'.next-agent'};
 next=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','0.0.0.0','--port','3117'],{env:environment,stdio:['ignore','pipe','pipe']});
 next.stdout.resume();next.stderr.resume();processes.push(next);
 let ready=false;for(let i=0;i<60;i++){try{const response=await fetch('http://127.0.0.1:3117/api/health');if(response.ok){ready=true;break;}}catch{}await new Promise(resolveResult=>setTimeout(resolveResult,500));}
 assert.ok(ready,'isolated Next server did not start');
 const template=await readFile('../deploy/proxy/nginx.conf.template','utf8');
 const rendered=template.replaceAll('${PUBLIC_HOST}','localhost').replaceAll('${CONTROLLER_UPSTREAM}','host.docker.internal:3117').replaceAll('${PROXY_SECRET}',secret);
 await writeFile(join(directory,'nginx.conf'),rendered,{mode:0o600});
 execFileSync('docker',['run','--rm','-d','--name',name,'-p','127.0.0.1::443','-v',`${directory}:/pki:ro`,'-v',`${join(directory,'nginx.conf')}:/etc/nginx/nginx.conf:ro`,'nginx@sha256:9bf97bd7714f5e24c1ccd545ecb9eb5435cb6d109c97cebb15e7e455e0239edb'],{stdio:'pipe'});container=true;
 execFileSync('docker',['exec',name,'nginx','-t'],{stdio:'pipe'});
 const binding=execFileSync('docker',['port',name,'443/tcp'],{encoding:'utf8'}).trim();
 const origin=`https://localhost:${binding.split(':').at(-1)}`;
 const user=(await pool.query('SELECT email,password_hash FROM operators WHERE email=$1',[process.env.FABRIC_TEST_EMAIL])).rows[0];
 const cookie=signSession(user.email,process.env.CONTROLLER_SESSION_SECRET,Date.now(),createHash('sha256').update(user.password_hash).digest('hex'));
 async function operator(path,body){const response=await fetch(`http://127.0.0.1:3117${path}`,{method:body?'POST':'GET',headers:{cookie:`sdwan-session=${cookie}`,Origin:process.env.CONTROLLER_PUBLIC_ORIGIN,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};}
 const go=process.env.GO_BINARY || 'go';
 const binary=join(directory,'fabric-agent');
 await run(go,['-C',resolve('../sdwan-edge'),'build','-o',binary,'./cmd/fabric-agent']);
 const created=await operator('/api/operator/nodes',{name:'Real Go Edge',kind:'branch',mode:'gateway',lanPrefix:'10.91.0.0/24'});assert.equal(created.status,201);
 const nodeId=created.body.node.id;
 const stateDirectory=join(directory,'agent-state');
 await run(binary,['enroll','--controller',origin,'--server-ca',ca,'--state-dir',stateDirectory],{...process.env,FABRIC_ENROLLMENT_TOKEN:created.body.enrollment.token});
 const state=JSON.parse(await readFile(join(stateDirectory,'identity.json'),'utf8'));
 assert.equal(state.nodeId,nodeId);
 const noCertificate=await request(origin,'/api/agent/v1/desired');assert.equal(noCertificate.status,403);
 const spoofed=await request(origin,'/api/agent/v1/desired',{headers:{'X-Fabric-Proxy-Secret':secret,'X-Fabric-Client-Serial':'fake','X-Fabric-Client-Verified':'SUCCESS'}});assert.equal(spoofed.status,403);
 const direct=await fetch('http://127.0.0.1:3117/api/agent/v1/desired',{headers:{'X-Fabric-Client-Serial':'fake','X-Fabric-Client-Verified':'SUCCESS'}});assert.equal(direct.status,401);
 const published=await operator(`/api/operator/nodes/${nodeId}/config`,{expectedRevision:0,pollIntervalSeconds:30});assert.equal(published.status,201);
 await run(binary,['run','--once','--state-dir',stateDirectory]);
 const received=await pool.query('SELECT status FROM config_acknowledgements WHERE node_id=$1',[nodeId]);assert.equal(received.rows[0].status,'received');
 const telemetry=await operator(`/api/operator/nodes/${nodeId}/telemetry`);assert.equal(telemetry.status,200);assert.equal(telemetry.body.telemetry.snapshot.agentVersion,execFileSync(binary,['version'],{encoding:'utf8'}).trim());
 const staged=JSON.parse(await readFile(join(stateDirectory,'desired.json'),'utf8'));assert.equal(staged.deviceKind,'branch');
 const persisted=JSON.parse(await readFile(join(stateDirectory,'identity.json'),'utf8'));
 const conditionalPath=`/api/agent/v1/desired?revision=${persisted.revision}&checksum=${persisted.checksum}`;
 const conditional=await request(origin,conditionalPath,{certificate:state.certificate,key:state.privateKey});
 assert.equal(conditional.status,200);assert.equal(conditional.body.unchanged,true);assert.equal(conditional.body.payload,undefined);
 await run(binary,['run','--once','--state-dir',stateDirectory]);
 assert.equal(await readFile(join(stateDirectory,'identity.json'),'utf8'),JSON.stringify(persisted));

 const liveAgent=spawn(binary,['run','--state-dir',stateDirectory],{env:process.env,stdio:['ignore','ignore','pipe']});processes.push(liveAgent);
 await new Promise(resolveResult=>setTimeout(resolveResult,750));
 const pushed=await operator(`/api/operator/nodes/${nodeId}/config`,{expectedRevision:1,pollIntervalSeconds:45});assert.equal(pushed.status,201);
 const pushStarted=performance.now();let pushedAck=false;
 for(let attempt=0;attempt<100;attempt++){
  const ack=await pool.query('SELECT status FROM config_acknowledgements WHERE node_id=$1 AND revision=2',[nodeId]);
  if(ack.rows[0]?.status==='received'){pushedAck=true;break;}
  await new Promise(resolveResult=>setTimeout(resolveResult,100));
 }
 liveAgent.kill('SIGTERM');if(liveAgent.exitCode===null)await new Promise(resolveResult=>liveAgent.once('exit',resolveResult));
 assert.ok(pushedAck,'agent did not receive the published revision through the long-poll');
 assert.ok(performance.now()-pushStarted<10_000,'revision delivery exceeded the 10 second smoke budget');
 processes.splice(processes.indexOf(liveAgent),1);
 const timings=[];const loadStarted=performance.now();
 await Promise.all(Array.from({length:8},async()=>{
  const connection=new https.Agent({ca:serverCA,cert:state.certificate,key:state.privateKey,keepAlive:true,maxSockets:1});
  try {for(let i=0;i<5;i++) {const started=performance.now();const result=await request(origin,conditionalPath,{agent:connection});assert.equal(result.status,200);assert.equal(result.body.unchanged,true);timings.push(performance.now()-started);}}
  finally {connection.destroy();}
 }));
 timings.sort((a,b)=>a-b);
 console.log(`Management baseline: 40 unchanged reads, 8 concurrent connections, p95=${timings[Math.ceil(timings.length*.95)-1].toFixed(1)}ms, duration=${(performance.now()-loadStarted).toFixed(1)}ms. Local development sample; not production capacity.`);

 const hubCreated=await operator('/api/operator/nodes',{name:'Real Go Hub',kind:'hub',mode:'gateway'});assert.equal(hubCreated.status,201);
 const hubDirectory=join(directory,'hub-state');
 await run(binary,['enroll','--controller',origin,'--server-ca',ca,'--state-dir',hubDirectory],{...process.env,FABRIC_ENROLLMENT_TOKEN:hubCreated.body.enrollment.token});
 const hubState=JSON.parse(await readFile(join(hubDirectory,'identity.json'),'utf8'));assert.equal(hubState.kind,'hub');
 assert.equal((await operator(`/api/operator/nodes/${hubState.nodeId}/config`,{expectedRevision:0,pollIntervalSeconds:30})).status,201);
 await run(binary,['run','--once','--state-dir',hubDirectory]);
 assert.equal((await pool.query('SELECT status FROM config_acknowledgements WHERE node_id=$1',[hubState.nodeId])).rows[0].status,'received');
 const wrongScope=await request(origin,'/api/agent/v1/ack',{certificate:hubState.certificate,key:hubState.privateKey,body:{revision:1,checksum:published.body.checksum,status:'received'}});assert.equal(wrongScope.status,409);
 const rogueKey=join(directory,'rogue.key');const rogueCert=join(directory,'rogue.crt');
 execFileSync('openssl',['req','-new','-x509','-newkey','rsa:2048','-noenc','-keyout',rogueKey,'-out',rogueCert,'-days','1','-subj','/CN=rogue'],{stdio:'pipe'});
 const rogue=await request(origin,'/api/agent/v1/desired',{certificate:await readFile(rogueCert,'utf8'),key:await readFile(rogueKey,'utf8')});assert.ok(rogue.status>=400);
 const keepAlive=new https.Agent({ca:serverCA,cert:state.certificate,key:state.privateKey,keepAlive:true,maxSockets:1});
 assert.equal((await request(origin,'/api/agent/v1/desired',{agent:keepAlive})).status,200);
 const revoked=await operator(`/api/operator/nodes/${nodeId}/revoke`,{});assert.equal(revoked.status,201);
 const afterRevocation=await request(origin,'/api/agent/v1/desired',{agent:keepAlive});
 assert.equal(afterRevocation.status,401);assert.equal(afterRevocation.reusedSocket,true);keepAlive.destroy();
 console.log('PASS: real Go Edge and Hub enrollment through NGINX mTLS, config received/staged, actual telemetry, missing-cert/header-spoof/direct-bypass rejection and revocation.');
}finally{
 if(container)execFileSync('docker',['stop',name],{stdio:'pipe'});
 for(const child of processes){child.kill('SIGTERM');await new Promise(resolveResult=>{if(child.exitCode!==null)return resolveResult();child.once('exit',resolveResult);setTimeout(()=>{child.kill('SIGKILL');},5000).unref();});}
 await pool.end();await rm(directory,{recursive:true,force:true});
}
