// Pure helpers of the depreciation-run screen (docs/specs/fixed-assets.md AC-32..AC-34): the preview payload of
// fixed_assets.preview_depreciation, the URL search, and the texts the page shows (blockers, totals, results).
import type { Label, Locale } from '../api/types.ts';
import { formatDecimal } from './format.ts';

export const PREVIEW_ACTION = 'fixed_assets.preview_depreciation';
export const RUN_ACTION = 'fixed_assets.run_depreciation';
export const RULES_ACTION = 'fixed_assets.depreciation_rules';
export const RULES_SETTING_HREF = '/settings?tab=accounting';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface DepreciationSearch {
  periodId?: string;
}

/** validateSearch of /finance/depreciation: only a well-formed period id survives. */
export function parseDepreciationSearch(raw: Record<string, unknown>): DepreciationSearch {
  return typeof raw.periodId === 'string' && UUID.test(raw.periodId) ? { periodId: raw.periodId } : {};
}

export const BLOCKERS = [
  'period_closed',
  'year_closed',
  'future_period',
  'not_twelve_months',
  'rules_unverified',
  'over_limit',
  'later_year_booked',
] as const;
export type Blocker = (typeof BLOCKERS)[number];

export interface PreviewLine {
  assetId: string;
  code: string;
  name: string;
  method: string;
  usefulLife: number;
  openingBookValue: string;
  annualAmount: string;
  bookedInYear: string;
  amount: string;
  expenseAccountId: string;
  accumulatedAccountId: string;
  switched: boolean;
}

export interface RunSummary {
  id: string;
  number: string | null;
  journalEntryId: string | null;
  journalEntryNumber: string | null;
  totalAmount: string;
  assetCount: number;
}

export interface DepreciationPreview {
  period: { id: string; code: string; startDate: string; endDate: string; isClosed: boolean; isFuture: boolean };
  fiscalYear: { id: string; code: string; isClosed: boolean };
  defaulted: boolean;
  rules: { id: string; verifiedOn: string | null; confirmedOn: string | null; usable: boolean };
  lines: PreviewLine[];
  total: string;
  assetCount: number;
  overLimit: boolean;
  runs: RunSummary[];
  skipped: Record<string, number>;
  priorYearPending: { count: number; total: string; periodId: string } | null;
  blockers: Blocker[];
}

export interface RunResult {
  created: boolean;
  run?: RunSummary;
  existingRuns?: RunSummary[];
  rulesVerified: boolean;
}

export const METHOD_LABEL: Readonly<Record<string, Label>> = {
  straight_line: { ja: '定額法', en: 'Straight-line' },
  declining_200: { ja: '定率法', en: 'Declining balance' },
};

export const BLOCKER_LABEL: Readonly<Record<Blocker, Label>> = {
  period_closed: {
    ja: 'この期間は締め済みのため実行できません。実行するには月次締めの画面で期間を再開してください。',
    en: 'This period is closed, so depreciation cannot be run. Reopen it on the month-end close screen to run it.',
  },
  year_closed: {
    ja: 'この会計年度は締め済みのため実行できません。',
    en: 'This fiscal year is closed, so depreciation cannot be run.',
  },
  future_period: {
    ja: 'まだ始まっていない期間は実行できません（発生していない償却を計上しないため）。',
    en: 'A period that has not started cannot be run (depreciation that has not happened is not booked).',
  },
  not_twelve_months: {
    ja: '12 か月の暦月でない会計年度は扱えません。',
    en: 'Only fiscal years of twelve calendar months are supported.',
  },
  rules_unverified: {
    ja: '償却率表が一次資料と未照合で、会社の照合記録もありません。照合して設定に記録するまで実行できません。',
    en: 'The rate tables are not verified and the company has not recorded a confirmation. Run is blocked until it is recorded in the settings.',
  },
  over_limit: {
    ja: '1 回に計上できる資産は 500 件までです（未対応）。',
    en: 'One run books at most 500 assets (more is not supported yet).',
  },
  later_year_booked: {
    ja: '後の会計年度に償却を計上済みの資産があります。後の年度の実行を新しい順に取り消してから実行してください。',
    en: 'Some assets already have depreciation in a later fiscal year. Cancel the later runs, newest first, before running this period.',
  },
};

export const yen = (value: string): string => formatDecimal(value);

/** The blockers that stop a run, in display order; empty when the run button may be used. */
export function runBlockers(preview: DepreciationPreview): Blocker[] {
  return BLOCKERS.filter((b) => preview.blockers.includes(b));
}

/** True when the run button is shown enabled (something to book, nothing blocks). */
export function canRun(preview: DepreciationPreview): boolean {
  return preview.lines.length > 0 && runBlockers(preview).length === 0;
}

/** "N assets, total X yen" for the confirm dialog and the totals row. */
export function totalText(preview: Pick<DepreciationPreview, 'assetCount' | 'total'>, locale: Locale): string {
  return locale === 'ja'
    ? `${preview.assetCount} 件、合計 ${yen(preview.total)} 円`
    : `${preview.assetCount} asset${preview.assetCount === 1 ? '' : 's'}, total ${yen(preview.total)} yen`;
}

/** The polite announcement after a run. */
export function runAnnouncement(result: RunResult, periodCode: string, locale: Locale): string {
  if (!result.created || !result.run)
    return locale === 'ja'
      ? `${periodCode} に計上する償却はありませんでした。`
      : `Nothing was due for ${periodCode}; no entry was created.`;
  const entry = result.run.journalEntryNumber ?? result.run.journalEntryId ?? '';
  return locale === 'ja'
    ? `${periodCode} の償却を計上しました（${result.run.assetCount} 件、${yen(result.run.totalAmount)} 円、仕訳 ${entry}）。`
    : `Booked depreciation for ${periodCode} (${result.run.assetCount} assets, ${yen(result.run.totalAmount)} yen, entry ${entry}).`;
}

const SKIP_LABEL: Readonly<Record<string, Label>> = {
  disposed: { ja: '除却・売却済み', en: 'disposed' },
  not_in_service: { ja: '未供用', en: 'not in service' },
  fully_depreciated: { ja: '償却済み', en: 'fully depreciated' },
  already_booked: { ja: 'この期間に計上済み', en: 'already booked in this period' },
  nothing_due: { ja: '計上額 0', en: 'nothing due' },
};

/** "未供用 2 件、償却済み 1 件" — skipped assets by reason (zero reasons left out). */
export function skippedText(skipped: Record<string, number>, locale: Locale): string {
  const parts = Object.entries(SKIP_LABEL)
    .filter(([key]) => (skipped[key] ?? 0) > 0)
    .map(([key, l]) => (locale === 'ja' ? `${l.ja} ${skipped[key]} 件` : `${skipped[key]} ${l.en}`));
  return parts.join(locale === 'ja' ? '、' : ', ');
}

export function methodText(line: Pick<PreviewLine, 'method' | 'usefulLife' | 'switched'>, locale: Locale): string {
  const method = METHOD_LABEL[line.method]?.[locale] ?? line.method;
  const years = locale === 'ja' ? `${line.usefulLife} 年` : `${line.usefulLife} y`;
  const switched = line.switched ? (locale === 'ja' ? '・改定償却率' : ', revised rate') : '';
  return `${method} ${years}${switched}`;
}
