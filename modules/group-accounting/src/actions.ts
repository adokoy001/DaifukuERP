import { authorizedCompanies, can, Conflict, defineAction, label, repo, StateError, withAuthorizedCompany, withLock, type Context, type Infer } from '@daifuku/kernel';
import { Account, JournalLine } from '@daifuku/mod-accounting';
import { z } from 'zod';
import { boardOutput, changeInput, command, companySource, groupMapping, adjustment, groupResult, prepareInput, sourceInput } from './contract.ts';
import { GroupRun } from './entity.ts';
import { writeGroup } from './internal.ts';
import { collectSources } from './sources.ts';
import { consolidate } from './calculate.ts';
async function authorizeSnapshot(ctx: Context, row: Infer<typeof GroupRun>) {
  const sources = z.array(companySource).parse(row.sources);
  for (const source of sources) await withAuthorizedCompany(ctx, source.companyId, async (child) => { await repo(child, Account).list({ limit: 1 }); await repo(child, JournalLine).list({ limit: 1 }); });
  return sources;
}
function board(row: Infer<typeof GroupRun>) { return { id: row.id, version: row.version, name: row.name, from: row.from, to: row.to, status: row.status, sources: z.array(companySource).parse(row.sources), mapping: z.array(groupMapping).parse(row.mapping), adjustments: z.array(adjustment).parse(row.adjustments), result: groupResult.parse(row.result), reviewBasis: row.reviewBasis, confirmedAt: row.confirmedAt?.toISOString() ?? null, reason: row.reason }; }
export const groupCompaniesAction = defineAction({ name: 'group_accounting.companies', description: label('連結対象として選択可能な会社', 'Authorized consolidation companies'), input: z.object({}), output: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string(), currency: z.string() })), permission: { roles: ['accounting'] }, mutates: false, handler: async (ctx) => {
  const companies = await authorizedCompanies(ctx), allowed = [];
  for (const company of companies) { const canRead = await withAuthorizedCompany(ctx, company.id, async (child) => can(child, Account, 'read') && can(child, JournalLine, 'read')); if (canRead && company.currency === 'JPY') allowed.push(company); } return allowed;
} });
export const groupSourcesAction = defineAction({ name: 'group_accounting.sources', description: label('単体試算表と科目mapping用資料', 'Standalone trial balances for mapping'), input: sourceInput, output: z.object({ sources: z.array(companySource) }), permission: { roles: ['accounting'] }, mutates: false, handler: async (ctx, input) => ({ sources: await collectSources(ctx, input) }) });
export const prepareGroupAction = defineAction({ name: 'group_accounting.prepare', description: label('連結精算表の下書きを作成・更新', 'Prepare a consolidation worksheet'), input: prepareInput, output: command, permission: { entity: GroupRun.name, op: 'create' }, handler: async (ctx, input) => withLock(ctx, 'group-run:' + (input.runId ?? 'new'), async () => {
  const previous = input.runId ? await repo(ctx, GroupRun).lock(input.runId) : null;
  if (previous) { await authorizeSnapshot(ctx, previous); if (previous.status !== 'draft' || previous.version !== input.expectedVersion) throw new Conflict('Consolidation draft changed or is finalized', 'Reload or create a new worksheet.'); }
  else if (input.expectedVersion !== 0) throw new Conflict('New worksheet version must be zero', 'Omit runId for a new draft.');
  const sources = await collectSources(ctx, input), result = consolidate(sources, input.mapping, input.adjustments);
  return writeGroup(ctx, async (inner) => { const values = { name: input.name, from: input.from, to: input.to, sources, mapping: input.mapping, adjustments: input.adjustments, result, reviewBasis: input.reviewBasis, status: 'draft' as const }; const row = previous ? await repo(inner, GroupRun).update(previous.id, values) : await repo(inner, GroupRun).create(values); return { id: row.id, version: row.version, status: row.status }; });
}) });
export const groupBoardAction = defineAction({ name: 'group_accounting.board', description: label('権限を再確認して連結精算表を表示', 'Read an authorized consolidation worksheet'), input: z.object({ runId: z.uuid() }), output: boardOutput, permission: { entity: GroupRun.name, op: 'read' }, mutates: false, handler: async (ctx, { runId }) => { const row = await repo(ctx, GroupRun).get(runId); await authorizeSnapshot(ctx, row); return board(row); } });
export const confirmGroupAction = defineAction({ name: 'group_accounting.confirm', description: label('最新・締め済み資料で連結を確定', 'Confirm current closed-period consolidation'), input: changeInput, output: command, permission: { entity: GroupRun.name, op: 'update' }, handler: async (ctx, input) => {
  const row = await repo(ctx, GroupRun).lock(input.runId); if (row.status !== 'draft' || row.version !== input.expectedVersion) throw new Conflict('Worksheet changed or is not a draft', 'Reload the current worksheet.');
  const original = await authorizeSnapshot(ctx, row), current = await collectSources(ctx, { companyIds: original.map((s) => s.companyId), from: row.from, to: row.to }, true);
  if (current.some((source) => original.find((old) => old.companyId === source.companyId)?.revision !== source.revision)) throw new Conflict('Standalone source changed', 'Prepare the draft again using current closed-period sources.');
  const calculated = consolidate(original, z.array(groupMapping).parse(row.mapping), z.array(adjustment).parse(row.adjustments));
  if (JSON.stringify(calculated) !== JSON.stringify(groupResult.parse(row.result))) throw new StateError('Consolidation snapshot is inconsistent', 'Rebuild and review the draft.');
  return writeGroup(ctx, async (inner) => { const updated = await repo(inner, GroupRun).update(row.id, { status: 'confirmed', confirmedAt: ctx.now(), reason: input.reason }); return { id: updated.id, version: updated.version, status: updated.status }; });
} });
export const cancelGroupAction = defineAction({ name: 'group_accounting.cancel', description: label('理由を残して連結精算表を取消', 'Cancel a consolidation worksheet'), input: changeInput, output: command, permission: { entity: GroupRun.name, op: 'update' }, handler: async (ctx, input) => { const row = await repo(ctx, GroupRun).lock(input.runId); await authorizeSnapshot(ctx, row); if (row.version !== input.expectedVersion || row.status === 'cancelled') throw new Conflict('Worksheet changed or is already cancelled', 'Reload the current worksheet.'); return writeGroup(ctx, async (inner) => { const updated = await repo(inner, GroupRun).update(row.id, { status: 'cancelled', reason: input.reason }); return { id: updated.id, version: updated.version, status: updated.status }; }); } });
