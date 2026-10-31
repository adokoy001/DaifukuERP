// form-ergonomics AC-3: the error summary at the top of the generic form — every message of a failed save in the
// order the form shows it, each with the element id of its input (header field or line-grid cell) when one is on the
// screen. Pure; components/form-error-summary.tsx renders it and moves focus.
import type { EntityMeta, FieldMeta, Label } from '../api/types.ts';
import type { GridErrors, GridRow } from './lines.ts';

/** One message of the summary. `targetId` is absent when no input on the form owns the message. */
export interface SummaryItem {
  key: string;
  message: string;
  /** Element id of the input to focus (`f-<field>` / `l-<line>-<rowKey>-<field>`). */
  targetId?: string;
  /** The form section that holds the input (switches the tab first on a narrow screen). */
  section?: string;
  /** Field label (header field or grid column); absent for form-level messages. */
  field?: Label | string;
  /** Line grid and 1-based row number of a cell message. */
  line?: { label: Label; row: number };
}

export interface SummaryInput {
  /** Header sections as rendered (after create-mode filtering), including the ext fields as their own section. */
  sections: readonly { key: string; fields: readonly FieldMeta[] }[];
  /** Every header field the entity has (labels of messages for fields that are not rendered). */
  allFields: readonly FieldMeta[];
  fieldErrors: Readonly<Record<string, string>>;
  formErrors: readonly string[];
  lines: readonly { line: EntityMeta; columns: readonly FieldMeta[]; rows: readonly GridRow[]; errors: GridErrors }[];
}

export const headerFieldId = (name: string) => `f-${name}`;
export const gridCellId = (line: string, rowKey: string, field: string) => `l-${line}-${rowKey}-${field}`;

/** Form-level messages first (no input), then header fields in section order, then grid cells row by row. */
export function errorSummary(input: SummaryInput): SummaryItem[] {
  const items: SummaryItem[] = input.formErrors.map((message, i) => ({ key: `form:${i}`, message }));
  const listed = new Set<string>();
  for (const section of input.sections)
    for (const field of section.fields) {
      const message = input.fieldErrors[field.name];
      if (message === undefined || listed.has(field.name)) continue;
      listed.add(field.name);
      items.push({
        key: `field:${field.name}`,
        message,
        targetId: headerFieldId(field.name),
        section: section.key,
        field: field.label,
      });
    }
  const labels = new Map(input.allFields.map((f) => [f.name, f.label] as const));
  for (const [name, message] of Object.entries(input.fieldErrors)) {
    if (listed.has(name)) continue;
    items.push({ key: `field:${name}`, message, field: labels.get(name) ?? name });
  }
  for (const grid of input.lines) {
    const columns = new Map(grid.columns.map((c) => [c.name, c] as const));
    const fieldLabels = new Map(grid.line.fields.map((f) => [f.name, f.label] as const));
    grid.rows.forEach((row, index) => {
      const errors = grid.errors[row.key];
      if (!errors) return;
      const shown = grid.columns.filter((c) => errors[c.name] !== undefined).map((c) => c.name);
      const other = Object.keys(errors).filter((name) => !columns.has(name));
      for (const name of [...shown, ...other]) {
        const message = errors[name];
        if (message === undefined) continue;
        const column = columns.get(name);
        items.push({
          key: `line:${grid.line.name}:${row.key}:${name}`,
          message,
          ...(column ? { targetId: gridCellId(grid.line.name, row.key, name) } : {}),
          field: column?.label ?? fieldLabels.get(name) ?? name,
          line: { label: grid.line.label, row: index + 1 },
        });
      }
    });
  }
  return items;
}

/** The first item that has an input to focus (AC-3: focus moves there after a failed save). */
export function firstTarget(items: readonly SummaryItem[]): SummaryItem | undefined {
  return items.find((item) => item.targetId !== undefined);
}
