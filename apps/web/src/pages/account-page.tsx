import { useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker, useNavigate } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
import { changeOwnPassword, logoutAllSessions } from '../api/account.ts';
import { clearSession, getToken, getUser, isApiError } from '../api/client.ts';
import { ControlDialog } from '../components/control-dialog.tsx';
import { Icon } from '../components/icon.tsx';
import { useLocale } from '../i18n.tsx';
import '../account.css';

type Passwords = { current: string; next: string; confirm: string };
const EMPTY: Passwords = { current: '', next: '', confirm: '' };
type AccountReason = 'password-changed' | 'signed-out-all';

function useAccountSecurity() {
  const [passwords, setPasswords] = useState<Passwords>(EMPTY);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [confirmLogout, setConfirmLogout] = useState(false);
  const inFlight = useRef(false), exitAllowed = useRef(false);
  const qc = useQueryClient(), navigate = useNavigate(), { t } = useLocale();
  const dirty = Object.values(passwords).some(Boolean);
  useBlocker({ shouldBlockFn: () => Boolean(getToken()) && !exitAllowed.current && (inFlight.current || (dirty && !globalThis.confirm(t({ ja: '入力中のパスワードを破棄して移動しますか？', en: 'Discard the password you are entering and leave?' })))), enableBeforeUnload: dirty || busy });
  const perform = async (operation: () => Promise<{ ok: true }>, reason: AccountReason) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await operation();
      if (result?.ok !== true) throw new Error('Invalid response');
      exitAllowed.current = true; setPasswords(EMPTY); clearSession(); qc.clear();
      await navigate({ to: '/login', search: { reason }, replace: true });
    } catch (err) {
      const invalidCurrent = isApiError(err) && err.issues().some((issue) => issue.path === 'currentPassword');
      setError(t(invalidCurrent ? { ja: '現在のパスワードを確認してください。変更は行われていません。', en: 'Check your current password. Nothing was changed.' } : { ja: '処理を完了できませんでした。通信を確認して再試行してください。変更が完了していた場合は、再ログインが必要です。', en: 'Could not confirm completion. Check your connection and retry. If the change completed, sign in again.' }));
    } finally { inFlight.current = false; setBusy(false); }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (passwords.next !== passwords.confirm) { setError(t({ ja: '新しいパスワードと確認用の入力が一致していません。', en: 'The new password and confirmation do not match.' })); return; }
    if (passwords.next === passwords.current) { setError(t({ ja: '現在とは異なるパスワードを入力してください。', en: 'Choose a different password from your current one.' })); return; }
    void perform(() => changeOwnPassword(passwords.current, passwords.next), 'password-changed');
  };
  const update = (field: keyof Passwords, value: string) => { setPasswords((previous) => ({ ...previous, [field]: value })); setError(''); };
  return { passwords, busy, error, confirmLogout, setConfirmLogout, submit, update, logout: () => void perform(logoutAllSessions, 'signed-out-all') };
}

type SecurityState = ReturnType<typeof useAccountSecurity>;
function PasswordCard({ security }: { security: SecurityState }) {
  const { t } = useLocale();
  const [show, setShow] = useState(false);
  const fields = [
    { key: 'current' as const, label: t({ ja: '現在のパスワード', en: 'Current password' }), autocomplete: 'current-password', min: 1 },
    { key: 'next' as const, label: t({ ja: '新しいパスワード', en: 'New password' }), autocomplete: 'new-password', min: 12 },
    { key: 'confirm' as const, label: t({ ja: '新しいパスワード（確認）', en: 'Confirm new password' }), autocomplete: 'new-password', min: 12 },
  ];
  return <section className="account-card" aria-labelledby="password-title">
    <div className="account-card-heading"><span className="icon-tile tone-violet"><Icon name="settings" /></span><div><h2 id="password-title">{t({ ja: 'パスワードを変更', en: 'Change password' })}</h2><p>{t({ ja: '自分のアカウントを、いつでも自分で管理。', en: 'Keep control of your own account.' })}</p></div></div>
    <form onSubmit={security.submit} aria-label={t({ ja: 'パスワードの変更', en: 'Change your password' })}>
      <fieldset disabled={security.busy}>
        {fields.map((field) => <div className="account-field" key={field.key}><label htmlFor={`account-${field.key}`}>{field.label}</label><input id={`account-${field.key}`} name={field.key} className="input" type={show ? 'text' : 'password'} autoComplete={field.autocomplete} required minLength={field.min} maxLength={200} value={security.passwords[field.key]} onChange={(event) => security.update(field.key, event.target.value)} aria-describedby={field.key === 'current' ? undefined : 'password-guidance'} /></div>)}
        <p id="password-guidance" className="account-help">{t({ ja: '12〜200文字。ほかのサービスと使い回さず、長いパスフレーズをおすすめします。', en: 'Use 12–200 characters. Choose a long passphrase you do not use elsewhere.' })}</p>
        <label className="account-show"><input type="checkbox" checked={show} onChange={(event) => setShow(event.target.checked)} />{t({ ja: '入力したパスワードを表示', en: 'Show passwords' })}</label>
        <p className="account-effect"><Icon name="logout" size={17} />{t({ ja: '変更すると、この画面を含む全端末からログアウトします。新しいパスワードでログインし直してください。', en: 'Changing your password signs out every device, including this one. Sign in again with your new password.' })}</p>
        <button type="submit" className="btn btn-primary">{t(security.busy ? { ja: '処理中…', en: 'Working…' } : { ja: '変更してログインし直す', en: 'Change password and sign in again' })}<Icon name="arrow" size={17} /></button>
      </fieldset>
    </form>
  </section>;
}

