import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors focus:outline-none focus:ring-1 focus:ring-primary uppercase tracking-wider',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-[#0A0F18]',
        secondary: 'border border-border-default bg-surface-secondary text-text-primary',
        outline: 'border border-border-default text-text-muted',
        success: 'border border-success/30 bg-success/10 text-success',
        warning: 'border border-warning/30 bg-warning/10 text-warning',
        destructive: 'border border-danger/30 bg-danger/10 text-danger',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
