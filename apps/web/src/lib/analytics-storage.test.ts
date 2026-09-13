import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsSettings } from './analytics.ts';
import { analyticsStorageKey, parseAnalyticsSettings, readAnalyses, writeAnalyses, mutateAnalyses, sameSavedAnalysis, type AnalysisLockManager, type AnalysisStorage, type SavedAnalysis } from './analytics-storage.ts';

function settings(): AnalyticsSettings {
  return { dataset: 'sales', period: '12-months', from: '2025-10-01', to: '2026-09-13', state: 'submitted', pivot: { rows: [{ field: 'date', grain: 'year' }, { field: 'date', grain: 'month' }], columns: [{ field: 'site' }], measures: [{ field: 'amount', op: 'sum' }, { field: 'amount', op: 'avg' }] }, chart: 'line', chartMeasure: 1, subtotals: false, expandedRows: ['["2026"]'], expandedColumns: [] };
}
function entry(id = 'analysis-1'): SavedAnalysis { return { id, name: '月次の売上', updatedAt: '2026-09-13T04:00:00.000Z', settings: settings() }; }
function memory(): AnalysisStorage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
const key = analyticsStorageKey({ tenantId: 'tenant-a', userId: 'user-a', companyId: 'company-a' });
function serialLocks(): AnalysisLockManager {
  let tail: Promise<unknown> = Promise.resolve();
  return { request<T>(_name: string, _options: { mode: 'exclusive' }, callback: () => T | Promise<T>): Promise<T> {
    const result = tail.then(callback); tail = result.then(() => undefined, () => undefined); return result;
  } };
}
describe('cross-tab analysis mutations', () => {
  it('reads the latest state inside an exclusive scope lock so concurrent tabs preserve unrelated saves', async () => {
    const storage = memory(), locks = serialLocks();
    const requests = vi.spyOn(locks, 'request');
    await Promise.all([
      mutateAnalyses(storage, locks, key, { kind: 'save', entry: entry('tab-a') }),
      mutateAnalyses(storage, locks, key, { kind: 'save', entry: entry('tab-b') }),
    ]);
    expect(readAnalyses(storage, key).map((item) => item.id)).toEqual(['tab-a', 'tab-b']);
    expect(requests.mock.calls.every(([name, options]) => name === key && options.mode === 'exclusive')).toBe(true);
  });
  it('checks current content as well as timestamps and rejects stale save or delete without losing other analyses', async () => {
    const storage = memory(), locks = serialLocks(), baseline = entry();
    writeAnalyses(storage, key, [baseline, entry('other')]);
    const updated = { ...baseline, name: '別タブで変更', settings: { ...baseline.settings, chart: 'bar' as const } };
    await mutateAnalyses(storage, locks, key, { kind: 'save', entry: updated, baseline });
    expect(sameSavedAnalysis(updated, baseline)).toBe(false); // Same updatedAt, different content.
    await expect(mutateAnalyses(storage, locks, key, { kind: 'save', entry: { ...baseline, name: '古いタブで変更' }, baseline })).rejects.toMatchObject({ code: 'conflict' });
    await expect(mutateAnalyses(storage, locks, key, { kind: 'delete', id: baseline.id, baseline })).rejects.toMatchObject({ code: 'conflict' });
    expect(readAnalyses(storage, key)).toEqual([entry('other'), updated]);
    await mutateAnalyses(storage, locks, key, { kind: 'save', entry: { ...baseline, id: 'copy', name: 'コピー' } });
    expect(readAnalyses(storage, key)).toHaveLength(3);
  });
  it('only deletes the matching loaded version and refuses to resurrect an analysis another tab deleted', async () => {
    const storage = memory(), locks = serialLocks(), baseline = entry();
    writeAnalyses(storage, key, [baseline, entry('other')]);
    await mutateAnalyses(storage, locks, key, { kind: 'delete', id: baseline.id, baseline });
    expect(readAnalyses(storage, key)).toEqual([entry('other')]);
    await expect(mutateAnalyses(storage, locks, key, { kind: 'save', entry: baseline, baseline })).rejects.toMatchObject({ code: 'conflict' });
    await expect(mutateAnalyses(storage, locks, key, { kind: 'delete', id: 'other', baseline })).rejects.toMatchObject({ code: 'conflict' });
  });
  it('does not overwrite an existing id as a new analysis or bypass limits using a stale list', async () => {
    const storage = memory(), locks = serialLocks(), items = Array.from({ length: 30 }, (_, index) => entry(`id-${index}`));
    writeAnalyses(storage, key, items);
    await expect(mutateAnalyses(storage, locks, key, { kind: 'save', entry: entry('id-0') })).rejects.toMatchObject({ code: 'conflict' });
    await expect(mutateAnalyses(storage, locks, key, { kind: 'save', entry: entry('new-id') })).rejects.toThrow('Up to 30');
    expect(readAnalyses(storage, key)).toEqual(items);
  });
  it('never falls back to an unlocked write when Web Locks are unavailable or rejected', async () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    await expect(mutateAnalyses(storage, undefined, key, { kind: 'save', entry: entry() })).rejects.toMatchObject({ code: 'unsupported' });
    const locks: AnalysisLockManager = { request: () => Promise.reject(new Error('Lock access denied')) };
    await expect(mutateAnalyses(storage, locks, key, { kind: 'save', entry: entry() })).rejects.toThrow('Lock access denied');
    expect(storage.getItem).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled();
  });
});
function stored(value: unknown): AnalysisStorage { return { getItem: () => JSON.stringify(value), setItem: vi.fn() }; }
describe('scoped analysis persistence', () => {
  it('round-trips named settings and expansion state without fetching or storing snapshots', () => {
    const storage = memory(), items = [entry()];
    expect(readAnalyses(storage, key)).toEqual([]);
    writeAnalyses(storage, key, items);
    expect(readAnalyses(storage, key)).toEqual(items);
    const raw = storage.getItem(key) ?? '';
    expect(JSON.parse(raw)).toEqual({ version: 1, items });
    expect(raw).not.toContain('accessToken');
  });
  it('isolates every tenant, user and company dimension', () => {
    const storage = memory(); writeAnalyses(storage, key, [entry()]);
    for (const scope of [
      { tenantId: 'tenant-b', userId: 'user-a', companyId: 'company-a' },
      { tenantId: 'tenant-a', userId: 'user-b', companyId: 'company-a' },
      { tenantId: 'tenant-a', userId: 'user-a', companyId: 'company-b' },
    ]) expect(readAnalyses(storage, analyticsStorageKey(scope))).toEqual([]);
    expect(readAnalyses(storage, key)).toHaveLength(1);
  });
  it('cannot collide when scope values contain separators or percent escapes', () => {
    const scopes = [
      { tenantId: 'a.b', userId: 'c', companyId: 'd' }, { tenantId: 'a', userId: 'b.c', companyId: 'd' },
      { tenantId: 'a', userId: 'b', companyId: 'c.d' }, { tenantId: 'a%2Eb', userId: 'c', companyId: 'd' },
      { tenantId: 'a/b', userId: 'c', companyId: 'd' },
    ];
    expect(new Set(scopes.map(analyticsStorageKey)).size).toBe(scopes.length);
  });
  it('allows updating and deleting a saved analysis without retaining old content', () => {
    const storage = memory(); writeAnalyses(storage, key, [entry()]);
    const updated = { ...entry(), name: '改訂した月次売上', settings: { ...settings(), period: 'custom' as const, from: '2024-04-01', to: '2025-03-31' } };
    writeAnalyses(storage, key, [updated]); expect(readAnalyses(storage, key)).toEqual([updated]);
    writeAnalyses(storage, key, []); expect(readAnalyses(storage, key)).toEqual([]);
  });
});
describe('stored configuration validation', () => {
  it('accepts bounded custom and relative settings with canonical fields', () => {
    expect(parseAnalyticsSettings(settings())).toEqual(settings());
    const custom = { ...settings(), period: 'custom', from: '2024-02-29', to: '2024-03-01' };
    expect(parseAnalyticsSettings(custom)).toEqual(custom);
  });
  it.each(['snapshot', 'records', 'accessToken', 'password'])('rejects unexpected %s instead of persisting raw data or credentials', field => {
    const invalid = { ...settings(), [field]: [{ privateValue: 'must not persist' }] };
    expect(parseAnalyticsSettings(invalid)).toBeUndefined();
    const storage = { getItem: () => null, setItem: vi.fn() };
    expect(() => writeAnalyses(storage, key, [{ ...entry(), settings: invalid }])).toThrow();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('rejects extra properties nested in axes, measures or saved entries', () => {
    const base = settings();
    expect(parseAnalyticsSettings({ ...base, pivot: { ...base.pivot, rows: [{ field: 'date', grain: 'year', rows: [{ amount: 'private' }] }] } })).toBeUndefined();
    expect(parseAnalyticsSettings({ ...base, pivot: { ...base.pivot, measures: [{ field: 'amount', op: 'sum', values: ['private'] }] } })).toBeUndefined();
    expect(() => readAnalyses(stored({ version: 1, items: [{ ...entry(), rows: [{ amount: 'private' }] }] }), key)).toThrow();
  });
  it('rejects unsupported envelope data instead of accepting a hidden snapshot', () => {
    expect(() => readAnalyses(stored({ version: 1, items: [entry()], snapshot: [{ amount: 'private' }] }), key)).toThrow();
  });
  it('rejects enum coercions, empty/oversized fields, duplicate levels and invalid chart indices', () => {
    const base = settings();
    const invalid = [
      { ...base, chart: ['bar'] },
      { ...base, pivot: { ...base.pivot, rows: [{ field: 'date', grain: ['year'] }] } },
      { ...base, pivot: { ...base.pivot, measures: [{ field: 'amount', op: ['sum'] }] } },
      { ...base, pivot: { ...base.pivot, rows: [{ field: '' }] } },
      { ...base, pivot: { ...base.pivot, rows: [{ field: 'a'.repeat(129) }] } },
      { ...base, pivot: { ...base.pivot, rows: [{ field: 'site' }, { field: 'site', grain: 'value' }] } },
      { ...base, chartMeasure: 2 }, { ...base, chartMeasure: -1 }, { ...base, chartMeasure: 0.5 },
      { ...base, expandedRows: [123] },
      { ...base, pivot: { ...base.pivot, rows: Array.from({ length: 4 }, (_, i) => ({ field: `field${i}` })) } },
    ];
    for (const value of invalid) expect(parseAnalyticsSettings(value), JSON.stringify(value)).toBeUndefined();
  });
  it('rejects impossible/reversed dates and unbounded expansion keys', () => {
    for (const value of [
      { ...settings(), from: '2025-02-29' }, { ...settings(), from: '2027-01-01' },
      { ...settings(), to: '' }, { ...settings(), expandedRows: new Array<string>(1001).fill('[]') },
      { ...settings(), expandedColumns: ['a'.repeat(2001)] },
    ]) expect(parseAnalyticsSettings(value)).toBeUndefined();
  });
  it('rejects duplicate identifiers, empty names, unknown versions and malformed JSON', () => {
    for (const value of [
      { version: 1, items: [entry(), entry()] }, { version: 1, items: [{ ...entry(), name: '  ' }] },
      { version: 2, items: [] }, { version: 0, items: [] }, { version: 1, items: {} },
    ]) expect(() => readAnalyses(stored(value), key)).toThrow();
    expect(() => readAnalyses({ getItem: () => '{broken', setItem: vi.fn() }, key)).toThrow();
  });
  it('bounds count and payload size before invoking the storage write', () => {
    const storage = { getItem: () => null, setItem: vi.fn() };
    expect(() => writeAnalyses(storage, key, Array.from({ length: 31 }, (_, i) => entry(`id-${i}`)))).toThrow();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(() => readAnalyses({ getItem: () => ' '.repeat(250_001), setItem: vi.fn() }, key)).toThrow();
  });
  it('propagates storage access/quota failures for a visible UI recovery message', () => {
    const forbidden: AnalysisStorage = { getItem: () => { throw new Error('Storage unavailable'); }, setItem: () => { throw new Error('Quota exceeded'); } };
    expect(() => readAnalyses(forbidden, key)).toThrow('Storage unavailable');
    expect(() => writeAnalyses(forbidden, key, [entry()])).toThrow('Quota exceeded');
  });
});
