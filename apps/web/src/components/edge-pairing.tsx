import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { accountSecurity } from '../api/identity.ts';
import { getUser } from '../api/client.ts';
import { useEdgeCommand } from '../api/edge.ts';
import type { EdgeRow } from '../api/edge.ts';
import { useLocale } from '../i18n.tsx';
import { IdentityStepUp } from './identity-step-up.tsx';
import { ControlDialog } from './control-dialog.tsx';
import { WorkforceError } from './workforce-shared.tsx';
import { EdgeTime } from './edge-shared.tsx';
import '../identity.css';
export function EdgePairing({ gateway, revoke = false, onClose }: { gateway: EdgeRow; revoke?: boolean; onClose: () => void }) {
  const { t } = useLocale(), task = useEdgeCommand(), [result, setResult] = useState<Record<string, unknown>>(), [reason, setReason] = useState('');
  const security = useQuery({ queryKey: ['account-security', getUser()?.id], queryFn: ({ signal }) => accountSecurity(signal), gcTime: 0, retry: false });
  const title = t(revoke ? { ja: '中継の接続資格を失効', en: 'Revoke relay credentials' } : { ja: '店舗中継の接続コード', en: 'Pair a store relay' });
  if (result) return <ControlDialog title={title} onClose={onClose}><div className="edge-form">{revoke ? <p role="status">{t({ ja: '接続資格を失効しました。再接続には新しい接続コードが必要です。', en: 'Credentials have been revoked. Reconnecting requires a new pairing code.' })}</p> : <><p>{t({ ja: 'このコードを店舗側の中継設定へ貼り付けてください。コードは一度だけ使え、画面を閉じると再表示できません。', en: 'Copy this single-use code into the store relay setup. It cannot be shown again after closing this dialog.' })}</p><label>{t({ ja: '接続コード', en: 'Pairing code' })}<input className="input edge-secret" autoComplete="off" spellCheck={false} readOnly value={String(result.pairingToken)} onFocus={(event) => event.target.select()}/></label><p>{t({ ja: '有効期限', en: 'Expires' })}: <EdgeTime value={result.expiresAt}/></p></>}<button className="btn" onClick={onClose}>{t({ ja: '閉じる', en: 'Close' })}</button></div></ControlDialog>;
  if (!security.data || !security.data.configured) return <ControlDialog title={title} onClose={onClose}><div className="edge-form">{security.isError ? <WorkforceError error={security.error} onRetry={() => void security.refetch()}/> : <p role="status">{t(security.data ? { ja: '中継の接続には本人確認基盤の設定が必要です。運用手順に沿って認証設定を行ってください。', en: 'Relay pairing requires configured account verification. Configure identity services using the operations guide.' } : { ja: '本人確認の設定を取得中…', en: 'Loading account verification…' })}</p>}</div></ControlDialog>;
  return <IdentityStepUp title={title} mfaEnabled={security.data.mfaEnabled} onClose={onClose} onVerified={async (stepUpToken) => { const value = await task.mutateAsync({ path: revoke ? '/edge/credentials/revoke' : '/edge/pairings', input: { gatewayId: gateway.id, expectedVersion: gateway.version, stepUpToken, ...(revoke ? { reason: reason.trim() } : {}) } }); setResult(value); }}>
    <p><strong>{String(gateway.name)}</strong></p>{revoke ? <label>{t({ ja: '失効理由', en: 'Revocation reason' })}<textarea className="input" value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={1000}/></label> : <p className="edge-callout">{t({ ja: '発行済みの未使用コードは無効になります。店舗・機器の設置場所を確認してから接続してください。', en: 'This invalidates any earlier unused pairing code. Verify the store and device location before pairing.' })}</p>}
  </IdentityStepUp>;
}
