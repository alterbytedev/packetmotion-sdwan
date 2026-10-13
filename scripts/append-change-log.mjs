import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// flock releases on process exit, including SIGKILL. Never unlink the lock inode.
const writer = String.raw`
import fcntl,json,os,re,sys
from pathlib import Path
entry=json.load(sys.stdin)
root=Path(entry['directory']); root.mkdir(parents=True,exist_ok=True)
data=entry['text'].encode('utf-8')
limit=512000
if not data or len(data)>limit-100: raise ValueError('Entry must fit in a single log file')
with (root/'.append.lock').open('a') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 logs=sorted(root.glob('log_change_[0-9][0-9][0-9].md'))
 active=logs[-1] if logs else root/'log_change_001.md'
 if not active.exists(): active.write_text('# PacketMotion Fabric — Change Log 001\n')
 if active.stat().st_size+len(data)>limit:
  number=int(active.stem.rsplit('_',1)[1])+1
  if number>999: raise ValueError('Log numbering exhausted')
  active=root/f'log_change_{number:03}.md'
  with active.open('x') as out: out.write(f'# PacketMotion Fabric — Change Log {number:03}\n')
 with active.open('ab') as out:
  out.write(data); out.flush(); os.fsync(out.fileno())
 index=root/'README.md'
 contents=index.read_text() if index.exists() else '# Agent Change Logs\n\n- Active file: \x60log_change_001.md\x60\n'
 contents=re.sub(r'Active file: \x60[^\x60]+\x60',f'Active file: \x60{active.name}\x60',contents)
 temporary=root/'.index.tmp'
 temporary.write_text(contents); os.replace(temporary,index)
 print(active.name)
`;

export function appendChangeLog(text, directory = resolve('docs/change-logs')) {
  return new Promise((resolveResult, reject) => {
    const child = spawn('python3', ['-c', writer], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let error = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { error += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolveResult(output.trim()) : reject(new Error(error || `Writer exited ${code}`)));
    child.stdin.end(JSON.stringify({ directory, text }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/append-change-log.mjs <entry-file>');
  console.log(await appendChangeLog(await readFile(process.argv[2], 'utf8')));
}
