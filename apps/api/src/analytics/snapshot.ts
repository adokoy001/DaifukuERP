import { createHash } from 'node:crypto';
import { assertReadableFields, can, Decimal, PermissionDenied, registry, repo, StateError, ValidationError, type Context, type Domain, type TableColumn } from '@daifuku/kernel';
import { z } from 'zod';
import { analyticsCatalog, SOURCES, type AnalyticsDataset, type SourceDefinition } from './catalog.ts';

export const MAX_ANALYTICS_ROWS = 50_000;
const businessDate = z.iso.date().refine((value) => !value.startsWith('0000-'), '年は0001以降にしてください。');
export const snapshotInput = z.object({ dataset: z.string().min(1).max(100), from: businessDate, to: businessDate, state: z.string().min(1).max(40) }).strict().refine((input) => input.from <= input.to, { path: ['to'], message: '終了日は開始日以降にしてください。' });
export type SnapshotInput = z.infer<typeof snapshotInput>;
type Row = Record<string, unknown>;

/** Opaque cache invalidation value, never an authorization credential. */
export function analyticsScopeKey(ctx: Context, datasets = analyticsCatalog(ctx)): string {
  const sorted = (values: readonly string[] | undefined) => [...(values ?? [])].sort();
  return createHash('sha256').update(JSON.stringify({ tenant: ctx.tenantId, company: ctx.companyId, actor: ctx.actor, roles: sorted(ctx.roles), scope: ctx.accessScope, sites: sorted(ctx.siteIds), stores: sorted(ctx.storeIds), packs: sorted(ctx.appliedPacks), tenantAdmin: ctx.tenantAdmin, sessionVersion: ctx.sessionVersion, datasets })).digest('hex');
}

export interface AnalyticsSnapshot {
  dataset: string;
  columns: TableColumn[];
  rows: Row[];
  scopeKey: string;
  meta: { from: string; to: string; state: string; rowCount: number; limit: number; complete: true; retrievedAt: string };
}

export function analyticsMeasureValue(source: SourceDefinition, key: string, row: Row): string | null {
  const derived = source.derived?.[key];
  const value = row[derived?.source ?? key];
  if (value === undefined || value === null) return null;
  let decimal = Decimal.from(String(value));
  if (derived?.divisor) decimal = decimal.div(derived.divisor).roundHalfUp(6);
  if (derived?.signedBy) {
    const direction = row[derived.signedBy];
    if (direction !== 'pay' && direction !== 'receive') throw new StateError('入出金区分を確認できませんでした。', '銀行明細の区分を確認してください。');
    if (direction === 'pay') decimal = decimal.neg();
  }
  return decimal.toString();
}

/** Each page comes from the caller's same repeatable-read Context; an over-cap source never yields a partial report. */
export async function collectCompleteRows(readPage: (offset: number) => Promise<{ items: Row[]; total: number }>, limit = MAX_ANALYTICS_ROWS): Promise<Row[]> {
  const rows: Row[] = [];
  let expected: number | undefined;
  for (;;) {
    const page = await readPage(rows.length);
    if (page.total > limit) throw new ValidationError(`分析対象が上限 ${limit.toLocaleString('ja-JP')} 件を超えています。`, [{ path: 'from', message: '期間を短くして再取得してください。' }], '部分的な合計を表示しないため、取得を中止しました。');
    if (expected === undefined) expected = page.total;
    if (page.total !== expected || rows.length + page.items.length > expected || (!page.items.length && rows.length < expected)) throw new StateError('分析データの完全性を確認できませんでした。', '期間を見直して再取得してください。');
    rows.push(...page.items);
    if (rows.length === expected) return rows;
  }
}

