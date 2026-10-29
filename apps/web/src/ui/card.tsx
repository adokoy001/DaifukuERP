// UI kit: Card — a bordered surface. `as="form"` lets a whole form be one card (settings).
import { createElement, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cx } from './cx.ts';

export interface CardProps extends ComponentPropsWithoutRef<'form'> {
  as?: 'section' | 'div' | 'article' | 'form';
  children?: ReactNode;
}

export function Card({ as = 'section', className, children, ...rest }: CardProps) {
  return createElement(as, { ...rest, className: cx('ui-card', className) }, children);
}
