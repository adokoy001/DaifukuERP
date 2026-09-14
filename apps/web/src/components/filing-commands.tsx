import { useRef, useState } from 'react';
import {
  filingCommandOutput,
  filingExportOutput,
  prepareAccountingInput,
  preparePayrollInput,
  type FilingBoard,
  type FilingDetail,
  type FilingExport,
} from '@daifuku/mod-tax-filing/contract';
import { useFinanceCommand } from '../api/finance.ts';
import { useLocale } from '../i18n.tsx';
import { financeFileBlob } from '../lib/finance-file.ts';
import { saveBlob } from '../lib/download.ts';
import { FinanceDialog, FinanceField, FinanceNotice } from './finance-shared.tsx';
import { WorkforceError } from './workforce-shared.tsx';

export function FilingPrepare({
  board,
  previous,
  stale,
  onCreated,
  onClose,
}: {
  board: FilingBoard;
  previous?: FilingDetail | undefined;
  stale: boolean;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const command = useFinanceCommand();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const accounting = board.kind === 'accounting';
  return (
    <FinanceDialog
      title={t(
        previous
          ? { ja: '最新の根拠で資料を再作成', en: 'Recreate from current sources' }
          : { ja: '申告準備資料を作成', en: 'Create filing preparation' },
      )}
      submitLabel={t({ ja: '根拠を固定して資料を作成', en: 'Create source snapshot' })}
      stale={stale}
      submitDisabled={board.truncated}
      onClose={onClose}
      onSubmit={async (data) => {
        const common = { idempotencyKey, ...(previous ? { previousId: previous.id } : {}) };
        const input = accounting
          ? prepareAccountingInput.parse({
              ...common,
              fiscalYearId: String(data.get('fiscalYearId') ?? ''),
              incomeTransferNotPostedConfirmed: data.get('scopeConfirmed') === 'on',
              taxClassificationReview: String(data.get('review') ?? ''),
            })
          : preparePayrollInput.parse({
              ...common,
              taxYear: Number(data.get('taxYear')),
              annualScopeConfirmed: data.get('scopeConfirmed') === 'on',
            });
        const result = filingCommandOutput.parse(
          await command.mutateAsync({
            action: accounting ? 'tax_filing.prepare_accounting' : 'tax_filing.prepare_payroll',
            input,
          }),
        );
        onCreated(result.id);
      }}
    >
      <FinanceNotice>
        {t({
          ja: '現在の原資料と設定を固定して下書きを作成します。既存の資料を上書きせず、再作成元との関係を残します。',
          en: 'Capture current sources and settings in a draft. Existing preparations are preserved and recreation links are recorded.',
        })}
      </FinanceNotice>
      {accounting ? (
        <>
          <label className="finance-field">
            <span>{t({ ja: '会計年度', en: 'Fiscal year' })}</span>
            <select className="input" name="fiscalYearId" required defaultValue={previous?.fiscalYearId ?? ''}>
              <option value="">{t({ ja: '対象年度を選択', en: 'Select fiscal year' })}</option>
              {board.years.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.code} · {year.from} ～ {year.to} ·{' '}
                  {t(year.closed ? { ja: '締め済み', en: 'Closed' } : { ja: '未締め', en: 'Open' })}
                </option>
              ))}
            </select>
          </label>
          <FinanceField
            label={{ ja: '消費税区分と例外項目の確認記録', en: 'Review of tax classification and exceptions' }}
            name="review"
            required
            maxLength={2000}
          />
          <label>
            <input type="checkbox" name="scopeConfirmed" required />
            {t({
              ja: '当年度の損益振替仕訳をまだ転記していないことを確認しました',
              en: 'I verified that the current-year income closing transfer has not been posted',
            })}
          </label>
        </>
      ) : (
        <>
          <label className="finance-field">
            <span>{t({ ja: '対象年', en: 'Tax year' })}</span>
            <select
              className="input"
              name="taxYear"
              defaultValue={previous?.taxYear ?? board.payrollProfile?.taxYear}
              required
            >
              {[...new Set(board.profiles.flatMap((row) => row.taxYears))].map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" name="scopeConfirmed" required />
            {t({
              ja: '対象年の全従業員・給与・年末調整の対象範囲を確認しました',
              en: 'I reviewed the full employee, payroll and year-end adjustment scope for this year',
            })}
          </label>
        </>
      )}
    </FinanceDialog>
  );
}

