// UI kit: Toolbar — a wrapping row of controls (search, filters) with an optional end-aligned group (pager, counts).
// It is a plain group, not role="toolbar": the controls keep their normal Tab order.
import type { ReactNode } from 'react';
import { cx } from './cx.ts';

export interface ToolbarProps {
  children?: ReactNode;
  /** Right-aligned group. */
  end?: ReactNode;
  /** Accessible name; when given the row is exposed as a named group. */
  label?: string;
  className?: string;
}

export function Toolbar({ children, end, label, className }: ToolbarProps) {
  return (
    <div className={cx('ui-toolbar', className)} role={label ? 'group' : undefined} aria-label={label}>
      {children}
      {end ? <div className="ui-toolbar-end">{end}</div> : null}
    </div>
  );
}
