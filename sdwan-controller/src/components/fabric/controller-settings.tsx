import { LogOut, Terminal } from 'lucide-react';
import { logout } from '@/app/login/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function ControllerSettings({ email, roleLabel }: { email: string; roleLabel: string }) {
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
            Additional operators, tenant management, and account editing are not available yet.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