export function FilingReview({
  detail,
  mode,
  stale,
  onClose,
}: {
  detail: FilingDetail;
  mode: 'confirm' | 'cancel';
  stale: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const command = useFinanceCommand();
  const confirm = mode === 'confirm';
  return (
    <FinanceDialog
      title={t(
        confirm
          ? { ja: '申告準備資料を確認', en: 'Confirm filing preparation' }
          : { ja: '準備資料を取消', en: 'Cancel preparation' },
      )}
      submitLabel={t(
        confirm
          ? { ja: '資料の確認を完了', en: 'Confirm preparation' }
          : { ja: '理由を記録して取消', en: 'Record reason and cancel' },
      )}
      stale={stale || (confirm && detail.stale)}
      onClose={onClose}
      onSubmit={async (data) => {
        await command.mutateAsync({
          action: `tax_filing.${mode}`,
          input: {
            kind: detail.kind,
            id: detail.id,
            expectedVersion: detail.version,
            reason: String(data.get('reason') ?? ''),
            ...(confirm ? { warningsReviewed: data.get('reviewed') === 'on' } : {}),
          },
        });
      }}
    >
      <FinanceNotice>
        {t({
          ja: 'これは資料の確認・取消です。税務署や自治体への送信、提出済み申告の取消は行いません。',
          en: 'This confirms or cancels the preparation only. It does not submit to tax authorities or withdraw a filed return.',
        })}
      </FinanceNotice>
      <FinanceField
        label={{ ja: '確認・取消の根拠', en: 'Review / cancellation evidence' }}
        name="reason"
        required
        maxLength={2000}
      />
      {confirm ? (
        <label>
          <input type="checkbox" name="reviewed" required />
          {t({ ja: '検算結果とすべての注意事項を確認しました', en: 'I reviewed all validation results and warnings' })}
        </label>
      ) : null}
    </FinanceDialog>
  );
}

export function FilingDownloads({
  detail,
  stale,
  onClose,
}: {
  detail: FilingDetail;
  stale: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const command = useFinanceCommand();
  const [result, setResult] = useState<FilingExport>();
  const [error, setError] = useState<unknown>();
  const locked = useRef(false);
  const download = async () => {
    if (locked.current || stale) return;
    locked.current = true;
    setResult(undefined);
    setError(undefined);
    try {
      setResult(
        filingExportOutput.parse(
          await command.mutateAsync({
            action: 'tax_filing.export',
            input: { kind: detail.kind, id: detail.id, expectedVersion: detail.version },
          }),
        ),
      );
    } catch (failure) {
      setError(failure);
    } finally {
      locked.current = false;
    }
  };
  return (
    <FinanceDialog
      title={t({ ja: '申告準備ファイルを取得', en: 'Download filing files' })}
      submitLabel=""
      readOnly
      onClose={onClose}
      onSubmit={async () => undefined}
    >
      <FinanceNotice>{detail.notice}</FinanceNotice>
      <button
        type="button"
        className="btn btn-primary"
        disabled={command.isPending || stale}
        onClick={() => {
          void download();
        }}
      >
        {t({ ja: '最新の根拠を検査して出力', en: 'Validate sources and export' })}
      </button>
      {error ? <WorkforceError error={error} /> : null}
      {result && !stale ? (
        <>
          <p>{result.notice}</p>
          <div className="finance-download">
            {result.files.map((file) => (
              <button
                type="button"
                key={file.filename}
                className="btn"
                onClick={() => saveBlob(financeFileBlob(file.contentBase64, file.mediaType), file.filename)}
              >
                {file.filename} · {file.encoding}
              </button>
            ))}
          </div>
          <small>
            {t({ ja: '根拠ハッシュ', en: 'Source hash' })}: {result.sourceHash}
          </small>
        </>
      ) : null}
    </FinanceDialog>
  );
}
