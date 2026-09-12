import { useCallback, useState } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { useAccessAudit, useAccessCatalog, type AccessCatalog, type AccessEditorStatus } from '../api/access.ts';
import { useMe } from '../api/company.tsx';
import { getUser } from '../api/client.ts';
import { AccessInviteUser } from '../components/access-invite-user.tsx';
import { AccessCreateUser } from '../components/access-create-user.tsx';
import { AccessMemberships } from '../components/access-memberships.tsx';
import { AccessUserProfile } from '../components/access-user-profile.tsx';
import { accessRoleLabel } from '../components/access-role-options.tsx';
import { Icon } from '../components/icon.tsx';
import { useLocale } from '../i18n.tsx';
import { LoadingView, MetaError } from './status-views.tsx';
export function AccessPage() {
  const { t } = useLocale();
  const me = useMe();
  const catalog = useAccessCatalog(me.data?.user.tenantAdmin === true);
  const [query, setQuery] = useState(''), [selected, setSelected] = useState(() => getUser()?.id ?? ''), [creating, setCreating] = useState(false), [inviting, setInviting] = useState(false);
  const [profile, setProfile] = useState<AccessEditorStatus>({ dirty: false, busy: false }), [membership, setMembership] = useState<AccessEditorStatus>({ dirty: false, busy: false }), [creation, setCreation] = useState<AccessEditorStatus>({ dirty: false, busy: false });
  const profileStatus = useCallback((status: AccessEditorStatus) => setProfile(status), []);
  const membershipStatus = useCallback((status: AccessEditorStatus) => setMembership(status), []);
  const creationStatus = useCallback((status: AccessEditorStatus) => setCreation(status), []);
  const dirty = profile.dirty || membership.dirty || creation.dirty;
  const busy = profile.busy || membership.busy || creation.busy;
  const discard = () => globalThis.confirm(t({ ja: '未保存の変更があります。破棄して移動しますか？', en: 'Discard your unsaved changes and leave?' }));
  useBlocker({ shouldBlockFn: () => busy || (dirty && !discard()), enableBeforeUnload: busy || dirty });
  const choose = (id: string) => { if (!busy && ((!profile.dirty && !membership.dirty) || discard())) setSelected(id); };
  if (me.isError && !me.data) return <MetaError error={me.error} retry={() => void me.refetch()} />;
  if (!me.data) return <LoadingView />;
  if (!me.data.user.tenantAdmin) return <div role="alert" className="workspace-page">{t({ ja: '利用者と所属の管理はテナント管理者だけが行えます。', en: 'Only tenant administrators can manage users and memberships.' })}</div>;
  if (catalog.isError && !catalog.data) return <MetaError error={catalog.error} retry={() => void catalog.refetch()} />;
  if (!catalog.data) return <LoadingView />;
  const data = catalog.data;
  const users = data.users.filter((user) => (user.name + ' ' + user.email).toLowerCase().includes(query.toLowerCase()));
  // Searching the directory never silently switches or unmounts the selected editor.
  const user = data.users.find((item) => item.id === selected) ?? data.users[0];
  return <div className="workspace-page access-page">
    {catalog.isError || me.isError ? <div className="notice-strip" role="alert">{t({ ja: '最新情報を取得できませんでした。入力内容は保持しています。', en: 'Could not refresh current information. Your edits are preserved.' })}<button className="btn" onClick={() => { void me.refetch(); void catalog.refetch(); }}>{t({ ja: '再読込', en: 'Retry' })}</button></div> : null}
    <header className="control-heading"><div><span className="eyebrow">PEOPLE & ACCESS</span><h1>{t({ ja: '人と仕事を、適切につなぐ。', en: 'The right access for every person.' })}</h1><p>{t({ ja: '利用者の状態、会社での役割、担当店舗をひとつの画面で管理します。', en: 'Manage users, company roles and store assignments in one place.' })}</p></div><span className="control-heading-icon"><Icon name="people" size={36} /></span></header>
    <div className="control-summary"><span><b>{data.users.filter((u) => u.active).length}</b>{t({ ja: '有効な利用者', en: 'Active users' })}</span><span><b>{data.companies.length}</b>{t({ ja: '会社', en: 'Companies' })}</span><span><b>{data.memberships.filter((m) => m.accessScope === 'stores').length}</b>{t({ ja: '店舗限定の所属', en: 'Store-scoped memberships' })}</span><button className="btn btn-primary" disabled={busy || creating || inviting} onClick={() => setCreating(true)}>{t({ ja: '利用者を追加', en: 'Add user' })}</button><button className="btn" disabled={busy || creating || inviting} onClick={() => setInviting(true)}>{t({ ja: 'メールで招待', en: 'Invite by email' })}</button></div>
    {inviting ? <AccessInviteUser onClose={() => setInviting(false)} onStatus={creationStatus} /> : null}
    {creating ? <AccessCreateUser onClose={() => setCreating(false)} onStatus={creationStatus} /> : null}
    <div className="access-workspace"><section className="access-panel access-directory"><h2>{t({ ja: '利用者一覧', en: 'User directory' })}</h2><input className="input" type="search" aria-label={t({ ja: '利用者を検索', en: 'Search users' })} placeholder={t({ ja: '氏名・メールアドレス', en: 'Name or email' })} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="access-user-list">{users.map((item) => <button key={item.id} disabled={busy} className={'access-user ' + (user?.id === item.id ? 'is-selected' : '')} onClick={() => { if (user?.id !== item.id) choose(item.id); }} aria-pressed={user?.id === item.id}><span className="user-avatar">{item.name.slice(0, 1)}</span><span><strong>{item.name}</strong><small>{item.email}</small><span className={'status-pill ' + (item.active ? 'is-good' : 'is-muted')}>{t(item.active ? { ja: '有効', en: 'Active' } : { ja: '無効', en: 'Inactive' })}</span>{item.tenantAdmin ? <span className="status-pill">{t({ ja: 'テナント管理者', en: 'Tenant admin' })}</span> : null}</span></button>)}</div>{users.length === 0 ? <p>{t({ ja: '一致する利用者はいません。', en: 'No matching users.' })}</p> : null}
    </section><div className="access-details">{user ? <><AccessUserProfile key={'profile/' + user.id} user={user} onStatus={profileStatus} /><AccessMemberships key={'membership/' + user.id} user={user} catalog={data} onStatus={membershipStatus} /><AccessAuditPanel key={'audit/' + user.id} userId={user.id} catalog={data} /></> : null}</div></div>
  </div>;
}

