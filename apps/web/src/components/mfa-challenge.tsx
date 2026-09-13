import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { verifyMfa, type MfaChallenge as Challenge } from '../api/identity.ts';
import type { LoginResponse } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
export function MfaChallenge({
  challenge,
  onSuccess,
  onCancel,
}: {
  challenge: Challenge;
  onSuccess: (result: LoginResponse) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLocale(),
    [code, setCode] = useState('');
  const mutation = useMutation({
    mutationFn: () => verifyMfa(challenge.challengeToken, code.trim()),
    onSuccess,
    onError: () => setCode(''),
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      aria-label={t({ ja: '二段階認証', en: 'Two-step verification' })}
    >
      <h1>{t({ ja: 'もう一度、本人確認', en: 'One more security check' })}</h1>
      <p>
        {t({
          ja: '認証アプリの6桁コード、または未使用の回復コードを入力してください。',
          en: 'Enter a six-digit authenticator code or an unused recovery code.',
        })}
      </p>
      <label htmlFor="login-mfa-code">
        {t({ ja: '認証コード・回復コード', en: 'Authenticator or recovery code' })}
      </label>
      <input
        id="login-mfa-code"
        className="input identity-code"
        autoComplete="one-time-code"
        autoCapitalize="off"
        spellCheck={false}
        autoFocus
        required
        maxLength={100}
        value={code}
        onChange={(event) => setCode(event.target.value)}
        disabled={mutation.isPending}
      />
      {mutation.isError ? (
        <p className="account-error" role="alert">
          {t({
            ja: 'コードを確認してください。期限切れの場合はログインからやり直してください。',
            en: 'Check your code. If this request expired, start from sign in again.',
          })}
        </p>
      ) : null}
      <button className="btn btn-primary" disabled={mutation.isPending}>
        {t({ ja: '確認してログイン', en: 'Verify and sign in' })}
      </button>
      <button className="btn" type="button" disabled={mutation.isPending} onClick={onCancel}>
        {t({ ja: 'ログインからやり直す', en: 'Start again' })}
      </button>
    </form>
  );
}
