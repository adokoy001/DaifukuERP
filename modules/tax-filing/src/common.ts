import { Conflict, PermissionDenied, StateError, contentHash, repo, type Context, type Domain, type EntityDef, type Infer } from '@daifuku/kernel';
import type { FilingPack } from './entities.ts';
import type { FilingSource, FilingPrepared } from './profile.ts';
import type { FilingKind, FilingIssue } from './contract.ts';
import { FilingAccountingPack, FilingAccountingProfile, FilingPayrollPack, FilingPayrollProfile } from './entities.ts';
export const actorId = (ctx: Context): string => ctx.actor.type === 'agent' ? ctx.actor.onBehalfOf ?? '' : ctx.actor.id;
export function requireKind(ctx: Context, kind: FilingKind) { if (!ctx.companyId || ctx.actor.type === 'relay' || (ctx.accessScope && ctx.accessScope !== 'all') || (!ctx.roles.includes('admin') && !ctx.roles.includes(kind === 'accounting' ? 'accounting' : 'workforce_payroll'))) throw new PermissionDenied('tax_filing', 'company-preparation', ctx.roles); }
export const packEntity = (kind: FilingKind) => kind === 'accounting' ? FilingAccountingPack : FilingPayrollPack;
export const profileEntity = (kind: FilingKind) => kind === 'accounting' ? FilingAccountingProfile : FilingPayrollProfile;
export function expectVersion(actual: number, expected: number) { if (actual !== expected) throw new Conflict('申告準備資料が別の操作で変更されています', '最新の版を読み直してください。'); }
export function stableJson(value: unknown): string { const normalized: unknown = JSON.parse(JSON.stringify(value)); const order = (v: unknown): unknown => Array.isArray(v) ? v.map(order) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, item]) => [k, order(item)])) : v; return JSON.stringify(order(normalized)); }
export const sourceHash = (value: unknown): string => contentHash(stableJson(value));
export function issue(code: string, message: string, reference: string | null = null, severity: FilingIssue['severity'] = 'error'): FilingIssue { return { code, message, reference, severity }; }
export async function allRows<E extends EntityDef>(ctx: Context, entity: E, where: Domain = {}, maximum = 20000): Promise<Infer<E>[]> {
 const rows: Infer<E>[] = []; let expected: number | undefined;
 for (let offset = 0;; offset += 500) { const page = await repo(ctx, entity).list({ where, offset, limit: 500, orderBy: [{ field: 'id', dir: 'asc' }] });
  if (page.total > maximum || (expected !== undefined && expected !== page.total)) throw new StateError('申告根拠の上限超過または採取中の変更です', '資料を整理して再実行してください。部分集計は保存しません。'); expected = page.total; rows.push(...page.items);
  if (rows.length === page.total) return rows; if (!page.items.length || rows.length > page.total) throw new StateError('申告根拠の全件取得を確認できません', '再実行してください。'); }
}
export function rowVersions(entity: EntityDef, rows: { id: string; version: number }[]) { return rows.map(({ id, version }) => ({ entity: entity.name, id, version })); }

export function assertEvidence(row: FilingPack): asserts row is FilingPack & { source: FilingSource; prepared: FilingPrepared } { if (!row.source || !row.prepared) throw new StateError('保存済みの申告根拠が不足しています', '資料を確認し、新しい準備版を作成してください。'); }
