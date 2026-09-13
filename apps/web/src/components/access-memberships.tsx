import { useEffect, useState, type FormEvent } from 'react';
import {
  useAccessMutation,
  type AccessCatalog,
  type AccessEditorStatus,
  type AccessUser,
  type Membership,
} from '../api/access.ts';
import { getUser } from '../api/client.ts';
import { useLocale } from '../i18n.tsx';
import { AccessRoleOptions } from './access-role-options.tsx';
import { ActionConfirm } from './action-confirm.tsx';
import { useToast } from './toast.tsx';
const signature = (roles: string[], scope: string, stores: string[], sites: string[]) =>
  JSON.stringify([
    [...roles].sort(),
    scope,
    scope !== 'all' ? [...stores].sort() : [],
    scope === 'sites' ? [...sites].sort() : [],
  ]);
function MembershipEditor({
  user,
  catalog,
  companyId,
  current,
  onStatus,
}: {
  user: AccessUser;
  catalog: AccessCatalog;
  companyId: string;
  current: Membership | undefined;
  onStatus: (status: AccessEditorStatus) => void;
}) {
  const { t } = useLocale();
  const toast = useToast();
  const mutation = useAccessMutation();
  const self = user.id === getUser()?.id;
  const [baseline, setBaseline] = useState(current);
  const [roles, setRoles] = useState(current?.roles ?? []),
    [scope, setScope] = useState<Membership['accessScope']>(current?.accessScope ?? 'all'),
    [storeIds, setStoreIds] = useState(current?.storeIds ?? []),
    [siteIds, setSiteIds] = useState(current?.siteIds ?? []);
  const [pending, setPending] = useState<'save' | 'remove'>();
  const company = catalog.companies.find((c) => c.id === companyId);
  const stores = catalog.stores.filter((store) => store.companyId === companyId);
  const sites = (catalog.sites ?? []).filter((site) => site.companyId === companyId);
  const changed =
    signature(roles, scope, storeIds, siteIds) !==
    signature(baseline?.roles ?? [], baseline?.accessScope ?? 'all', baseline?.storeIds ?? [], baseline?.siteIds ?? []);
  const stale = (current?.version ?? 0) !== (baseline?.version ?? 0);
  const busy = mutation.isPending || pending !== undefined;
  const invalidStoreRoles = scope === 'stores' && roles.some((r) => !['chain_staff', 'chain_manager'].includes(r));
  const invalidSiteRoles =
    scope === 'sites' &&
    roles.some(
      (r) =>
        ![
          'workforce_employee',
          'workforce_manager',
          'chain_staff',
          'chain_manager',
          'edge_manager',
          'edge_operator',
        ].includes(r),
    );
  const invalid =
    invalidStoreRoles ||
    invalidSiteRoles ||
    (scope === 'stores' && storeIds.length === 0) ||
    (scope === 'sites' && siteIds.length === 0);
  useEffect(() => {
    onStatus({ dirty: changed, busy });
    return () => onStatus({ dirty: false, busy: false });
  }, [changed, busy, onStatus]);
  const reset = (fresh: Membership | undefined) => {
    setBaseline(fresh);
    setRoles(fresh?.roles ?? []);
    setScope(fresh?.accessScope ?? 'all');
    setStoreIds(fresh?.storeIds ?? []);
    setSiteIds(fresh?.siteIds ?? []);
  };
  const reload = () => {
    if (
      !changed ||
      globalThis.confirm(
        t({
          ja: '入力中の変更を破棄して、最新の会社所属を読み込みますか？',
          en: 'Discard your edits and load the latest membership?',
        }),
      )
    )
      reset(current);
  };
  const save = () => {
    const remove = pending === 'remove';
    setPending(undefined);
    mutation.mutate(
      {
        path: '/admin/users/' + user.id + '/companies/' + companyId,
        method: remove ? 'DELETE' : 'PUT',
        body: {
          expectedVersion: baseline?.version ?? 0,
          ...(!remove
            ? {
                roles,
                accessScope: scope,
                storeIds: scope !== 'all' ? storeIds : [],
                siteIds: scope === 'sites' ? siteIds : [],
              }
            : {}),
        },
      },
      {
        onSuccess: (data) => {
          reset(remove ? undefined : (data as Membership));
          toast.success(t({ ja: '会社へのアクセス設定を更新しました', en: 'Company access updated' }));
        },
        onError: (e) => toast.error(e),
      },
    );
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy && !self && changed && !stale && !invalid && roles.length > 0) setPending('save');
  };
  return (
    <>
      <form
        className="access-membership-form"
        onSubmit={submit}
        aria-label={t({ ja: '会社へのアクセス設定', en: 'Company access' })}
      >
        <h3>{company?.name}</h3>
        <p className="muted">
          {t(
            current
              ? { ja: 'この会社に所属しています', en: 'This user is a member of this company' }
              : { ja: 'この会社への所属はまだありません', en: 'No membership in this company yet' },
          )}
        </p>
        {stale ? (
          <div className="notice-strip" role="status">
            {t({
              ja: '所属が別の操作で更新されました。入力は保持しています。最新情報を読み直してください。',
              en: 'This membership changed elsewhere. Your edits are preserved. Reload before saving.',
            })}
            <button type="button" className="btn" disabled={busy} onClick={reload}>
              {t({ ja: '最新情報を読み込む', en: 'Reload latest' })}
            </button>
          </div>
        ) : null}
        <fieldset disabled={self || mutation.isPending}>
          <legend>{t({ ja: '業務ロール', en: 'Business roles' })}</legend>
          <AccessRoleOptions
            options={catalog.roles}
            value={roles}
            onChange={setRoles}
            disabled={self || mutation.isPending}
          />
        </fieldset>
        <label>
          {t({ ja: '店舗のアクセス範囲', en: 'Store access scope' })}
          <select
            className="input"
            aria-label={t({ ja: '店舗のアクセス範囲', en: 'Store access scope' })}
            value={scope}
            disabled={self || mutation.isPending}
            onChange={(e) => setScope(e.target.value as Membership['accessScope'])}
          >
            <option value="all">{t({ ja: '会社全体', en: 'Entire company' })}</option>
            <option value="stores">{t({ ja: '指定した店舗のみ', en: 'Selected stores only' })}</option>
            <option value="sites">
              {t({ ja: '指定した拠点のみ（人事・勤怠・機器）', en: 'Selected workforce/device sites only' })}
            </option>
          </select>
        </label>
        {scope === 'sites' ? (
          <>
            <fieldset disabled={self || mutation.isPending}>
              <legend>{t({ ja: '許可する拠点', en: 'Allowed workforce sites' })}</legend>
              <div className="access-role-options">
                {sites.map((site) => (
                  <label key={site.id}>
                    <input
                      type="checkbox"
                      checked={siteIds.includes(site.id)}
                      onChange={(e) =>
                        setSiteIds(e.target.checked ? [...siteIds, site.id] : siteIds.filter((id) => id !== site.id))
                      }
                    />
                    {site.name}
                  </label>
                ))}
              </div>
              {sites.length === 0 ? (
                <p>{t({ ja: '先に従業員管理で拠点を作成してください。', en: 'Create workforce sites first.' })}</p>
              ) : null}
            </fieldset>
            {roles.some((role) => role.startsWith('chain_')) ? (
              <fieldset disabled={self || mutation.isPending}>
                <legend>
                  {t({ ja: '兼務する飲食チェーン店舗（任意）', en: 'Additional restaurant stores (optional)' })}
                </legend>
                <div className="access-role-options">
                  {stores.map((store) => (
                    <label key={store.id}>
                      <input
                        type="checkbox"
                        checked={storeIds.includes(store.id)}
                        onChange={(e) =>
                          setStoreIds(
                            e.target.checked ? [...storeIds, store.id] : storeIds.filter((id) => id !== store.id),
                          )
                        }
                      />
                      {store.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <small>
              {t({
                ja: '従業員本人は自分の記録だけ、拠点管理者は選択した拠点だけを扱います。',
                en: 'Employees access only their own records. Managers access only selected sites.',
              })}
            </small>
          </>
        ) : null}
        {scope === 'stores' ? (
          <fieldset disabled={self || mutation.isPending}>
            <legend>{t({ ja: '許可する店舗', en: 'Allowed stores' })}</legend>
            <div className="access-role-options">
              {stores.map((store) => (
                <label key={store.id}>
                  <input
                    type="checkbox"
                    checked={storeIds.includes(store.id)}
                    onChange={(e) =>
                      setStoreIds(e.target.checked ? [...storeIds, store.id] : storeIds.filter((id) => id !== store.id))
                    }
                  />
                  {store.name}
                </label>
              ))}
            </div>
            {stores.length === 0 ? (
              <p>
                {t({
                  ja: 'この会社に店舗がありません。先に店舗を作成してください。',
                  en: 'Create a store in this company first.',
                })}
              </p>
            ) : null}
            <small>
              {t({
                ja: '店舗に対応した操作だけを許可します。会計・在庫の最終確定は本部が担当します。',
                en: 'Only store-aware operations are allowed. Headquarters performs final posting.',
              })}
            </small>
          </fieldset>
        ) : null}
        {user.tenantAdmin ? (
          <p className="notice-strip">
            {t({
              ja: 'この利用者はテナント管理者です。所属設定とは別に全会社を管理できます。',
              en: 'This user is a tenant administrator and can manage all companies independently of memberships.',
            })}
          </p>
        ) : null}
        {invalidStoreRoles ? (
          <p role="status">
            {t({
              ja: '店舗限定では「店舗スタッフ」「店長」だけを選択してください。',
              en: 'Store-scoped memberships accept only Store staff and Store manager roles.',
            })}
          </p>
        ) : null}
        {invalidSiteRoles ? (
          <p role="status">
            {t({
              ja: '拠点限定では従業員・拠点管理者・店舗スタッフ・店長・機器担当を選択してください。本部担当は会社全体の設定です。',
              en: 'Site scope supports employees, site managers, restaurant staff/managers and device roles. Headquarters roles use company-wide scope.',
            })}
          </p>
        ) : null}
        <div className="button-row">
          <button
            className="btn btn-primary"
            disabled={self || !changed || busy || stale || invalid || roles.length === 0}
          >
            {t({ ja: '会社へのアクセスを保存', en: 'Save company access' })}
          </button>
          {baseline ? (
            <button
              type="button"
              className="btn btn-danger"
              disabled={self || busy || stale}
              onClick={() => setPending('remove')}
            >
              {t({ ja: 'この会社の所属を解除', en: 'Remove membership' })}
            </button>
          ) : null}
        </div>
      </form>
      {pending ? (
        <ActionConfirm
          title={t(
            pending === 'remove'
              ? { ja: '所属を解除', en: 'Remove membership' }
              : { ja: 'アクセスを更新', en: 'Update access' },
          )}
          message={user.name + ' / ' + (company?.name ?? '')}
          destructive={pending === 'remove'}
          cancelDocument={false}
          onClose={() => setPending(undefined)}
          onConfirm={save}
        />
      ) : null}
    </>
  );
}
export function AccessMemberships({
  user,
  catalog,
  onStatus,
}: {
  user: AccessUser;
  catalog: AccessCatalog;
  onStatus: (status: AccessEditorStatus) => void;
}) {
  const { t } = useLocale();
  const [companyId, setCompanyId] = useState(user.defaultCompanyId ?? catalog.companies[0]?.id ?? '');
  const [status, setStatus] = useState<AccessEditorStatus>({ dirty: false, busy: false });
  useEffect(() => {
    onStatus(status);
    return () => onStatus({ dirty: false, busy: false });
  }, [status, onStatus]);
  const choose = (id: string) => {
    if (
      !status.busy &&
      (!status.dirty ||
        globalThis.confirm(
          t({
            ja: '未保存の所属変更を破棄して、別の会社を選びますか？',
            en: 'Discard membership edits and select another company?',
          }),
        ))
    )
      setCompanyId(id);
  };
  const current = catalog.memberships.find((m) => m.userId === user.id && m.companyId === companyId);
  return (
    <section className="access-panel">
      <h2>{t({ ja: '会社と店舗の権限', en: 'Companies and stores' })}</h2>
      <label>
        {t({ ja: '権限を設定する会社', en: 'Company to configure' })}
        <select
          className="input"
          aria-label={t({ ja: '権限を設定する会社', en: 'Company to configure' })}
          value={companyId}
          disabled={status.busy}
          onChange={(e) => choose(e.target.value)}
        >
          {catalog.companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {companyId ? (
        <MembershipEditor
          key={user.id + '/' + companyId}
          user={user}
          catalog={catalog}
          companyId={companyId}
          current={current}
          onStatus={setStatus}
        />
      ) : (
        <p>{t({ ja: '会社を先に作成してください。', en: 'Create a company first.' })}</p>
      )}
    </section>
  );
}
