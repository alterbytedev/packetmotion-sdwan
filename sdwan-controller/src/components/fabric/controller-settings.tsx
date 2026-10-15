import { LogOut, Terminal } from 'lucide-react';
import { logout } from '@/app/login/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BrandingSettings } from './branding-settings';
import { InsecureHttpAllowlistSettings } from './insecure-http-allowlist-settings';
import { OperatorManager } from './operator-manager';
import type { OperatorRole } from '@/lib/fabric/types';

export function ControllerSettings({
  email,
  roleLabel,
  role,
  isSuperadmin,
}: {
  email: string;
  roleLabel: string;
  role: OperatorRole;
  isSuperadmin: boolean;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Operator account</CardTitle>
          <CardDescription>Your current controller access.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-4 text-sm">
            <div className="flex flex-wrap justify-between gap-2 border-b pb-4">
              <dt className="text-muted-foreground">Email address</dt>
              <dd className="font-medium">{email}</dd>
            </div>
            <div className="flex justify-between border-b pb-4">
              <dt className="text-muted-foreground">Role</dt>
              <dd>{roleLabel}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Session duration</dt>
              <dd>8 hours</dd>
            </div>
          </dl>
          <form action={logout} className="mt-6">
            <Button variant="outline">
              <LogOut /> Sign out of controller
            </Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Controller configuration</CardTitle>
          <CardDescription>Managed by the controller administrator.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 rounded-lg bg-muted p-4">
            <Terminal size={18} className="mt-1 shrink-0 text-muted-foreground" />
            <p className="text-xs leading-6 text-muted-foreground">
              Operator credentials and session signing keys are configured on the server. To reset
              access, follow the operator setup instructions in the controller README.
            </p>
          </div>
          <p className="mt-4 text-xs leading-6 text-muted-foreground">
            Superadmins can create admin and viewer accounts; admins can create viewer accounts;
            viewers cannot manage accounts. Account editing and password reset are not available yet.
          </p>
        </CardContent>
      </Card>
      {role !== 'viewer' && <div className="xl:col-span-2"><OperatorManager role={role} /></div>}
      {isSuperadmin && <div className="xl:col-span-2"><BrandingSettings /></div>}
      {isSuperadmin && <div className="xl:col-span-2"><InsecureHttpAllowlistSettings /></div>}
    </div>
  );
}
