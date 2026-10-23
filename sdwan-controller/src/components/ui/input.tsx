import * as React from 'react';
import { controlSizes, type ControlSize } from './control-size';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<'input'> & { controlSize?: ControlSize }
>(({ className, type, controlSize = 'default', ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      'flex w-full rounded-lg border border-input bg-background px-3 shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      controlSizes[controlSize],
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';
