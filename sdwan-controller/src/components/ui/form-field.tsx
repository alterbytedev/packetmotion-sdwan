import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type FormFieldProps = {
  label: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
};

export function FormField({ label, children, htmlFor, hint, error, className }: FormFieldProps) {
  const generatedId = useId();
  const controlId = htmlFor ?? generatedId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;

  return (
    <div className={cn('space-y-2', className)}>
      <label htmlFor={controlId} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p id={hintId} className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      {error && <p id={errorId} className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
