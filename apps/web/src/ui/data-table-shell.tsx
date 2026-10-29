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
  isEmpty?: boolean;
  /** Body shown when `isEmpty` (usually an <EmptyState>). */
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
  isEmpty = false,
  empty,
  label,
  fill = false,
  className,
  testId,
}: DataTableShellProps) {
  const columns = Math.max(1, columnCount);
  let body: ReactNode = children;
  if (skeleton) body = <SkeletonRows rows={skeletonRows} columns={columns} />;
  else if (isEmpty)
    body = (
      <tr>
        <td colSpan={columns} className="ui-cell-empty">
          {empty}
        </td>
      </tr>
    );
  return (
    <div
      className={cx('ui-table-frame', fill && 'is-fill', busy && !skeleton && 'is-refreshing', className)}
      aria-busy={busy || skeleton}
      data-testid={testId}
    >
      <table className="ui-table" aria-label={label}>
        <thead>{head}</thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
}
