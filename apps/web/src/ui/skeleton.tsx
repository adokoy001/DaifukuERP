// UI kit: Skeleton placeholders. They are decorative (aria-hidden); the container announces the busy state instead.
import type { CSSProperties } from 'react';
import { cx } from './cx.ts';

export interface SkeletonProps {
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  className?: string;
}

export function Skeleton({ width, height, className }: SkeletonProps) {
  const style: CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = height;
  return <span aria-hidden="true" className={cx('ui-skeleton', className)} style={style} />;
}

const WIDTHS = ['72%', '48%', '86%', '60%', '38%', '66%'];

/** Placeholder rows for a tbody while the first page (or a changed query) loads. */
export function SkeletonRows({ rows = 6, columns }: { rows?: number; columns: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true" data-testid="skeleton-row">
          {Array.from({ length: Math.max(1, columns) }, (_, c) => (
            <td key={c}>
              <Skeleton width={WIDTHS[(r + c) % WIDTHS.length]} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Placeholder card with a few text lines. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="ui-skeleton-card" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={WIDTHS[i % WIDTHS.length]} />
      ))}
    </div>
  );
}
