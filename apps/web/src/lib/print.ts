// Print view of a document (web-polish): which action renders it and how the returned HTML gets a print bar.
// Data-driven from /meta: the record page looks for `<entity.module>.render_invoice_html` whose input has an `id`
// property (today `sales.render_invoice_html` for sales_invoice; a module adding the same-named action gets the button
// for free). Pure; print.test.ts.
import type { ActionMeta, EntityMeta } from '../api/types.ts';

export const PRINT_ACTION_SUFFIX = 'render_invoice_html';

/** The render action of an entity's module, when its input schema takes `{ id }`. */
export function printActionFor(entity: Pick<EntityMeta, 'module'>, actions: readonly ActionMeta[]): ActionMeta | undefined {
  if (!entity.module) return undefined;
  const name = `${entity.module}.${PRINT_ACTION_SUFFIX}`;
  return actions.find((a) => a.name === name && a.inputSchema?.properties?.id !== undefined);
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
export function withPrintBar(html: string, labels: PrintBarLabels): string {
  const bar =
    `<style>.daifuku-print-bar{position:fixed;top:8px;right:8px;z-index:2147483647;display:flex;gap:6px;font:13px system-ui,sans-serif}` +
    `.daifuku-print-bar button{padding:4px 12px;border:1px solid #888;border-radius:4px;background:#fff;cursor:pointer}` +
    `.daifuku-print-bar button:hover{background:#eee}@media print{.daifuku-print-bar{display:none}}</style>` +
    `<div class="daifuku-print-bar"><button type="button" onclick="window.print()">${escapeHtml(labels.print)}</button>` +
    `<button type="button" onclick="window.close()">${escapeHtml(labels.close)}</button></div>`;
  const body = /<body[^>]*>/i.exec(html);
  if (!body) return `${bar}${html}`;
  const at = body.index + body[0].length;
  return `${html.slice(0, at)}${bar}${html.slice(at)}`;
}
