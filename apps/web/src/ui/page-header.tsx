// UI kit: PageHeader — the screen title (h1) with optional back link, eyebrow, inline meta, subtitle and actions.
// The icon and the text block share a row that never wraps; only the actions move below on a narrow screen.
import type { ReactNode } from 'react';
import { cx } from './cx.ts';

export interface PageHeaderProps {
  title: ReactNode;
  /** Small line under the title (what the screen is for). */
  subtitle?: ReactNode;
  /** Back link rendered above the title (e.g. "← Partners"). */
  back?: ReactNode;
  /** Small uppercase label above the title. */
  eyebrow?: ReactNode;
  /** Inline after the title: technical name, number, status badge. */
  meta?: ReactNode;
  /** Leading visual (icon tile) before the text block. */
  icon?: ReactNode;
  /** Primary actions on the right (wrap below the title when the row is too narrow). */
  actions?: ReactNode;
  titleTestId?: string;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  back,
  eyebrow,
  meta,
  icon,
  actions,
  titleTestId,
  className,
}: PageHeaderProps) {
  return (
    <header className={cx('ui-page-header', className)}>
      <div className="ui-page-header-main">
        {icon}
        <div className="ui-page-header-text">
          {back}
          {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
          <div className="ui-page-header-title">
            <h1 data-testid={titleTestId}>{title}</h1>
            {meta}
          </div>
          {subtitle ? <p className="ui-page-header-subtitle">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="ui-page-header-actions">{actions}</div> : null}
    </header>
  );
}