async function referenceLabels(ctx: Context, source: SourceDefinition, dataset: AnalyticsDataset, rows: Row[]): Promise<Map<string, Map<string, string>>> {
  const result = new Map<string, Map<string, string>>();
  for (const col of dataset.dimensions) {
    const field = registry.entity(source.id).config.fields[col.key];
    if (field?.kind !== 'ref' || !field.ref || !registry.hasEntity(field.ref)) continue;
    const target = registry.entity(field.ref);
    const display = target.displayField;
    if (!display || !can(ctx, target, 'read')) continue;
    try { assertReadableFields(ctx, target, [display]); }
    catch (error) { if (error instanceof PermissionDenied) continue; throw error; }
    const ids = [...new Set(rows.flatMap((row) => typeof row[col.key] === 'string' ? [row[col.key] as string] : []))];
    const labels = new Map<string, string>();
    // Request only ids already present in an authorized fact row; the target repository applies its own scope.
    for (let index = 0; index < ids.length; index += 500) {
      const page = await repo(ctx, target).list({ where: { id: { $in: ids.slice(index, index + 500) } }, limit: 500, orderBy: [{ field: 'id' }] });
      for (const row of page.items) {
        const name = row[display];
        if (typeof name === 'string' && name.length > 0) labels.set(row.id, `${name} [${row.id}]`);
      }
    }
    result.set(col.key, labels);
  }
  return result;
}

export async function analyticsSnapshot(ctx: Context, input: SnapshotInput): Promise<AnalyticsSnapshot> {
  const catalog = analyticsCatalog(ctx);
  const dataset = catalog.find((item) => item.id === input.dataset);
  const source = SOURCES.find((item) => item.id === input.dataset);
  if (!dataset || !source) throw new PermissionDenied(input.dataset, 'analytics', ctx.roles);
  const state = source.states.find((item) => item.value === input.state);
  if (!state) throw new ValidationError('この分析対象では利用できない状態です。', [{ path: 'state', message: '対象の状態一覧から選択してください。' }]);
  const where: Domain = { $and: [{ [source.dateField]: { $gte: input.from, $lte: input.to } }, state.where ?? {}] };
  const repository = repo(ctx, registry.entity(source.id));
  const needed = new Set([...dataset.dimensions.map((col) => col.key), ...dataset.measures.flatMap((col) => {
    const derived = source.derived?.[col.key];
    return [derived?.source ?? col.key, ...(derived?.signedBy ? [derived.signedBy] : [])];
  })]);
  const raw = await collectCompleteRows(async (offset) => {
    const page = await repository.list({ where, orderBy: [{ field: 'id', dir: 'asc' }], limit: 500, offset });
    // Discard unrelated JSON/evidence fields page by page; a 50k-row analysis must not retain payroll calculation blobs.
    return { total: page.total, items: page.items.map((row) => Object.fromEntries([...needed].map((key) => [key, row[key]]))) };
  });
  if (source.dimensions.includes('currency')) {
    // Currency remains a safety boundary even when a browser user removes its axis.
    assertReadableFields(ctx, registry.entity(source.id), ['currency']);
    if (new Set(raw.map((row) => row.currency)).size > 1) throw new StateError('複数の通貨が含まれるため合算できません。', '単一通貨の対象を選択してください。');
  }
  const labels = await referenceLabels(ctx, source, dataset, raw);
  const columns = [...dataset.dimensions, ...dataset.measures];
  const numeric = new Set(dataset.measures.map((col) => col.key));
  const rows = raw.map((row) => Object.fromEntries(columns.map((col) => {
    const derived = source.derived?.[col.key];
    const value = row[derived?.source ?? col.key];
    // Only declared readable columns leave the server. Missing numeric fields stay missing, never zero.
    if (value === undefined || value === null) return [col.key, null];
    if (numeric.has(col.key)) return [col.key, analyticsMeasureValue(source, col.key, row)];
    return [col.key, typeof value === 'string' ? labels.get(col.key)?.get(value) ?? value : value];
  })));
  return { dataset: dataset.id, columns, rows, scopeKey: analyticsScopeKey(ctx, catalog), meta: { from: input.from, to: input.to, state: input.state, rowCount: rows.length, limit: MAX_ANALYTICS_ROWS, complete: true, retrievedAt: ctx.now().toISOString() } };
}
