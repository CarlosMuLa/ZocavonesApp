import { cn } from '../../lib/utils';

const ALERT_VARIANTS = {
  default: 'bg-background text-foreground',
  destructive: 'border-destructive/50 bg-destructive/10 text-destructive',
};

export function Alert({ className, variant = 'default', ...props }) {
  return (
    <div
      role="alert"
      className={cn('relative w-full rounded-lg border p-3.5 text-sm', ALERT_VARIANTS[variant], className)}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }) {
  return <h5 className={cn('font-semibold leading-none tracking-tight', className)} {...props} />;
}

export function AlertDescription({ className, ...props }) {
  return <div className={cn('mt-1.5 text-xs leading-relaxed', className)} {...props} />;
}
