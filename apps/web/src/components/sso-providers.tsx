import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { identityProviders } from '../api/identity.ts';
import { startSso } from '../lib/identity-flow.ts';
import { useLocale } from '../i18n.tsx';
export function SsoProviders() {
  const { t } = useLocale(), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const providers = useQuery({ queryKey: ['identity-providers'], queryFn: identityProviders, retry: false, gcTime: 0 });
  const start = async (id: string) => { if (busy) return; setBusy(true); setError(false); try { await startSso(id); } catch { setError(true); setBusy(false); } };
  if (!providers.data?.items.length && !providers.isError) return null;
  return <section className="identity-sso"><p>{t({ ja: '組織のアカウントでログイン', en: 'Sign in with your organization' })}</p>{providers.data?.items.map((provider) => <button type="button" className="btn" disabled={busy} key={provider.id} onClick={() => void start(provider.id)}>{provider.label}</button>)}{providers.isError || error ? <p className="account-error" role="alert">{t({ ja: 'SSO情報を取得できません。再読込するか、パスワードでログインしてください。', en: 'SSO is unavailable. Reload or sign in with your password.' })}</p> : null}</section>;
}
