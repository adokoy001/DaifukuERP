import { Link } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useOperationsTask } from '../api/operations.ts';
import type { ActionMeta, TableResult } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { reviewLabels } from '../lib/operations.ts';
import { ControlDialog } from './control-dialog.tsx';
import { useToast } from './toast.tsx';
interface SelectedTask { row: Record<string, unknown>; action: string; decision?: string; title: string }
export function OperationsBoard({ result, actions }: { result: TableResult; actions: ActionMeta[] }) {
  const { t } = useLocale();
  const toast = useToast();
  const task = useOperationsTask();
  const [selected, setSelected] = useState<SelectedTask>(), [note, setNote] = useState(''), [onlyPending, setOnlyPending] = useState(false), [showUnplanned, setShowUnplanned] = useState(false), [page, setPage] = useState(0);
  const allowed = (name: string) => actions.some((a) => a.name === 'restaurant_chain.' + name);
  const rows = result.rows.filter((row) => (!onlyPending || row.docstatus !== 1) && (showUnplanned || row.status !== 'unplanned')).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.store).localeCompare(String(b.store)));
  const lastPage = Math.max(0, Math.ceil(rows.length / 50) - 1), visiblePage = Math.min(page, lastPage);
  const visibleRows = rows.slice(visiblePage * 50, (visiblePage + 1) * 50);
  const choose = (row: Record<string, unknown>, action: string, title: string, decision?: string) => { setNote(''); setSelected({ row, action, title, ...(decision ? { decision } : {}) }); };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || task.isPending) return;
    task.mutate({ action: selected.action, input: { closingId: selected.row.closingId, expectedVersion: selected.row.version, ...(selected.decision ? { decision: selected.decision, note } : {}) } }, { onSuccess: () => { setSelected(undefined); toast.success(t({ ja: '日次報告を更新しました', en: 'Daily report updated' })); }, onError: (e) => toast.error(e) });
  };
  return <section className="control-panel"><div className="panel-heading"><div><h2>{t({ ja: '店舗の日次報告', en: 'Daily store reports' })}</h2><p>{t({ ja: '営業計画と報告の突き合わせ。確認状況は現在の状態です。', en: 'Match plans to reports. Review status reflects the current workflow.' })}</p></div><div className="button-row"><label className="access-check"><input type="checkbox" checked={showUnplanned} onChange={(e) => { setShowUnplanned(e.target.checked); setPage(0); }} />{t({ ja: '計画のない日も表示', en: 'Include unplanned days' })}</label><label className="access-check"><input type="checkbox" checked={onlyPending} onChange={(e) => { setOnlyPending(e.target.checked); setPage(0); }} />{t({ ja: '未確定だけ', en: 'Unposted only' })}</label></div></div>
    <div className="operations-board-scroll"><table className="operations-board" data-testid="operations-board"><thead><tr><th>{t({ ja: '営業日', en: 'Business day' })}</th><th>{t({ ja: '店舗', en: 'Store' })}</th><th>{t({ ja: '状態', en: 'Status' })}</th><th>{t({ ja: '確認・確定', en: 'Review and post' })}</th></tr></thead><tbody>{visibleRows.map((row, index) => {
      const status = String(row.status ?? row.reviewStatus ?? 'missing');
      const review = String(row.reviewStatus ?? '');
      const draft = row.docstatus === 0 && typeof row.closingId === 'string';
      return <tr key={String(row.date) + '/' + String(row.storeId) + '/' + index}><td>{String(row.date)}</td><td><strong>{String(row.store)}</strong>{row.closingId ? <Link to="/e/$entity/$id" params={{ entity: 'restaurant_chain_closing', id: String(row.closingId) }}>{t({ ja: '報告を開く', en: 'Open report' })}</Link> : <span className="muted">{t({ ja: '報告なし', en: 'No report' })}</span>}</td><td><span className={'status-pill ' + (row.docstatus === 1 ? 'is-good' : 'is-attention')}>{reviewLabels[status] ? t(reviewLabels[status]) : status}</span>{row.reviewNote ? <small className="review-note">{String(row.reviewNote)}</small> : null}</td><td><div className="button-row">
        {draft && ['draft', 'returned'].includes(review) && allowed('submit_for_review') ? <button className="btn" disabled={task.isPending} onClick={() => choose(row, 'submit_for_review', t({ ja: '店長へ提出', en: 'Submit for review' }))}>{t({ ja: '提出', en: 'Submit' })}</button> : null}
        {draft && review === 'submitted' && allowed('review') ? <button className="btn" disabled={task.isPending} onClick={() => choose(row, 'review', t({ ja: '報告を承認', en: 'Approve report' }), 'approve')}>{t({ ja: '承認', en: 'Approve' })}</button> : null}
        {draft && ['submitted', 'approved'].includes(review) && allowed('review') ? <button className="btn" disabled={task.isPending} onClick={() => choose(row, 'review', t({ ja: '報告を差戻し', en: 'Return report' }), 'return')}>{t({ ja: '差戻し', en: 'Return' })}</button> : null}
        {draft && review === 'approved' && allowed('finalize') ? <button className="btn btn-primary" disabled={task.isPending} onClick={() => choose(row, 'finalize', t({ ja: '本部で確定', en: 'Post from headquarters' }))}>{t({ ja: '本部確定', en: 'Post' })}</button> : null}
      </div></td></tr>;
    })}</tbody></table>{rows.length === 0 ? <p className="report-ready">{t({ ja: '該当する日次報告はありません。', en: 'No matching daily reports.' })}</p> : null}</div>
    <div className="operations-pagination"><span>{rows.length} {t({ ja: '件', en: 'rows' })} · {visiblePage + 1} / {lastPage + 1}</span>{lastPage > 0 ? <div className="button-row"><button className="btn" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>{t({ ja: '前へ', en: 'Previous' })}</button><button className="btn" disabled={visiblePage >= lastPage} onClick={() => setPage(visiblePage + 1)}>{t({ ja: '次へ', en: 'Next' })}</button></div> : null}</div>
    {selected ? <ControlDialog title={selected.title} onClose={() => setSelected(undefined)} busy={task.isPending}><form onSubmit={submit}><p>{String(selected.row.store) + ' · ' + String(selected.row.date)}</p>{selected.action === 'finalize' ? <p className="notice-strip">{t({ ja: '報告を確定し、必要な売上・入金・在庫処理を行います。', en: 'Finalize this report and post the required sales, payment and inventory entries.' })}</p> : null}{selected.decision ? <label>{t(selected.decision === 'return' ? { ja: '差戻し理由', en: 'Return reason' } : { ja: '確認メモ（任意）', en: 'Review note (optional)' })}<textarea className="input" required={selected.decision === 'return'} rows={3} value={note} onChange={(e) => setNote(e.target.value)} disabled={task.isPending} /></label> : null}<div className="dialog-actions"><button className="btn" type="button" disabled={task.isPending} onClick={() => setSelected(undefined)}>{t({ ja: '戻る', en: 'Back' })}</button><button className="btn btn-primary" disabled={task.isPending}>{selected.title}</button></div></form></ControlDialog> : null}
  </section>;
}
