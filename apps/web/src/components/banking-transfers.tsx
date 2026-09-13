import { useState } from 'react';
import { bankTransferDetail, bankTransferExportOutput, type BankBoard } from '@daifuku/mod-banking/contract';
import { useFinanceCommand, useFinanceList, useFinanceRead } from '../api/finance.ts';
import type { RecordJson } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { financeBytesBlob } from '../lib/finance-file.ts';
import { saveBlob } from '../lib/download.ts';
import { CommercePager } from './commerce-shared.tsx';
import { FinanceDialog, FinanceField, FinanceMoney, FinanceNotice, SourceLink } from './finance-shared.tsx';
import { WorkforceError } from './workforce-shared.tsx';

type Selection = { invoice: RecordJson; payeeId: string };
export function BankingTransferPrepare({
  account,
  payees,
  stale,
  onClose,
}: {
  account: BankBoard['accounts'][number];
  payees: BankBoard['payees'];
  stale: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale(),
    [offset, setOffset] = useState(0),
    [selection, setSelection] = useState<Record<string, Selection>>({}),
    [requestId] = useState(() => crypto.randomUUID());
  const query = useFinanceList('purchase_invoice', { docstatus: 1, balance: { $gt: '0' } }, !stale, offset),
    command = useFinanceCommand();
  const items = Object.values(selection);
  return (
    <FinanceDialog
      title={t({ ja: '振込データを準備', en: 'Prepare transfer data' })}
      description={`${account.name} · ${account.accountNumberMasked}`}
      submitLabel={t({ ja: '対象と口座を固定して準備', en: 'Prepare with verified accounts' })}
      stale={stale}
      submitDisabled={query.isFetching || query.isError || !items.length || items.some((item) => !item.payeeId)}
      onClose={onClose}
      onSubmit={async (data) => {
        await command.mutateAsync({
          action: 'banking.prepare_transfer',
          input: {
            requestId,
            bankAccountId: account.id,
            accountVersion: account.version,
            transferDate: String(data.get('transferDate') ?? ''),
            items: items.map(({ invoice, payeeId }) => {
              const payee = payees.find((row) => row.id === payeeId);
              if (!payee?.active)
                throw new Error(t({ ja: '振込先を選び直してください。', en: 'Select the payee account again.' }));
              return {
                invoiceId: invoice.id,
                expectedVersion: invoice.version,
                expectedBalance: String(invoice.balance),
                payeeId,
                payeeVersion: payee.version,
              };
            }),
          },
        });
      }}
    >
      <FinanceNotice>
        {t({
          ja: '未払請求書の残高全額を対象にします。準備・出力では送金せず、入出金や仕訳も作成しません。銀行での受付と実出金は別途確認します。',
          en: 'Use the full outstanding invoice balances. Preparation and export do not send money or create payments. Confirm bank acceptance and actual debits separately.',
        })}
      </FinanceNotice>
      <FinanceField label={{ ja: '振込指定日', en: 'Transfer date' }} name="transferDate" type="date" required />
      {query.isError ? (
        <WorkforceError
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : null}
      <div className="finance-table-wrap">
        <table className="finance-table">
          <thead>
            <tr>
              <th>{t({ ja: '対象請求書', en: 'Invoice' })}</th>
              <th>{t({ ja: '振込先', en: 'Payee account' })}</th>
              <th>{t({ ja: '未払残高', en: 'Outstanding' })}</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.items.map((invoice) => {
              const candidates = payees.filter((payee) => payee.partnerId === invoice.partnerId && payee.active),
                item = selection[invoice.id];
              return (
                <tr key={invoice.id}>
                  <td>
                    <label>
                      <input
                        type="checkbox"
                        checked={Boolean(item)}
                        onChange={(event) =>
                          setSelection((current) => {
                            const next = { ...current };
                            if (event.target.checked)
                              next[invoice.id] = {
                                invoice,
                                payeeId: candidates.length === 1 ? (candidates[0]?.id ?? '') : '',
                              };
                            else delete next[invoice.id];
                            return next;
                          })
                        }
                      />
                      {String(invoice.number)}
                    </label>
                    <small>{String(invoice.date)}</small>
                    <SourceLink entity="purchase_invoice" id={invoice.id}>
                      {t({ ja: '原資料', en: 'Source' })}
                    </SourceLink>
                  </td>
                  <td>
                    <select
                      className="input"
                      aria-label={`${String(invoice.number)} ${t({ ja: '振込先', en: 'Payee account' })}`}
                      disabled={!item}
                      value={item?.payeeId ?? ''}
                      onChange={(event) => {
                        const payeeId = event.target.value;
                        setSelection((current) => ({ ...current, [invoice.id]: { invoice, payeeId } }));
                      }}
                    >
                      <option value="">{t({ ja: '口座を選択', en: 'Select account' })}</option>
                      {candidates.map((payee) => (
                        <option key={payee.id} value={payee.id}>
                          {payee.partnerName} · {payee.accountNumberMasked}
                        </option>
                      ))}
                    </select>
                    {!candidates.length ? (
                      <small>
                        {t({
                          ja: '取引先の振込先口座を先に登録してください。',
                          en: 'Register an account for this partner first.',
                        })}
                      </small>
                    ) : null}
                  </td>
                  <td data-money>
                    <FinanceMoney value={String(invoice.balance)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <CommercePager offset={offset} total={query.data?.total ?? 0} onPage={setOffset} />
      <p>{t({ ja: `${items.length}件を選択`, en: `${items.length} selected` })}</p>
    </FinanceDialog>
  );
}

export function BankingTransferExport({
  batchId,
  stale,
  onClose,
}: {
  batchId: string;
  stale: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale(),
    query = useFinanceRead('banking.transfer_detail', { batchId }, !stale, bankTransferDetail.parse),
    command = useFinanceCommand();
  const [format, setFormat] = useState<'canonical_csv' | 'zengin120'>('zengin120'),
    [lineEnding, setLineEnding] = useState<'none' | 'crlf'>('none');
  const value = query.data;
  const exported = value?.state === 'exported',
    exportFormat = exported ? (value.format ?? format) : format;
  const exportEnding = exported
    ? (value.lineEnding ?? lineEnding)
    : exportFormat === 'canonical_csv'
      ? 'crlf'
      : lineEnding;
  const accountType = (type: 'ordinary' | 'current') =>
    t(type === 'ordinary' ? { ja: '普通', en: 'Ordinary' } : { ja: '当座', en: 'Current' });
  return (
    <FinanceDialog
      title={t({ ja: '振込データの確認・出力', en: 'Review and export transfers' })}
      submitLabel={t({ ja: '確認してファイルを保存', en: 'Confirm and download file' })}
      stale={stale}
      submitDisabled={!value || query.isFetching || query.isError || value.state === 'cancelled'}
      onClose={onClose}
      onSubmit={async (data) => {
        if (!value || data.get('reviewed') !== 'on') return;
        const result = bankTransferExportOutput.parse(
          await command.mutateAsync({
            action: 'banking.export_transfer',
            input: { batchId, expectedVersion: value.version, format: exportFormat, lineEnding: exportEnding },
          }),
        );
        saveBlob(financeBytesBlob(result.bytes, result.contentType), result.filename);
      }}
    >
      {query.isError ? (
        <WorkforceError
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : !value ? (
        <p role="status">{t({ ja: '振込対象を取得中…', en: 'Loading transfers…' })}</p>
      ) : (
        <>
          <FinanceNotice>
            {t({
              ja: '保存後、契約している銀行サービスで取込・承認します。全銀120バイト形式の対応可否と改行設定を銀行に確認してください。この操作だけでは送金されません。',
              en: 'Import and approve the file in your bank service. Verify its support for the 120-byte Zengin format and line endings. This action does not send money.',
            })}
          </FinanceNotice>
          <p>
            {value.snapshot.account.name} · {value.snapshot.account.bankCode}-{value.snapshot.account.branchCode} ·{' '}
            {accountType(value.snapshot.account.accountType)} · {value.snapshot.account.accountNumber} ·{' '}
            {value.transferDate}
          </p>
          <p>
            {value.snapshot.account.holderKana} · {t({ ja: '振込依頼人コード', en: 'Requester code' })}:{' '}
            {value.snapshot.account.requesterCode}
          </p>
          <p>
            {value.itemCount} {t({ ja: '件 / 合計', en: 'items / total' })} <FinanceMoney value={value.total} />
          </p>
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead>
                <tr>
                  <th>{t({ ja: '振込先・請求書', en: 'Payee / invoice' })}</th>
                  <th>{t({ ja: '銀行・支店・口座', en: 'Bank / branch / account' })}</th>
                  <th>{t({ ja: '金額', en: 'Amount' })}</th>
                </tr>
              </thead>
              <tbody>
                {value.snapshot.lines.map((row) => (
                  <tr key={row.invoiceId}>
                    <td>
                      {row.partnerName}
                      <small>
                        {row.payee.holderKana} · {row.number}
                      </small>
                    </td>
                    <td>
                      {row.payee.bankCode}-{row.payee.branchCode}
                      <small>
                        {accountType(row.payee.accountType)} · {row.payee.accountNumber}
                      </small>
                    </td>
                    <td data-money>
                      <FinanceMoney value={row.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="finance-form-grid">
            <label className="finance-field">
              <span>{t({ ja: '出力形式', en: 'Export format' })}</span>
              <select
                className="input"
                disabled={exported}
                value={exportFormat}
                onChange={(event) => setFormat(event.target.value as typeof format)}
              >
                <option value="zengin120">
                  {t({ ja: '全銀120バイト（Shift_JIS）', en: 'Zengin 120-byte (Shift_JIS)' })}
                </option>
                <option value="canonical_csv">{t({ ja: '確認用CSV（UTF-8）', en: 'Review CSV (UTF-8)' })}</option>
              </select>
            </label>
            <label className="finance-field">
              <span>{t({ ja: '全銀の改行', en: 'Zengin line ending' })}</span>
              <select
                className="input"
                disabled={exported || exportFormat === 'canonical_csv'}
                value={exportEnding}
                onChange={(event) => setLineEnding(event.target.value as typeof lineEnding)}
              >
                <option value="none">{t({ ja: '改行なし', en: 'No line endings' })}</option>
                <option value="crlf">CRLF</option>
              </select>
            </label>
          </div>
          <label>
            <input type="checkbox" name="reviewed" required />
            {t({
              ja: '振込先・金額・指定日・銀行の取込条件を確認しました',
              en: 'I reviewed the payees, amounts, date and bank import requirements',
            })}
          </label>
        </>
      )}
    </FinanceDialog>
  );
}

export function BankingTransferCancel({
  row,
  stale,
  onClose,
}: {
  row: BankBoard['transfers'][number];
  stale: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale(),
    command = useFinanceCommand();
  return (
    <FinanceDialog
      title={t({ ja: '振込準備を取消', en: 'Cancel transfer preparation' })}
      submitLabel={t({ ja: '準備を取消', en: 'Cancel preparation' })}
      onClose={onClose}
      stale={stale}
      onSubmit={async (data) => {
        await command.mutateAsync({
          action: 'banking.cancel_transfer',
          input: { batchId: row.id, expectedVersion: row.version, reason: String(data.get('reason') ?? '') },
        });
      }}
    >
      <FinanceNotice>
        {t({
          ja: '銀行へ提出済みのファイルは取消されません。提出後の変更は銀行側の状態も確認してください。',
          en: 'This does not cancel a file already submitted to a bank. Check the bank status if you submitted it.',
        })}
      </FinanceNotice>
      <FinanceField label={{ ja: '取消理由', en: 'Cancellation reason' }} name="reason" required maxLength={500} />
    </FinanceDialog>
  );
}
