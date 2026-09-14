import { useEffect, useState, type FormEvent } from 'react';
import { useAccessMutation, type AccessEditorStatus } from '../api/access.ts';
import { useLocale } from '../i18n.tsx';
import { useToast } from './toast.tsx';
export function AccessCreateUser({
  onClose,
  onStatus,
}: {
  onClose: () => void;
  onStatus: (status: AccessEditorStatus) => void;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const mutation = useAccessMutation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantAdmin, setTenantAdmin] = useState(false);
  const dirty = name.length > 0 || email.length > 0 || password.length > 0 || tenantAdmin;
  useEffect(() => {
    onStatus({ dirty, busy: mutation.isPending });
    return () => onStatus({ dirty: false, busy: false });
  }, [dirty, mutation.isPending, onStatus]);
  const close = () => {
    if (
      !dirty ||
      globalThis.confirm(t({ ja: '入力中の新規利用者情報を破棄しますか？', en: 'Discard the new user details?' }))
    )
      onClose();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (mutation.isPending) return;
    mutation.mutate(
      { path: '/admin/users', method: 'POST', body: { name, email, password, tenantAdmin } },
      {
        onSuccess: () => {
          setPassword('');
          toast.success(
            t({
              ja: '利用者を作成しました。会社への所属を設定してください。',
              en: 'User created. Assign a company membership next.',
            }),
          );
          onClose();
        },
        onError: (e) => toast.error(e),
      },
    );
  };
  return (
    <form
      className="access-panel access-create"
      onSubmit={submit}
      aria-label={t({ ja: '利用者の新規作成', en: 'Create a user' })}
    >
      <h2>{t({ ja: '利用者を追加', en: 'Add a user' })}</h2>
      <div className="access-form-grid">
        <label>
          {t({ ja: '氏名', en: 'Name' })}
          <input
            className="input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={mutation.isPending}
          />
        </label>
        <label>
          {t({ ja: 'メールアドレス', en: 'Email' })}
          <input
            className="input"
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={mutation.isPending}
          />
        </label>
        <label>
          {t({ ja: '初期パスワード', en: 'Initial password' })}
          <input
            className="input"
            type="password"
            required
            minLength={12}
            maxLength={200}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={mutation.isPending}
          />
        </label>
      </div>
      <small>
        {t({
          ja: '12文字以上。作成通知メールは送信されません。',
          en: 'At least 12 characters. No invitation email is sent.',
        })}
      </small>
      <label className="access-check">
        <input
          type="checkbox"
          checked={tenantAdmin}
          onChange={(e) => setTenantAdmin(e.target.checked)}
          disabled={mutation.isPending}
        />
        {t({
          ja: 'テナント管理者にする（全会社・利用者を管理）',
          en: 'Tenant administrator — manages all companies and users',
        })}
      </label>
      <div className="button-row">
        <button className="btn btn-primary" disabled={mutation.isPending}>
          {t({ ja: '利用者を作成', en: 'Create user' })}
        </button>
        <button className="btn" type="button" disabled={mutation.isPending} onClick={close}>
          {t({ ja: '閉じる', en: 'Close' })}
        </button>
      </div>
    </form>
  );
}
