// /admin/permissions (docs/specs/access-insight.md AC-6, AC-7, AC-21), built with the UI kit: the entity x role x
// operation matrix GET /admin/permissions derives from the registry, grouped by module, with note badges and an opened
// row for row rules, restricted fields, store/site/relay limits and transitions; an "Actions" tab for action entry
// permissions. Filters and the tab live in the URL. On a narrow screen one role is shown (entity x operation).
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Fragment, useId, useState, useSyncExternalStore } from 'react';
import { isApiError } from '../api/client.ts';
import { usePermissionMatrix } from '../api/access-insight.ts';
import { useMeta } from '../api/queries.ts';
import type { Label } from '../api/types.ts';
import { Icon } from '../components/icon.tsx';
import { PermissionNotes } from '../components/permission-notes.tsx';
import { useLocale } from '../i18n.tsx';
import {
  BADGE_TEXT,
  cellText,
  entityBadges,
  filterActions,
  filterEntities,
  groupByModule,
  kernelCapabilitiesOf,
  moduleOptions,
  OP_TEXT,
  parsePermissionsSearch,
  permissionsSearchParams,
  permissionText,
  submitNote,
  viewRole,
  type BadgeId,
  type MatrixEntity,
  type MatrixRole,
  type PermissionMatrix,
  type PermissionsSearch,
} from '../lib/permission-matrix.ts';
import {
  Badge,
  Card,
  DataTableShell,
  EmptyState,
  FormSection,
  PageHeader,
  SkeletonCard,
  TabPanel,
  Tabs,
} from '../ui/index.ts';
import { LoadingView, MetaError } from './status-views.tsx';

const NARROW = '(max-width: 640px)';
function subscribeNarrow(listener: () => void): () => void {
  const media = globalThis.matchMedia?.(NARROW);
  media?.addEventListener('change', listener);
  return () => media?.removeEventListener('change', listener);
}
/** AC-7: 390px phones (640px and below) start with one role. */
function useNarrow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => globalThis.matchMedia?.(NARROW).matches ?? false,
    () => false,
  );
}

export function canUseAccessInsight(roles: readonly string[] | undefined): boolean {
  return roles?.includes('admin') === true;
}

export function AdminOnly({ testId, title }: { testId: string; title: Label }) {
  const { t } = useLocale();
  return (
    <div className="workspace-page">
      <EmptyState
        titleAs="h1"
        testId={testId}
        title={t(title)}
        description={t({
          ja: '管理者（admin）の役割と、店舗・拠点に限定されない会社全体への所属が必要です。必要なら管理者に依頼してください。',
          en: 'The admin role with company-wide access (not limited to stores or sites) is required. Ask your administrator if you need it.',
        })}
      />
    </div>
  );
}

function Badges({ ids }: { ids: BadgeId[] }) {
  const { t } = useLocale();
  if (!ids.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <Badge key={id} tone={BADGE_TEXT[id].tone} data-badge={id}>
          {t(BADGE_TEXT[id].label)}
        </Badge>
      ))}
    </span>
  );
}

function OpsCell({ ops, testId }: { ops: MatrixEntity['ops']; testId: string }) {
  const { locale } = useLocale();
  const text = cellText(ops, locale);
  return (
    <td data-testid={testId} data-ops={ops.join(' ')} className="whitespace-nowrap font-mono">
      <span aria-hidden="true">{text.abbr}</span>
      <span className="sr-only">{text.full}</span>
    </td>
  );
}

function EntityRow({
  entity,
  roles,
  role,
  matrix,
}: {
  entity: MatrixEntity;
  roles: readonly MatrixRole[];
  role: string | undefined;
  matrix: PermissionMatrix;
}) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const notesId = useId();
  const columns = role ? matrix.ops.length + 2 : roles.length + 2;
  const submit = submitNote(entity);
  return (
    <>
      <tr data-testid={`matrix-row-${entity.name}`}>
        <td className="min-w-48">
          <span className="block font-semibold text-text">{t(entity.label)}</span>
          <span className="block font-mono text-xs text-text-muted">{entity.name}</span>
          <Badges ids={entityBadges(entity, role)} />
        </td>
        {role
          ? matrix.ops.map((op) => {
              const applicable = entity.ops.includes(op);
              const allowed = applicable && (entity.grants[role] ?? []).includes(op);
              return (
                <td key={op} data-testid={`cell-${entity.name}-${op}`} data-allowed={allowed} className="text-center">
                  <span aria-hidden="true">{!applicable ? '·' : allowed ? '✓' : '—'}</span>
                  <span className="sr-only">
                    {t(OP_TEXT[op].name)}:{' '}
                    {!applicable
                      ? t({ ja: '対象外', en: 'not applicable' })
                      : allowed
                        ? t({ ja: '許可', en: 'allowed' })
                        : t({ ja: 'なし', en: 'not allowed' })}
                  </span>
                  {op === 'submit' && allowed && submit ? (
                    <span className="block text-xs text-text-muted">{t(submit)}</span>
                  ) : null}
                </td>
              );
            })
          : roles.map((r) => (
              <OpsCell key={r.name} ops={entity.grants[r.name] ?? []} testId={`cell-${entity.name}-${r.name}`} />
            ))}
        <td>
          <button
            type="button"
            className="ui-link"
            aria-expanded={open}
            aria-controls={notesId}
            onClick={() => setOpen((v) => !v)}
            data-testid={`matrix-details-${entity.name}`}
          >
            {open ? t({ ja: '閉じる', en: 'Close' }) : t({ ja: '詳細', en: 'Details' })}
            <span className="sr-only">{locale === 'ja' ? `（${entity.label.ja}）` : ` (${entity.label.en})`}</span>
          </button>
        </td>
      </tr>
      <tr id={notesId} hidden={!open}>
        <td colSpan={columns}>{open ? <PermissionNotes entity={entity} roles={roles} role={role} /> : null}</td>
      </tr>
    </>
  );
}

