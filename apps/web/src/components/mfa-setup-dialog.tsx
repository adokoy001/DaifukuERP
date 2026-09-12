import { useEffect, useRef, useState } from 'react';
import { identityPost, type MfaSetup } from '../api/identity.ts';
import { useLocale } from '../i18n.tsx';
import { ControlDialog } from './control-dialog.tsx';
export function MfaSetupDialog({ setup, onClose, onComplete, onBusy }: { setup: MfaSetup; onClose: () => void; onComplete: (codes: string[]) => Promise<void>; onBusy?: (busy: boolean) => void }) {
  const { t } = useLocale(), [code, setCode] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(false), [qr, setQr] = useState(''), inFlight = useRef(false);
  useEffect(() => { let live = true; void import('qrcode').then((module) => module.toDataURL(setup.otpauthUri, { width: 240, margin: 4 })).then((url) => { if (live) setQr(url); }).catch(() => { /* Manual secret entry remains available. */ }); return () => { live = false; }; }, [setup.otpauthUri]);
  const confirm = async () => {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); onBusy?.(true); setError(false);
    try { const result = await identityPost<{ ok: true; recoveryCodes: string[] }>('mfa/confirm', { setupToken: setup.setupToken, code: code.trim() }); await onComplete(result.recoveryCodes); }
    catch { setError(true); setCode(''); }
    finally { inFlight.current = false; setBusy(false); onBusy?.(false); }
  };
  return <ControlDialog title={t({ ja: '認証アプリを登録', en: 'Set up your authenticator' })} onClose={onClose} busy={busy}><form className="identity-setup" onSubmit={(event) => { event.preventDefault(); void confirm(); }}><p>{t({ ja: '認証アプリでQRコードを読み取るか、下の設定キーを入力してください。続いて6桁コードを入力すると登録が完了します。', en: 'Scan this QR code in your authenticator or enter the setup key below. Enter its six-digit code to finish.' })}</p>{qr ? <img src={qr} alt={t({ ja: '認証アプリ登録用QRコード', en: 'Authenticator setup QR code' })} width={240} height={240} /> : null}<label>{t({ ja: '設定キー', en: 'Setup key' })}<code data-testid="mfa-setup-secret">{setup.secret}</code></label><p className="account-help">{t({ ja: 'このキーは他人に教えないでください。登録後に全端末からログアウトし、回復コードを一度だけ表示します。', en: 'Keep this key private. Setup signs out all devices and displays recovery codes once.' })}</p><label htmlFor="setup-code">{t({ ja: 'アプリの6桁コード', en: 'Six-digit app code' })}</label><input id="setup-code" className="input identity-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" autoFocus required value={code} onChange={(event) => setCode(event.target.value)} disabled={busy} />{error ? <p role="alert" className="account-error">{t({ ja: '登録完了を確認できません。新しいコードを確認し、期限切れの場合は閉じて登録をやり直してください。', en: 'Could not confirm setup. Check a fresh code; if this request expired, close it and start again.' })}</p> : null}<button className="btn btn-primary" disabled={busy}>{t({ ja: '登録して回復コードを表示', en: 'Enable and show recovery codes' })}</button></form></ControlDialog>;
}
