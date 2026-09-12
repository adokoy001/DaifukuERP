import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { edgeIdentity, useEdgeCommand } from '../api/edge.ts';
import { request } from '../api/client.ts';
import type { ListResponse } from '../api/types.ts';
import type { EdgeRow } from '../api/edge.ts';
import { useLocale } from '../i18n.tsx';
import { EdgeForm } from './edge-form.tsx';
import { ControlDialog } from './control-dialog.tsx';
import { canRetainData } from '../lib/read-recovery.ts';
import { ReadRefreshNotice } from './read-refresh-notice.tsx';
import { WorkforceError } from './workforce-shared.tsx';
export function EdgeGatewayForm({ onClose }: { onClose: () => void }) {
  const { t } = useLocale(), task = useEdgeCommand();
  const sites = useQuery({ queryKey: ['edge-sites', edgeIdentity()], queryFn: ({ signal }) => request<ListResponse>('/api/workforce_site?limit=500', { signal, cache: 'no-store' }), retry: false, gcTime: 0, staleTime: 0, refetchInterval: 15_000, refetchOnWindowFocus: 'always', networkMode: 'always' });
  if (sites.isError && !canRetainData(sites)) return <ControlDialog title={t({ ja: '店舗の中継を登録', en: 'Register a store relay' })} onClose={onClose}><WorkforceError error={sites.error} onRetry={() => void sites.refetch()}/></ControlDialog>;
  return <EdgeForm title={t({ ja: '店舗の中継を登録', en: 'Register a store relay' })} submitLabel={t({ ja: '中継を登録', en: 'Register relay' })} onClose={onClose} onSubmit={async (data) => { await task.mutateAsync({ action: 'edge.create_gateway', input: { siteId: String(data.get('siteId')), code: String(data.get('code')).trim(), name: String(data.get('name')).trim() } }); }}>
    <ReadRefreshNotice sources={[sites]}/>
    <label>{t({ ja: '設置する拠点', en: 'Installation site' })}<select className="input" name="siteId" required defaultValue="" disabled={!sites.data}><option value="">{t({ ja: '拠点を選択', en: 'Select a site' })}</option>{sites.data?.items.filter((site) => site.active !== false).map((site) => <option key={site.id} value={site.id}>{String(site.code)} · {String(site.name)}</option>)}</select></label>
    {sites.data?.total === 0 ? <p className="edge-callout">{t({ ja: '先に従業員・勤怠管理で拠点を作成してください。店舗限定の権限では、管理者に拠点単位の所属設定を依頼してください。', en: 'Create a workforce site first. For a store-only membership, ask an administrator to assign site-scoped access.' })}</p> : null}
    <label>{t({ ja: '中継コード', en: 'Relay code' })}<input className="input" name="code" required maxLength={40} pattern="[A-Za-z0-9_-]+" placeholder="store-01"/></label>
    <label>{t({ ja: '中継の名前', en: 'Relay name' })}<input className="input" name="name" required maxLength={100} placeholder={t({ ja: '渋谷店 カウンター', en: 'Store counter' })}/></label>
    <p className="edge-callout">{t({ ja: '登録後に接続コードを発行し、店舗のLinux中継エージェントへ設定します。設置する拠点は登録後に変更できません。', en: 'After registration, issue a pairing code for the Linux relay agent. The installation site is fixed after registration.' })}</p>
  </EdgeForm>;
}
export function EdgeDeviceForm({ gateway, onClose }: { gateway: EdgeRow; onClose: () => void }) {
  const { t } = useLocale(), task = useEdgeCommand(), [driver, setDriver] = useState('ipp_text');
  return <EdgeForm title={t({ ja: '機器を登録', en: 'Register a device' })} submitLabel={t({ ja: '機器を登録', en: 'Register device' })} onClose={onClose} onSubmit={async (data) => { await task.mutateAsync({ action: 'edge.register_device', input: { gatewayId: gateway.id, localDeviceId: String(data.get('localDeviceId')).trim(), name: String(data.get('name')).trim(), driver } }); }}>
    <p className="edge-callout">{String(gateway.name)}</p>
    <label>{t({ ja: '機器名', en: 'Device name' })}<input className="input" name="name" required maxLength={100}/></label>
    <label>{t({ ja: '店舗内の機器ID', en: 'Local device ID' })}<input className="input" name="localDeviceId" required pattern="[A-Za-z0-9_-]+" maxLength={80} placeholder="counter-printer"/></label>
    <label>{t({ ja: '接続方式', en: 'Device driver' })}<select className="input" value={driver} onChange={(event) => setDriver(event.target.value)}><option value="ipp_text">{t({ ja: 'IPPテキストプリンター', en: 'IPP text printer' })}</option><option value="simulator">{t({ ja: 'シミュレーター（印刷・釣銭・状態）', en: 'Simulator (print, cash and status)' })}</option></select></label>
    <p className="edge-callout">{t({ ja: '機器IDと接続方式を店舗側の設定と一致させてください。プリンターのLANアドレスは店舗側だけで設定します。実釣銭機の接続には機種別の追加対応が必要です。', en: 'Match the device ID and driver to the local agent configuration. Configure printer LAN addresses only at the store. Real cash devices need a model-specific adapter.' })}</p>
  </EdgeForm>;
}
export function EdgeActiveForm({ row, type, onClose }: { row: EdgeRow; type: 'gateway' | 'device'; onClose: () => void }) {
  const { t } = useLocale(), task = useEdgeCommand(), active = !row.active;
  return <EdgeForm title={t(active ? { ja: '受付を再開', en: 'Resume requests' } : { ja: '受付を停止', en: 'Pause requests' })} submitLabel={t({ ja: '理由を記録して変更', en: 'Apply with reason' })} onClose={onClose} onSubmit={async (data) => { await task.mutateAsync({ action: `edge.set_${type}_active`, input: { [type === 'gateway' ? 'gatewayId' : 'deviceId']: row.id, expectedVersion: row.version, active, reason: String(data.get('reason')).trim() } }); }}>
    <p><strong>{String(row.name)}</strong></p><p className="edge-callout">{t({ ja: '開始済みの物理動作は、この操作で停止・巻き戻しできません。不明な処理は実機を確認し、要確認一覧から解決します。', en: 'This cannot stop or undo a physical operation that already started. Inspect the device and resolve uncertain work in the review queue.' })}</p><label>{t({ ja: '変更理由', en: 'Reason' })}<textarea className="input" name="reason" rows={3} required maxLength={1000}/></label>
  </EdgeForm>;
}
