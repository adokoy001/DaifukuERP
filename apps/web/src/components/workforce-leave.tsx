import { useState } from 'react';
import { formText, type LeaveSummary } from '../api/workforce.ts';
import { useWorkforceTask } from '../api/workforce-query.ts';
import { useLocale } from '../i18n.tsx';
import { formatDecimal } from '../lib/format.ts';
import { leavePortions } from '../lib/workforce.ts';
import { WorkforceDialog } from './workforce-dialog.tsx';
import { WorkforceEmpty, WorkforcePanel, WorkforceStatus } from './workforce-shared.tsx';

function LeaveForm({ today, onSaved, onClose }: { today: string; onSaved: (date: string) => void; onClose: () => void }) {
  const { t } = useLocale(), task = useWorkforceTask();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  return <WorkforceDialog title={t({ ja: '有給休暇を申請', en: 'Request paid leave' })} description={t({ ja: '取得日と区分を選び、理由を入力します。半日休暇は会社の運用と合意を確認して申請してください。', en: 'Choose the date and portion, then enter a reason. Check your company’s agreement before requesting half-day leave.' })} submitLabel={t({ ja: '有給を申請', en: 'Request paid leave' })} onClose={onClose} onSubmit={async (data) => {
    await task.mutateAsync({ action: 'workforce.request_leave', input: { idempotencyKey, leaveDate: formText(data, 'leaveDate'), portion: formText(data, 'portion'), reason: formText(data, 'reason') } });
    onSaved(formText(data, 'leaveDate'));
  }}><div className="workforce-form-row"><label>{t({ ja: '取得する日', en: 'Leave date' })}<input className="input" name="leaveDate" type="date" defaultValue={today} required /></label><label>{t({ ja: '取得する区分', en: 'Leave portion' })}<select className="input" name="portion" aria-label={t({ ja: '取得する区分', en: 'Leave portion' })} defaultValue="full">{Object.entries(leavePortions).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label></div><label>{t({ ja: '申請する理由', en: 'Reason for request' })}<textarea className="input" name="reason" maxLength={1000} required rows={3} /></label></WorkforceDialog>;
}

export function WorkforceLeave({ balance, requests, today, actions, registered, onPeriod }: { balance: string; requests: LeaveSummary[]; today: string; actions: string[]; registered: boolean; onPeriod: (period: string) => void }) {
  const { t } = useLocale(), task = useWorkforceTask();
  const [creating, setCreating] = useState(false), [cancel, setCancel] = useState<LeaveSummary>();
  return <WorkforcePanel title={t({ ja: '有給休暇', en: 'Paid leave' })} note={t({ ja: '残数と申請の状況を確認できます。', en: 'Review your balance and request status.' })} icon="leaf" actions={registered && actions.includes('workforce.request_leave') ? <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>{t({ ja: '有給を申請', en: 'Request leave' })}</button> : null}>
    <div className="workforce-pay-total"><span>{t({ ja: '有効な有給残数', en: 'Available paid leave' })}</span><strong className="workforce-money">{formatDecimal(balance)} <small>{t({ ja: '日', en: 'days' })}</small></strong></div>
    {requests.length ? <div className="workforce-record-list">{requests.map((row) => <article className="workforce-record" key={row.id}><header><h3>{row.leaveDate} · {t(leavePortions[row.portion] ?? { ja: '有給', en: 'Paid leave' })}</h3><WorkforceStatus status={row.status} /></header><p>{row.reason}</p>{row.reviewReason ? <p>{t({ ja: '確認者から', en: 'Reviewer' })}: {row.reviewReason}</p> : null}{['pending', 'approved'].includes(row.status) && actions.includes('workforce.cancel_leave') ? <div className="workforce-record-actions"><button type="button" className="btn" onClick={() => setCancel(row)}>{t({ ja: '申請を取り消す', en: 'Cancel request' })}</button></div> : null}</article>)}</div> : <WorkforceEmpty icon="leaf">{t({ ja: 'この月の有給申請はありません。', en: 'No paid leave requests this month.' })}</WorkforceEmpty>}
    <p className="workforce-footer-note">{t({ ja: '取得日の付与期限・残数・他の申請との重複は、承認時にも確認されます。', en: 'Expiry, available balance and overlapping requests are checked again when approved.' })}</p>
    {creating ? <LeaveForm today={today} onSaved={(date) => onPeriod(date.slice(0, 7))} onClose={() => setCreating(false)} /> : null}
    {cancel ? <WorkforceDialog title={t({ ja: '有給申請を取り消す', en: 'Cancel paid leave request' })} description={cancel.leaveDate + ' · ' + cancel.reason} submitLabel={t({ ja: '取消を確定', en: 'Confirm cancellation' })} onClose={() => setCancel(undefined)} stale={requests.find((r) => r.id === cancel.id)?.version !== cancel.version} onSubmit={async (data) => { await task.mutateAsync({ action: 'workforce.cancel_leave', input: { requestId: cancel.id, expectedVersion: cancel.version, reason: formText(data, 'reason') } }); }}><label>{t({ ja: '取り消す理由', en: 'Cancellation reason' })}<textarea className="input" name="reason" required maxLength={1000} rows={3} /></label></WorkforceDialog> : null}
  </WorkforcePanel>;
}
