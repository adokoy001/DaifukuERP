import { useCommerceCopy } from './commerce-copy.ts';
import { useId, useState } from 'react';
import { useCommerceTask, type FranchiseBoard } from '../api/commerce.ts';
import { useMeta } from '../api/queries.ts';
import type { RecordJson } from '../api/types.ts';
import { businessToday } from '../lib/operations.ts';
import { RefField } from './fields/ref-field.tsx';
import { CommerceDialog, CommerceMoney } from './commerce-shared.tsx';
export function CommerceFranchiseGenerate({ agreement, stale, onClose, onSaved }: {
    agreement: RecordJson;
    stale: boolean;
    onClose: () => void;
    onSaved: (id: string) => void;
}) {
    const copy = useCommerceCopy();
    const task = useCommerceTask();
    return <CommerceDialog title={copy("FC月次精算を作成・請求確定")} submitLabel={copy("根拠を確認して請求を生成")} stale={stale} onClose={onClose} onSubmit={async (data) => { const saved = await task.mutateAsync({ action: 'franchise.generate', input: { agreementId: agreement.id, expectedAgreementVersion: agreement.version, month: String(data.get('month')), grossSales: String(data.get('grossSales')), netSales: String(data.get('netSales')), sourceReference: String(data.get('sourceReference') ?? '').trim(), date: String(data.get('date')), dueDate: String(data.get('dueDate')) } }); onSaved(saved.id); }}>
 <p className="commerce-notice">{String(agreement.name)} · {agreement.direction === 'bill' ? copy("加盟店へ請求") : copy("本部への支払請求")} · {agreement.basis === 'gross' ? copy("税込売上") : copy("税抜売上")}{copy("× 率")}{String(agreement.rate)}{copy("＋ 定額")}<CommerceMoney value={String(agreement.fixedAmount)}/>{copy("。既存の請求書により消費税を計算します。")}</p><div className="commerce-form"><label>{copy("精算月")}<input className="input" type="month" name="month" required/></label><label>{copy("請求日")}<input className="input" type="date" name="date" required max={businessToday()} defaultValue={businessToday()}/></label><label>{copy("税込売上（円）")}<input className="input" name="grossSales" inputMode="numeric" required pattern="[0-9]+"/></label><label>{copy("税抜売上（円）")}<input className="input" name="netSales" inputMode="numeric" required pattern="[0-9]+"/></label><label>{copy("支払期日")}<input className="input" name="dueDate" type="date" required/></label><label className="wide">{copy("確定売上資料・確認記録")}<textarea className="input" name="sourceReference" required maxLength={1000} rows={3} placeholder={copy("承認済み月次売上表の番号、照合日、確認担当など")}/></label></div><p className="commerce-notice">{copy("会社間の二重転記ではなく、この会社の請求・支払請求を作成します。対象月全体が契約期間内である必要があります。売上資料を自動検証・POSから税抜推定する機能は含みません。")}</p>
 </CommerceDialog>;
}
export function CommerceFranchisePayment({ board, stale, mode, onClose }: {
    board: FranchiseBoard;
    stale: boolean;
    mode: 'settle' | 'cancel';
    onClose: () => void;
}) {
    const copy = useCommerceCopy();
    const task = useCommerceTask(), meta = useMeta(), id = useId(), [accountId, setAccountId] = useState('');
    const field = meta.data?.entities.find((e) => e.name === 'payment')?.fields.find((f) => f.name === 'accountId');
    return <CommerceDialog title={mode === 'settle' ? copy("FC未決済残高の入出金") : copy("FC精算・入出金・請求を取消")} submitLabel={mode === 'settle' ? copy("入出金を確定") : copy("理由を記録して一括取消")} stale={stale} onClose={onClose} onSubmit={async (data) => { if (mode === 'settle' && !accountId)
        throw new Error(copy("入出金科目を候補から選択してください。")); await task.mutateAsync({ action: 'franchise.' + mode, input: { settlementId: board.id, expectedVersion: board.version, date: String(data.get('date')), ...(mode === 'settle' ? { accountId, expectedBalance: board.balance, method: String(data.get('method')) } : { reason: String(data.get('reason') ?? '').trim() }) } }); }}>
 <p className="commerce-notice">{board.contract.name} · {board.month}{copy("· 現在残高")}<CommerceMoney value={board.balance}/>。{mode === 'settle' ? copy("現在の未決済残高全額を消し込みます。入出金科目・日付を確認してください。") : copy("連動した入出金を戻してから請求を取り消します。外部で消し込んだ入出金が残る場合は原資料を整理するまで取消できません。")}</p>
 <label>{mode === 'settle' ? copy("入出金日") : copy("取消有効日")}<input className="input" name="date" type="date" required min={board.date} max={businessToday()} defaultValue={businessToday()}/></label>
 {mode === 'settle' ? <><label>{copy("方法")}<select className="input" name="method"><option value="bank_transfer">{copy("振込")}</option><option value="cash">{copy("現金")}</option><option value="other">{copy("その他")}</option></select></label>{field ? <label htmlFor={id}>{copy("入出金科目")}<RefField id={id} field={field} value={accountId} onChange={(value) => setAccountId(typeof value === 'string' ? value : '')} ariaLabel={copy("入出金科目")} disabled={false} invalid={false}/></label> : <p role="alert">{copy("入出金科目の選択権限がありません。")}</p>}</> : <label>{copy("取消理由")}<textarea className="input" name="reason" required maxLength={1000} rows={3}/></label>}
 </CommerceDialog>;
}
