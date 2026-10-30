// Setup wizard steps that reuse other screens' parts (docs/specs/setup-wizard.md AC-21..AC-23): the industry template
// (the /templates card and pack.apply behind a confirmation), users (the /admin/users create, invite and membership
// editors, tenant administrators only) and work and pay (workforce.initialize_policy). Each part keeps its own endpoint
// and permission check; the wizard only re-reads GET /meta/setup-status afterwards.
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAccessCatalog, type AccessEditorStatus } from '../api/access.ts';
import { getCompanyId } from '../api/client.ts';
import { useMe } from '../api/company.tsx';
import { useApplyPack, useCompanies, usePacks, type PackItem } from '../api/templates.ts';
import { useLocale } from '../i18n.tsx';
import { describeError } from '../lib/error-view.ts';
import { templateOrder } from '../lib/templates.ts';
import { TemplateCard } from '../pages/templates-page.tsx';
import { Button, SkeletonCard } from '../ui/index.ts';
import { AccessCreateUser } from './access-create-user.tsx';
import { AccessInviteUser } from './access-invite-user.tsx';
import { AccessMemberships } from './access-memberships.tsx';
import { ActionConfirm } from './action-confirm.tsx';
import { SetupChecks, SetupSaveError, useBusyKeys, useDirtyKeys, type SetupStepProps } from './setup-shared.tsx';
import { WorkforceInitialize } from './workforce-initialize.tsx';

/** `example` demonstrates the extension API; it is not an industry and does not complete the step. */
const NOT_AN_INDUSTRY = 'example';

export function IndustryTemplateStep(props: SetupStepProps) {
  const { t } = useLocale();
  const packs = usePacks();
  const companies = useCompanies();
  const apply = useApplyPack();
  const [pending, setPending] = useState<{ pack: PackItem; sample: boolean }>();
  const company = companies.data?.items.find((c) => c.id === companies.data.companyId);
  const confirm = () => {
    if (!pending || apply.isPending) return;
    const input = { name: pending.pack.name, sample: pending.sample };
    setPending(undefined);
    props.onBusy(true);
    apply.mutate(input, {
      onSuccess: () => props.announce(t({ ja: 'テンプレートを適用しました。', en: 'Template applied.' })),
      onSettled: async () => {
        props.onBusy(false);
        await props.refresh();
      },
    });
  };
  const items = (packs.data?.items ?? [])
    .filter((pack) => pack.name !== NOT_AN_INDUSTRY)
    .sort((a, b) => {
      const rank = (name: string) => {
        const i = templateOrder.indexOf(name);
        return i < 0 ? templateOrder.length : i;
      };
      return rank(a.name) - rank(b.name);
    });
  return (
    <div className="flex flex-col gap-3">
      <SetupChecks checks={props.step.checks} />
      <p className="text-sm text-text-secondary">
        {t({
          ja: '業種に合うテンプレートを適用すると、業界の設定と専用の画面が追加されます。保存済みの設定は上書きしません。業界テンプレートを使わない会社は、理由を書いてこの段階をスキップしてください。',
          en: 'Applying a template for your industry adds its settings and screens; settings already saved are kept. If the company uses no industry template, skip this step with a reason.',
        })}{' '}
        <Link to="/templates" className="ui-link">
          {t({ ja: 'テンプレート画面を開く', en: 'Open the templates screen' })}
        </Link>
      </p>
      {apply.isError ? <SetupSaveError view={describeError(apply.error)} /> : null}
      {companies.isError && !companies.data ? (
        <SetupSaveError view={describeError(companies.error)} testId="setup-companies-load-error" kind="load" />
      ) : null}
      {packs.isError ? (
        <SetupSaveError view={describeError(packs.error)} testId="setup-templates-load-error" kind="load" />
      ) : !packs.data ? (
        <div aria-busy="true">
          <SkeletonCard lines={3} />
        </div>
      ) : (
        <div className="template-grid" data-testid="setup-templates">
          {items.map((pack) => (
            <TemplateCard
              key={pack.name}
              pack={pack}
              meta={props.meta}
              busy={apply.isPending || pending !== undefined || !company}
              onApply={(p, sample) => setPending({ pack: p, sample })}
            />
          ))}
        </div>
      )}
      {pending ? (
        <ActionConfirm
          title={t({ ja: 'テンプレートを適用', en: 'Apply template' })}
          message={t({
            ja: `${company?.name ?? ''}：${pending.pack.label.ja}。${pending.sample ? 'サンプルデータも追加します。' : '初期設定と必要なマスタを追加します。'}`,
            en: `${company?.name ?? ''}: ${pending.pack.label.en}. ${pending.sample ? 'Sample data will also be added.' : 'Initial settings and master records will be added.'}`,
          })}
          cancelDocument={false}
          destructive={false}
          onConfirm={confirm}
          onClose={() => setPending(undefined)}
        />
      ) : null}
    </div>
  );
}

