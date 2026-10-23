import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Table({
  className,
  density = 'comfortable',
  ...props
}: ComponentProps<'table'> & { density?: 'compact' | 'comfortable' }) {
  return (
    <table
      data-density={density}
      className={cn(
        'w-full caption-bottom text-left text-sm',
        density === 'compact' ? '[--table-cell-padding:0.625rem]' : '[--table-cell-padding:1rem]',
        className,
      )}
      {...props}
    />
  );
}
export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return (
    <thead
      className={cn(
        'border-y bg-muted/70 text-xs text-muted-foreground [&_th]:border-r [&_th]:border-border/60 [&_th:last-child]:border-r-0',
        className,
      )}
      {...props}
    />
  );
}
export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody className={cn('[&_tr:last-child]:border-b-0', className)} {...props} />;
}
export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      className={cn(
        'border-b transition-colors hover:bg-accent/40 focus-within:bg-accent/40 data-[selected=true]:bg-accent',
        className,
      )}
      {...props}
    />
  );
}
export function TableHead({ className, scope = 'col', ...props }: ComponentProps<'th'>) {
  return (
    <th
      scope={scope}
      className={cn('h-10 px-4 whitespace-nowrap font-semibold tracking-wide', className)}
      {...props}
    />
  );
}
export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      className={cn('px-4 py-[var(--table-cell-padding,1rem)] align-middle', className)}
      {...props}
    />
  );
}
export function TableToolbar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 border-b bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
      {...props}
    />
  );
}
