import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { isApiError, setSession } from '../api/client.ts';
import { login } from '../api/queries.ts';
import type { LoginResponse } from '../api/types.ts';
import type { MfaChallenge as Challenge } from '../api/identity.ts';
import { AuthFrame } from '../components/auth-frame.tsx';
import { MfaChallenge } from '../components/mfa-challenge.tsx';
import { SsoProviders } from '../components/sso-providers.tsx';
import { takeMfa } from '../lib/identity-flow.ts';
import { useLocale } from '../i18n.tsx';
import { S } from '../strings.ts';

export function TenantChoice({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useLocale();
  return (
    <details className="login-advanced">
      <summary>{t({ ja: '組織を指定してログイン', en: 'Sign in to a specific organization' })}</summary>
      <label htmlFor="tenant-id">{t({ ja: '組織ID（任意）', en: 'Organization ID (optional)' })}</label>
      <input
        id="tenant-id"
        name="tenantId"
        className="input code"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
        aria-describedby="tenant-help"
      />
      <p id="tenant-help">
        {t({
          ja: '複数の組織で同じメールアドレスを使う場合、管理者から案内された組織IDを入力してください。',
          en: 'If you use this email in more than one organization, enter the organization ID provided by your administrator.',
        })}
      </p>
    </details>
  );
}

export function useCompleteLogin() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async (res: LoginResponse) => {
    setSession(res.token, res.user);
    qc.clear();
    await navigate({
      to: res.user.roles.length > 0 && res.user.roles.every((role) => role === 'workforce_employee') ? '/me' : '/',
      replace: true,
    });
  };
}

function LoginNotice() {
  const { t } = useLocale();
  const search = useSearch({ strict: false }) as { reason?: string };
  if (search.reason === 'expired')
    return (
      <p role="status" className="notice">
        {t(S.sessionExpired)}
      </p>
    );
  if (search.reason === 'password-changed')
    return (
      <p role="status" className="notice">
        {t({
          ja: 'パスワードを変更し、全端末からログアウトしました。新しいパスワードでログインしてください。',
          en: 'Your password was changed and all devices were signed out. Sign in with your new password.',
        })}
      </p>
    );
  if (search.reason === 'signed-out-all')
    return (
      <p role="status" className="notice">
        {t({
          ja: '全端末からログアウトしました。利用を続ける場合はログインしてください。',
          en: 'All devices were signed out. Sign in to continue.',
        })}
      </p>
    );
  return null;
}

export function LoginPage() {
  const { t } = useLocale();
  const complete = useCompleteLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      setChallenge(takeMfa());
    }
  }, []);
  const m = useMutation({
    mutationFn: () => login(email, password, tenantId.trim() || undefined),
    onSuccess: async (res) => {
      setPassword('');
      if ('mfaRequired' in res) setChallenge(res);
      else await complete(res);
    },
  });
  if (challenge)
    return (
      <AuthFrame>
        <MfaChallenge
          challenge={challenge}
          onSuccess={complete}
          onCancel={() => {
            setChallenge(null);
            m.reset();
          }}
        />
      </AuthFrame>
    );
  return (
    <AuthFrame>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          m.mutate();
        }}
        aria-label={t(S.login)}
      >
        <h1>{t({ ja: 'おかえりなさい', en: 'Welcome back' })}</h1>
        <p>
          {t({ ja: 'アカウントでログインして、仕事を始めましょう。', en: 'Sign in to your account to get started.' })}
        </p>
        <LoginNotice />
        <label htmlFor="email">{t(S.email)}</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        <label htmlFor="password">{t(S.password)}</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <TenantChoice value={tenantId} onChange={setTenantId} />
        {m.error ? (
          <p role="alert" className="account-error">
            {t(S.loginFailed)}: {isApiError(m.error) ? `${m.error.message} — ${m.error.hint}` : m.error.message}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary w-full justify-center" disabled={m.isPending}>
          {m.isPending ? t(S.loggingIn) : t(S.login)}
        </button>
        <Link to="/forgot-password" className="auth-back">
          {t({ ja: 'パスワードを忘れた方', en: 'Forgot your password?' })}
        </Link>
      </form>
      <SsoProviders />
    </AuthFrame>
  );
}
