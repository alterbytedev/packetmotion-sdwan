'use client';

import { useActionState, useState } from 'react';
import { ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { login } from '@/app/login/actions';
import { Button } from '@/components/ui/button';
import { Feedback } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';

export function LoginForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(login, { error: '' });
  const [visible, setVisible] = useState(false);
  return (
    <form action={action} className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium">
          Email address
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="you@company.com"
          autoComplete="username"
          required
          maxLength={254}
          disabled={pending}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={visible ? 'text' : 'password'}
            placeholder="Enter your password"
            autoComplete="current-password"
            required
            maxLength={1024}
            disabled={pending}
            className="pr-12"
          />
          <Button
            variant="unstyled"
            size="icon-sm"
            type="button"
            onClick={() => setVisible(!visible)}
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-pressed={visible}
            className="absolute right-3 top-3 rounded text-muted-foreground"
          >
            {visible ? <EyeOff size={18} /> : <Eye size={18} />}
          </Button>
        </div>
      </div>
      {!configured && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Set up operator access with <code>npm run init:superadmin</code> on the controller.
        </p>
      )}
      {state.error && (
        <Feedback tone="error" presentation="panel">
          {state.error}
        </Feedback>
      )}
      <Button className="w-full" size="lg" disabled={pending || !configured}>
        {pending ? (
          <>
            <LoaderCircle className="animate-spin" /> Signing in…
          </>
        ) : (
          <>
            Sign in to controller <ArrowRight />
          </>
        )}
      </Button>
      <p className="text-center text-xs leading-5 text-muted-foreground">
        Access is restricted to authorized operators.
        <br />
        Contact your controller administrator for access.
      </p>
    </form>
  );
}
