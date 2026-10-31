// docs/specs/setup-wizard.md AC-5, AC-7, AC-15, AC-16: deriveSetupStatus — a step is done when every check is ok,
// skipped when not done and recorded as skipped, otherwise todo; the summary counts required steps only.
import { label, type SetupProgress } from '@daifuku/kernel';
import { describe, expect, it } from 'vitest';
import { deriveSetupStatus, SETUP_STEPS, type SetupCheck } from '../src/setup-status.ts';

const AT = '2026-10-30T01:00:00.000Z';
const ALL_IDS = [
  'company.profile',
  'accounting.fiscal_period',
  'setup.chart_of_accounts',
  'tax.standard_rate',
  'sales.issuer',
  'inventory.stock_settings',
  'setup.industry_template',
  'setup.users',
  'setup.workforce_policy',
];
const check = (id: string, status: SetupCheck['status'] = 'ok'): SetupCheck => ({
  id,
  status,
  label: label(id, id),
  detail: label(`${id} ${status}`, `${id} ${status}`),
});
const allOk = (overrides: Record<string, SetupCheck['status'] | null> = {}): SetupCheck[] =>
  ALL_IDS.flatMap((id) => (overrides[id] === null ? [] : [check(id, overrides[id] ?? 'ok')]));
const derive = (items: SetupCheck[], progress: SetupProgress = {}, omit?: ('workforce' | 'users')[]) =>
  deriveSetupStatus({ checkedAt: AT, items, progress, ...(omit ? { omit } : {}) });
const step = (status: ReturnType<typeof derive>, id: string) => {
  const found = status.steps.find((s) => s.id === id);
  expect(found, id).toBeDefined();
  return found as NonNullable<typeof found>;
};

describe('setup-wizard AC-5: steps and response shape', () => {
  it('AC-5: nine steps in order with ids, labels, optional flag and the checks used', () => {
    const status = derive(allOk());
    expect(status.checkedAt).toBe(AT);
    expect(status.steps.map((s) => [s.id, s.order, s.optional])).toEqual([
      ['company_profile', 1, false],
      ['fiscal_year', 2, false],
      ['chart_of_accounts', 3, false],
      ['tax', 4, false],
      ['invoice_issuer', 5, false],
      ['inventory', 6, false],
      ['industry_template', 7, false],
      ['users', 8, false],
      ['workforce', 9, true],
    ]);
    expect(status.steps.map((s) => s.checks.map((c) => c.id))).toEqual(ALL_IDS.map((id) => [id]));
    for (const s of status.steps) expect(s.label.ja && s.label.en).toBeTruthy();
    expect(SETUP_STEPS).toHaveLength(9);
  });

  it('AC-5: every check ok -> every step done, nothing remaining, nextStep null', () => {
    const status = derive(allOk());
    expect(status.steps.every((s) => s.status === 'done' && !s.regressed)).toBe(true);
    expect(status.summary).toEqual({ required: 8, done: 8, skipped: 0, remaining: 0, nextStep: null, attention: [] });
  });

  it('AC-5: nextStep is the first required todo step', () => {
    const status = derive(allOk({ 'tax.standard_rate': 'fail', 'setup.users': 'warn' }));
    expect(status.summary.nextStep).toBe('tax');
    expect(status.summary.remaining).toBe(2);
  });

  it('AC-5: progress is returned as stored (the wizard merges into it)', () => {
    const progress: SetupProgress = { workforce: { state: 'skipped', at: AT, reason: 'not used' }, updatedAt: AT };
    expect(derive(allOk(), progress, ['workforce']).progress).toEqual(progress);
  });
});

describe('setup-wizard AC-16: warn, fail and missing checks are not done', () => {
  it.each([['warn'], ['fail']] as const)('AC-16: a %s check makes its step todo and keeps the item', (s) => {
    const status = derive(allOk({ 'accounting.fiscal_period': s }));
    expect(step(status, 'fiscal_year').status).toBe('todo');
    expect(step(status, 'fiscal_year').checks[0]).toMatchObject({ id: 'accounting.fiscal_period', status: s });
    expect(step(status, 'company_profile').status).toBe('done');
  });

  it('AC-16: a missing check is "could not be checked" (warn) and the step is todo; others still return', () => {
    const status = derive(allOk({ 'sales.issuer': null }));
    const issuer = step(status, 'invoice_issuer');
    expect(issuer.status).toBe('todo');
    expect(issuer.checks[0]).toMatchObject({ id: 'sales.issuer', status: 'warn' });
    expect(issuer.checks[0]?.detail.en).toContain('could not be checked');
    expect(status.steps).toHaveLength(9);
  });

  it('AC-16: without the workforce module step 9 is not returned, and its record stays in progress', () => {
    const progress: SetupProgress = { workforce: { state: 'skipped', at: AT, reason: 'no staff' } };
    const status = derive(allOk({ 'setup.workforce_policy': null }), progress, ['workforce']);
    expect(status.steps.map((s) => s.id)).not.toContain('workforce');
    expect(status.progress.workforce).toEqual(progress.workforce);
    expect(status.summary.required).toBe(8);
  });
});

describe('setup-wizard AC-15: done -> skipped -> todo, records and regressions', () => {
  it('AC-15: a skipped step that is not met is skipped with its reason; skipped steps are not remaining', () => {
    const status = derive(allOk({ 'setup.industry_template': 'warn' }), {
      industry_template: { state: 'skipped', at: AT, reason: 'テンプレートは使わない' },
    });
    expect(step(status, 'industry_template')).toMatchObject({
      status: 'skipped',
      reason: 'テンプレートは使わない',
      skippedAt: AT,
    });
    expect(status.summary).toMatchObject({ done: 7, skipped: 1, remaining: 0, nextStep: null });
  });

  it('AC-15: once the condition holds, a skipped step is done and still returns its skip record', () => {
    const status = derive(allOk(), { users: { state: 'skipped', at: AT, reason: 'solo' } });
    expect(step(status, 'users')).toMatchObject({ status: 'done', reason: 'solo', skippedAt: AT });
    expect(status.summary.skipped).toBe(0);
  });

  it('AC-15: a completed record never changes the status; met -> completedAt only, unmet -> regressed', () => {
    const progress: SetupProgress = { tax: { state: 'completed', at: AT } };
    expect(step(derive(allOk(), progress), 'tax')).toMatchObject({ status: 'done', completedAt: AT, regressed: false });
    expect(step(derive(allOk({ 'tax.standard_rate': 'fail' }), progress), 'tax')).toMatchObject({
      status: 'todo',
      completedAt: AT,
      regressed: true,
    });
  });

  it('AC-15: the optional step is not counted in the summary', () => {
    const status = derive(allOk({ 'setup.workforce_policy': 'warn' }));
    expect(step(status, 'workforce').status).toBe('todo');
    expect(status.summary).toMatchObject({ required: 8, done: 8, remaining: 0, nextStep: null });
  });
});

describe('setup-wizard AC-7: attention lists steps whose checks fail, skipped or not', () => {
  it('AC-7: a skipped step with a fail check stays in attention; warn does not', () => {
    const status = derive(allOk({ 'inventory.stock_settings': 'fail', 'setup.users': 'warn' }), {
      inventory: { state: 'skipped', at: AT, reason: 'later' },
      users: { state: 'skipped', at: AT, reason: 'solo' },
    });
    expect(step(status, 'inventory').status).toBe('skipped');
    expect(status.summary).toMatchObject({ remaining: 0, nextStep: null, attention: ['inventory'] });
  });
});
