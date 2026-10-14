'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  size?: ModalSize;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
  className?: string;
};

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

const focusableSelector =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = 'md',
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
  className,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    if (!panel) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusable = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) => element.getClientRects().length > 0,
      );
    const focusFrame = requestAnimationFrame(() => {
      if (!panel.isConnected) return;
      (focusable()[0] ?? panel).focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && closeOnEscape) {
        event.preventDefault();
        onOpenChangeRef.current(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const controls = focusable();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel?.focus();
      } else if (event.shiftKey && (document.activeElement === first || !panel?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      cancelAnimationFrame(focusFrame);
      previouslyFocused?.focus();
    };
  }, [open, closeOnEscape]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close dialog backdrop"
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
        onClick={() => {
          if (closeOnBackdrop) onOpenChange(false);
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          'relative my-auto w-full rounded-xl border bg-card text-card-foreground shadow-xl outline-none',
          sizeClasses[size],
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b p-5 sm:p-6">
          <div className="space-y-1.5">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight">{title}</h2>
            {description && <p id={descriptionId} className="text-sm leading-relaxed text-muted-foreground">{description}</p>}
          </div>
          {showCloseButton && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close dialog"
              onClick={() => onOpenChange(false)}
              className="-mr-2 -mt-2 size-9 shrink-0"
            >
              <X aria-hidden="true" />
            </Button>
          )}
        </div>
        <div className="p-5 sm:p-6">{children}</div>
      </div>
    </div>
  );
}

export function ModalFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}
