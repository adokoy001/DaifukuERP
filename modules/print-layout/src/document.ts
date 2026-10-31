// A complete printable HTML document (docs/specs/print-templates.md AC-5, AC-6, AC-25): doctype, lang, title, viewport,
// A4 page box and one inline stylesheet. No script, external resource or event attribute is ever emitted.
import type { Locale } from '@daifuku/kernel';
import { escapeHtml } from './format.ts';

const PAGE_CSS =
  '@page{size:A4;margin:12mm}' +
  'html,body{margin:0;background:#fff;color:#111}' +
  '.print-document *{box-sizing:border-box}' +
  // Paper: a smaller type size and tighter cells (overriding the parts' inline padding) so 20 item lines fit one A4
  // page (spec verification step 5, measured with Chromium PDF output).
  '@media print{.print-document{padding:0;max-width:none;font-size:11px}' +
  '.print-document th,.print-document td{padding:2px 6px!important}' +
  '.print-document .table-wrap{overflow:visible;margin:6px 0!important}' +
  '.print-document .parties{margin:8px 0!important}}';

export interface PrintDocumentInput {
  title: string;
  locale: Locale;
  /** HTML built from the shared parts (already escaped). */
  body: string;
  /** Extra class on the article (e.g. `quotation`). */
  className: string;
}

/** Wraps the body in a full document: `<!DOCTYPE html>`, `<html lang>`, `<title>`, viewport and the A4 `@page`. */
export function printDocument(input: PrintDocumentInput): string {
  return [
    '<!DOCTYPE html>',
    `<html lang="${input.locale}">`,
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)}</title><style>${PAGE_CSS}</style></head>`,
    '<body>',
    `<article class="print-document ${escapeHtml(input.className)}" lang="${input.locale}" style="font-family:sans-serif;max-width:800px;margin:0 auto;padding:16px;color:#111;overflow-wrap:anywhere;">`,
    input.body,
    '</article>',
    '</body>',
    '</html>',
  ].join('\n');
}

/**
 * Puts a state banner (statusBanner) at the top of the body: right after `<body ...>` when the (possibly overridden)
 * layout has one, otherwise in front of the fragment. An empty banner leaves the HTML unchanged (AC-17).
 */
export function withStatusBanner(html: string, banner: string): string {
  if (!banner) return html;
  return /<body[^>]*>/i.test(html) ? html.replace(/<body([^>]*)>/i, `<body$1>${banner}`) : banner + html;
}
