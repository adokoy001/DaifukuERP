// docs/specs/setup-wizard.md AC-6, AC-11, AC-26: the kernel setting `setup.progress` — its schema (strict records,
// reasons of 1-200 characters), the tolerant reader, idempotent registration and its presentation attributes.
import { describe, expect, it } from 'vitest';
import {
  ensureSetupProgressSetting,
  registry,
  SETUP_PROGRESS_KEY,
  SETUP_PROGRESS_SETTING,
  SETUP_STEP_IDS,
  setupProgressOf,
  setupProgressSchema,
  settingCategory,
} from '../src/index.ts';

const AT = '2026-10-30T01:02:03.000Z';

describe('setup-wizard AC-11: setup.progress schema', () => {
  it('AC-11: the nine step ids are stable and in display order', () => {
    expect(SETUP_STEP_IDS).toEqual([
      'company_profile',
      'fiscal_year',
      'chart_of_accounts',
      'tax',
      'invoice_issuer',
      'inventory',
      'industry_template',
      'users',
      'workforce',
    ]);
  });

  it('AC-11: completed and skipped records with an ISO time are accepted; every property is optional', () => {
    expect(setupProgressSchema.parse({})).toEqual({});
    const value = {
      company_profile: { state: 'completed', at: AT },
      industry_template: { state: 'skipped', at: AT, reason: 'テンプレートは使わない' },
      updatedAt: AT,
    };
    expect(setupProgressSchema.parse(value)).toEqual(value);
    expect(
      setupProgressSchema.safeParse({ tax: { state: 'completed', at: '2026-10-30T10:00:00+09:00' } }).success,
    ).toBe(true);
  });

  it('AC-11: a completed record is strict — a reason or an unknown key is refused', () => {
    expect(setupProgressSchema.safeParse({ tax: { state: 'completed', at: AT, reason: 'x' } }).success).toBe(false);
    expect(setupProgressSchema.safeParse({ tax: { state: 'completed', at: AT, by: 'me' } }).success).toBe(false);
  });

  it('AC-11: times must be ISO date-times and states must be known', () => {
    expect(setupProgressSchema.safeParse({ tax: { state: 'completed', at: '2026-10-30' } }).success).toBe(false);
    expect(setupProgressSchema.safeParse({ tax: { state: 'done', at: AT } }).success).toBe(false);
    expect(setupProgressSchema.safeParse({ updatedAt: 'yesterday' }).success).toBe(false);
  });

  it('AC-11: unknown top-level properties are dropped, not stored', () => {
    expect(setupProgressSchema.parse({ legacy_step: { state: 'completed', at: AT } })).toEqual({});
  });
});

describe('setup-wizard AC-6/AC-26: skip reasons', () => {
  it('AC-26: a skip needs a reason of 1-200 characters after trimming', () => {
    const skip = (reason: unknown) => setupProgressSchema.safeParse({ users: { state: 'skipped', at: AT, reason } });
    expect(skip(undefined).success).toBe(false);
    expect(skip('').success).toBe(false);
    expect(skip('   ').success).toBe(false);
    expect(skip('x'.repeat(201)).success).toBe(false);
    expect(skip('x'.repeat(200)).success).toBe(true);
  });

  it('AC-6: the stored reason is trimmed', () => {
    const parsed = setupProgressSchema.parse({ users: { state: 'skipped', at: AT, reason: '  一人で使う  ' } });
    expect(parsed.users).toEqual({ state: 'skipped', at: AT, reason: '一人で使う' });
  });
});

describe('setup-wizard AC-11: reading and registering setup.progress', () => {
  it('AC-11: a stored value that does not match reads as no record, so status derivation goes on', () => {
    expect(setupProgressOf({})).toEqual({});
    expect(setupProgressOf({ [SETUP_PROGRESS_KEY]: 'broken' })).toEqual({});
    expect(setupProgressOf({ [SETUP_PROGRESS_KEY]: { tax: { state: 'completed', at: AT, reason: 'x' } } })).toEqual({});
    expect(setupProgressOf({ [SETUP_PROGRESS_KEY]: { tax: { state: 'completed', at: AT } } })).toEqual({
      tax: { state: 'completed', at: AT },
    });
  });

  it('AC-11: ensureSetupProgressSetting registers once and is idempotent', () => {
    ensureSetupProgressSetting();
    ensureSetupProgressSetting();
    expect(registry.setting(SETUP_PROGRESS_KEY)).toBe(SETUP_PROGRESS_SETTING);
  });

  it('AC-11: presentation — system tab, ja/en labels for the setting and all ten properties, no default, managedBy, admin-only writes', () => {
    const def = SETUP_PROGRESS_SETTING;
    expect(settingCategory(def)).toBe('system');
    expect(def.default).toBeUndefined();
    expect(def.description?.ja && def.description.en).toBeTruthy();
    expect(Object.keys(def.fields ?? {}).sort()).toEqual([...SETUP_STEP_IDS, 'updatedAt'].sort());
    for (const field of Object.values(def.fields ?? {})) expect(field.label.ja && field.label.en).toBeTruthy();
    expect(def.managedBy).toEqual({ href: '/setup', label: { ja: 'セットアップ', en: 'Setup' } });
    // Decision 5: only company admins (who can open the wizard) change the record; the settings role reads it.
    expect(def.writeRoles).toEqual(['admin']);
  });
});
