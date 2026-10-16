'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CirclePlus, Copy, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Feedback } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { OperatorRole } from '@/lib/fabric/types';
import { formatDateUtc } from '@/lib/date-format';

type Operator = { id: string; email: string; role: OperatorRole; createdAt: string };

export function OperatorManager({ role }: { role: OperatorRole }) {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/operator/operators', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load operators.');
      setOperators(result.operators);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load operators.');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setNotice('');
    setCreated(null);
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      const response = await fetch('/api/operator/operators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to create operator.');
      setCreated({ email: result.operator.email, password: result.password });
      setNotice(result.message);
      form.reset();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create operator.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <Users size={19} className="mt-1 text-muted-foreground" />
          <div>
            <CardTitle>Operator accounts</CardTitle>
            <CardDescription>
              {role === 'superadmin' ? 'Superadmins can add admins and viewers.' : 'Admins can add viewer accounts.'}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <Feedback tone="error" presentation="panel">{error}</Feedback>}
        {notice && <Feedback tone="success" presentation="panel">{notice}</Feedback>}
        {created && (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-4 text-sm">
            <p><strong>{created.email}</strong> · generated password (shown once)</p>
            <code className="block break-all rounded bg-background p-3">{created.password}</code>
            <Button type="button" size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(created.password)}>
              <Copy /> Copy generated password
            </Button>
          </div>
        )}
        <form onSubmit={submit} className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-[1fr_auto_auto]">
          <label htmlFor="operator-email" className="space-y-2 text-sm">
            <span>Email address</span>
            <Input id="operator-email" name="email" type="email" required maxLength={254} autoComplete="off" />
          </label>
          {role === 'superadmin' ? (
            <label htmlFor="operator-role" className="space-y-2 text-sm">
              <span>Access level</span>
              <Select id="operator-role" name="role" defaultValue="admin">
                <option value="admin">Admin</option>
                <option value="viewer">User (viewer)</option>
              </Select>
            </label>
          ) : <input type="hidden" name="role" value="viewer" />}
          <div className="flex items-end">
            <Button type="submit" disabled={pending}><CirclePlus /> Add operator</Button>
          </div>
        </form>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Created</th></tr></thead>
            <tbody>{operators.map((operator) => <tr key={operator.id} className="border-t"><td className="p-3 font-medium">{operator.email}</td><td className="p-3">{operator.role === 'viewer' ? 'User (viewer)' : operator.role}</td><td className="p-3">{formatDateUtc(operator.createdAt)} UTC</td></tr>)}</tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
