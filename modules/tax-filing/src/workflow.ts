import { repo, StateError, Conflict, withLock, type Context } from '@daifuku/kernel';
import { WorkforceEmployee } from '@daifuku/mod-workforce';
import type { FilingKind } from './contract.ts';
import { actorId, allRows, expectVersion, packEntity, requireKind, sourceHash, stableJson } from './common.ts';
import { accountingSource } from './accounting-source.ts';
import { payrollSource } from './payroll-source.ts';
import { filingProfile } from './profile.ts';
import { filingWrite } from './internal.ts';
import type { FilingPack } from './entities.ts';
export async function sourceLocks<T>(ctx: Context, kind: FilingKind, work: () => Promise<T>): Promise<T> {
  requireKind(ctx, kind);
  return withLock(ctx, 'tax-filing', () =>
    withLock(ctx, kind === 'accounting' ? 'accounting-periods' : 'workforce:policies', async () => {
      if (kind === 'payroll')
        for (const employee of await allRows(ctx, WorkforceEmployee, {}, 2000))
          await withLock(ctx, 'workforce:employee:' + employee.id, async () => undefined);
      return work();
    }),
  );
}
export async function loadSource(
  ctx: Context,
  kind: FilingKind,
  target: { fiscalYearId?: string | null | undefined; taxYear?: number | null | undefined; request: unknown },
) {
  const source =
    kind === 'accounting'
      ? await accountingSource(ctx, target.fiscalYearId ?? '')
      : await payrollSource(ctx, target.taxYear ?? 0);
  source.records.preparationFacts = target.request;
  const profile = filingProfile(String(source.profile.countryProfile));
  if (
    profile.kind !== kind ||
    (kind === 'payroll' && !profile.option.taxYears.includes(target.taxYear ?? 0)) ||
    source.from < profile.option.from ||
    (profile.option.to && source.to > profile.option.to)
  )
    throw new StateError('申告準備形式の対応期間外です', '対応する制度年・会計期間を指定してください。');
  source.records.countryProfile = profile.option;
  source.records.referenceArtifacts = profile.referenceArtifacts ?? [];
  return { source, prepared: profile.prepare(source) };
}
export async function createPreparation(
  ctx: Context,
  kind: FilingKind,
  input: {
    idempotencyKey: string;
    previousId?: string | undefined;
    fiscalYearId?: string | undefined;
    taxYear?: number | undefined;
  },
) {
  return sourceLocks(ctx, kind, async () => {
    const entity = packEntity(kind);
    const prior = (await allRows(ctx, entity, { idempotencyKey: input.idempotencyKey }))[0];
    if (prior) {
      if (stableJson(prior.request) !== stableJson(input))
        throw new Conflict('再試行キーが別の準備で使われています', '新しい準備には新しいキーを使用してください。');
      return { id: prior.id, version: prior.version };
    }
    if (input.previousId) {
      const previous = await repo(ctx, entity).get(input.previousId);
      if (previous.fiscalYearId !== (input.fiscalYearId ?? null) || previous.taxYear !== (input.taxYear ?? null))
        throw new StateError('前版の対象期間が異なります', '同じ会計年度または給与年度の前版を選んでください。');
    }
    const { source, prepared } = await loadSource(ctx, kind, { ...input, request: input });
    const row = await filingWrite(ctx, entity, (write) =>
      repo(write, entity).create({
        countryProfile: String(source.profile.countryProfile),
        from: source.from,
        to: source.to,
        fiscalYearId: input.fiscalYearId ?? null,
        taxYear: input.taxYear ?? null,
        previousId: input.previousId ?? null,
        idempotencyKey: input.idempotencyKey,
        request: input,
        source: JSON.parse(stableJson(source)),
        prepared,
        sourceHash: sourceHash(source),
        status: 'draft',
        preparedBy: actorId(ctx),
      }),
    );
    return { id: row.id, version: row.version };
  });
}
export async function currentSource(ctx: Context, kind: FilingKind, row: FilingPack) {
  return loadSource(ctx, kind, { fiscalYearId: row.fiscalYearId, taxYear: row.taxYear, request: row.request });
}
export async function assertCurrent(ctx: Context, kind: FilingKind, row: FilingPack) {
  const latest = await currentSource(ctx, kind, row);
  if (sourceHash(latest.source) !== row.sourceHash)
    throw new Conflict('申告準備の元資料が変更されています', '保存資料を残して新しい準備版を作成してください。');
  return latest;
}
export async function changeState(
  ctx: Context,
  input: { kind: FilingKind; id: string; expectedVersion: number; reason: string },
  status: 'confirmed' | 'cancelled',
) {
  return sourceLocks(ctx, input.kind, async () => {
    const entity = packEntity(input.kind);
    const row = await repo(ctx, entity).lock(input.id);
    expectVersion(row.version, input.expectedVersion);
    if (row.status === 'cancelled' || (status === 'confirmed' && row.status !== 'draft'))
      throw new StateError('準備資料の状態が変わっています', '現在の状態を確認してください。');
    if (status === 'confirmed') {
      if (row.preparedBy === actorId(ctx))
        throw new StateError('作成者以外の担当者が確認してください', '元資料と検算を別担当者が確認します。');
      const latest = await assertCurrent(ctx, input.kind, row);
      if (latest.prepared.issues.some((i) => i.severity === 'error'))
        throw new StateError(
          '申告準備に未解決の検算エラーがあります',
          '問題を修正し、新しい準備版を作成してください。',
        );
    }
    const updated = await filingWrite(ctx, entity, (write) =>
      repo(write, entity).update(
        row.id,
        {
          status,
          reviewReason: input.reason,
          ...(status === 'confirmed' ? { confirmedAt: ctx.now(), confirmedBy: actorId(ctx) } : {}),
        },
        { expectedVersion: row.version },
      ),
    );
    return { id: updated.id, version: updated.version };
  });
}
