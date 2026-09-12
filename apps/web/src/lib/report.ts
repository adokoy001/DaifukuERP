// Pure helpers for report pages (web-phase1 AC-3). report.test.ts.
import type { ActionMeta, Label, TableResult } from '../api/types.ts';

const TITLE_MAX = 32;
const SENTENCE_END = /[。．.:：（(]/;
/** `試算表を返します` -> `試算表`: the verb tail the action descriptions conventionally end with. */
const JA_VERB_TAIL = /(を|の)?(返|出力|表示|作成|集計|計算)します$/;

function shorten(s: string, tail?: RegExp): string {
  const cut = SENTENCE_END.exec(s);
  let head = (cut && cut.index > 0 ? s.slice(0, cut.index) : s).trim();
  if (tail) head = head.replace(tail, '') || head;
  return head.length > TITLE_MAX ? `${head.slice(0, TITLE_MAX)}…` : head;
}

/** Menu title for a report: actions only carry a description, so its first clause is used (`試算表を返します。…` -> `試算表`). */
export function reportTitle(action: Pick<ActionMeta, 'name' | 'description'>): Label {
  const ja = shorten(action.description.ja, JA_VERB_TAIL);
  const en = shorten(action.description.en);
  return { ja: ja || action.name, en: en || action.name };
}

/** Totals whose key is a column key: shown in the table's totals row. */
export function columnTotals(result: TableResult): Record<string, string> {
  const keys = new Set(result.columns.map((c) => c.key));
  return Object.fromEntries(Object.entries(result.totals ?? {}).filter(([k]) => keys.has(k)));
}

/**
 * web-phase15 AC-7: totals whose key matches no column (e.g. accounting.tax_period_summary `output_tax_total`,
 * `input_tax_total`, `net_tax_due`), in the server's order; shown as a key/value list below the table and appended to CSV.
 */
export function extraTotals(result: TableResult): [string, string][] {
  const keys = new Set(result.columns.map((c) => c.key));
  return Object.entries(result.totals ?? {}).filter(([k]) => !keys.has(k));
}