const auditLabels: Record<string, { ja: string; en: string }> = { name: { ja: '表示名', en: 'Name' }, email: { ja: 'メール', en: 'Email' }, active: { ja: '有効', en: 'Active' }, tenantAdmin: { ja: 'テナント管理者', en: 'Tenant admin' }, roles: { ja: '業務ロール', en: 'Roles' }, accessScope: { ja: 'アクセス範囲', en: 'Scope' }, storeIds: { ja: '担当店舗', en: 'Stores' }, companyId: { ja: '会社', en: 'Company' }, defaultCompanyId: { ja: '既定の会社', en: 'Default company' }, passwordChanged: { ja: 'パスワード変更', en: 'Password changed' } };
function AccessAuditPanel({ userId, catalog }: { userId: string; catalog: AccessCatalog }) {
  const { t } = useLocale();
  const query = useAccessAudit(userId);
  const display = (key: string, value: unknown): string => {
    if (value === null || value === undefined) return '—';
    if (key === 'roles' && Array.isArray(value)) return value.map((r) => t(accessRoleLabel(String(r)))).join(', ');
    if (key === 'storeIds' && Array.isArray(value)) return value.map((id) => catalog.stores.find((s) => s.id === id)?.name ?? String(id)).join(', ') || '—';
    if (key === 'companyId' || key === 'defaultCompanyId') return catalog.companies.find((c) => c.id === value)?.name ?? String(value);
    if (key === 'accessScope') return t(value === 'stores' ? { ja: '指定店舗のみ', en: 'Selected stores' } : { ja: '会社全体', en: 'Entire company' });
    if (typeof value === 'boolean') return t(value ? { ja: 'はい', en: 'Yes' } : { ja: 'いいえ', en: 'No' });
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  };
  return <section className="access-panel access-audit"><h2>{t({ ja: 'アクセス変更の履歴', en: 'Access change history' })}</h2><p className="muted">{t({ ja: '直近100件。パスワードそのものは記録・表示しません。', en: 'Latest 100 changes. Password values are never logged or displayed.' })}</p>
    {query.isError ? <p role="alert">{t({ ja: '履歴を取得できませんでした。', en: 'Could not load history.' })}<button className="btn" onClick={() => void query.refetch()}>{t({ ja: '再読込', en: 'Retry' })}</button></p> : query.isPending ? <p>{t({ ja: '読込中…', en: 'Loading…' })}</p> : query.data.items.length === 0 ? <p>{t({ ja: '変更履歴はありません。', en: 'No access changes recorded.' })}</p> : query.data.items.map((entry) => {
      const keys = [...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})])].filter((key) => !['id', 'userId', 'version'].includes(key) && JSON.stringify(entry.before?.[key]) !== JSON.stringify(entry.after?.[key]));
      const actor = catalog.users.find((u) => u.id === (entry.onBehalfOf ?? entry.actorId))?.name ?? entry.actorId;
      return <details key={entry.id}><summary>{new Date(entry.at).toLocaleString()} · {t(entry.entity === 'company_membership' ? { ja: '会社所属', en: 'Membership' } : { ja: '利用者情報', en: 'User profile' })} · {actor}</summary><div className="table-scroll"><table className="data-table"><thead><tr><th>{t({ ja: '項目', en: 'Field' })}</th><th>{t({ ja: '変更前', en: 'Before' })}</th><th>{t({ ja: '変更後', en: 'After' })}</th></tr></thead><tbody>{keys.map((key) => <tr key={key}><th>{auditLabels[key] ? t(auditLabels[key]) : key}</th><td>{display(key, entry.before?.[key])}</td><td>{display(key, entry.after?.[key])}</td></tr>)}</tbody></table></div></details>;
    })}
  </section>;
}