function DataTable({
  matrix,
  entities,
  role,
}: {
  matrix: PermissionMatrix;
  entities: MatrixEntity[];
  role: string | undefined;
}) {
  const { t } = useLocale();
  const roles = matrix.roles;
  const roleLabel = roles.find((r) => r.name === role)?.label;
  const columns = role ? matrix.ops.length + 2 : roles.length + 2;
  const head = (
    <tr>
      <th scope="col">{t({ ja: 'データ', en: 'Data' })}</th>
      {role
        ? matrix.ops.map((op) => (
            <th scope="col" key={op} className="text-center">
              {t(OP_TEXT[op].name)}
            </th>
          ))
        : roles.map((r) => (
            <th scope="col" key={r.name} title={r.name}>
              {t(r.label)}
              {r.implicitAll ? <span className="block font-normal">{t({ ja: '（すべて）', en: '(all)' })}</span> : null}
            </th>
          ))}
      <th scope="col">
        <span className="sr-only">{t({ ja: '詳細', en: 'Details' })}</span>
      </th>
    </tr>
  );
  return (
    <DataTableShell
      head={head}
      columnCount={columns}
      label={
        role && roleLabel
          ? t({ ja: `権限マトリクス（${roleLabel.ja}）`, en: `Permission matrix (${roleLabel.en})` })
          : t({ ja: '権限マトリクス', en: 'Permission matrix' })
      }
      isEmpty={entities.length === 0}
      empty={
        <EmptyState
          title={t({ ja: '条件に合うデータがありません', en: 'No data matches' })}
          description={t({ ja: '絞り込みを変えてください。', en: 'Change the filters.' })}
        />
      }
      testId="matrix-table"
    >
      {groupByModule(entities).map((group) => (
        <Fragment key={group.module}>
          <tr className="bg-surface-muted" data-testid={`matrix-group-${group.module}`}>
            <td colSpan={columns} className="font-semibold text-text">
              {t(group.label)}
            </td>
          </tr>
          {group.items.map((entity) => (
            <EntityRow key={entity.name} entity={entity} roles={roles} role={role} matrix={matrix} />
          ))}
        </Fragment>
      ))}
    </DataTableShell>
  );
}

function ActionsTable({
  matrix,
  search,
  role,
}: {
  matrix: PermissionMatrix;
  search: PermissionsSearch;
  role: string | undefined;
}) {
  const { t } = useLocale();
  const actions = filterActions(matrix, search);
  const roles = role ? matrix.roles.filter((r) => r.name === role) : matrix.roles;
  const head = (
    <tr>
      <th scope="col">{t({ ja: 'アクション', en: 'Action' })}</th>
      <th scope="col">{t({ ja: '入口の権限', en: 'Entry permission' })}</th>
      {roles.map((r) => (
        <th scope="col" key={r.name} className="text-center">
          {t(r.label)}
        </th>
      ))}
    </tr>
  );
  return (
    <DataTableShell
      head={head}
      columnCount={roles.length + 2}
      label={t({ ja: 'アクションの実行可否', en: 'Who can run each action' })}
      isEmpty={actions.length === 0}
      empty={<EmptyState title={t({ ja: '条件に合うアクションがありません', en: 'No actions match' })} />}
      testId="actions-table"
    >
      {actions.map((a) => (
        <tr key={a.name} data-testid={`action-row-${a.name}`}>
          <td className="min-w-48">
            <span className="block font-semibold text-text">{t(a.description)}</span>
            <span className="block font-mono text-xs text-text-muted">{a.name}</span>
            {!a.applied ? <Badges ids={['unapplied']} /> : null}
          </td>
          <td className="text-sm">
            {t(permissionText(a.permission, matrix.roles))}
            {a.storeAccess || a.siteAccess || a.relayAccess ? (
              <span className="block text-xs text-text-muted">
                {[
                  a.storeAccess ? t({ ja: '店舗限定でも可', en: 'store-limited allowed' }) : '',
                  a.siteAccess ? t({ ja: '拠点限定でも可', en: 'site-limited allowed' }) : '',
                  a.relayAccess ? t({ ja: '店舗端末から可', en: 'site devices allowed' }) : '',
                ]
                  .filter(Boolean)
                  .join(' / ')}
              </span>
            ) : null}
          </td>
          {roles.map((r) => {
            const runnable = a.runnable.includes(r.name);
            return (
              <td key={r.name} className="text-center" data-testid={`run-${a.name}-${r.name}`} data-allowed={runnable}>
                <span aria-hidden="true">{runnable ? '✓' : '—'}</span>
                <span className="sr-only">
                  {runnable ? t({ ja: '実行できる', en: 'can run' }) : t({ ja: '実行できない', en: 'cannot run' })}
                </span>
              </td>
            );
          })}
        </tr>
      ))}
    </DataTableShell>
  );
}

