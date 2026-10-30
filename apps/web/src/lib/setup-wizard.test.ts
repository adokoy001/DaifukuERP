// docs/specs/setup-wizard.md AC-1, AC-3, AC-4, AC-6, AC-7, AC-10, AC-15, AC-20, AC-26: the wizard's pure helpers.
import { describe, expect, it } from 'vitest';
import {
  buildProgress,
  canConfirm,
  canSkip,
  canUndoSkip,
  cardTarget,
  fiscalYearEndMonth,
  initialStep,
  INVENTORY_GUIDE,
  inventoryState,
  isAdminRoles,
  issuerFromProfile,
  neighbourStep,
  OPTIONAL_TEXT,
  parseSetupSearch,
  progressText,
  proposeFiscalYear,
  showSetupCard,
  skipReasonError,
  STEP_STATUS_TEXT,
  stepperKeyTarget,
  tokyoDate,
  yearEnd,
  type FiscalYearRow,
  type SetupProgress,
  type SetupStatus,
  type SetupStep,
  type SetupStepId,
} from './setup-wizard.ts';

const AT = '2026-10-30T01:00:00.000Z';
const NOW = new Date('2026-10-30T02:00:00.000Z');
const year = (startDate: string, endDate: string, code = startDate.slice(0, 4)): FiscalYearRow => ({
  code,
  startDate,
  endDate,
});
const FY2026 = year('2026-01-01', '2026-12-31');
const stepOf = (id: SetupStepId, status: SetupStep['status'], extra: Partial<SetupStep> = {}): SetupStep => ({
  id,
  order: 1,
  label: { ja: id, en: id },
  optional: id === 'workforce',
  status,
  regressed: false,
  checks: [],
  ...extra,
});
const statusOf = (summary: Partial<SetupStatus['summary']>, steps: SetupStep[] = []): SetupStatus => ({
  checkedAt: AT,
  steps,
  summary: { required: 8, done: 8, skipped: 0, remaining: 0, nextStep: null, attention: [], ...summary },
  progress: {},
});

describe('setup-wizard AC-1: which step opens', () => {
  const steps = [stepOf('company_profile', 'done'), stepOf('fiscal_year', 'todo'), stepOf('workforce', 'done')];
  it('AC-1: ?step= is kept only for a known id', () => {
    expect(parseSetupSearch({ step: 'tax' })).toEqual({ step: 'tax' });
    expect(parseSetupSearch({ step: 'nope' })).toEqual({});
    expect(parseSetupSearch({ step: 3 })).toEqual({});
  });
  it('AC-1: the requested step, else the first required todo step, else the first step', () => {
    const status = statusOf({ nextStep: 'fiscal_year', remaining: 1 }, steps);
    expect(initialStep(status, 'workforce')).toBe('workforce');
    expect(initialStep(status, undefined)).toBe('fiscal_year');
    expect(initialStep(statusOf({}, steps), undefined)).toBe('company_profile');
    expect(initialStep(status, 'users')).toBe('fiscal_year');
    expect(initialStep(undefined, 'tax')).toBe('tax');
  });
  it('AC-1: previous and next follow the response order', () => {
    expect(neighbourStep(steps, 'fiscal_year', 1)).toBe('workforce');
    expect(neighbourStep(steps, 'company_profile', -1)).toBeUndefined();
  });
});

