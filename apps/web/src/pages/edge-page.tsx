import '../edge.css';
import '../workforce.css';
import { useEffect, useState } from 'react';
import { edgeIdentity, useEdgeBoard, useEdgeAccess } from '../api/edge.ts';
import { EdgeActiveForm, EdgeDeviceForm, EdgeGatewayForm } from '../components/edge-config-forms.tsx';
import { EdgeDevices, EdgeFleet, type EdgeSelection } from '../components/edge-fleet.tsx';
import { EdgeJobForm } from '../components/edge-job-form.tsx';
import { EdgeJobs, EdgeReviewForm } from '../components/edge-jobs.tsx';
import { EdgePairing } from '../components/edge-pairing.tsx';
import { EdgeHero } from '../components/edge-shared.tsx';
import { ReadRecoveryProvider, ReadRefreshNotice } from '../components/read-refresh-notice.tsx';
import { WorkforceError } from '../components/workforce-shared.tsx';
import { useLocale } from '../i18n.tsx';
import { edgeRecentResponse } from '../lib/edge.ts';
import { canRetainData } from '../lib/read-recovery.ts';
export function EdgePage() { return <EdgeWorkspace key={edgeIdentity()}/>; }
function EdgeWorkspace() {
  const { t } = useLocale(), meta = useEdgeAccess(), actions = meta.data?.actions.map((action) => action.name) ?? [];
  const allowed = actions.includes('edge.board'), manage = actions.includes('edge.create_gateway');
  const [gatewayId, setGatewayId] = useState<string>(), [create, setCreate] = useState(false), [selection, setSelection] = useState<EdgeSelection>();
  const board = useEdgeBoard(allowed, gatewayId), sources = [meta, board], data = board.data, failed = sources.find((source) => source.isError && !canRetainData(source));
  const busy = sources.some((source) => source.isFetching || source.isError), gateway = data?.gateways.find((row) => row.id === gatewayId);
  const selectionAllowed = !selection || Boolean(data && selectionPermitted(selection, actions) && (selection.type === 'pair' || selection.type === 'revoke' || selection.type === 'gateway-active' || selection.type === 'device-new' ? data.gateways : selection.type === 'review' ? data.jobs : data.devices).some((row) => row.id === selection.row.id));
  useEffect(() => { if (!manage || failed) setCreate(false); if (failed || !selectionAllowed) setSelection(undefined); }, [manage, failed, selectionAllowed]);
  const close = () => setSelection(undefined), refresh = () => { for (const source of sources) void source.refetch(); };
  return <div className="workspace-page edge-page"><EdgeHero/>{failed ? <WorkforceError error={failed.error} onRetry={refresh}/> : !meta.data ? <p role="status">{t({ ja: '利用権限を確認しています…', en: 'Checking access…' })}</p> : !allowed ? <p className="edge-callout">{t({ ja: 'この会社で機器連携を利用する権限がありません。', en: 'You do not have device integration access in this company.' })}</p> : <ReadRecoveryProvider sources={sources}>
    <ReadRefreshNotice/>
    <div className="edge-toolbar"><div><h2>{t({ ja: '現場のつながりを、一目で。', en: 'Your stores, at a glance.' })}</h2><p>{t({ ja: '店舗からの通信だけで接続。15秒ごとに最新の状況を確認します。', en: 'Connections originate at the store. This view refreshes every 15 seconds.' })}</p></div><div className="edge-buttons"><button className="btn" disabled={sources.some((source) => source.isFetching)} onClick={refresh}>{t({ ja: '最新の状況を取得', en: 'Refresh status' })}</button>{manage ? <button className="btn btn-primary" disabled={busy} onClick={() => setCreate(true)}>{t({ ja: '中継を登録', en: 'Register relay' })}</button> : null}</div></div>
    {!data ? <p role="status">{t({ ja: '機器の状況を取得しています…', en: 'Loading device status…' })}</p> : <>
      <div className="edge-metrics"><article><span>{t({ ja: '登録した中継', en: 'Registered relays' })}</span><strong>{data.gateways.length}</strong><small>{t({ ja: '権限のある拠点', en: 'Sites within your access' })}</small></article><article><span>{t({ ja: '直近90秒の応答', en: 'Responses within 90 seconds' })}</span><strong>{data.gateways.filter((row) => row.active && edgeRecentResponse(row.lastSeenAt, data.serverTime)).length}</strong><small>{t({ ja: '中継の応答を確認', en: 'Relay responses received' })}</small></article><article data-review><span>{t({ ja: '要確認の処理', en: 'Work requiring review' })}</span><strong>{data.jobs.filter((row) => row.state === 'uncertain').length}</strong><small>{t({ ja: '表示中の履歴から集計', en: 'Within the displayed history' })}</small></article></div>
      <EdgeFleet gateways={data.gateways} selected={gatewayId} serverTime={data.serverTime} manage={manage} onSelect={setGatewayId} onAction={setSelection} busy={busy}/>
      <div className="edge-toolbar edge-filter"><label>{t({ ja: '表示する中継', en: 'Filter by relay' })}<select className="input" value={gatewayId ?? ''} onChange={(event) => setGatewayId(event.target.value || undefined)}><option value="">{t({ ja: 'すべての中継', en: 'All relays' })}</option>{data.gateways.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>{manage ? <button className="btn btn-primary" disabled={busy || !gateway?.active} onClick={() => { if (gateway) setSelection({ type: 'device-new', row: gateway }); }}>{t({ ja: '選択した中継に機器を登録', en: 'Register device for selected relay' })}</button> : null}</div>
      <EdgeDevices devices={data.devices} gateways={data.gateways} events={data.events} manage={manage} operate={actions.includes('edge.enqueue')} onAction={setSelection} busy={busy}/>
      <EdgeJobs jobs={data.jobs} devices={data.devices} canCancel={actions.includes('edge.cancel')} canResolve={actions.includes('edge.resolve')} onReview={(row) => setSelection({ type: 'review', row })} busy={busy}/>
      {data.truncated ? <p className="edge-callout" role="status">{t({ ja: '件数が多いため一覧の一部を表示しています。中継で絞り込み、全履歴は業務メニューの処理一覧で確認してください。', en: 'This view shows a limited subset. Filter by relay or open the full job list from the business menu.' })}</p> : null}
      <p className="edge-footnote">{t({ ja: 'クラウド・オンプレで共通の仕組みです。店舗はERPのHTTPS接続先に到達できる必要があります。初版の実機対応はIPPテキスト印刷で、釣銭はシミュレーターです。', en: 'The same relay works with cloud and on-premises ERP. Stores must be able to reach the ERP HTTPS endpoint. This release supports IPP text printing; cash operations use a simulator.' })}</p>
    </>}
    {create && manage ? <EdgeGatewayForm onClose={() => setCreate(false)}/> : null}
    {selection && selectionAllowed && (selection.type === 'pair' || selection.type === 'revoke') ? <EdgePairing gateway={selection.row} revoke={selection.type === 'revoke'} onClose={close}/> : null}
    {selection && selectionAllowed && (selection.type === 'gateway-active' || selection.type === 'device-active') ? <EdgeActiveForm row={selection.row} type={selection.type === 'gateway-active' ? 'gateway' : 'device'} onClose={close}/> : null}
    {selectionAllowed && selection?.type === 'device-new' ? <EdgeDeviceForm gateway={selection.row} onClose={close}/> : null}
    {selectionAllowed && selection?.type === 'job-new' && data ? <EdgeJobForm device={selection.row} serverTime={data.serverTime} onClose={close}/> : null}
    {selectionAllowed && selection?.type === 'review' ? <EdgeReviewForm job={selection.row} onClose={close}/> : null}
  </ReadRecoveryProvider>}</div>;
}

function selectionPermitted(selection: EdgeSelection, actions: string[]) {
  const action = selection.type === 'pair' || selection.type === 'revoke' ? 'edge.create_gateway' : selection.type === 'gateway-active' ? 'edge.set_gateway_active' : selection.type === 'device-active' ? 'edge.set_device_active' : selection.type === 'device-new' ? 'edge.register_device' : selection.type === 'job-new' ? 'edge.enqueue' : selection.row.state === 'queued' ? 'edge.cancel' : 'edge.resolve';
  return actions.includes(action);
}
