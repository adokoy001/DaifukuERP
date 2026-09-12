import type { ReactNode } from 'react';
import { useLocale } from '../i18n.tsx';
import { Icon } from './icon.tsx';
export function EdgePanel({ title, note, actions, children }: { title: string; note?: string; actions?: ReactNode; children: ReactNode }) {
  return <section className="edge-panel"><header><div><h2>{title}</h2>{note ? <p>{note}</p> : null}</div>{actions}</header>{children}</section>;
}
const states: Record<string, { ja: string; en: string }> = {
  queued: { ja: '待機中', en: 'Queued' }, claimed: { ja: '取得済み・開始前', en: 'Claimed, not started' }, executing: { ja: '実行中', en: 'Executing' },
  succeeded: { ja: '完了報告', en: 'Completion reported' }, failed: { ja: '失敗', en: 'Failed' }, uncertain: { ja: '実機の確認が必要', en: 'Device review required' }, cancelled: { ja: '取消済み', en: 'Cancelled' }, expired: { ja: '期限切れ', en: 'Expired' },
  paused: { ja: '受付停止', en: 'Requests paused' },
  online: { ja: '応答あり', en: 'Responding' }, offline: { ja: '応答なし', en: 'No response' }, unknown: { ja: '未確認', en: 'Unconfirmed' }, busy: { ja: '処理中', en: 'Busy' }, error: { ja: 'エラー', en: 'Error' },
};
export function EdgeBadge({ state }: { state: string }) { const { t } = useLocale(); return <span className="edge-badge" data-state={state}>{states[state] ? t(states[state]) : state}</span>; }
export function EdgeKind({ kind }: { kind: string }) { const { t } = useLocale(); return <>{t(kind === 'print.text' ? { ja: 'テキスト印刷', en: 'Text print' } : kind === 'cash.dispense' ? { ja: '釣銭払い出し（模擬）', en: 'Cash dispense (simulated)' } : { ja: '機器状態の取得', en: 'Device status' })}</>; }
export function EdgeTime({ value }: { value: unknown }) {
  const { locale } = useLocale(), date = typeof value === 'string' ? new Date(value) : null;
  return <>{date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-GB', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'medium' }).format(date) : '—'}</>;
}
export function EdgeHero({ actions }: { actions?: ReactNode }) {
  const { t } = useLocale();
  return <header className="edge-hero"><div><span className="eyebrow">DAIFUKU · STORE LINK</span><h1>{t({ ja: '店舗と機器を、つなぐ。', en: 'Your stores, connected.' })}</h1><p>{t({ ja: '店舗の中継・プリンター・機器の状態と、依頼した処理をひとつの画面で。', en: 'See your store relays, printers, device status and requested work in one place.' })}</p>{actions}</div><div className="edge-flow" aria-label={t({ ja: '店舗から本部への接続', en: 'Outbound connection from store to headquarters' })}><span><Icon name="building" size={28}/>{t({ ja: '店舗', en: 'Store' })}</span><Icon name="arrow"/><span><Icon name="check" size={28}/>{t({ ja: '安全な接続', en: 'Secure link' })}</span><Icon name="arrow"/><span><Icon name="chart" size={28}/>{t({ ja: '本部', en: 'Headquarters' })}</span></div></header>;
}