describe('setup-wizard AC-3: fiscal year proposal', () => {
  it('AC-3 (a): a year contains today and the check is ok -> show it, propose nothing', () => {
    expect(proposeFiscalYear({ today: '2026-10-15', endMonth: 12, years: [FY2026], check: 'ok' })).toEqual({
      kind: 'current',
      current: FY2026,
      mismatch: false,
    });
  });
  it('AC-3 (a): within 30 days of the latest year end -> propose its continuation', () => {
    const plan = proposeFiscalYear({ today: '2026-12-15', endMonth: undefined, years: [FY2026], check: 'warn' });
    expect(plan).toMatchObject({
      kind: 'current',
      proposal: { startDate: '2027-01-01', endDate: '2027-12-31', continuation: true, mismatch: false },
    });
    expect(plan.kind === 'current' && plan.proposal?.overlap).toBeFalsy();
  });
  it('AC-3 (a): a year-end month that does not match the existing year is noted', () => {
    expect(proposeFiscalYear({ today: '2026-10-15', endMonth: 3, years: [FY2026], check: 'ok' })).toMatchObject({
      kind: 'current',
      mismatch: true,
    });
  });
  it.each(['2027-01-15', '2027-03-31'])(
    'AC-3 (b): the seeded Jan-Dec year, year-end month 3, today %s -> continue with the next Jan-Dec year',
    (today) => {
      expect(proposeFiscalYear({ today, endMonth: 3, years: [FY2026], check: 'fail' })).toEqual({
        kind: 'propose',
        proposal: { startDate: '2027-01-01', endDate: '2027-12-31', continuation: true, mismatch: true },
      });
    },
  );
  it('AC-3 (b): more than 12 months after the latest year -> align to the year-end month and note the gap', () => {
    const plan = proposeFiscalYear({
      today: '2027-02-01',
      endMonth: 3,
      years: [year('2025-01-01', '2025-12-31')],
      check: 'fail',
    });
    expect(plan).toEqual({
      kind: 'propose',
      proposal: {
        startDate: '2026-04-01',
        endDate: '2027-03-31',
        continuation: false,
        mismatch: false,
        gap: { from: '2026-01-01', to: '2026-03-31' },
      },
    });
  });
  it('AC-3 (b): no year at all -> the year-end month decides (12 when unset)', () => {
    expect(proposeFiscalYear({ today: '2026-10-15', endMonth: undefined, years: [], check: 'fail' })).toEqual({
      kind: 'propose',
      proposal: { startDate: '2026-01-01', endDate: '2026-12-31', continuation: false, mismatch: false },
    });
    expect(proposeFiscalYear({ today: '2026-02-10', endMonth: 3, years: [], check: 'fail' })).toMatchObject({
      proposal: { startDate: '2025-04-01', endDate: '2026-03-31' },
    });
    expect(proposeFiscalYear({ today: '2026-04-01', endMonth: 3, years: [], check: 'fail' })).toMatchObject({
      proposal: { startDate: '2026-04-01', endDate: '2027-03-31' },
    });
  });
  it('AC-3: a proposal that overlaps an existing year names it (no create action)', () => {
    const later = year('2026-04-01', '2027-03-31', 'FY2026-04');
    const plan = proposeFiscalYear({ today: '2026-02-10', endMonth: 12, years: [later], check: 'fail' });
    expect(plan).toMatchObject({ kind: 'propose', proposal: { startDate: '2026-01-01', overlap: later } });
  });
  it.each([['a closed period for today'], ['a year without periods']])(
    'AC-3 (c): a year contains today but the check fails (%s) -> propose nothing',
    () => {
      expect(proposeFiscalYear({ today: '2026-10-15', endMonth: 12, years: [FY2026], check: 'fail' })).toEqual({
        kind: 'blocked',
        current: FY2026,
      });
    },
  );
  it('AC-3: dates — 12-month ends and the Tokyo business date of checkedAt', () => {
    expect(yearEnd('2026-04-01')).toBe('2027-03-31');
    expect(yearEnd('2024-03-01')).toBe('2025-02-28');
    expect(tokyoDate('2026-10-30T15:30:00.000Z')).toBe('2026-10-31');
  });
  it('AC-3: the year-end month is read from company.profile only when it is 1-12', () => {
    expect(fiscalYearEndMonth({ fiscalYearEndMonth: 3 })).toBe(3);
    expect(fiscalYearEndMonth({ fiscalYearEndMonth: 13 })).toBeUndefined();
    expect(fiscalYearEndMonth(null)).toBeUndefined();
  });
});

describe('setup-wizard AC-6/AC-15: merging a change into setup.progress', () => {
  const stored: SetupProgress = {
    workforce: { state: 'skipped', at: AT, reason: 'no staff' },
    users: { state: 'skipped', at: AT, reason: 'solo' },
    updatedAt: AT,
  };
  it('AC-6: a skip is added with the trimmed reason and the update time', () => {
    expect(buildProgress({}, { step: 'tax', record: 'skipped', reason: '  later  ' }, NOW)).toEqual({
      tax: { state: 'skipped', at: NOW.toISOString(), reason: 'later' },
      updatedAt: NOW.toISOString(),
    });
  });
  it('AC-15: records of steps not changed survive — step 9 (not returned) and a skip on a done step', () => {
    const next = buildProgress(stored, { step: 'tax', record: 'completed' }, NOW);
    expect(next.workforce).toEqual(stored.workforce);
    expect(next.users).toEqual(stored.users);
    expect(next.tax).toEqual({ state: 'completed', at: NOW.toISOString() });
  });
  it('AC-15: a completed record replaces the skip of the same step', () => {
    expect(buildProgress(stored, { step: 'users', record: 'completed' }, NOW).users).toEqual({
      state: 'completed',
      at: NOW.toISOString(),
    });
  });
  it('AC-6: undo removes only that record', () => {
    const next = buildProgress(stored, { step: 'users', record: null }, NOW);
    expect(next.users).toBeUndefined();
    expect(next.workforce).toEqual(stored.workforce);
    expect(next.updatedAt).toBe(NOW.toISOString());
  });
  it('AC-15: confirm only while done, skip only while todo, undo whenever a skip record exists', () => {
    expect(canConfirm(stepOf('tax', 'done'))).toBe(true);
    expect(canConfirm(stepOf('tax', 'todo'))).toBe(false);
    expect(canConfirm(stepOf('tax', 'skipped'))).toBe(false);
    expect(canSkip(stepOf('tax', 'todo'))).toBe(true);
    expect(canSkip(stepOf('tax', 'skipped'))).toBe(false);
    expect(canSkip(stepOf('tax', 'done'))).toBe(false);
    expect(canUndoSkip(stepOf('tax', 'done', { reason: 'x', skippedAt: AT }))).toBe(true);
    expect(canUndoSkip(stepOf('tax', 'todo'))).toBe(false);
  });
  it('AC-26: a reason is required and at most 200 characters after trimming', () => {
    expect(skipReasonError('   ')?.en).toContain('Enter');
    expect(skipReasonError('x'.repeat(201))?.ja).toContain('200');
    expect(skipReasonError(` ${'x'.repeat(200)} `)).toBeNull();
  });
});

