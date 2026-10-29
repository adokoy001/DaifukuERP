// UI kit: EmptyState — what is (not) here and the next step. Not a live region: it describes a settled state.
import type { ReactNode } from 'react';
import { cx } from './cx.ts';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  /** Primary next step (create, clear search, import). */
  action?: ReactNode;
  icon?: ReactNode;
  /** Use a heading when the empty state is the main content of a page region (h1 when it is the whole screen). */
  titleAs?: 'p' | 'h1' | 'h2' | 'h3';
  className?: string;
  testId?: string;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  titleAs: Title = 'p',
  className,
  testId = 'empty-state',
}: EmptyStateProps) {
  return (
    <div className={cx('ui-empty', className)} data-testid={testId}>
      {icon ? (
        <span className="ui-empty-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <Title className="ui-empty-title">{title}</Title>
      {description ? <p className="ui-empty-description">{description}</p> : null}
      {action ? <div className="ui-empty-actions">{action}</div> : null}
    </div>
  );
}
