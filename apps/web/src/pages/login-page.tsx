// AC-1: login form; on success the token is stored (sessionStorage) and the app loads /meta.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { isApiError, setSession } from '../api/client.ts';
import { login } from '../api/queries.ts';
import { useLocale } from '../i18n.tsx';
import { S } from '../strings.ts';
import { Icon } from '../components/icon.tsx';

function TenantChoice({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useLocale();
  return <details className="login-advanced"><summary>{t({ ja: '組織を指定してログイン', en: 'Sign in to a specific organization' })}</summary>
    <label htmlFor="tenant-id">{t({ ja: '組織ID（任意）', en: 'Organization ID (optional)' })}</label>
    <input id="tenant-id" name="tenantId" className="input code" value={value} onChange={(e) => onChange(e.target.value)} pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" aria-describedby="tenant-help" />
    <p id="tenant-help">{t({ ja: '複数の組織で同じメールアドレスを使う場合、管理者から案内された組織IDを入力してください。', en: 'If you use this email in more than one organization, enter the organization ID provided by your administrator.' })}</p>
  </details>;
}

export function LoginPage() {
  const { t, locale, setLocale } = useLocale();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const search = useSearch({ strict: false }) as { reason?: string };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantId, setTenantId] = useState('');
  const m = useMutation({
    mutationFn: () => login(email, password, tenantId.trim() || undefined),
    onSuccess: async (res) => {
      setSession(res.token, res.user);
      qc.clear();
      await navigate({ to: res.user.roles.length > 0 && res.user.roles.every((role) => role === 'workforce_employee') ? '/me' : '/' });
    },
  });
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  const err = m.error;
  return (
    <div className="login-page">
      <section className="login-story"><div className="brand"><span className="brand-mark">大</span><span>Daifuku<small>YOUR BUSINESS, CONNECTED</small></span></div><h2>{t({ ja: '日々の仕事に、\n心地よい見通しを。', en: 'A clearer view of\nyour everyday business.' }).split('\n').map((line) => <span className="block" key={line}>{line}</span>)}</h2><p>{t({ ja: '販売、仕入、在庫、会計。ひとつにつながる記録で、次の一歩を軽やかに。', en: 'Sales, purchasing, inventory and accounting. Connected records make your next step easier.' })}</p><div className="login-steps"><span><Icon name="document" size={18} /></span><span>{t({ ja: '記録する', en: 'Record' })}</span><span>{t({ ja: 'つながる', en: 'Connect' })}</span><span>{t({ ja: '見渡せる', en: 'Understand' })}</span></div></section>
      <div className="login-form-wrap"><form onSubmit={onSubmit} className="login-form" aria-label={t(S.login)}>
        <div className="mb-4 flex items-center justify-between">
          <h1>{t({ ja: 'おかえりなさい', en: 'Welcome back' })}</h1>
          <button type="button" className="text-xs text-neutral-500 uppercase hover:underline" onClick={() => setLocale(locale === 'ja' ? 'en' : 'ja')}>
            {locale === 'ja' ? 'en' : 'ja'}
          </button>
        </div>
        <p>{t({ ja: 'アカウントでログインして、仕事を始めましょう。', en: 'Sign in to your account to get started.' })}</p>
        {search.reason === 'expired' ? (
          <p role="status" className="mb-3 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
            {t(S.sessionExpired)}
          </p>
        ) : null}
        <label htmlFor="email" className="block text-xs font-medium text-neutral-700">
          {t(S.email)}
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className="input mb-3" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <label htmlFor="password" className="block text-xs font-medium text-neutral-700">
          {t(S.password)}
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input mb-4" value={password} onChange={(e) => setPassword(e.target.value)} />
        <TenantChoice value={tenantId} onChange={setTenantId} />
        {err ? (
          <p role="alert" className="mb-3 rounded bg-red-50 px-2 py-1 text-xs text-red-800">
            {t(S.loginFailed)}: {isApiError(err) ? `${err.message} — ${err.hint}` : err.message}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary w-full justify-center" disabled={m.isPending}>
          {m.isPending ? t(S.loggingIn) : t(S.login)}
        </button>
      </form></div>
    </div>
  );
}
