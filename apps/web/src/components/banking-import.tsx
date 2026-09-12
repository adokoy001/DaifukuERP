import { useRef, useState } from 'react';
import { bankImportPreview, type BankBoard } from '@daifuku/mod-banking/contract';
import { useFinanceCommand } from '../api/finance.ts';
import { useLocale } from '../i18n.tsx';
import { FinanceFileError, readFinanceCsv } from '../lib/finance-file.ts';
import { saveBlob } from '../lib/download.ts';
import { FinanceDialog, FinanceMoney, FinanceNotice } from './finance-shared.tsx';
import { WorkforceError } from './workforce-shared.tsx';

export function BankingImport({ account, stale, onClose }: { account: BankBoard['accounts'][number]; stale: boolean; onClose: () => void }) {
  const { t } = useLocale(), command = useFinanceCommand();
  const [csv, setCsv] = useState(''), [filename, setFilename] = useState(''), [preview, setPreview] = useState<ReturnType<typeof bankImportPreview.parse>>(), [error, setError] = useState<unknown>(), [busy, setBusy] = useState(false);
  const reading = useRef(0), pending = useRef(false);
  const read = async (file: File | undefined) => {
    const generation = ++reading.current; setPreview(undefined); setCsv(''); setFilename(''); setError(undefined);
    if (!file) return;
    try { const text = await readFinanceCsv(file); if (generation === reading.current) { setCsv(text); setFilename(file.name); } }
    catch (failure) { if (generation === reading.current) setError(failure); }
  };
  const inspect = async () => {
    if (pending.current || stale || !csv) return; pending.current = true; setBusy(true); setError(undefined); const generation = reading.current;
    try { const result = await command.mutateAsync({ action: 'banking.preview_import', input: { bankAccountId: account.id, csv } }); if (generation === reading.current) setPreview(bankImportPreview.parse(result)); }
    catch (failure) { setError(failure); } finally { pending.current = false; setBusy(false); }
  };
  return <FinanceDialog title={t({ ja: '銀行明細を取り込む', en: 'Import bank transactions' })} description={`${account.name} · ${account.accountNumberMasked}`} submitLabel={t({ ja: '確認した明細を取り込む', en: 'Import reviewed transactions' })} readOnly={!preview} stale={stale || busy} onClose={onClose} onSubmit={async () => {
    if (!preview || stale || busy) return;
    await command.mutateAsync({ action: 'banking.import_statement_csv', input: { bankAccountId: account.id, csv, previewHash: preview.previewHash } });
  }}>
    <FinanceNotice>{t({ ja: '正規CSV（UTF-8・最大256 KiB）を使用します。明細IDは同じ取引に同じ値を付け、再取得時も保持してください。取込だけでは会計処理しません。', en: 'Use canonical UTF-8 CSV up to 256 KiB. Keep the same stable transaction ID across downloads. Importing does not post accounting entries.' })}</FinanceNotice>
    <button type="button" className="btn" onClick={() => saveBlob(new Blob(['externalId,bookedOn,direction,amount,description\r\nSAMPLE-001,2026-09-01,receive,11000,サンプル入金\r\n'], { type: 'text/csv;charset=utf-8' }), 'daifuku-bank-sample.csv')}>{t({ ja: '入力例CSVを保存', en: 'Download sample CSV' })}</button>
    <label className="finance-field"><span>{t({ ja: '銀行明細CSV', en: 'Bank transaction CSV' })}</span><input type="file" accept=".csv,text/csv" disabled={busy} onChange={(event) => { void read(event.target.files?.[0]); }}/></label>
    <button type="button" className="btn btn-primary" disabled={!csv || busy || stale} onClick={() => { void inspect(); }}>{busy ? t({ ja: '検査中…', en: 'Validating…' }) : t({ ja: '取込内容を確認', en: 'Preview import' })}</button>
    {error instanceof FinanceFileError ? <p role="alert" className="finance-inline-error">{t(error.label)}</p> : error ? <WorkforceError error={error}/> : null}
    {preview ? <><p>{filename} · {t({ ja: `全${preview.rowCount}件 / 新規${preview.newCount}件 / 登録済み${preview.duplicateCount}件`, en: `${preview.rowCount} rows / ${preview.newCount} new / ${preview.duplicateCount} already imported` })}</p><p>{t({ ja: '入金合計', en: 'Receipts' })}: <FinanceMoney value={preview.receiveTotal}/> · {t({ ja: '出金合計', en: 'Disbursements' })}: <FinanceMoney value={preview.payTotal}/></p>
      <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>{t({ ja: '明細ID・日付', en: 'Transaction / date' })}</th><th>{t({ ja: '摘要', en: 'Description' })}</th><th>{t({ ja: '金額', en: 'Amount' })}</th><th>{t({ ja: '取込', en: 'Import' })}</th></tr></thead><tbody>{preview.rows.map((row) => <tr key={row.externalId}><td>{row.externalId}<small>{row.bookedOn}</small></td><td>{row.description}</td><td data-money>{row.direction === 'pay' ? '−' : '+'}<FinanceMoney value={row.amount}/></td><td>{t(row.duplicate ? { ja: '登録済み', en: 'Already imported' } : { ja: '新規', en: 'New' })}</td></tr>)}</tbody></table></div></> : null}
  </FinanceDialog>;
}