function Legend({ matrix, role }: { matrix: PermissionMatrix; role: string | undefined }) {
  const { t, locale } = useLocale();
  const capabilityRoles = role ? matrix.roles.filter((r) => r.name === role) : matrix.roles;
  return (
    <Card>
      <FormSection title={t({ ja: '凡例と注意', en: 'Legend and notes' })} landmark>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="matrix-legend">
          {matrix.ops.map((op) => (
            <li key={op}>
              <span className="font-mono font-semibold">{OP_TEXT[op].abbr[locale]}</span> = {t(OP_TEXT[op].name)}
            </li>
          ))}
        </ul>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-text-secondary">
          <li>
            {t({
              ja: '会社単位のデータは、画面上部で選んでいる会社の行だけが対象です。「テナント共通」の札はすべての会社で共有されるデータです。',
              en: 'Company data covers only the rows of the company selected at the top. "Shared by the tenant" marks data shared by every company.',
            })}
          </li>
          <li>
            {t({
              ja: '行ルールは既存の行の閲覧・更新・確定などを絞ります。作成する値は行ルールでは制限されず、各業務の検証によります。',
              en: 'Row rules narrow reading, updating, submitting and so on of existing rows. Values of new rows are not limited by row rules but by each module’s validation.',
            })}
          </li>
          <li>
            {t({
              ja: '複数のロールを持つ人は許可の和になります。行ルールは、許可を与えるロールがすべて制限されているときだけ当たります。',
              en: 'A person with several roles gets the union of their grants; a row rule applies only when every granting role is restricted.',
            })}
          </li>
          <li>
            {t({
              ja: 'アクションは、ここに示す入口の権限に加えて、中で追加の確認（テナント管理者だけ、など）を行う場合があります。',
              en: 'Actions may check more inside (tenant administrators only, for example) beyond the entry permission shown here.',
            })}
          </li>
        </ul>
        <h3 className="mt-3 text-sm font-semibold text-text">
          {t({ ja: 'kernel の機能', en: 'Kernel capabilities' })}
        </h3>
        <ul className="flex flex-col gap-1 text-sm" data-testid="kernel-capabilities">
          {capabilityRoles.map((r) => {
            const caps = kernelCapabilitiesOf(matrix, r.name);
            if (!caps.length) return null;
            return (
              <li key={r.name}>
                <span className="font-semibold">{t(r.label)}</span>:{' '}
                {caps.map((c) => t(c.label)).join(locale === 'ja' ? '、' : ', ')}
                {t({ ja: '（会社全体の所属のとき）', en: ' (with company-wide access)' })}
              </li>
            );
          })}
          {matrix.kernel
            .filter((c) => c.tenantAdmin)
            .map((c) => (
              <li key={c.id}>
                <span className="font-semibold">{t({ ja: 'テナント管理者', en: 'Tenant administrators' })}</span>:{' '}
                {t(c.label)}
              </li>
            ))}
        </ul>
      </FormSection>
    </Card>
  );
}