export function UsersStep(props: SetupStepProps) {
  const { t } = useLocale();
  const me = useMe();
  const tenantAdmin = me.data?.user.tenantAdmin === true;
  const catalog = useAccessCatalog(tenantAdmin);
  const dirty = useDirtyKeys(props.onDirty);
  const busy = useBusyKeys(props.onBusy);
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [createdId, setCreatedId] = useState<string>();
  const [invited, setInvited] = useState(false);
  const { refresh } = props;
  const editorStatus = useCallback(
    (key: string) => {
      const reportDirty = dirty(key);
      const reportBusy = busy(key);
      return (status: AccessEditorStatus) => {
        reportDirty(status.dirty);
        reportBusy(status.busy);
      };
    },
    [dirty, busy],
  );
  const createStatus = useMemo(() => editorStatus('create'), [editorStatus]);
  const inviteStatus = useMemo(() => editorStatus('invite'), [editorStatus]);
  const membershipStatus = useMemo(() => editorStatus('membership'), [editorStatus]);
  const companyId = getCompanyId() ?? undefined;
  // A saved membership changes the access catalog (useAccessMutation invalidates it). Re-read the setup status only
  // when this company's active members changed — not on the catalog's own refetch on focus (no automatic re-checks).
  const members = catalog.data
    ? catalog.data.memberships
        .filter((m) => m.companyId === companyId && catalog.data.users.some((u) => u.id === m.userId && u.active))
        .map((m) => m.userId)
        .sort()
        .join(',')
    : undefined;
  const firstMembers = useRef(members);
  useEffect(() => {
    if (firstMembers.current === undefined) firstMembers.current = members;
    else if (members !== firstMembers.current) {
      firstMembers.current = members;
      void refresh();
    }
  }, [members, refresh]);
  const created = createdId ? catalog.data?.users.find((user) => user.id === createdId) : undefined;
  return (
    <div className="flex flex-col gap-3">
      {/* The fix link opens /admin/users, which only tenant administrators can use. */}
      <SetupChecks checks={props.step.checks} links={tenantAdmin} />
      {me.isPending ? (
        <div aria-busy="true">
          <SkeletonCard lines={2} />
        </div>
      ) : null}
      {me.isError && !me.data ? (
        <SetupSaveError view={describeError(me.error)} testId="setup-users-load-error" kind="load" />
      ) : null}
      {tenantAdmin && catalog.isError && !catalog.data ? (
        <SetupSaveError view={describeError(catalog.error)} testId="setup-users-catalog-error" kind="load" />
      ) : null}
      {me.data && !tenantAdmin ? (
        <p className="ui-notice text-sm" data-testid="setup-users-not-tenant-admin">
          {t({
            ja: '利用者の追加と所属の設定はテナント管理者が行います。1 人で使う場合は、理由を書いてこの段階をスキップできます。',
            en: 'A tenant administrator adds users and sets memberships. If you work alone, you can skip this step with a reason.',
          })}
        </p>
      ) : null}
      {tenantAdmin ? (
        <>
          <p className="text-sm text-text-secondary">
            {t({
              ja: 'この会社に所属する有効な利用者が 2 人以上になると完了します。追加した利用者には、この会社の所属と業務ロールを設定してください。',
              en: 'Done once this company has two or more active members. Give each new user a membership and business roles in this company.',
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={creating || inviting}
              onClick={() => {
                setCreating(true);
                setInvited(false);
              }}
              data-testid="setup-users-create"
            >
              {t({ ja: '利用者を追加', en: 'Add user' })}
            </Button>
            <Button
              disabled={creating || inviting}
              onClick={() => {
                setInviting(true);
                setInvited(false);
              }}
            >
              {t({ ja: 'メールで招待', en: 'Invite by email' })}
            </Button>
            <Link to="/admin/users" className="ui-link self-center">
              {t({ ja: '利用者と権限の画面を開く', en: 'Open users and access' })}
            </Link>
          </div>
          {creating ? (
            <AccessCreateUser
              onClose={() => setCreating(false)}
              onStatus={createStatus}
              onCreated={(user) => setCreatedId(user.id)}
            />
          ) : null}
          {inviting ? (
            <AccessInviteUser
              onClose={() => setInviting(false)}
              onStatus={inviteStatus}
              onInvited={() => setInvited(true)}
            />
          ) : null}
          {invited ? (
            <p className="ui-notice text-sm" data-testid="setup-users-invited">
              {t({
                ja: '招待した人が受理し、この会社への所属を割り当てるまで、この段階は完了しません（招待中の利用者は無効の状態で数えません）。所属は受理後に利用者と権限の画面で割り当ててください。受理前に所属を付けると招待を再発行できなくなります。',
                en: 'This step completes only after the invitee accepts and gets a membership in this company (pending invitees are inactive and not counted). Assign the membership in Users and access after acceptance; a membership set before acceptance prevents reissuing the invitation.',
              })}
            </p>
          ) : null}
          {created && catalog.data ? (
            <AccessMemberships
              key={created.id}
              user={created}
              catalog={catalog.data}
              onStatus={membershipStatus}
              {...(companyId ? { initialCompanyId: companyId } : {})}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function WorkforceStep(props: SetupStepProps) {
  const { t } = useLocale();
  const ready = props.step.checks.every((check) => check.status === 'ok');
  const canInitialize = props.meta.actions.some((action) => action.name === 'workforce.initialize_policy');
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-secondary">
        {t({
          ja: 'この段階は任意です。従業員の勤怠・給与を使う会社は、勤怠・給与の制度を準備します（新しい会社には初めから作られています）。',
          en: 'This step is optional. Companies that track work and pay for employees prepare the policy (a new company already has one).',
        })}
      </p>
      <SetupChecks checks={props.step.checks} />
      {!ready && canInitialize ? (
        <div>
          <WorkforceInitialize onDone={() => void props.refresh()} />
        </div>
      ) : null}
      <p>
        <Link to="/workforce" className="ui-link">
          {t({ ja: '勤怠・給与の画面を開く', en: 'Open work and pay' })}
        </Link>
      </p>
    </div>
  );
}
