// docs/specs/fixed-assets.md AC-32..AC-34: the pure parts of the depreciation-run screen (URL search, run gating,
// blocker texts in both languages, totals and the announcement after a run, navigation and help entries).
import { describe, expect, it } from 'vitest';
import type { ActionMeta, AppMeta } from '../api/types.ts';
import { helpTopicFor } from './help.ts';
import {
  BLOCKER_LABEL,
  BLOCKERS,
  canRun,
  methodText,
  parseDepreciationSearch,
  PREVIEW_ACTION,
  runAnnouncement,
  runBlockers,
  skippedText,
  totalText,
  type DepreciationPreview,
} from './depreciation.ts';
import { buildNavigation, findNavigationEntry } from './navigation.ts';

const PERIOD = '4d1c1d6e-3c0b-4a8e-9a55-0f0d6f6a1b2c';
const preview = (over: Partial<DepreciationPreview> = {}): DepreciationPreview => ({
  period: {
    id: PERIOD,
    code: '2026-10',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
    isClosed: false,
    isFuture: false,
  },
  fiscalYear: { id: 'fy', code: 'FY2026', isClosed: false },
  defaulted: false,
  rules: { id: 'jp-2026-10-30', verifiedOn: null, confirmedOn: '2026-10-30', usable: true },
  lines: [
    {
      assetId: 'a',
      code: 'G1',
      name: '備品',
      method: 'declining_200',
      usefulLife: 5,
      openingBookValue: '600000',
      annualAmount: '60000',
      bookedInYear: '0',
      amount: '10000',
      expenseAccountId: 'e',
      accumulatedAccountId: 'c',
      switched: true,
    },
  ],
  total: '10000',
  assetCount: 1,
  overLimit: false,
  runs: [],
  skipped: { disposed: 0, not_in_service: 2, fully_depreciated: 0, already_booked: 1, nothing_due: 0 },
  priorYearPending: null,
  blockers: [],
  ...over,
});

describe('depreciation screen (AC-32)', () => {
  it('AC-32: only a well-formed period id survives the URL search', () => {
    expect(parseDepreciationSearch({ periodId: PERIOD })).toEqual({ periodId: PERIOD });
    expect(parseDepreciationSearch({ periodId: 'x' })).toEqual({});
    expect(parseDepreciationSearch({})).toEqual({});
  });

  it('AC-32: the run is enabled only with something to book and no blocker', () => {
    expect(canRun(preview())).toBe(true);
    expect(canRun(preview({ lines: [] }))).toBe(false);
    expect(canRun(preview({ blockers: ['rules_unverified'] }))).toBe(false);
    expect(runBlockers(preview({ blockers: ['later_year_booked', 'period_closed'] }))).toEqual([
      'period_closed',
      'later_year_booked',
    ]);
  });

  it('AC-34: every blocker has Japanese and English text', () => {
    for (const b of BLOCKERS) expect(BLOCKER_LABEL[b].ja && BLOCKER_LABEL[b].en).toBeTruthy();
  });

  it('AC-32: totals, skipped reasons, method text and the run announcement in both languages', () => {
    expect(totalText(preview(), 'ja')).toBe('1 件、合計 10,000 円');
    expect(totalText(preview(), 'en')).toBe('1 asset, total 10,000 yen');
    expect(skippedText(preview().skipped, 'ja')).toBe('未供用 2 件、この期間に計上済み 1 件');
    expect(methodText(preview().lines[0] as DepreciationPreview['lines'][number], 'ja')).toBe(
      '定率法 5 年・改定償却率',
    );
    const run = {
      id: 'r',
      number: 'DR-2026-0001',
      journalEntryId: 'j',
      journalEntryNumber: 'JE-2026-0005',
      totalAmount: '15000',
      assetCount: 2,
    };
    expect(runAnnouncement({ created: true, run, rulesVerified: false }, '2026-10', 'ja')).toBe(
      '2026-10 の償却を計上しました（2 件、15,000 円、仕訳 JE-2026-0005）。',
    );
    expect(runAnnouncement({ created: false, existingRuns: [run], rulesVerified: false }, '2026-10', 'en')).toBe(
      'Nothing was due for 2026-10; no entry was created.',
    );
  });

  it('AC-33: the screen is listed in the finance workspace only with the preview action; help maps to the chapter', () => {
    const action = (name: string): ActionMeta => ({
      name,
      module: name.split('.')[0] ?? '',
      description: { ja: name, en: name },
      generic: false,
      mutates: false,
      resultKind: 'other',
    });
    const meta = (names: string[]): AppMeta => ({
      entities: [],
      actions: names.map(action),
      modules: [],
      roles: ['accounting'],
    });
    expect(findNavigationEntry(buildNavigation(meta([]), false), '/finance/depreciation')).toBeUndefined();
    expect(findNavigationEntry(buildNavigation(meta([PREVIEW_ACTION]), false), '/finance/depreciation')).toMatchObject({
      href: '/finance/depreciation',
      workspace: 'finance',
    });
    expect(helpTopicFor('/finance/depreciation')).toEqual({ chapter: 'appendix-o-fixed-assets.md' });
    expect(helpTopicFor('/e/fixed_asset')?.chapter).toBe('appendix-o-fixed-assets.md');
    expect(helpTopicFor('/r/fixed_assets.property_tax_summary')?.section).toBe('償却資産申告の集計');
  });
});
