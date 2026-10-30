// Pure helpers of /admin/health (docs/specs/setup-health.md AC-9): items ordered fail, warn, ok (stable inside a
// status), the status shown as both a colour tone and a word, the summary line, and which links the screen follows.
import type { Label } from '../api/types.ts';

export type HealthStatus = 'ok' | 'warn' | 'fail';
export interface HealthItem {
  id: string;
  status: HealthStatus;
  label: Label;
  detail: Label;
  href?: string;
}
export interface HealthReport {
  checkedAt: string;
  items: HealthItem[];
}

const RANK: Record<HealthStatus, number> = { fail: 0, warn: 1, ok: 2 };

export function sortHealthItems(items: readonly HealthItem[]): HealthItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => RANK[a.item.status] - RANK[b.item.status] || a.index - b.index)
    .map((entry) => entry.item);
}

export const STATUS_TEXT: Record<HealthStatus, Label> = {
  fail: { ja: '要対応', en: 'Action needed' },
  warn: { ja: '注意', en: 'Check' },
  ok: { ja: 'OK', en: 'OK' },
};
export const STATUS_TONE: Record<HealthStatus, 'danger' | 'warning' | 'success'> = {
  fail: 'danger',
  warn: 'warning',
  ok: 'success',
};

export function healthCounts(items: readonly HealthItem[]): Record<HealthStatus, number> {
  const counts: Record<HealthStatus, number> = { fail: 0, warn: 0, ok: 0 };
  for (const item of items) counts[item.status]++;
  return counts;
}

export function summaryText(items: readonly HealthItem[]): Label {
  const c = healthCounts(items);
  if (c.fail === 0 && c.warn === 0) return { ja: `${c.ok} 項目すべて OK です。`, en: `All ${c.ok} items are OK.` };
  return {
    ja: `要対応 ${c.fail} 件・注意 ${c.warn} 件・OK ${c.ok} 件`,
    en: `${c.fail} action needed, ${c.warn} to check, ${c.ok} OK`,
  };
}

/** The router target of an item link: in-app paths only (the API already drops anything else). */
export function healthLink(href: string | undefined): { to: string; search: Record<string, string> } | undefined {
  if (!href || !/^\/(?!\/)[A-Za-z0-9/_.?=&-]*$/.test(href) || href.includes('..')) return undefined;
  const at = href.indexOf('?');
  if (at < 0) return { to: href, search: {} };
  return { to: href.slice(0, at), search: Object.fromEntries(new URLSearchParams(href.slice(at + 1))) };
}

/** The link text says what the screen is for: fixing a problem, or reviewing a setting that is fine. */
export function linkText(status: HealthStatus): Label {
  return status === 'ok' ? { ja: '確認する', en: 'Review' } : { ja: '直す', en: 'Fix' };
}