describe('setup-wizard AC-7: the home card', () => {
  it('AC-7: only for admin roles (others never ask for the status)', () => {
    expect(isAdminRoles(['admin', 'accounting'])).toBe(true);
    expect(isAdminRoles(['settings'])).toBe(false);
    expect(isAdminRoles(undefined)).toBe(false);
  });
  it('AC-7: shown while a required step is todo, or a check fails even on a skipped step', () => {
    expect(showSetupCard(statusOf({ remaining: 2, nextStep: 'tax' }))).toBe(true);
    expect(showSetupCard(statusOf({ attention: ['inventory'], skipped: 1 }))).toBe(true);
    expect(showSetupCard(statusOf({ skipped: 2 }))).toBe(false);
  });
  it('AC-7: links to the next todo step, else the first failing step', () => {
    expect(cardTarget(statusOf({ remaining: 1, nextStep: 'tax', attention: ['inventory'] }))).toBe('tax');
    expect(cardTarget(statusOf({ attention: ['inventory'] }))).toBe('inventory');
    expect(cardTarget(statusOf({}))).toBeNull();
  });
  it('AC-7: the progress line in both languages', () => {
    expect(progressText(statusOf({ done: 5, skipped: 1 }).summary)).toEqual({
      ja: '8 段階中 5 段階完了、スキップ 1',
      en: '5 of 8 steps done, 1 skipped',
    });
    expect(progressText(statusOf({ done: 3 }).summary).en).toBe('3 of 8 steps done');
  });
});

describe('setup-wizard AC-10: stepper keys', () => {
  it.each([
    ['ArrowDown', 0, 1],
    ['ArrowRight', 8, 0],
    ['ArrowUp', 0, 8],
    ['ArrowLeft', 3, 2],
    ['Home', 5, 0],
    ['End', 2, 8],
  ])('AC-10: %s from %i -> %i (wraps at the ends)', (key, from, to) => {
    expect(stepperKeyTarget(key, from, 9)).toBe(to);
  });
  it('AC-10: other keys do not move', () => {
    expect(stepperKeyTarget('Tab', 1, 9)).toBeUndefined();
    expect(stepperKeyTarget('ArrowDown', 0, 0)).toBeUndefined();
  });
});

describe('setup-wizard AC-4/AC-20: inventory choice and issuer copy', () => {
  it('AC-4: both on -> use, both off -> none, otherwise mixed (no choice preselected)', () => {
    expect(inventoryState(true, true)).toBe('use');
    expect(inventoryState(false, false)).toBe('none');
    expect(inventoryState(true, false)).toBe('mixed');
  });
  it('AC-20: the issuer takes the legal name (else the company name) and the contact fields', () => {
    expect(
      issuerFromProfile(
        {
          legalName: '株式会社段階',
          invoiceRegistrationNo: 'T1234567890123',
          postalCode: '100-0001',
          address: '東京都',
          phone: '03',
          email: 'a@example.com',
          representative: '代表',
          fiscalYearEndMonth: 3,
        },
        '段階',
      ),
    ).toEqual({
      name: '株式会社段階',
      invoiceRegistrationNo: 'T1234567890123',
      postalCode: '100-0001',
      address: '東京都',
      phone: '03',
      email: 'a@example.com',
    });
    expect(issuerFromProfile(null, '段階商事')).toEqual({ name: '段階商事' });
  });
});

describe('setup-wizard AC-10: every text has ja and en', () => {
  it('AC-10: status words, optional mark and inventory guidance', () => {
    for (const label of [
      ...Object.values(STEP_STATUS_TEXT),
      OPTIONAL_TEXT,
      ...Object.values(INVENTORY_GUIDE).flatMap((g) => [g.title, g.description]),
    ])
      expect(label.ja && label.en).toBeTruthy();
  });
});
