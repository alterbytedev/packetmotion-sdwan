import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
const tones = {
  default: '',
  neutral: 'bg-muted/50 text-foreground',
  success: 'border-emerald-600/30 bg-emerald-600/10 text-emerald-800',
  warning: 'border-amber-600/30 bg-amber-600/10 text-amber-900',
  danger: 'border-rose-600/30 bg-rose-600/10 text-rose-800',
};

export function Badge({
  className,
  tone = 'default',
  size = 'default',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones; size?: 'sm' | 'default' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border text-[11px] font-medium',
        size === 'sm' ? 'whitespace-nowrap px-2 py-0.5' : 'px-2.5 py-1',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
