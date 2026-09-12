import { useState } from 'react';
import { bankCandidatesOutput, type BankBoard, type BankCandidate } from '@daifuku/mod-banking/contract';
import { useFinanceCommand, useFinanceRead } from '../api/finance.ts';
import { useLocale } from '../i18n.tsx';
import { FinanceDialog, FinanceField, FinanceMoney, FinanceNotice, SourceLink } from './finance-shared.tsx';
import { WorkforceError } from './workforce-shared.tsx';

export function BankingMatch({ statementId, stale, onClose }: { statementId: string; stale: boolean; onClose: () => void }) {
  const { t } = useLocale(), query = useFinanceRead('banking.candidates', { statementId }, !stale, bankCandidatesOutput.parse), command = useFinanceCommand();
  const [selected, setSelected] = useState<BankCandidate>(), [requestId] = useState(() => crypto.randomUUID());
  const candidate = query.data?.candidates.find((row) => row.targetKind === selected?.targetKind && row.targetId === selected.targetId);
  const changed = !selected || !candidate || selected.targetVersion !== candidate.targetVersion || selected.balance !== candidate.balance;
  return <FinanceDialog title={t({ ja: '銀行明細と帳簿を照合', en: 'Match bank transaction to books' })} submitLabel={t({ ja: '根拠を確認して消込', en: 'Confirm and reconcile' })} stale={stale || Boolean(selected && changed)} submitDisabled={!selected || query.isFetching || query.isError} onClose={onClose} onSubmit={async (data) => {
    if (!selected || changed) return;
    await command.mutateAsync({ action: 'banking.reconcile', input: { requestId, statementId, targetKind: selected.targetKind, targetId: selected.targetId, targetVersion: selected.targetVersion, expectedBalance: selected.balance, reason: String(data.get('reason') ?? ''), ...(selected.targetKind === 'invoice' && data.get('paymentDate') ? { paymentDate: String(data.get('paymentDate')) } : {}) } });
  }}>
    {query.isError ? <WorkforceError error={query.error} onRetry={() => { void query.refetch(); }}/> : query.data ? <>
      <FinanceNotice>{query.data.statement.bookedOn} · {query.data.statement.description} · <FinanceMoney value={query.data.statement.amount}/></FinanceNotice>
      <p>{t({ ja: '候補の根拠を確認して選んでください。「既存入出金」は照合だけ、「請求書」は銀行明細の金額で入出金を作成します。', en: 'Review the evidence before selecting. Existing payments are linked only; invoices create a payment for the transaction amount.' })}</p>
      <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>{t({ ja: '選択・対象', en: 'Select / target' })}</th><th>{t({ ja: '取引先・根拠', en: 'Partner / evidence' })}</th><th>{t({ ja: '金額・残高', en: 'Amount / balance' })}</th></tr></thead><tbody>{query.data.candidates.map((row) => <tr key={`${row.targetKind}:${row.targetId}`} data-selected={row.targetId === selected?.targetId && row.targetKind === selected.targetKind}><td><label><input type="radio" name="candidate" checked={row.targetId === selected?.targetId && row.targetKind === selected.targetKind} onChange={() => setSelected(row)}/>{row.number ?? row.targetId}</label><small>{t(row.targetKind === 'payment' ? { ja: '既存入出金', en: 'Existing payment' } : { ja: '請求書', en: 'Invoice' })} · {row.date}</small></td><td>{row.partnerName}<ul className="finance-reasons">{row.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul><SourceLink entity={row.targetKind === 'payment' ? 'payment' : query.data.statement.direction === 'receive' ? 'sales_invoice' : 'purchase_invoice'} id={row.targetId}>{t({ ja: '原資料', en: 'Source' })}</SourceLink></td><td data-money><FinanceMoney value={row.amount}/><small>{t({ ja: '残高', en: 'Balance' })}: <FinanceMoney value={row.balance}/></small></td></tr>)}</tbody></table></div>
      {query.data.candidates.length === 0 ? <p>{t({ ja: '候補がありません。取引先・請求・入出金の登録内容を確認してください。', en: 'No candidates found. Check the partner, invoice and payment records.' })}</p> : null}
      {query.data.truncated ? <FinanceNotice>{t({ ja: '候補の一部を表示しています。目的の取引がない場合は元帳と明細を確認してください。', en: 'Only some candidates are shown. Check the ledger if your transaction is missing.' })}</FinanceNotice> : null}
      {selected?.targetKind === 'invoice' ? <><FinanceField label={{ ja: '記帳日（再照合時は訂正日以降）', en: 'Posting date (on or after reversal for rematching)' }} name="paymentDate" type="date" required defaultValue={query.data.statement.bookedOn}/><FinanceNotice>{t({ ja: '銀行明細の日付は保持します。取消後の再照合では、必要に応じて訂正日以降の記帳日を選んでください。', en: 'The bank transaction date is retained. For a rematch after reversal, choose an appropriate posting date on or after that reversal.' })}</FinanceNotice></> : null}
      <FinanceField label={{ ja: '照合の確認記録', en: 'Reconciliation evidence' }} name="reason" required maxLength={500}/>
    </> : <p role="status">{t({ ja: '候補を確認しています…', en: 'Loading candidates…' })}</p>}
  </FinanceDialog>;
}

export function BankingUndo({ row, stale, onClose }: { row: BankBoard['reconciliations'][number]; stale: boolean; onClose: () => void }) {
  const { t } = useLocale(), command = useFinanceCommand();
  return <FinanceDialog title={t({ ja: '銀行照合を解除', en: 'Reverse reconciliation' })} submitLabel={t({ ja: '理由を記録して解除', en: 'Record reason and reverse' })} onClose={onClose} stale={stale} onSubmit={async (data) => { await command.mutateAsync({ action: 'banking.undo_reconciliation', input: { reconciliationId: row.id, expectedVersion: row.version, correctionDate: String(data.get('correctionDate') ?? ''), reason: String(data.get('reason') ?? '') } }); }}>
    <FinanceNotice>{t(row.createdPayment ? { ja: 'この照合で作成した入出金も取消し、仕訳と請求残高を戻します。銀行での返金・組戻しは行いません。', en: 'The payment created by this reconciliation is cancelled and its accounting and invoice balance reversed. No bank refund is made.' } : { ja: '既存入出金との照合を解除します。元の入出金と仕訳は保持します。', en: 'Unlink the existing payment. Its payment and journal entry are retained.' })}</FinanceNotice>
    <FinanceField label={{ ja: '訂正日', en: 'Correction date' }} name="correctionDate" type="date" required/>
    <FinanceField label={{ ja: '解除理由', en: 'Reason for reversal' }} name="reason" required maxLength={500}/>
  </FinanceDialog>;
}
