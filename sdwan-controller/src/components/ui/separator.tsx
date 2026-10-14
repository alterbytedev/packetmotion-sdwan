import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type SeparatorProps = HTMLAttributes<HTMLDivElement> & {
  orientation?: 'horizontal' | 'vertical';
};

export function Separator({
  className,
  orientation = 'horizontal',
  ...props
}: SeparatorProps) {
  const isHorizontal = orientation === 'horizontal';
  const classes = cn(
    'shrink-0 border-0 bg-border',
    isHorizontal ? 'h-px w-full' : 'h-full w-px',
    className,
  );
  return <hr aria-orientation={orientation} className={classes} {...props} />;
}
