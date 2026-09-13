import '../src/modules.ts';
import { makeContext, registry, type ContextParams } from '@daifuku/kernel';
import { describe, expect, it } from 'vitest';
import { analyticsCatalog, SOURCES } from '../src/analytics/catalog.ts';
import {
  analyticsMeasureValue,
  analyticsScopeKey,
  collectCompleteRows,
  snapshotInput,
} from '../src/analytics/snapshot.ts';

const context = (params: Partial<ContextParams> = {}) =>
  makeContext({} as never, {
    tenantId: 'tenant',
    companyId: 'company',
    actor: { type: 'user', id: 'user' },
    roles: ['admin'],
    appliedPacks: ['restaurant_chain'],
    ...params,
  });

describe('browser analytics source contracts', () => {
  it('exposes only existing allowlisted, readable source fields and permission-specific catalogs', () => {
    const admin = analyticsCatalog(context());
    expect(admin.length).toBeGreaterThanOrEqual(8);
    for (const source of SOURCES) {
      const entity = registry.entity(source.id);
      for (const key of [...source.dimensions, ...source.measures])
        expect(key in entity.columns || source.derived?.[key]).toBeTruthy();
    }
    expect(analyticsCatalog(context({ roles: ['nobody'] }))).toEqual([]);
    expect(analyticsCatalog(context({ companyId: null }))).toEqual([]);
    const employee = analyticsCatalog(
      context({ roles: ['workforce_employee'], accessScope: 'sites', siteIds: ['site'] }),
    );
    expect(employee.map((item) => item.id)).toContain('workforce_attendance');
    expect(employee.map((item) => item.id)).not.toContain('bank_statement');
    expect(admin.find((item) => item.id === 'stock_ledger')?.measures.map((item) => item.key)).toEqual(['costDelta']);
    expect(admin.find((item) => item.id === 'workforce_payroll')?.measures.map((item) => item.key)).not.toContain(
      'calculation',
    );
  });

  it('omits masked measures and rejects a source whose required filter would reveal a hidden field', () => {
    const permissions = registry.entity('sales_invoice').config.permissions;
    const previous = permissions.fieldGroups;
    try {
      Object.assign(permissions, {
        fieldGroups: { sensitive: { fields: ['total', 'subtotal'], roles: ['accounting'] } },
      });
      const source = analyticsCatalog(context({ roles: ['sales'] })).find((item) => item.id === 'sales_invoice');
      expect(source?.measures.map((item) => item.key)).not.toContain('total');
      expect(source?.defaultMeasure).toBe('taxTotal');
      Object.assign(permissions, { fieldGroups: { sensitive: { fields: ['docstatus'], roles: ['accounting'] } } });
      expect(analyticsCatalog(context({ roles: ['sales'] })).map((item) => item.id)).not.toContain('sales_invoice');
      Object.assign(permissions, { fieldGroups: { sensitive: { fields: ['currency'], roles: ['accounting'] } } });
      expect(analyticsCatalog(context({ roles: ['sales'] })).map((item) => item.id)).not.toContain('sales_invoice');
    } finally {
      if (previous === undefined) Reflect.deleteProperty(permissions, 'fieldGroups');
      else Object.assign(permissions, { fieldGroups: previous });
    }
  });

  it('does not infer masked bank direction through a signed derived amount', () => {
    const permissions = registry.entity('bank_statement').config.permissions;
    const previous = permissions.fieldGroups;
    try {
      Object.assign(permissions, {
        fieldGroups: { direction: { fields: ['direction'], roles: ['bank_direction_reviewer'] } },
      });
      const source = analyticsCatalog(context({ roles: ['accounting'] })).find((item) => item.id === 'bank_statement');
      expect(source?.dimensions.map((item) => item.key)).not.toContain('direction');
      expect(source?.measures.map((item) => item.key)).toEqual(['amount']);
      expect(source?.defaultMeasure).toBe('amount');
    } finally {
      if (previous === undefined) Reflect.deleteProperty(permissions, 'fieldGroups');
      else Object.assign(permissions, { fieldGroups: previous });
    }
  });

  it('invalidates scope on role, site, actor and company changes, independently of array order', () => {
    const original = context({ roles: ['sales', 'viewer'], siteIds: ['a', 'b'] });
    const key = analyticsScopeKey(original);
    expect(analyticsScopeKey(context({ roles: ['viewer', 'sales'], siteIds: ['b', 'a'] }))).toBe(key);
    for (const params of [
      { roles: ['sales'] },
      { siteIds: ['a'] },
      { actor: { type: 'user' as const, id: 'other' } },
      { companyId: 'other' },
    ])
      expect(analyticsScopeKey(context(params))).not.toBe(key);
  });

  it('validates real date boundaries and refuses reversed periods or arbitrary extra query fields', () => {
    const good = { dataset: 'sales_invoice', from: '2024-02-29', to: '2026-09-13', state: 'submitted' };
    expect(snapshotInput.safeParse(good).success).toBe(true);
    expect(snapshotInput.safeParse({ ...good, from: '2025-02-29' }).success).toBe(false);
    expect(snapshotInput.safeParse({ ...good, from: '0000-01-01' }).success).toBe(false);
    expect(snapshotInput.safeParse({ ...good, to: '2024-02-28' }).success).toBe(false);
    expect(snapshotInput.safeParse({ ...good, where: {} }).success).toBe(false);
  });

  it('signs bank withdrawals exactly, preserves missing values and bounds minute conversion precision', () => {
    const bank = SOURCES.find((source) => source.id === 'bank_statement');
    const attendance = SOURCES.find((source) => source.id === 'workforce_attendance');
    if (!bank || !attendance) throw new Error('Required analytics source missing');
    expect(analyticsMeasureValue(bank, 'signedAmount', { amount: '99999999999999.123456', direction: 'pay' })).toBe(
      '-99999999999999.123456',
    );
    expect(analyticsMeasureValue(bank, 'signedAmount', { amount: '1', direction: 'receive' })).toBe('1');
    expect(analyticsMeasureValue(bank, 'amount', {})).toBeNull();
    expect(analyticsMeasureValue(bank, 'amount', { amount: null })).toBeNull();
    expect(() => analyticsMeasureValue(bank, 'signedAmount', { amount: '1', direction: 'unknown' })).toThrow();
    expect(analyticsMeasureValue(attendance, 'workedMinutes', { workedMs: 1 })).toBe('0.000017');
    expect(analyticsMeasureValue(attendance, 'workedMinutes', { workedMs: 3_600_000 })).toBe('60');
  });
});

describe('complete bounded analytics snapshots', () => {
  it('returns all pages including exactly the limit and supports empty sources', async () => {
    const pages = [{ id: '1' }, { id: '2' }, { id: '3' }];
    expect(
      await collectCompleteRows(async (offset) => ({ items: pages.slice(offset, offset + 2), total: 3 }), 3),
    ).toEqual(pages);
    expect(await collectCompleteRows(async () => ({ items: [], total: 0 }))).toEqual([]);
  });
  it('rejects over-limit sources and incomplete or changing page totals instead of returning partial aggregates', async () => {
    await expect(collectCompleteRows(async () => ({ items: [{ id: '1' }], total: 50_001 }))).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(collectCompleteRows(async () => ({ items: [], total: 2 }))).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    await expect(
      collectCompleteRows(async (offset) => ({ items: [{ id: String(offset) }], total: offset ? 3 : 2 })),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
