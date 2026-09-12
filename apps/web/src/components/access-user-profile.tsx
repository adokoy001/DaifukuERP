import { useEffect, useState, type FormEvent } from 'react';
import { useAccessMutation, type AccessEditorStatus, type AccessUser } from '../api/access.ts';
import { getUser } from '../api/client.ts';
import { useLocale } from '../i18n.tsx';
import { ActionConfirm } from './action-confirm.tsx';
import { useToast } from './toast.tsx';
export function AccessUserProfile({ user, onStatus }: { user: AccessUser; onStatus: (status: AccessEditorStatus) => void }) {
  const { t } = useLocale();
  const toast = useToast();
  const mutation = useAccessMutation();
  const self = getUser()?.id === user.id;
  const [baseline, setBaseline] = useState(user);
  const [name, setName] = useState(user.name), [active, setActive] = useState(user.active), [tenantAdmin, setTenantAdmin] = useState(user.tenantAdmin), [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const changed = name !== baseline.name || active !== baseline.active || tenantAdmin !== baseline.tenantAdmin || password.length > 0;
  const stale = baseline.version !== user.version;
  const busy = mutation.isPending || pending;
  useEffect(() => { onStatus({ dirty: changed, busy }); return () => onStatus({ dirty: false, busy: false }); }, [changed, busy, onStatus]);
  const reset = (fresh: AccessUser) => { setBaseline(fresh); setName(fresh.name); setActive(fresh.active); setTenantAdmin(fresh.tenantAdmin); setPassword(''); };
  const reload = () => { if (!changed || globalThis.confirm(t({ ja: '入力中の変更を破棄して、最新の利用者情報を読み込みますか？', en: 'Discard your edits and load the latest user profile?' }))) reset(user); };
  const submit = (e: FormEvent) => { e.preventDefault(); if (changed && !busy && !stale) setPending(true); };
  const save = () => {
    setPending(false);
    mutation.mutate({ path: '/admin/users/' + user.id, method: 'PATCH', body: { expectedVersion: baseline.version, name, ...(!self ? { active, tenantAdmin } : {}), ...(password ? { password } : {}) } }, { onSuccess: (data) => { reset(data as AccessUser); toast.success(t({ ja: '利用者情報を更新しました', en: 'User updated' })); }, onError: (e) => toast.error(e) });
  };
  return <><form className="access-panel" onSubmit={submit} aria-label={t({ ja: '利用者情報', en: 'User profile' })}>
    <h2>{user.name}</h2><p className="muted">{user.email}</p>
    {stale ? <div className="notice-strip" role="status">{t({ ja: '別の操作で情報が更新されました。入力内容は保持しています。最新情報を読み直して変更を確認してください。', en: 'This profile changed elsewhere. Your edits are preserved. Reload and review the latest values.' })}<button type="button" className="btn" disabled={busy} onClick={reload}>{t({ ja: '最新情報を読み込む', en: 'Reload latest' })}</button></div> : null}
    <label>{t({ ja: '表示名', en: 'Display name' })}<input className="input" required value={name} disabled={mutation.isPending} onChange={(e) => setName(e.target.value)} /></label>
    <div className="access-role-options"><label><input type="checkbox" checked={active} disabled={self || mutation.isPending} onChange={(e) => setActive(e.target.checked)} />{t({ ja: '有効な利用者', en: 'Active user' })}</label><label><input type="checkbox" checked={tenantAdmin} disabled={self || mutation.isPending} onChange={(e) => setTenantAdmin(e.target.checked)} />{t({ ja: 'テナント管理者', en: 'Tenant administrator' })}</label></div>
    <label>{t({ ja: '新しいパスワード（変更時だけ）', en: 'New password (optional)' })}<input className="input" type="password" minLength={12} maxLength={200} autoComplete="new-password" value={password} disabled={mutation.isPending} onChange={(e) => setPassword(e.target.value)} /></label>
    <small>{t({ ja: '権限・有効状態・パスワードの変更は、利用中のセッションにも反映されます。', en: 'Access, active status and password changes also affect existing sessions.' })}</small>
    {self ? <small>{t({ ja: '自分自身の管理者権限・有効状態・会社所属は変更できません。', en: 'You cannot change your own administrator status, active status or memberships.' })}</small> : null}
    <button className="btn btn-primary" disabled={!changed || mutation.isPending || stale}>{t({ ja: '利用者情報を保存', en: 'Save profile' })}</button>
  </form>{pending ? <ActionConfirm title={t({ ja: '利用者情報を更新', en: 'Update user' })} message={user.name + '：' + t({ ja: '入力した利用者情報とアクセス設定を適用します。', en: 'Apply the entered profile and access settings.' })} destructive={!active || tenantAdmin !== baseline.tenantAdmin} cancelDocument={false} onConfirm={save} onClose={() => setPending(false)} /> : null}
  </>;
}
