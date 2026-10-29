// UI kit: Card — a bordered surface. `as="form"` lets a whole form be one card (settings); only then are form
// attributes (onSubmit, noValidate, action, ...) accepted.
import { createElement, type ComponentPropsWithoutRef } from 'react';
import { cx } from './cx.ts';

export type CardProps =
  | ({ as: 'form' } & ComponentPropsWithoutRef<'form'>)
  | ({ as?: 'section' | 'div' | 'article' } & ComponentPropsWithoutRef<'section'>);

export function Card({ as = 'section', className, children, ...rest }: CardProps) {
  return createElement(as, { ...rest, className: cx('ui-card', className) }, children);
}
