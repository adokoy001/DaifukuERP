import type { EdgeRow } from '../api/edge.ts';
import { useLocale } from '../i18n.tsx';
import { useEdgeCommand } from '../api/edge.ts';
import { EdgeForm } from './edge-form.tsx';
import { EdgeBadge, EdgeKind, EdgePanel, EdgeTime } from './edge-shared.tsx';
export function EdgeJobs({ jobs, devices, canCancel, canResolve, onReview, busy }: { jobs: EdgeRow[]; devices: EdgeRow[]; canCancel: boolean; canResolve: boolean; onReview: (row: EdgeRow) => void; busy: boolean }) {
  const { t } = useLocale();
  const deviceName = (id: unknown) => String(devices.find((device) => device.id === id)?.name ?? id ?? '—');
  return <EdgePanel title={t({ ja: '処理の履歴と確認', en: 'Work queue and review' })} note={t({ ja: '開始後に応答を失った処理は自動再実行しません。実機を確認してから結果を記録してください。', en: 'Work with an unknown outcome after starting is not automatically repeated. Check the device before recording a resolution.' })}>
    <div className="edge-table-wrap"><table className="edge-table"><thead><tr><th>{t({ ja: '依頼日時 / 機器', en: 'Requested / device' })}</th><th>{t({ ja: '処理', en: 'Operation' })}</th><th>{t({ ja: '状態', en: 'State' })}</th><th>{t({ ja: '開始期限', en: 'Deadline' })}</th><th>{t({ ja: '結果 / 根拠', en: 'Result / evidence' })}</th><th>{t({ ja: '操作', en: 'Action' })}</th></tr></thead><tbody>{jobs.map((job) => {
      const result = typeof job.result === 'object' && job.result !== null ? job.result as Record<string, unknown> : {};
      return <tr key={job.id} data-state={String(job.state)}><td><EdgeTime value={job.createdAt}/><strong>{deviceName(job.deviceId)}</strong><small className="edge-id">{job.id}</small></td><td><EdgeKind kind={String(job.kind)}/></td><td><EdgeBadge state={String(job.state)}/></td><td><EdgeTime value={job.expiresAt}/></td><td className="edge-wrap">{String(result.summary ?? result.code ?? job.reason ?? '—')}{result.deviceJobId ? <small>IPP job: {String(result.deviceJobId)}</small> : null}{job.evidence ? <small>{String(job.evidence)}</small> : null}</td><td>{job.state === 'queued' && canCancel || job.state === 'uncertain' && canResolve ? <button className="btn" disabled={busy} onClick={() => onReview(job)}>{t(job.state === 'queued' ? { ja: '取消', en: 'Cancel' } : { ja: '実機確認・解決', en: 'Review and resolve' })}</button> : '—'}</td></tr>;
    })}</tbody></table></div>{!jobs.length ? <p className="edge-empty">{t({ ja: 'まだ処理の依頼はありません。機器を登録すると、印刷や状態取得を依頼できます。', en: 'No work has been requested yet. Register a device to request printing or a status check.' })}</p> : null}
  </EdgePanel>;
}
export function EdgeReviewForm({ job, onClose }: { job: EdgeRow; onClose: () => void }) {
  const { t } = useLocale(), task = useEdgeCommand(), resolve = job.state === 'uncertain';
  return <EdgeForm title={t(resolve ? { ja: '実機の確認結果を記録', en: 'Record device review' } : { ja: '待機中の依頼を取消', en: 'Cancel queued work' })} submitLabel={t(resolve ? { ja: '確認結果で解決', en: 'Resolve with evidence' } : { ja: '理由を記録して取消', en: 'Cancel with reason' })} onClose={onClose} onSubmit={async (data) => {
    await task.mutateAsync({ action: resolve ? 'edge.resolve' : 'edge.cancel', input: { jobId: job.id, expectedVersion: job.version, reason: String(data.get('reason')).trim(), ...(resolve ? { resolution: String(data.get('resolution')), evidence: String(data.get('evidence')).trim() } : {}) } });
  }}>
    <p className="edge-callout"><EdgeKind kind={String(job.kind)}/> · <span className="edge-id">{job.id}</span></p>
    {resolve ? <><p className="edge-callout">{t({ ja: '実機と出力物・現金の状態を確認してください。この操作は記録を確定するもので、機器を動かしたり再実行したりしません。', en: 'Inspect the device, output and cash state. This records a resolution; it does not operate or repeat the device command.' })}</p><label>{t({ ja: '確認した結果', en: 'Observed result' })}<select className="input" name="resolution" required defaultValue=""><option value="">{t({ ja: '結果を選択', en: 'Choose a result' })}</option><option value="succeeded">{t({ ja: '完了を確認した', en: 'Completion verified' })}</option><option value="failed">{t({ ja: '完了していないことを確認した', en: 'Non-completion verified' })}</option></select></label><label>{t({ ja: '確認の根拠', en: 'Evidence' })}<textarea className="input" name="evidence" rows={4} required maxLength={2000}/></label><label className="edge-check"><input type="checkbox" required/>{t({ ja: '実機を確認し、後続処理を再開してよいことを確認しました。', en: 'I inspected the device and confirmed it is safe to resume subsequent work.' })}</label></> : null}
    <label>{t({ ja: '理由', en: 'Reason' })}<textarea className="input" name="reason" rows={3} required maxLength={1000}/></label>
  </EdgeForm>;
}
