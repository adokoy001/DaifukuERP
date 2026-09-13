import { defineAction, label, repo, StateError, withLock, type Context } from '@daifuku/kernel';
import type { z } from 'zod';
import { Account } from '@daifuku/mod-accounting';
import { WorkforceEmployee } from '@daifuku/mod-workforce';
import * as c from './contract.ts';
import { allRows, assertEvidence, expectVersion, packEntity, profileEntity, requireKind } from './common.ts';
import { filingProfile } from './profile.ts';
import { filingWrite } from './internal.ts';
import { assertCurrent, changeState, createPreparation, sourceLocks } from './workflow.ts';
import { filingBoard, filingDetail } from './read-model.ts';
const roles = ['accounting', 'workforce_payroll'];
function action<I extends z.ZodType, O extends z.ZodType>(
  name: string,
  description: string,
  input: I,
  output: O,
  handler: (ctx: Context, input: z.infer<I>) => Promise<z.input<O>>,
  mutates = true,
) {
  return defineAction({
    name: 'tax_filing.' + name,
    description: label(description, description),
    input,
    output,
    permission: { roles },
    handler,
    mutates,
  });
}
async function saveProfile(
  ctx: Context,
  kind: c.FilingKind,
  input: { expectedVersion: number; countryProfile: string; taxYear?: number } & Record<string, unknown>,
) {
  requireKind(ctx, kind);
  return withLock(ctx, 'tax-filing', async () => {
    const entity = profileEntity(kind),
      key = kind === 'accounting' ? 'singleton' : String(input.taxYear),
      prior = (await allRows(ctx, entity, { key }))[0];
    expectVersion(prior?.version ?? 0, input.expectedVersion);
    const { expectedVersion: _v, ...data } = input,
      country = filingProfile(input.countryProfile);
    if (country.kind !== kind || (kind === 'payroll' && !country.option.taxYears.includes(input.taxYear ?? 0)))
      throw new StateError('指定した準備形式または年度は未対応です', '対応する国別形式を選んでください。');
    if (kind === 'accounting') {
      const parsed = c.accountingProfileData.parse(data);
      country.validateProfile?.(parsed);
      const accounts = new Set((await allRows(ctx, Account, {}, 2000)).map((a) => a.id));
      if (parsed.mappings.some((m) => !accounts.has(m.accountId)))
        throw new StateError('会社内に存在しない科目が指定されています', '現在の会社の科目を選択してください。');
    }
    if (kind === 'payroll') {
      const parsed = c.payrollProfileData.parse(data);
      const employees = new Set((await allRows(ctx, WorkforceEmployee, {}, 2000)).map((e) => e.id));
      if (parsed.recipients.some((r) => !employees.has(r.employeeId)))
        throw new StateError('会社内に存在しない社員が指定されています', '現在の会社の社員を選択してください。');
      if (new Set(parsed.recipients.map((r) => r.employeeId)).size !== parsed.recipients.length)
        throw new StateError('社員の補足情報が重複しています', '社員ごとに一度だけ記録してください。');
    }
    const saved = await filingWrite(ctx, entity, (write) =>
      prior
        ? repo(write, entity).update(prior.id, { data }, { expectedVersion: prior.version })
        : repo(write, entity).create({ key, data }),
    );
    return { id: saved.id, version: saved.version };
  });
}
export const boardAction = action(
  'board',
  '申告準備の設定と履歴',
  c.filingBoardInput,
  c.filingBoardOutput,
  (ctx, i) => filingBoard(ctx, i.kind),
  false,
);
export const getAction = action(
  'get',
  '保存した根拠・検算と最新資料の差異',
  c.filingRefInput,
  c.filingDetailOutput,
  (ctx, i) => filingDetail(ctx, i.kind, i.id),
  false,
);
export const saveAccountingProfileAction = action(
  'save_accounting_profile',
  '財務諸表の科目分類と根拠を保存',
  c.saveAccountingProfileInput,
  c.filingCommandOutput,
  (ctx, i) => saveProfile(ctx, 'accounting', i),
);
export const savePayrollProfileAction = action(
  'save_payroll_profile',
  '給与申告準備の補足情報を保存',
  c.savePayrollProfileInput,
  c.filingCommandOutput,
  (ctx, i) => saveProfile(ctx, 'payroll', i),
);
export const prepareAccountingAction = action(
  'prepare_accounting',
  '会計資料を採取して財務諸表を検算',
  c.prepareAccountingInput,
  c.filingCommandOutput,
  (ctx, i) => createPreparation(ctx, 'accounting', i),
);
export const preparePayrollAction = action(
  'prepare_payroll',
  '給与・年調から申告準備資料を採取',
  c.preparePayrollInput,
  c.filingCommandOutput,
  (ctx, i) => createPreparation(ctx, 'payroll', i),
);
export const confirmAction = action(
  'confirm',
  '元資料の一致を確認して準備資料を確定',
  c.confirmFilingInput,
  c.filingCommandOutput,
  (ctx, i) => changeState(ctx, i, 'confirmed'),
);
export const cancelAction = action(
  'cancel',
  '理由を残して準備資料を取消',
  c.cancelFilingInput,
  c.filingCommandOutput,
  (ctx, i) => changeState(ctx, i, 'cancelled'),
);
export const exportAction = action(
  'export',
  '確認済み準備の取込用・照合用ファイルを作成',
  c.exportFilingInput,
  c.filingExportOutput,
  (ctx, i) =>
    sourceLocks(ctx, i.kind, async () => {
      const row = await repo(ctx, packEntity(i.kind)).get(i.id);
      expectVersion(row.version, i.expectedVersion);
      if (row.status !== 'confirmed')
        throw new StateError('確認済みの準備資料を選択してください', '取消・下書きからは正式な出力を作成できません。');
      assertEvidence(row);
      const latest = await assertCurrent(ctx, i.kind, row);
      if (latest.prepared.issues.some((r) => r.severity === 'error'))
        throw new StateError('出力できない検算結果です', '新しい準備版で問題を解消してください。');
      return {
        sourceHash: row.sourceHash,
        officialImport: row.prepared.officialImport,
        notice: row.prepared.notice,
        files: filingProfile(row.countryProfile).export(row.source, row.prepared),
      };
    }),
  false,
);
