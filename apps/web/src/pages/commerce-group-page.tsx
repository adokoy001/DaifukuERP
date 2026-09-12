import { useCommerceCopy } from '../components/commerce-copy.ts';
import { useState } from 'react';
import { commerceIdentity, useCommerceList, useCommerceRead, type AuthorizedCompany, type CompanySource, type GroupBoard } from '../api/commerce.ts';
import { CommerceEmpty, CommercePager, CommercePanel, CommerceShell, useCommerceAccess } from '../components/commerce-shared.tsx';
import { CommerceGroupEditor } from '../components/commerce-group-editor.tsx';
import { CommerceGroupConfirm, CommerceGroupResult } from '../components/commerce-group-result.tsx';
import { ReadRecoveryProvider } from '../components/read-refresh-notice.tsx';
import { businessToday } from '../lib/operations.ts';
export function CommerceGroupPage() { return <GroupWorkspace key={commerceIdentity()}/>; }
function GroupWorkspace() {
    const copy = useCommerceCopy();
    const today = businessToday(), priorEnd = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
    priorEnd.setUTCDate(0);
    const initialTo = priorEnd.toISOString().slice(0, 10), initialFrom = initialTo.slice(0, 7) + '-01';
    const { allowed, actions } = useCommerceAccess('group_accounting.companies');
    const [selected, setSelected] = useState<string[]>([]), [period, setPeriod] = useState<{
        from: string;
        to: string;
    }>(), [runId, setRunId] = useState(''), [offset, setOffset] = useState(0), [editor, setEditor] = useState<{
        sources: CompanySource[];
        from: string;
        to: string;
        initial?: GroupBoard;
    }>(), [confirm, setConfirm] = useState<{
        board: GroupBoard;
        mode: 'confirm' | 'cancel';
    }>();
    const companies = useCommerceRead<AuthorizedCompany[]>('group_accounting.companies', {}, allowed), history = useCommerceList('group_accounting_run', allowed, offset), source = useCommerceRead<{
        sources: CompanySource[];
    }>('group_accounting.sources', { companyIds: selected, from: period?.from ?? '', to: period?.to ?? '' }, allowed && Boolean(period)), board = useCommerceRead<GroupBoard>('group_accounting.board', { runId }, allowed && Boolean(runId));
    const readers = [companies, history, source, board], busy = readers.some((q) => q.isFetching);
    return <CommerceShell title={copy("グループ連結精算表")} subtitle={copy("会社別の試算表を集め、科目の対応付けと消去・調整を確認します。各会社への現在の権限を毎回確認します。")} action="group_accounting.companies" sources={readers}><ReadRecoveryProvider sources={readers}>
 <CommercePanel title={copy("1. 対象会社と会計期間")} note={copy("JPY・同じ会計期間の会社を選択。単体試算表を確認してから下書きへ進みます。")}><div className="commerce-company-options">{companies.data?.map((c) => <label key={c.id}><input type="checkbox" checked={selected.includes(c.id)} onChange={(e) => { setPeriod(undefined); setSelected((ids) => e.target.checked ? [...ids, c.id] : ids.filter((id) => id !== c.id)); }}/>{c.code} · {c.name}</label>)}</div>{companies.data?.length === 0 ? <CommerceEmpty>{copy("現在の権限で利用できるJPY会社がありません。")}</CommerceEmpty> : null}<form className="commerce-toolbar" onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); const next = { from: String(data.get('from')), to: String(data.get('to')) }; if (period?.from === next.from && period.to === next.to)
        void source.refetch();
    else
        setPeriod(next); }}><label>{copy("開始日")}<input className="input" name="from" type="date" required defaultValue={initialFrom}/></label><label>{copy("終了日")}<input className="input" name="to" type="date" required defaultValue={initialTo}/></label><button className="btn btn-primary" disabled={!selected.length || busy}>{copy("単体資料を取得")}</button></form>{source.data && period ? <div className="commerce-detail"><p>{source.data.sources.length}{copy("社・")}{source.data.sources.reduce((n, s) => n + s.rows.length, 0)}{copy("科目を取得。")}{source.data.sources.every((s) => s.closed) ? copy("対象以前の全期間が締め済みです。") : copy("未締め期間があります。下書きは作成できます。")}</p>{actions.includes('group_accounting.prepare') ? <button className="btn btn-primary" disabled={busy || source.isError} onClick={() => setEditor({ sources: source.data.sources, ...period })}>{copy("2. 科目対応・消去を入力")}</button> : null}</div> : null}</CommercePanel>
 {board.data ? <><CommerceGroupResult board={board.data}/><div className="commerce-action-row">{board.data.status === 'draft' && actions.includes('group_accounting.prepare') ? <button className="btn" disabled={busy || board.isError} onClick={() => { if (board.data)
        setEditor({ sources: board.data.sources, from: board.data.from, to: board.data.to, initial: board.data }); }}>{copy("下書きを編集・資料更新")}</button> : null}{board.data.status === 'draft' && actions.includes('group_accounting.confirm') ? <button className="btn btn-primary" disabled={busy || board.isError} onClick={() => { if (board.data)
        setConfirm({ board: board.data, mode: 'confirm' }); }}>{copy("確定内容を確認")}</button> : null}{board.data.status !== 'cancelled' && actions.includes('group_accounting.cancel') ? <button className="btn" disabled={busy || board.isError} onClick={() => { if (board.data)
        setConfirm({ board: board.data, mode: 'cancel' }); }}>{copy("取消")}</button> : null}<button className="btn" disabled={busy} onClick={() => { void board.refetch(); }}>{copy("最新の状態を確認")}</button></div></> : runId && board.isFetching ? <p role="status">{copy("保存資料の閲覧権限を確認しています…")}</p> : null}
 <CommercePanel title={copy("保存した精算表")} note={copy("対象会社の閲覧権限が失効した資料は開けません。")}><div className="commerce-list">{history.data?.items.map((row) => <div className="commerce-list-item" key={row.id}><div><strong>{String(row.name)}</strong><small>{String(row.from)} ～ {String(row.to)} · {String(row.status)}</small></div><button className="btn" onClick={() => setRunId(row.id)}>{copy("精算表を開く")}</button></div>)}</div>{history.data?.total === 0 ? <CommerceEmpty>{copy("保存した精算表はまだありません。")}</CommerceEmpty> : null}<CommercePager offset={offset} total={history.data?.total ?? 0} onPage={setOffset}/></CommercePanel>
 {editor && (editor.initial ? board.data : source.data) ? <CommerceGroupEditor {...editor} stale={Boolean(editor.initial && board.data?.id === editor.initial.id && board.data.version !== editor.initial.version)} onClose={() => setEditor(undefined)} onSaved={setRunId}/> : null}{confirm && board.data ? <CommerceGroupConfirm {...confirm} stale={board.data?.version !== confirm.board.version} onClose={() => setConfirm(undefined)}/> : null}
 </ReadRecoveryProvider></CommerceShell>;
}
