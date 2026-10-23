import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { controlSizes, type ControlSize } from './control-size';
import { cn } from '@/lib/utils';

type SelectProps = React.ComponentProps<'select'> & {
  containerClassName?: string;
  controlSize?: ControlSize;
};

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, containerClassName, children, controlSize = 'default', ...props }, ref) => (
    <span className={cn('group relative inline-flex w-full', containerClassName)}>
      <select
        ref={ref}
        className={cn(
          'w-full cursor-pointer appearance-none rounded-xl border border-input bg-background pl-3 pr-10 text-sm font-medium text-foreground shadow-sm transition-[border-color,box-shadow,background-color] duration-150 hover:border-foreground/25 hover:bg-muted/20 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 focus-visible:shadow-md disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-input disabled:hover:bg-background',
          controlSizes[controlSize],
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-1.5 top-1/2 size-6 -translate-y-1/2 rounded-lg bg-muted/70 p-1.5 text-muted-foreground transition-colors group-hover:bg-muted group-focus-within:bg-accent group-focus-within:text-accent-foreground"
      />
    </span>
  ),
);

Select.displayName = 'Select';
