import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { accountSecurity, identityPost } from '../api/identity.ts';
import { getUser } from '../api/client.ts';
import type { AccessEditorStatus } from '../api/access.ts';
import { useLocale } from '../i18n.tsx';
import { IdentityStepUp } from './identity-step-up.tsx';
import '../identity.css';
export function AccessInviteUser({
  onClose,
  onStatus,
}: {
  onClose: () => void;
  onStatus: (status: AccessEditorStatus) => void;
}) {
  const { t } = useLocale();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState<string | null>(null);
  const security = useQuery({
    queryKey: ['account-security', getUser()?.id],
    queryFn: ({ signal }) => accountSecurity(signal),
    gcTime: 0,
    retry: false,
  });
  useEffect(() => {
    onStatus({ dirty: Boolean(email || name) && !delivery, busy });
    return () => onStatus({ dirty: false, busy: false });
  }, [email, name, delivery, busy, onStatus]);
  const invite = async (stepUpToken: string) => {
    const result = await identityPost<{ ok: true; userId: string; delivery: 'queued' | 'unconfigured' }>(
      'invitations',
      { email, name, stepUpToken },
    );
    setDelivery(result.delivery);
    setEmail('');
    setName('');
    await qc.invalidateQueries({ queryKey: ['access'] });
  };
  if (delivery)
    return (
      <section className="access-panel">
        <h2>{t({ ja: '招待を作成しました', en: 'Invitation created' })}</h2>
        <p role="status" className="notice">
          {t(
            delivery === 'queued'
              ? {
                  ja: '招待メールを配送待ちに登録しました。届いたリンクから本人がパスワードを設定します。受理後に、利用者一覧で会社と業務権限を割り当ててください。',
                  en: 'The invitation is queued for delivery. The recipient sets a password from the link. Assign company roles in the user directory after acceptance.',
                }
              : {
                  ja: '招待は作成しましたが、メール配送が未設定です。運用管理者がSMTPを設定し、期限内に配送処理を実行してください。期限切れの場合、同じメールアドレスで招待を作成し直せます。',
                  en: 'The invitation exists, but mail delivery is not configured. An operator must configure SMTP and run delivery before expiry. After expiry, create another invitation for the same email address.',
                },
          )}
        </p>
        <button className="btn" onClick={onClose}>
          {t({ ja: '閉じる', en: 'Close' })}
        </button>
      </section>
    );
  if (!security.data)
    return (
      <section className="access-panel">
        <p role={security.isError ? 'alert' : 'status'}>
          {t(
            security.isError
              ? { ja: '認証設定を取得できません。', en: 'Could not load security settings.' }
              : { ja: '招待の準備中…', en: 'Preparing invitation…' },
          )}
        </p>
        <button className="btn" onClick={onClose}>
          {t({ ja: '閉じる', en: 'Close' })}
        </button>
      </section>
    );
  if (!security.data.configured)
    return (
      <section className="access-panel">
        <p role="alert">
          {t({
            ja: '招待メールには認証基盤の設定が必要です。運用管理者に公開URLと暗号鍵の設定を依頼してください。',
            en: 'Invitation emails need identity configuration. Ask an operator to set the public URL and encryption key.',
          })}
        </p>
        <button className="btn" onClick={onClose}>
          {t({ ja: '閉じる', en: 'Close' })}
        </button>
      </section>
    );
  return (
    <IdentityStepUp
      title={t({ ja: 'メールで利用者を招待', en: 'Invite a user by email' })}
      mfaEnabled={security.data.mfaEnabled}
      onClose={onClose}
      onBusy={setBusy}
      onVerified={invite}
    >
      <label>
        {t({ ja: '招待する方の氏名', en: 'Invitee name' })}
        <input
          className="input"
          required
          maxLength={200}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label>
        {t({ ja: '招待先メールアドレス', en: 'Invitee email' })}
        <input
          className="input"
          type="email"
          autoComplete="off"
          required
          maxLength={200}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <p className="account-help">
        {t({
          ja: '本人が24時間以内にリンクから登録します。会社権限は登録後に割り当てます。未受理の招待は同じメールアドレスで再発行できます。再発行すると古いリンクは無効になります。',
          en: 'The recipient activates the account within 24 hours. Assign company permissions after activation. Reissuing an unaccepted invitation for the same email invalidates the old link.',
        })}
      </p>
    </IdentityStepUp>
  );
}
