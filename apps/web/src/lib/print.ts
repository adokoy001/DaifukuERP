// Print views of documents (docs/specs/print-templates.md AC-3, AC-4; web-polish print bar). Declarative from /meta: a
// render action `<module>.render_<document>_html` carries `print: { entity, label, idInput, when?, fields? }`, and the
// record page of that entity offers it when the record matches. No per-document table lives in the Web. Pure;
// print.test.ts.
import type { ActionMeta, EntityMeta, JsonSchema, PrintBindingMeta, SettingFieldMeta } from '../api/types.ts';
import { DOCSTATUS } from '../api/types.ts';

/** A /meta action that declares where it prints. */
export type PrintAction = ActionMeta & { print: PrintBindingMeta };

/** The record values the declaration may test (`when`) and the document state. */
export type PrintableRecord = Readonly<Record<string, unknown>> & { docstatus?: number };

/**
 * AC-3: the print actions offered on a record of `entity`, in /meta order — declared for this entity, whose input has
 * the `idInput` property, whose `when` values all equal the record's, and (documents) only once submitted.
 */
export function printActionsFor(
  entity: Pick<EntityMeta, 'name' | 'kind'>,
  record: PrintableRecord,
  actions: readonly ActionMeta[],
): PrintAction[] {
  if (entity.kind === 'document' && record.docstatus !== DOCSTATUS.submitted) return [];
  return actions.filter((a): a is PrintAction => {
    const print = a.print;
    if (!print || print.entity !== entity.name) return false;
    if (a.inputSchema?.properties?.[print.idInput] === undefined) return false;
    return Object.entries(print.when ?? {}).every(([field, value]) => record[field] === value);
  });
}

/** The input schema without the id property: what the dialog asks for, or undefined when nothing else is needed. */
export function extraInputSchema(action: PrintAction): JsonSchema | undefined {
  const properties = { ...(action.inputSchema?.properties ?? {}) };
  delete properties[action.print.idInput];
  if (Object.keys(properties).length === 0) return undefined;
  const required = (action.inputSchema?.required ?? []).filter((name) => name !== action.print.idInput);
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

/** AC-4: the dialog labels and help in ja and en, as the settings console's presentation (`schemaFields` 3rd arg). */
export function printFieldPresentation(action: PrintAction): Record<string, SettingFieldMeta> | undefined {
  const fields = action.print.fields;
  if (!fields) return undefined;
  return Object.fromEntries(
    Object.entries(fields).map(([name, f]) => [
      name,
      f.description ? { label: f.label, description: f.description } : { label: f.label },
    ]),
  );
}

/** AC-4: the action input — the extra values, then the record id under `idInput` (which always wins). */
export function printInputOf(
  action: PrintAction,
  recordId: string,
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return { ...extra, [action.print.idInput]: recordId };
}

/** `{ html }` from the action output; anything else is not printable. */
export function htmlOf(raw: unknown): string | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const html = (raw as Record<string, unknown>).html;
  return typeof html === 'string' && html.trim().length > 0 ? html : undefined;
}

export interface PrintBarLabels {
  print: string;
  close: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Adds a fixed toolbar (print / close) to a rendered document. Hidden by `@media print`, so the paper output is the
 * module's layout untouched. Inserted right after `<body ...>` when present, else before the content.
 */
export function withPrintBar(html: string, labels: PrintBarLabels, webOrigin: string): string {
  // The caller supplies location.origin, never an API-returned URL. Blob documents need an absolute asset URL.
  const origin = new URL(webOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== webOrigin)
    throw new Error('Print controls require the current Web origin.');
  const controls = new URL('/print-controls.js', origin).href;
  const bar =
    `<style>.daifuku-print-bar{position:fixed;top:8px;right:8px;z-index:2147483647;display:flex;gap:6px;font:13px system-ui,sans-serif}` +
    `.daifuku-print-bar button{padding:4px 12px;border:1px solid #888;border-radius:4px;background:#fff;cursor:pointer}` +
    `.daifuku-print-bar button:hover{background:#eee}@media print{.daifuku-print-bar{display:none}}</style>` +
    `<div class="daifuku-print-bar"><button type="button" data-daifuku-print="print">${escapeHtml(labels.print)}</button>` +
    `<button type="button" data-daifuku-print="close">${escapeHtml(labels.close)}</button></div>` +
    `<script src="${escapeHtml(controls)}" defer></script>`;
  const body = /<body[^>]*>/i.exec(html);
  if (!body) return `${bar}${html}`;
  const at = body.index + body[0].length;
  return `${html.slice(0, at)}${bar}${html.slice(at)}`;
}
