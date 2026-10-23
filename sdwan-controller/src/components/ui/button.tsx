import * as React from 'react';
import { LoaderCircle } from 'lucide-react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        outline:
          'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        destructive: 'bg-red-700 text-white shadow-sm hover:bg-red-800 focus-visible:ring-red-700',
        unstyled: '',
      },
      size: {
        default: 'h-10 px-4 py-2',
        xs: 'h-7 gap-1 px-2 text-xs [&_svg]:size-3.5',
        md: 'h-9 px-3 text-sm',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-12 px-6',
        icon: 'size-10',
        'icon-xs': 'size-7 [&_svg]:size-3.5',
        'icon-compact': 'size-8',
        'icon-md': 'size-9',
        'icon-sm': 'size-[18px] [&_svg]:size-[18px]',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> &
  ({ asChild: true; loading?: never } | { asChild?: false; loading?: boolean });

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, loading = false, disabled, children, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size, className }),
          loading && 'pointer-events-none',
        )}
        ref={ref}
        disabled={asChild ? undefined : disabled || loading}
        aria-disabled={asChild && (disabled || loading) ? true : undefined}
        aria-busy={loading || undefined}
        {...props}
      >
        {asChild || !loading ? (
          children
        ) : (
          <>
            <span className="inline-flex items-center justify-center gap-[inherit] opacity-0">
              {children}
            </span>
            {loading && (
              <LoaderCircle
                aria-hidden="true"
                className="absolute animate-spin motion-reduce:animate-none"
              />
            )}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
export { Button, buttonVariants };
