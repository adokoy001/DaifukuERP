import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { clearSession } from '../api/client.ts';
import { identityPost } from '../api/identity.ts';
import { AuthFrame } from '../components/auth-frame.tsx';
import { completeSso, readMailToken, readSsoReturn, rememberMfa, takeRecoveryCodes } from '../lib/identity-flow.ts';
import { useLocale } from '../i18n.tsx';
import { TenantChoice, useCompleteLogin } from './login-page.tsx';

export function ForgotPasswordPage() {
  const { t } = useLocale();
  const [email, setEmail] = useState('');
  const [tenantId, setTenantId] = useState('');
  const m = useMutation({
    mutationFn: () =>
      identityPost<{ ok: true }>('password-reset/request', { email, ...(tenantId ? { tenantId } : {}) }, true),
  });
  return (
    <AuthFrame>
      <h1>{t({ ja: 'パスワードの再設定', en: 'Reset your password' })}</h1>
      {m.isSuccess ? (
        <p role="status" className="notice">
          {t({
            ja: '入力された情報で再設定できる場合、メールをお届けします。受信できない場合は迷惑メールと組織IDを確認し、管理者へお問い合わせください。',
            en: 'If these details allow a reset, you will receive an email. Check spam and your organization ID, or contact your administrator.',
          })}
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <p>
            {t({
              ja: '登録したメールアドレスに、再設定用リンクをご案内します。',
              en: 'Request a reset link for your registered email address.',
            })}
          </p>
          <label htmlFor="reset-email">{t({ ja: 'メールアドレス', en: 'Email' })}</label>
          <input
            id="reset-email"
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <TenantChoice value={tenantId} onChange={setTenantId} />
          {m.isError ? (
            <p role="alert" className="account-error">
              {t({
                ja: '受付を確認できませんでした。時間をおいて再試行してください。',
                en: 'Could not confirm your request. Please try again later.',
              })}
            </p>
          ) : null}
          <button className="btn btn-primary" disabled={m.isPending}>
            {t({ ja: '再設定メールを依頼', en: 'Request reset email' })}
          </button>
        </form>
      )}
      <Link to="/login" className="auth-back">
        {t({ ja: 'ログインに戻る', en: 'Back to sign in' })}
      </Link>
    </AuthFrame>
  );
}

export function MailPasswordPage({ invitation = false }: { invitation?: boolean }) {
  const { t } = useLocale();
  const qc = useQueryClient();
  const initialized = useRef(false);
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      setToken(readMailToken());
    }
  }, []);
  const m = useMutation({
    mutationFn: () =>
      identityPost<{ ok: true }>(
        invitation ? 'invitations/accept' : 'password-reset/complete',
        { token, newPassword: password },
        true,
      ),
    onSuccess: () => {
      setToken('');
      setPassword('');
      setConfirm('');
      clearSession();
      qc.clear();
    },
  });
  return (
    <AuthFrame>
      <h1>
        {t(
          invitation
            ? { ja: 'Daifukuへようこそ', en: 'Welcome to Daifuku' }
            : { ja: '新しいパスワード', en: 'Choose a new password' },
        )}
      </h1>
      {m.isSuccess ? (
        <p role="status" className="notice">
          {t(
            invitation
              ? {
                  ja: 'アカウントを有効にしました。ログイン後、会社の所属・権限は管理者が設定します。',
                  en: 'Your account is active. Your administrator assigns company access and roles after you sign in.',
                }
              : {
                  ja: 'パスワードを再設定しました。全端末のログインは失効しています。MFAを登録済みの場合、次のログインでも認証コードが必要です。',
                  en: 'Your password was reset and all sessions expired. If MFA is enabled, you still need a verification code to sign in.',
                },
          )}
        </p>
      ) : token === '' ? (
        <p role="alert" className="account-error">
          {t({
            ja: '有効なリンクがありません。メールのリンクから開き直してください。',
            en: 'No valid link is available. Open the link from your email again.',
          })}
        </p>
      ) : token !== null ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (password !== confirm) setMismatch(true);
            else {
              setMismatch(false);
              m.mutate();
            }
          }}
        >
          <p>
            {t({
              ja: '12〜200文字の、ほかで使っていないパスワードを設定してください。',
              en: 'Use a unique password of 12–200 characters.',
            })}
          </p>
          <label htmlFor="mail-password">{t({ ja: '新しいパスワード', en: 'New password' })}</label>
          <input
            id="mail-password"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={200}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <label htmlFor="mail-confirm">{t({ ja: '新しいパスワード（確認）', en: 'Confirm new password' })}</label>
          <input
            id="mail-confirm"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={200}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {mismatch || m.isError ? (
            <p role="alert" className="account-error">
              {t(
                mismatch
                  ? { ja: '確認用のパスワードが一致していません。', en: 'The passwords do not match.' }
                  : {
                      ja: '完了を確認できませんでした。リンクは使用済み・期限切れの可能性があります。ログインを試すか、新しいリンクを依頼してください。',
                      en: 'Could not confirm completion. The link may be used or expired. Try signing in or request a new link.',
                    },
              )}
            </p>
          ) : null}
          <button className="btn btn-primary" disabled={m.isPending}>
            {t(
              invitation
                ? { ja: '登録して利用を始める', en: 'Activate account' }
                : { ja: 'パスワードを再設定', en: 'Reset password' },
            )}
          </button>
        </form>
      ) : (
        <p role="status">{t({ ja: 'リンクを確認しています…', en: 'Checking your link…' })}</p>
      )}
      <Link to="/login" className="auth-back">
        {t({ ja: 'ログインへ', en: 'Sign in' })}
      </Link>
      {!invitation && !m.isSuccess ? (
        <Link to="/forgot-password" className="auth-back">
          {t({ ja: '新しいリンクを依頼', en: 'Request a new link' })}
        </Link>
      ) : null}
    </AuthFrame>
  );
}