export function PermissionsPage() {
  const { t } = useLocale();
  const meta = useMeta();
  const navigate = useNavigate();
  const narrow = useNarrow();
  const search = parsePermissionsSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const allowed = canUseAccessInsight(meta.data?.roles);
  const matrix = usePermissionMatrix(allowed);
  const ids = useId();
  if (meta.isError && !meta.data) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (!meta.data) return <LoadingView />;
  const refused = matrix.isError && isApiError(matrix.error) && matrix.error.status === 403;
  if (!allowed || refused)
    return (
      <AdminOnly
        testId="permissions-forbidden"
        title={{ ja: '権限マトリクスを開く権限がありません', en: 'You cannot open the permission matrix' }}
      />
    );
  if (matrix.isError && !matrix.data) return <MetaError error={matrix.error} retry={() => void matrix.refetch()} />;
  const update = (next: Partial<PermissionsSearch>) =>
    void navigate({ to: '/admin/permissions', search: permissionsSearchParams({ ...search, ...next }), replace: true });
  const data = matrix.data;
  const role = data ? viewRole(search, data.roles, narrow) : undefined;
  const modules = data ? moduleOptions(data, search.packs === 'all') : [];
  return (
    <div className="workspace-page flex min-w-0 flex-col gap-4" data-testid="permissions-page">
      <PageHeader
        eyebrow="ACCESS"
        title={t({ ja: '権限マトリクス', en: 'Permission matrix' })}
        subtitle={t({
          ja: 'どのロールがどのデータに何をできるかを、システムの権限定義から表示します。権限の変更は「利用者と権限」で所属のロールを変えます。',
          en: 'Shows what each role may do with each kind of data, derived from the system’s permission definitions. To change access, change membership roles in Users and access.',
        })}
        icon={<Icon name="people" size={24} />}
      />
      <Card>
        <div className="flex flex-wrap items-end gap-3" role="group" aria-label={t({ ja: '絞り込み', en: 'Filters' })}>
          <label
            className="flex min-w-0 flex-col gap-1 text-sm font-semibold text-text-secondary"
            htmlFor={`${ids}-module`}
          >
            {t({ ja: '業務（モジュール）', en: 'Module' })}
            <select
              id={`${ids}-module`}
              className="input max-w-full"
              value={search.module ?? ''}
              onChange={(e) => update({ module: e.target.value || undefined })}
              data-testid="matrix-module"
            >
              <option value="">{t({ ja: 'すべて', en: 'All' })}</option>
              {modules.map((m) => (
                <option key={m.name} value={m.name}>
                  {t(m.label)}
                </option>
              ))}
            </select>
          </label>
          <label
            className="flex min-w-0 flex-col gap-1 text-sm font-semibold text-text-secondary"
            htmlFor={`${ids}-role`}
          >
            {t({ ja: 'ロール', en: 'Role' })}
            <select
              id={`${ids}-role`}
              className="input max-w-full"
              value={role ?? ''}
              onChange={(e) => update({ role: e.target.value || undefined })}
              data-testid="matrix-role"
            >
              {narrow ? null : (
                <option value="">{t({ ja: 'すべてのロールを並べる', en: 'All roles side by side' })}</option>
              )}
              {(data?.roles ?? []).map((r) => (
                <option key={r.name} value={r.name}>
                  {t(r.label)} ({r.name})
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm font-semibold text-text-secondary" htmlFor={`${ids}-q`}>
            {t({ ja: '名前で探す', en: 'Find by name' })}
            <input
              id={`${ids}-q`}
              className="input max-w-full"
              type="search"
              value={search.q ?? ''}
              onChange={(e) => update({ q: e.target.value || undefined })}
              data-testid="matrix-q"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary" htmlFor={`${ids}-packs`}>
            <input
              id={`${ids}-packs`}
              type="checkbox"
              checked={search.packs === 'all'}
              onChange={(e) => update({ packs: e.target.checked ? 'all' : undefined })}
              data-testid="matrix-packs"
            />
            {t({ ja: '未適用のパックも表示', en: 'Also show packs not applied' })}
          </label>
        </div>
      </Card>
      <Tabs
        idPrefix={`${ids}-tabs`}
        label={t({ ja: '表の種類', en: 'Table' })}
        selected={search.tab}
        onSelect={(tab) => update({ tab: tab === 'actions' ? 'actions' : 'data' })}
        items={[
          { id: 'data', label: t({ ja: 'データ', en: 'Data' }) },
          { id: 'actions', label: t({ ja: 'アクション', en: 'Actions' }) },
        ]}
      />
      <TabPanel idPrefix={`${ids}-tabs`} id="data" selected={search.tab === 'data'} className="min-w-0">
        {data ? (
          <DataTable matrix={data} entities={filterEntities(data, search)} role={role} />
        ) : (
          <SkeletonCard lines={6} />
        )}
      </TabPanel>
      <TabPanel idPrefix={`${ids}-tabs`} id="actions" selected={search.tab === 'actions'} className="min-w-0">
        {data ? <ActionsTable matrix={data} search={search} role={role} /> : <SkeletonCard lines={6} />}
      </TabPanel>
      {data ? <Legend matrix={data} role={role} /> : null}
    </div>
  );
}
