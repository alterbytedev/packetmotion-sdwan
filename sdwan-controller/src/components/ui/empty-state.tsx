import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

type EmptyStateProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
};
export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-4 py-8 text-center', className)} {...props}>
      {icon && (
        <span aria-hidden="true" className="mb-3 text-muted-foreground">
          {icon}
        </span>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
