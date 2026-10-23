import * as React from 'react';
import { Button, type ButtonProps } from './button';

type IconButtonProps = Omit<ButtonProps, 'size' | 'asChild' | 'aria-label'> & {
  'aria-label': string;
  size?: 'xs' | 'sm' | 'md' | 'default';
};
const sizes = { xs: 'icon-xs', sm: 'icon-compact', md: 'icon-md', default: 'icon' } as const;

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 'sm', type = 'button', variant = 'ghost', ...props }, ref) => (
    <Button ref={ref} type={type} variant={variant} size={sizes[size]} {...props} />
  ),
);
IconButton.displayName = 'IconButton';