function SessionCard({ security }: { security: SecurityState }) {
  const { t } = useLocale();
  return <section className="account-card account-session" aria-labelledby="sessions-title">
    <div className="account-card-heading"><span className="icon-tile tone-cyan"><Icon name="logout" /></span><div><h2 id="sessions-title">{t({ ja: 'ログイン中の端末', en: 'Signed-in devices' })}</h2><p>{t({ ja: '使い終えた端末へのアクセスをまとめて終了。', en: 'End access on devices you have finished using.' })}</p></div></div>
    <p>{t({ ja: '共有PCでログアウトし忘れたときなどに、すべてのログインを無効にできます。', en: 'If you forgot to sign out on a shared computer, you can invalidate all current sessions.' })}</p>
    <div className="account-session-note"><Icon name="check" size={18} /><span>{t({ ja: 'パスワードと業務データは変更されません。', en: 'Your password and business records stay the same.' })}</span></div>
    <button type="button" className="btn" disabled={security.busy} onClick={() => security.setConfirmLogout(true)}>{t({ ja: '全端末からログアウト', en: 'Sign out all devices' })}</button>
    <p className="account-help">{t({ ja: 'この画面のログインも終了します。端末ごとの一覧・個別ログアウトは未対応です。', en: 'This signs out the current screen too. A device list and individual revocation are not available yet.' })}</p>
  </section>;
}

export function AccountPage() {
  const security = useAccountSecurity(), { t, locale, setLocale } = useLocale(), user = getUser();
  return <main className="account-page" data-testid="account-security">
    <div className="account-frame">
      <header className="account-top"><Link to="/" className="account-brand"><span className="brand-mark">大</span><span>Daifuku<small>MY ACCOUNT</small></span></Link><button type="button" className="btn" onClick={() => setLocale(locale === 'ja' ? 'en' : 'ja')}>{locale === 'ja' ? 'English' : '日本語'}</button></header>
      <div className="account-intro"><div><span className="eyebrow">ACCOUNT &amp; SECURITY</span><h1>{t({ ja: '自分のアカウント', en: 'My account' })}</h1><p>{t({ ja: '毎日の仕事を、安心して始めるために。', en: 'Start each workday with confidence.' })}</p></div><Link className="btn" to="/">{t({ ja: 'ワークスペースへ戻る', en: 'Back to workspace' })}</Link></div>
      <section className="account-identity" aria-label={t({ ja: 'ログイン中の利用者', en: 'Signed-in user' })}><span className="user-avatar">{(user?.name ?? 'D').slice(0, 1)}</span><div><strong>{user?.name}</strong><span>{user?.email}</span></div><span className="account-identity-label">{t({ ja: '本人用の設定', en: 'Personal settings' })}</span></section>
      {security.error ? <p role="alert" className="account-error">{security.error}</p> : null}
      <div className="account-grid"><PasswordCard security={security} /><SessionCard security={security} /></div>
      {security.confirmLogout ? <ControlDialog title={t({ ja: '全端末のログインを終了しますか？', en: 'End every signed-in session?' })} busy={security.busy} onClose={() => security.setConfirmLogout(false)}><p>{t({ ja: 'この画面を含むすべての端末で、再ログインが必要になります。入力中のパスワードも破棄されます。', en: 'Every device, including this one, will need to sign in again. Any password you are entering will be discarded.' })}</p>{security.error ? <p className="account-error" role="alert">{security.error}</p> : null}<div className="dialog-actions"><button type="button" className="btn" disabled={security.busy} onClick={() => security.setConfirmLogout(false)} autoFocus>{t({ ja: '戻る', en: 'Go back' })}</button><button type="button" className="btn btn-primary" disabled={security.busy} onClick={security.logout}>{t(security.busy ? { ja: '処理中…', en: 'Working…' } : { ja: '全端末のログインを終了', en: 'End all sessions' })}</button></div></ControlDialog> : null}
    </div>
  </main>;
}
