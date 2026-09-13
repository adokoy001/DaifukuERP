import { useRef, useState, type ReactNode } from 'react';
import { stepUp } from '../api/identity.ts';
import { useLocale } from '../i18n.tsx';
import { ControlDialog } from './control-dialog.tsx';
export function IdentityStepUp({
  title,
  mfaEnabled,
  onClose,
  onVerified,
  onBusy,
  children,
}: {
  title: string;
  mfaEnabled: boolean;
  onClose: () => void;
  onVerified: (token: string) => Promise<void>;
  children?: ReactNode;
  onBusy?: (busy: boolean) => void;
}) {
  const { t } = useLocale();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    onBusy?.(true);
    setError(false);
    try {
      const result = await stepUp(password, code.trim() || undefined);
      setPassword('');
      setCode('');
      await onVerified(result.stepUpToken);
    } catch {
      setError(true);
      setCode('');
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusy?.(false);
    }
  };
  return (
    <ControlDialog title={title} onClose={onClose} busy={busy}>
      <form
        className="identity-step-up"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p>
          {t({
            ja: '大切な設定のため、現在のパスワードで本人確認します。',
            en: 'Confirm your current password before changing sensitive settings.',
          })}
        </p>
        <fieldset disabled={busy}>
          {children}
          <label>
            {t({ ja: '現在のパスワード', en: 'Current password' })}
            <input
              className="input"
              type="password"
              required
              maxLength={200}
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {mfaEnabled ? (
            <label>
              {t({ ja: '認証コード・回復コード', en: 'Authenticator or recovery code' })}
              <input
                className="input identity-code"
                required
                maxLength={100}
                autoComplete="one-time-code"
                spellCheck={false}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
          ) : null}
          {error ? (
            <p className="account-error" role="alert">
              {t({
                ja: '完了を確認できませんでした。入力・通信状況を確認してください。認証コードは新しく表示された値でやり直してください。',
                en: 'Could not confirm completion. Check your input and connection, then try a fresh authenticator code.',
              })}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button className="btn" type="button" onClick={onClose}>
              {t({ ja: '戻る', en: 'Go back' })}
            </button>
            <button className="btn btn-primary" type="submit">
              {t(busy ? { ja: '確認中…', en: 'Verifying…' } : { ja: '本人確認して続ける', en: 'Verify and continue' })}
            </button>
          </div>
        </fieldset>
      </form>
    </ControlDialog>
  );
}
