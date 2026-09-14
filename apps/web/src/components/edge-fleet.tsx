import type { EdgeRow } from '../api/edge.ts';
import { useLocale } from '../i18n.tsx';
import { edgeRecentResponse } from '../lib/edge.ts';
import { EdgeBadge, EdgePanel, EdgeTime } from './edge-shared.tsx';
import { Icon } from './icon.tsx';
export type EdgeSelection = {
  type: 'pair' | 'revoke' | 'gateway-active' | 'device-active' | 'device-new' | 'job-new' | 'review';
  row: EdgeRow;
};
export function EdgeFleet({
  gateways,
  selected,
  serverTime,
  manage,
  onSelect,
  onAction,
  busy,
}: {
  gateways: EdgeRow[];
  selected: string | undefined;
  serverTime: string;
  manage: boolean;
  onSelect: (id: string) => void;
  onAction: (action: EdgeSelection) => void;
  busy: boolean;
}) {
  const { t } = useLocale();
  return (
    <EdgePanel
      title={t({ ja: '店舗の中継', en: 'Store relays' })}
      note={t({
        ja: '接続資格と最終応答を確認できます。中継が応答していても、個々の機器の動作は別に確認してください。',
        en: 'Check pairing and the last response. A responding relay does not by itself confirm that each device is working.',
      })}
    >
      <div className="edge-fleet">
        {gateways.map((gateway) => (
          <article className="edge-gateway" data-selected={gateway.id === selected} key={gateway.id}>
            <header>
              <span className="edge-gateway-icon">
                <Icon name="building" size={24} />
              </span>
              <div>
                <strong>{String(gateway.name)}</strong>
                <small>{String(gateway.code)}</small>
              </div>
              <EdgeBadge
                state={
                  gateway.active === false
                    ? 'paused'
                    : edgeRecentResponse(gateway.lastSeenAt, serverTime)
                      ? 'online'
                      : 'unknown'
                }
              />
            </header>
            <dl>
              <div>
                <dt>{t({ ja: '最終応答', en: 'Last response' })}</dt>
                <dd>
                  <EdgeTime value={gateway.lastSeenAt} />
                </dd>
              </div>
              <div>
                <dt>{t({ ja: '接続資格', en: 'Pairing' })}</dt>
                <dd>{t(gateway.paired ? { ja: '発行済み', en: 'Issued' } : { ja: '未接続', en: 'Not paired' })}</dd>
              </div>
            </dl>
            <div className="edge-buttons">
              <button className="btn" aria-pressed={gateway.id === selected} onClick={() => onSelect(gateway.id)}>
                {t({ ja: 'この中継を見る', en: 'View relay' })}
              </button>
              {manage ? (
                <>
                  <button
                    className="btn"
                    disabled={busy || !gateway.active}
                    onClick={() => onAction({ type: 'pair', row: gateway })}
                  >
                    {t({ ja: '接続コード', en: 'Pairing code' })}
                  </button>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => onAction({ type: 'gateway-active', row: gateway })}
                  >
                    {t(gateway.active ? { ja: '受付停止', en: 'Pause' } : { ja: '受付再開', en: 'Resume' })}
                  </button>
                  {gateway.paired ? (
                    <button className="btn" disabled={busy} onClick={() => onAction({ type: 'revoke', row: gateway })}>
                      {t({ ja: '接続資格を失効', en: 'Revoke credentials' })}
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {!gateways.length ? (
        <p className="edge-empty">
          {t({
            ja: '店舗の中継を登録して、現場の機器と接続しましょう。',
            en: 'Register a store relay to connect your local devices.',
          })}
        </p>
      ) : null}
    </EdgePanel>
  );
}
export function EdgeDevices({
  devices,
  events,
  gateways,
  manage,
  operate,
  onAction,
  busy,
}: {
  devices: EdgeRow[];
  events: EdgeRow[];
  gateways: EdgeRow[];
  manage: boolean;
  operate: boolean;
  onAction: (action: EdgeSelection) => void;
  busy: boolean;
}) {
  const { t } = useLocale();
  return (
    <EdgePanel
      title={t({ ja: '接続する機器', en: 'Connected devices' })}
      note={t({
        ja: 'IPPプリンターとシミュレーターに対応します。機器ID・接続方式・宛先を店舗側でも設定してください。',
        en: 'Supports IPP printers and a simulator. Configure matching device IDs, drivers and destinations at the store.',
      })}
    >
      <div className="edge-devices">
        {devices.map((device) => {
          const event = events
            .filter((item) => item.deviceId === device.id)
            .sort((a, b) => Date.parse(String(b.observedAt)) - Date.parse(String(a.observedAt)))[0];
          const gateway = gateways.find((item) => item.id === device.gatewayId);
          return (
            <article className="edge-device" key={device.id}>
              <span className="edge-device-icon">
                <Icon name={device.driver === 'simulator' ? 'spark' : 'document'} size={24} />
              </span>
              <div className="edge-device-main">
                <h3>{String(device.name)}</h3>
                <p>
                  {String(gateway?.name ?? '—')} · {String(device.localDeviceId)}
                </p>
                <small>
                  {t(
                    device.driver === 'simulator'
                      ? { ja: 'シミュレーター / 実機操作なし', en: 'Simulator / no physical device' }
                      : { ja: 'IPPテキスト印刷', en: 'IPP text printing' },
                  )}
                </small>
                <div className="edge-device-status">
                  <span>{t({ ja: '最終観測時の報告', en: 'Last observed report' })}</span>
                  <EdgeBadge state={device.active === false ? 'paused' : String(event?.status ?? 'unknown')} />
                  <EdgeTime value={event?.observedAt} />
                  {event ? (
                    <small>
                      {t({ ja: '受信', en: 'Received' })}: <EdgeTime value={event.receivedAt} />
                    </small>
                  ) : null}
                </div>
              </div>
              <div className="edge-buttons">
                {operate ? (
                  <button
                    className="btn btn-primary"
                    disabled={busy || !device.active || !gateway?.active}
                    onClick={() => onAction({ type: 'job-new', row: device })}
                  >
                    {t({ ja: '処理を依頼', en: 'Request work' })}
                  </button>
                ) : null}
                {manage ? (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => onAction({ type: 'device-active', row: device })}
                  >
                    {t(device.active ? { ja: '受付停止', en: 'Pause' } : { ja: '受付再開', en: 'Resume' })}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      {!devices.length ? (
        <p className="edge-empty">
          {t({ ja: '中継を選択して機器を登録してください。', en: 'Select a relay and register a device.' })}
        </p>
      ) : null}
    </EdgePanel>
  );
}
