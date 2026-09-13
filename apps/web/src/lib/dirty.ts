import type { FormValues } from './form.ts';
import type { GridRow } from './lines.ts';

/** Client row keys change on a refetch; only values, persisted IDs and order describe the user's work. */
export function formFingerprint(values: FormValues, lines: Record<string, GridRow[]>): string {
  return JSON.stringify({
    values,
    lines: Object.fromEntries(
      Object.entries(lines).map(([name, rows]) => [name, rows.map(({ id, values: cells }) => ({ id, values: cells }))]),
    ),
  });
}
