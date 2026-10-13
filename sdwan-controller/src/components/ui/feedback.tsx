import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

type FeedbackProps = Omit<ComponentProps<'p'>, 'role'> & {
  tone?: 'error' | 'success' | 'loading';
  presentation?: 'inline' | 'panel';
};

export function Feedback({
  tone = 'loading',
  presentation = 'inline',
  className,
  ...props
}: FeedbackProps) {
  return (
    <p
      {...props}
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'text-sm',
        tone === 'error'
          ? 'text-red-700'
          : tone === 'success'
            ? 'text-primary'
            : 'text-muted-foreground',
        presentation === 'panel' && 'rounded-lg border p-3',
        presentation === 'panel' &&
          (tone === 'error'
            ? 'border-red-200 bg-red-50'
            : tone === 'success'
              ? 'bg-accent'
              : 'bg-muted'),
        className,
      )}
    />
  );
}
