import * as React from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Checkbox = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, ...props }, ref) => (
    <span className="relative inline-flex size-5 shrink-0">
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          'peer size-5 cursor-pointer appearance-none rounded border border-input bg-background transition-colors checked:border-primary checked:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
      <Check
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-auto size-3.5 text-primary-foreground opacity-0 peer-checked:opacity-100"
      />
    </span>
  ),
);
Checkbox.displayName = 'Checkbox';
