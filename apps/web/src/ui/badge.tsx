// UI kit: Badge — short status or count label coloured by a semantic tone.
import type { HTMLAttributes } from 'react';
import { cx } from './cx.ts';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps) {
  return <span className={cx('ui-badge', `ui-badge-${tone}`, className)} {...rest} />;
}
