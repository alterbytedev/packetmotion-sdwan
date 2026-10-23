'use client';
import { useEffect, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import type { AgentRelease } from '@/lib/fabric/agent-releases';

export function AgentUpgrade({ releases }: { releases: AgentRelease[] }) {
  const [version, setVersion] = useState(releases[0]?.version || '');
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const command = version && origin && /^\d+\.\d+\.\d+$/.test(version)
    ? `curl -fsSL ${origin}/fabric/edge.sh | sudo bash -s -- --controller ${origin} --version ${version}`
    : '';
  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent upgrade</CardTitle>
        <CardDescription>Select a signed release and run its upgrade command on this device.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {releases.length ? <>
          <label className="block space-y-2 text-sm font-medium" htmlFor="agent-release-version">
            Release version
            <Select controlSize="sm" id="agent-release-version" value={version} onChange={(event) => setVersion(event.target.value)}>
              {releases.map((release) => <option key={release.version} value={release.version}>{release.version}</option>)}
            </Select>
          </label>
          <p className="text-xs leading-5 text-muted-foreground">Run this command in a root-capable shell on the enrolled Debian device. The installer checks the signed manifest and keeps the device identity and local service overrides. If the service fails to start, it restores the previous agent binary and attempts to restart it.</p>
          <code className="block break-all rounded-lg bg-muted p-3 text-xs">{command}</code>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={copyCommand} disabled={!command}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? 'Copied' : 'Copy command'}
            </Button>
            {version && <Button asChild type="button" size="sm" variant="outline">
              <a href={`/fabric/releases/${version}/manifest.json`} download><Download aria-hidden="true" /> Download manifest</a>
            </Button>}
          </div>
        </> : <p className="text-sm text-muted-foreground">No signed agent releases are available on this controller.</p>}
      </CardContent>
    </Card>
  );
}
