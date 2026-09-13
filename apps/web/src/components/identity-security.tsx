import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { clearSession, getToken, getUser } from '../api/client.ts';
import { accountSecurity, identityPost, identityProviders, type MfaSetup } from '../api/identity.ts';
import { rememberRecoveryCodes, startSso } from '../lib/identity-flow.ts';
import { useLocale } from '../i18n.tsx';
import { IdentityStepUp } from './identity-step-up.tsx';
import { MfaSetupDialog } from './mfa-setup-dialog.tsx';
import { Icon } from './icon.tsx';
import '../identity.css';

type Operation = { kind: 'setup' | 'disable' | 'recovery' } | { kind: 'link' | 'unlink'; providerId: string };
export function IdentitySecurity() {
  const { t } = useLocale(),
    qc = useQueryClient(),
    navigate = useNavigate();
  const [operation, setOperation] = useState<Operation | null>(null),
    [setup, setSetup] = useState<MfaSetup | null>(null),
    [leaving, setLeaving] = useState(false),
    [busy, setBusy] = useState(false);
  const info = useQuery({
    queryKey: ['account-security', getUser()?.id],
    queryFn: ({ signal }) => accountSecurity(signal),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: !operation && !setup && !leaving,
  });
  const providers = useQuery({ queryKey: ['identity-providers'], queryFn: identityProviders, retry: false });
  useBlocker({
    shouldBlockFn: () =>
      Boolean(getToken()) &&
      !leaving &&
      (busy ||
        (Boolean(operation || setup) &&
          !globalThis.confirm(
            t({
              ja: '認証設定を閉じて移動しますか？入力中の情報は破棄されます。',
              en: 'Leave security setup and discard the current input?',
            }),
          ))),
    enableBeforeUnload: !leaving && Boolean(operation || setup),
  });
  const signedOut = async (codes?: string[]) => {
    setLeaving(true);
    await qc.cancelQueries();
    clearSession();
    qc.clear();
    setOperation(null);
    setSetup(null);
    if (codes) {
      rememberRecoveryCodes(codes);
      await navigate({ to: '/auth/recovery-codes', replace: true });
    } else await navigate({ to: '/login', search: { reason: 'signed-out-all' }, replace: true });
  };
  const verified = async (stepUpToken: string) => {
    if (!operation) return;
    if (operation.kind === 'setup') {
      const next = await identityPost<MfaSetup>('mfa/setup', { stepUpToken });
      setOperation(null);
      setSetup(next);
    } else if (operation.kind === 'link') {
      setLeaving(true);
      try {
        await startSso(operation.providerId, stepUpToken);
      } catch (error) {
        setLeaving(false);
        throw error;
      }
    } else if (operation.kind === 'recovery') {
      const result = await identityPost<{ recoveryCodes: string[] }>('mfa/recovery-codes', { stepUpToken });
      await signedOut(result.recoveryCodes);
    } else {
      await identityPost(operation.kind === 'disable' ? 'mfa/disable' : 'oidc/unlink', {
        stepUpToken,
        ...('providerId' in operation ? { providerId: operation.providerId } : {}),
      });
      await signedOut();
    }
  };
  return (
    <section className="account-card identity-card" aria-labelledby="identity-security-title">
      <div className="account-card-heading">
        <span className="icon-tile tone-violet">
          <Icon name="settings" />
        </span>
        <div>
          <h2 id="identity-security-title">{t({ ja: '二段階認証とSSO', en: 'Two-step verification and SSO' })}</h2>
          <p>
            {t({
              ja: '認証アプリと組織アカウントで、自分のアクセスを守る。',
              en: 'Protect your access with an authenticator and your organization account.',
            })}
          </p>
        </div>
      </div>
      {info.isError ? (
        <p className="account-error" role="alert">
          {t({ ja: '認証設定を取得できません。', en: 'Could not load security settings.' })}
          <button className="btn" onClick={() => void info.refetch()}>
            {t({ ja: '再読込', en: 'Retry' })}
          </button>
        </p>
      ) : info.data ? (
        <>
          <div className="identity-status">
            <span className={'status-pill ' + (info.data.mfaEnabled ? 'is-good' : 'is-muted')}>
              {t(
                info.data.mfaEnabled
                  ? { ja: '二段階認証 有効', en: 'MFA enabled' }
                  : { ja: '二段階認証 未登録', en: 'MFA not enabled' },
              )}
            </span>
            {info.data.mfaEnabled ? (
              <span>
                {t({
                  ja: `回復コード 残り${info.data.recoveryCodesRemaining}件`,
                  en: `${info.data.recoveryCodesRemaining} recovery codes remaining`,
                })}
              </span>
            ) : null}
          </div>
          {!info.data.configured ? (
            <p className="notice">
              {t({
                ja: '認証機能の導入設定が必要です。運用管理者が暗号鍵と公開URLを設定すると登録できます。',
                en: 'An operator must configure the identity encryption key and public URL before setup is available.',
              })}
            </p>
          ) : (
            <div className="identity-actions">
              {info.data.mfaEnabled ? (
                <>
                  <button className="btn" onClick={() => setOperation({ kind: 'recovery' })}>
                    {t({ ja: '回復コードを再発行', en: 'Replace recovery codes' })}
                  </button>
                  <button className="btn" onClick={() => setOperation({ kind: 'disable' })}>
                    {t({ ja: '二段階認証を解除', en: 'Disable MFA' })}
                  </button>
                </>
              ) : (
                <button className="btn btn-primary" onClick={() => setOperation({ kind: 'setup' })}>
                  {t({ ja: '認証アプリを登録', en: 'Set up authenticator' })}
                </button>
              )}
            </div>
          )}
          <h3 className="mt-4">{t({ ja: '組織アカウントの紐付け', en: 'Linked organization accounts' })}</h3>
          <p className="account-help">
            {t({
              ja: '紐付け後はログイン画面からSSOを利用できます。会社での権限は管理者が管理します。本人確認用のパスワードも引き続き保管してください。',
              en: 'After linking, use SSO from the sign-in screen. Administrators manage company roles. Keep your password for security checks.',
            })}
          </p>
          {(providers.data?.items ?? []).map((provider) => {
            const linked = info.data.identities.some((item) => item.providerId === provider.id);
            return (
              <div className="identity-provider" key={provider.id}>
                <strong>{provider.label}</strong>
                <button
                  className="btn"
                  disabled={!info.data.configured}
                  onClick={() => setOperation({ kind: linked ? 'unlink' : 'link', providerId: provider.id })}
                >
                  {t(
                    linked
                      ? { ja: '紐付けを解除', en: 'Unlink' }
                      : { ja: '組織アカウントを紐付け', en: 'Link organization account' },
                  )}
                </button>
              </div>
            );
          })}
          {providers.isError ? (
            <p role="alert">
              {t({
                ja: 'SSO設定を取得できません。再読込してください。',
                en: 'Could not load SSO providers. Please reload.',
              })}
            </p>
          ) : !providers.data?.items.length ? (
            <p className="muted">
              {t({ ja: 'SSO接続先はまだ設定されていません。', en: 'No SSO provider has been configured yet.' })}
            </p>
          ) : null}
        </>
      ) : (
        <p role="status">{t({ ja: '読込中…', en: 'Loading…' })}</p>
      )}
      {operation ? (
        <IdentityStepUp
          title={t({ ja: '認証設定の本人確認', en: 'Verify security changes' })}
          mfaEnabled={info.data?.mfaEnabled ?? false}
          onClose={() => setOperation(null)}
          onVerified={verified}
          onBusy={setBusy}
        >
          {operation.kind === 'disable' ? (
            <p className="notice">
              {t({
                ja: '解除するとログイン時の追加確認がなくなり、全端末からログアウトします。',
                en: 'Disabling MFA removes the extra sign-in check and signs out all devices.',
              })}
            </p>
          ) : operation.kind === 'recovery' ? (
            <p className="notice">
              {t({
                ja: '現在の回復コードはすべて無効になります。新しいコードを安全に保管してください。',
                en: 'All existing recovery codes will stop working. Store the new set safely.',
              })}
            </p>
          ) : null}
        </IdentityStepUp>
      ) : null}
      {setup ? (
        <MfaSetupDialog setup={setup} onClose={() => setSetup(null)} onComplete={signedOut} onBusy={setBusy} />
      ) : null}
    </section>
  );
}
