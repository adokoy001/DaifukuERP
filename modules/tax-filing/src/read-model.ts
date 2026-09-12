import { repo, type Context } from '@daifuku/kernel';
import { Account, FiscalPeriod, FiscalYear } from '@daifuku/mod-accounting';
import { WorkforceEmployee } from '@daifuku/mod-workforce';
import { accountingProfileData, payrollProfileData, filingBoardOutput, filingDetailOutput, filingSummary, type FilingKind } from './contract.ts';
import { allRows, assertEvidence, packEntity, profileEntity, requireKind, sourceHash } from './common.ts';
import { filingProfiles } from './profile.ts';
import { currentSource, sourceLocks } from './workflow.ts';
import { ledgerIntegrityIssues } from './ledger-validation.ts';
import type { FilingPack } from './entities.ts';
export function summary(kind: FilingKind, row: FilingPack) { assertEvidence(row); return filingSummary.parse({ ...row, kind, createdAt: row.createdAt.toISOString(), confirmedAt: row.confirmedAt?.toISOString() ?? null, issues: row.prepared.issues, totals: row.prepared.totals }); }
export async function filingBoard(ctx: Context, kind: FilingKind) {
 requireKind(ctx, kind);
 const packs = await repo(ctx, packEntity(kind)).list({ limit: 100, orderBy: [{ field: 'createdAt', dir: 'desc' }] }), profiles = await allRows(ctx, profileEntity(kind));
 const accounts = kind === 'accounting' ? await allRows(ctx, Account, {}, 2000) : [], years = kind === 'accounting' ? await allRows(ctx, FiscalYear) : [], employees = kind === 'payroll' ? await allRows(ctx, WorkforceEmployee, {}, 2000) : [];
 const saved = profiles[0], periods = kind === 'accounting' ? await allRows(ctx, FiscalPeriod) : [];
 const closed = (year: { id: string; startDate: string; endDate: string }) => { const relevant = periods.filter((p) => p.fiscalYearId === year.id); return relevant.length > 0 && relevant.every((p) => p.isClosed) && ledgerIntegrityIssues(year, relevant, [], []).length === 0; };
 return filingBoardOutput.parse({ kind, profiles: filingProfiles().filter((p) => p.kind === kind).map((p) => p.option), accountingProfile: kind === 'accounting' && saved ? { ...accountingProfileData.parse(saved.data), version: saved.version } : null, payrollProfile: kind === 'payroll' && saved ? { ...payrollProfileData.parse(saved.data), version: saved.version } : null, years: years.map((y) => ({ id: y.id, code: y.code, from: y.startDate, to: y.endDate, closed: closed(y) })), accounts, employees, packs: packs.items.map((r) => summary(kind, r)), truncated: packs.total > packs.items.length });
}
export async function filingDetail(ctx: Context, kind: FilingKind, id: string) {
 return sourceLocks(ctx, kind, async () => { const row = await repo(ctx, packEntity(kind)).get(id), latest = await currentSource(ctx, kind, row); assertEvidence(row);
  return filingDetailOutput.parse({ ...summary(kind, row), stale: sourceHash(latest.source) !== row.sourceHash, statements: row.prepared.statements, payrollRows: row.prepared.payrollRows, sourceCount: row.source.versions.length, sourceVersions: row.source.versions, officialImport: row.prepared.officialImport, notice: row.prepared.notice, profile: row.source.profile });
 });
}
