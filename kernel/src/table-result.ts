// TableResult: the output shape of report actions (docs/conventions/reports.md). Shared by every report action
// (accounting, sales, purchase, payment, packs); the generic web report page renders it.
import type { Label } from './i18n.ts';
import { z } from 'zod';

export const COLUMN_KINDS = ['text', 'decimal', 'int', 'date', 'ref', 'bool'] as const;
export type ColumnKind = (typeof COLUMN_KINDS)[number];

const labelSchema = z.object({ ja: z.string(), en: z.string() });

export const tableColumn = z.object({
  key: z.string(),
  label: labelSchema,
  kind: z.enum(COLUMN_KINDS),
  /** kind='ref': target entity name (the UI turns the cell into a link). */
  ref: z.string().optional(),
  align: z.enum(['left', 'right']).optional(),
});

export const tableResult = z.object({
  title: labelSchema,
  columns: z.array(tableColumn),
  /** Decimal cells are strings. */
  rows: z.array(z.record(z.string(), z.unknown())),
  /** column key -> total (decimal string). */
  totals: z.record(z.string(), z.string()).optional(),
  /** Period, filters, truncation flag. */
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type TableColumn = z.infer<typeof tableColumn>;
export type TableResult = z.infer<typeof tableResult>;

/** Row cap from docs/conventions/reports.md; beyond it `meta.truncated = true`. */
export const MAX_REPORT_ROWS = 10000;

export function column(key: string, label: Label, kind: ColumnKind, extra: { ref?: string; align?: 'left' | 'right' } = {}): TableColumn {
  const align = extra.align ?? (kind === 'decimal' || kind === 'int' ? 'right' : 'left');
  return { key, label, kind, align, ...(extra.ref ? { ref: extra.ref } : {}) };
}
