import type { AnalyticsSettings } from './analytics.ts';
import { GRAIN_LABELS, OP_LABELS, PERIODS, isIsoDate } from './analytics.ts';
import { validatePivotConfig } from './pivot.ts';

export interface SavedAnalysis { id: string; name: string; updatedAt: string; settings: AnalyticsSettings }
export interface AnalysisStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface AnalysisLockManager {
  request<T>(name: string, options: { mode: 'exclusive' }, callback: () => T | Promise<T>): Promise<T>;
}
export type AnalysisMutation = { kind: 'save'; entry: SavedAnalysis; baseline?: SavedAnalysis } | { kind: 'delete'; id: string; baseline: SavedAnalysis };
export class AnalysisStorageError extends Error {
  constructor(readonly code: 'unsupported' | 'conflict') { super(code); this.name = 'AnalysisStorageError'; }
}
const MAX_SAVED = 30;
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, max = 150): value is string { return typeof value === 'string' && value.length <= max; }
function exact(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).every((key) => keys.includes(key)); }
export function parseAnalyticsSettings(value: unknown): AnalyticsSettings | undefined {
  if (!object(value) || !exact(value, ['dataset', 'period', 'from', 'to', 'state', 'pivot', 'chart', 'chartMeasure', 'subtotals', 'expandedRows', 'expandedColumns'])) return undefined;
  if (!text(value.dataset) || !value.dataset || !text(value.state) || !value.state || !PERIODS.some((period) => period.value === value.period) || !text(value.from) || !text(value.to) || !isIsoDate(value.from) || !isIsoDate(value.to) || value.from > value.to) return undefined;
  if (typeof value.chart !== 'string' || !['bar', 'line', 'none'].includes(value.chart) || typeof value.subtotals !== 'boolean' || !Number.isInteger(value.chartMeasure) || Number(value.chartMeasure) < 0 || Number(value.chartMeasure) > 2) return undefined;
  const pivot = value.pivot;
  if (!object(pivot) || !exact(pivot, ['rows', 'columns', 'measures'])) return undefined;
  for (const axes of [pivot.rows, pivot.columns]) {
    if (!Array.isArray(axes) || axes.length > 3 || !axes.every((item: unknown) => object(item) && exact(item, ['field', 'grain']) && text(item.field) && item.field.length > 0 && (item.grain === undefined || typeof item.grain === 'string' && Object.hasOwn(GRAIN_LABELS, item.grain)))) return undefined;
  }
  if (!Array.isArray(pivot.measures) || !pivot.measures.length || pivot.measures.length > 3 || !pivot.measures.every((item: unknown) => object(item) && exact(item, ['field', 'op']) && text(item.field) && item.field.length > 0 && typeof item.op === 'string' && Object.hasOwn(OP_LABELS, item.op))) return undefined;
  if (Number(value.chartMeasure) >= pivot.measures.length) return undefined;
  try { validatePivotConfig(pivot as unknown as AnalyticsSettings['pivot']); } catch { return undefined; }
  for (const expanded of [value.expandedRows, value.expandedColumns]) if (!Array.isArray(expanded) || expanded.length > 1000 || !expanded.every((key: unknown) => text(key, 2000))) return undefined;
  return value as unknown as AnalyticsSettings;
}
export function analyticsStorageKey(scope: { tenantId: string; userId: string; companyId: string }): string {
  return `daifuku.analytics.v1.${JSON.stringify([scope.tenantId, scope.userId, scope.companyId])}`;
}
export function readAnalyses(storage: AnalysisStorage, key: string): SavedAnalysis[] {
  const raw = storage.getItem(key);
  if (!raw) return [];
  if (raw.length > 250_000) throw new Error('Saved analysis settings are too large.');
  const parsed: unknown = JSON.parse(raw);
  if (!object(parsed) || !exact(parsed, ['version', 'items']) || parsed.version !== 1 || !Array.isArray(parsed.items) || parsed.items.length > MAX_SAVED) throw new Error('Unsupported saved analysis settings.');
  const items: SavedAnalysis[] = [];
  for (const item of parsed.items) {
    if (!object(item) || !exact(item, ['id', 'name', 'updatedAt', 'settings']) || !text(item.id) || !text(item.name, 80) || !item.name.trim() || !text(item.updatedAt)) throw new Error('Invalid saved analysis.');
    const settings = parseAnalyticsSettings(item.settings);
    if (!settings || items.some((entry) => entry.id === item.id)) throw new Error('Invalid saved analysis configuration.');
    items.push({ id: item.id, name: item.name, updatedAt: item.updatedAt, settings });
  }
  return items;
}
export function writeAnalyses(storage: AnalysisStorage, key: string, items: SavedAnalysis[]): void {
  if (items.length > MAX_SAVED) throw new Error('Up to 30 analyses can be saved.');
  const raw = JSON.stringify({ version: 1, items });
  // Apply the same strict boundary before writing. Never persist snapshots or arbitrary extra properties.
  readAnalyses({ getItem: () => raw, setItem: () => undefined }, key);
  storage.setItem(key, raw);
}

/** Compare the loaded version, including settings, rather than a timestamp that can collide within one millisecond. */
export function sameSavedAnalysis(a: SavedAnalysis | undefined, b: SavedAnalysis | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * All application writes use the same origin/scoped Web Lock. Read only after obtaining the exclusive lock;
 * unrelated analyses added by another tab survive. A stale edit/delete never replaces a newer version.
 * There is deliberately no unlocked write fallback on unsupported/insecure browser contexts.
 */
export async function mutateAnalyses(storage: AnalysisStorage, locks: AnalysisLockManager | undefined, key: string, change: AnalysisMutation): Promise<SavedAnalysis[]> {
  if (!locks) throw new AnalysisStorageError('unsupported');
  return locks.request(key, { mode: 'exclusive' }, () => {
    const items = readAnalyses(storage, key);
    const id = change.kind === 'save' ? change.entry.id : change.id;
    const current = items.find((item) => item.id === id);
    const baseline = change.baseline;
    if (baseline ? baseline.id !== id || !sameSavedAnalysis(current, baseline) : current !== undefined) throw new AnalysisStorageError('conflict');
    const next = items.filter((item) => item.id !== id);
    if (change.kind === 'save') next.push(change.entry);
    writeAnalyses(storage, key, next);
    return next;
  });
}
