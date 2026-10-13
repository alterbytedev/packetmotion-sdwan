'use client';

import { LoaderCircle, Network, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function ControllerHealthCard({
  status,
  checking,
  checkedAt,
  onRefresh,
  error,
}: {
  status: string;
  checking: boolean;
  checkedAt: string;
  onRefresh: () => void;
  error: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Controller health</CardTitle>
          <CardDescription className="mt-1">Application availability.</CardDescription>
        </div>
        <Button
          size="icon"
          variant="ghost"
          disabled={checking}
          onClick={onRefresh}
          aria-label="Refresh controller health"
        >
          {checking ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
              <Network size={18} />
            </div>
            <div>
              <p className="text-xs font-medium">Controller application</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {checkedAt ? `Last checked ${checkedAt}` : 'Run a live availability check'}
              </p>
            </div>
          </div>
          <Badge
            role="status"
            className={
              error ? 'border-red-200 bg-red-50 text-red-700' : 'bg-muted text-muted-foreground'
            }
          >
            {status}
          </Badge>
        </div>
        <p className="mt-4 text-[11px] leading-5 text-muted-foreground">
          Checks the controller application only. Database readiness and device connections are not
          included.
        </p>
      </CardContent>
    </Card>
  );
}
