// UI kit: Button. Variants map onto the existing .btn classes so current CSS and test selectors keep working.
import type { ButtonHTMLAttributes } from 'react';
import { cx } from './cx.ts';

export type ButtonVariant = 'primary' | 'default' | 'danger' | 'ghost';
export type ButtonSize = 'md' | 'sm';

const VARIANT_CLASS: Record<ButtonVariant, string | undefined> = {
  primary: 'btn-primary',
  default: undefined,
  danger: 'btn-danger',
  ghost: 'btn-ghost',
};

/** Class list for a button-looking element (also for router `<Link>`s that act as buttons). */
export function buttonClass(variant: ButtonVariant = 'default', size: ButtonSize = 'md', className?: string): string {
  return cx('btn', VARIANT_CLASS[variant], size === 'sm' && 'btn-sm', className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** A native button; `type` defaults to "button" so it never submits a surrounding form by accident. */
export function Button({ variant = 'default', size = 'md', type = 'button', className, ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}