export function InvitationPage() {
  return <MailPasswordPage invitation />;
}

export function SsoCallbackPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const complete = useCompleteLogin();
  const started = useRef(false);
  const [state, setState] = useState<'working' | 'linked' | 'error'>('working');
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const input = readSsoReturn();
    if (!input) {
      setState('error');
      return;
    }
    void completeSso(input)
      .then(async (result) => {
        if ('linked' in result) {
          clearSession();
          qc.clear();
          setState('linked');
        } else if ('mfaRequired' in result) {
          rememberMfa(result);
          await navigate({ to: '/login', replace: true });
        } else await complete(result);
      })
      .catch(() => setState('error'));
  }, [complete, navigate, qc]);
  return (
    <AuthFrame>
      <h1>{t({ ja: '組織アカウントの確認', en: 'Organization sign-in' })}</h1>
      <p role={state === 'error' ? 'alert' : 'status'}>
        {t(
          state === 'working'
            ? { ja: '認証結果を確認しています…', en: 'Checking the sign-in result…' }
            : state === 'linked'
              ? {
                  ja: '組織アカウントを紐付けました。全端末からログアウトしましたので、SSOでログインしてください。',
                  en: 'Your organization account is linked. All sessions expired; sign in using SSO.',
                }
              : {
                  ja: '認証を完了できませんでした。同じブラウザからやり直してください。初回はパスワードでログインし、アカウント設定でSSOを紐付けます。',
                  en: 'Sign-in could not be completed. Start again in this browser. First-time users must sign in with a password and link SSO in account settings.',
                },
        )}
      </p>
      {state !== 'working' ? (
        <Link to="/login" className="auth-back">
          {t({ ja: 'ログインへ', en: 'Sign in' })}
        </Link>
      ) : null}
    </AuthFrame>
  );
}

export function RecoveryCodesPage() {
  const { t } = useLocale();
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      setCodes(takeRecoveryCodes());
    }
  }, []);
  return (
    <AuthFrame>
      <h1>{t({ ja: '回復コードを保管', en: 'Save your recovery codes' })}</h1>
      {codes.length ? (
        <>
          <p>
            {t({
              ja: '各コードは1回だけ使えます。認証アプリを失った時のため、安全な場所に書き留めてください。この画面を離れると再表示できません。全端末からログアウト済みです。',
              en: 'Each code works once. Keep them somewhere safe in case you lose your authenticator. They cannot be shown again after leaving this page. All sessions have been signed out.',
            })}
          </p>
          <ul className="identity-recovery">
            {codes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <label className="account-show">
            <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
            {t({ ja: '安全な場所に保存しました', en: 'I saved these somewhere safe' })}
          </label>
          {saved ? (
            <Link to="/login" className="btn btn-primary" onClick={() => setCodes([])}>
              {t({ ja: '保存してログインへ', en: 'Continue to sign in' })}
            </Link>
          ) : null}
        </>
      ) : (
        <>
          <p role="status">
            {t({
              ja: '表示できる回復コードはありません。紛失した場合はログイン後、再発行してください。',
              en: 'There are no recovery codes to display. Sign in to generate a new set if needed.',
            })}
          </p>
          <Link to="/login" className="auth-back">
            {t({ ja: 'ログインへ', en: 'Sign in' })}
          </Link>
        </>
      )}
    </AuthFrame>
  );
}
