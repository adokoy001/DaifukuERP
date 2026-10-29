// UI kit: DataTableShell — table frame with a sticky header, numeric right alignment, an empty state and skeleton rows.
// The caller owns the column model (header row and body rows); the shell owns the states around them.
import type { ReactNode } from 'react';
import { cx } from './cx.ts';
import { SkeletonRows } from './skeleton.tsx';

export type CellAlign = 'left' | 'right';

/** Class for numeric (right-aligned, tabular) header and body cells. */
export function cellAlignClass(align: CellAlign | undefined): string | undefined {
  return align === 'right' ? 'ui-cell-num' : undefined;
}

/** aria-sort for a column header: only the sorted column carries it (ARIA: at most one sorted header at a time). */
export function ariaSortFor(dir: false | 'asc' | 'desc'): 'ascending' | 'descending' | undefined {
  return dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined;
}

export interface DataTableShellProps {
  /** Header row(s): <tr><th scope="col">…</th></tr>. */
  head: ReactNode;
  /** Body rows, rendered when neither skeleton nor empty applies. */
  children?: ReactNode;
  columnCount: number;
  /** Data is being (re)fetched: sets aria-busy and shows a thin progress bar over the kept rows. */
  busy?: boolean;
  /** Replace the body with placeholder rows (first load, or a changed query whose old rows would mislead). */
  skeleton?: boolean;
  skeletonRows?: number;
  /**
   * Already-translated "Loading…" text. When given, a visually hidden polite live region (outside the busy frame, so
   * it is not muted with it) says it while the skeleton rows are shown.
   */
  loadingLabel?: string;
  isEmpty?: boolean;
  /** Shown when `isEmpty` (usually an <EmptyState>), after the table and as wide as the visible frame. */
  empty?: ReactNode;
  /** Accessible name of the table. */
  label?: string;
  /** Bound the height to the viewport so the sticky header stays visible (list screens). */
  fill?: boolean;
  className?: string;
  testId?: string;
}

export function DataTableShell({
  head,
  children,
  columnCount,
  busy = false,
  skeleton = false,
  skeletonRows = 6,
  loadingLabel,
  isEmpty = false,
  empty,
  label,
  fill = false,
  className,
  testId,
}: DataTableShellProps) {
  const showEmpty = !skeleton && isEmpty;
  const body = skeleton ? (
    <SkeletonRows rows={skeletonRows} columns={Math.max(1, columnCount)} />
  ) : showEmpty ? null : (
    children
  );
  return (
    <>
      {loadingLabel !== undefined ? (
        <p className="sr-only" aria-live="polite">
          {skeleton ? loadingLabel : ''}
        </p>
      ) : null}
      <div
        className={cx('ui-table-frame', fill && 'is-fill', busy && !skeleton && 'is-refreshing', className)}
        aria-busy={busy || skeleton}
        data-testid={testId}
      >
        <table className="ui-table" aria-label={label}>
          <thead>{head}</thead>
          <tbody>{body}</tbody>
        </table>
        {showEmpty ? <div className="ui-table-empty">{empty}</div> : null}
      </div>
    </>
  );
}
