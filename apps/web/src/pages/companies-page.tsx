// /admin/companies (docs/specs/company-admin.md AC-9..AC-11), built with the UI kit: the tenant's companies, a create
// form, renaming in a kit Dialog, and after creation the switch to the new company with its first-setup links. Every
// write is the existing POST / PATCH /admin/companies (the API checks the tenant administrator); switching is the
// company picker's own path (stored selection + full page load, so no data of the previous company survives).
import { useId, useState, type FormEvent } from 'react';
import { isApiError, setActiveCompany } from '../api/client.ts';
import {
  useAdminCompanies,
  useCreateCompany,
  useUpdateCompany,
  type AdminCompany,
  type CreatedCompany,
} from '../api/companies.ts';
import { useMe } from '../api/company.tsx';
import { Icon } from '../components/icon.tsx';
import { useToast } from '../components/toast.tsx';
import { useLocale } from '../i18n.tsx';
import {
  COMPANY_FIELD_LABEL,
  COMPANY_FIELDS,
  draftErrors,
  EMPTY_DRAFT,
  issuesByField,
  normalizeDraft,
  SETUP_DESTINATIONS,
  type CompanyDraft,
  type CompanyField,
} from '../lib/companies.ts';
import { formatTimestamp } from '../lib/format.ts';
import { S } from '../strings.ts';
import { Badge, Button, Card, DataTableShell, Dialog, EmptyState, FormSection, PageHeader } from '../ui/index.ts';
import { LoadingView, MetaError } from './status-views.tsx';

type FieldErrors = Partial<Record<CompanyField, string>>;

/** The company picker's switch (components/company-picker.tsx): a fresh page, so no prior-company data survives. */
function switchTo(companyId: string, href: string) {
  setActiveCompany(companyId);
  globalThis.location.assign(href);
}

function TextField({
  field,
  value,
  onChange,
  error,
  disabled,
  help,
  idPrefix,
}: {
  field: CompanyField;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  disabled: boolean;
  help?: string | undefined;
  idPrefix: string;
}) {
  const { t } = useLocale();
  const id = `${idPrefix}-${field}`;
  const describedBy = [help ? `${id}-help` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ');
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-text-secondary">
        {t(COMPANY_FIELD_LABEL[field])}
      </label>
      <input
        id={id}
        name={field}
        className="input w-full"
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
      {help ? (
        <p id={`${id}-help`} className="text-xs text-text-muted">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="ui-field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CreateCompanyForm({ onCreated, onCancel }: { onCreated: (c: CreatedCompany) => void; onCancel: () => void }) {
  const { t } = useLocale();
  const idPrefix = useId();
  const create = useCreateCompany();
  const [draft, setDraft] = useState<CompanyDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const help: Partial<Record<CompanyField, string>> = {
    code: t({
      ja: '英大文字・数字・_・-（1〜20 文字）。作成後は変更できません。',
      en: 'A–Z, 0–9, _ and - (1–20). It cannot be changed later.',
    }),
    currency: t({
      ja: '作成後は変更できません。業務の計算は現在 JPY のみです。',
      en: 'It cannot be changed later. Business calculations are JPY only for now.',
    }),
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = normalizeDraft(draft);
    const local = draftErrors(value);
    const localErrors: FieldErrors = Object.fromEntries(
      Object.entries(local).map(([field, label]) => [field, t(label)]),
    );
    setErrors(localErrors);
    setFormErrors([]);
    if (Object.keys(localErrors).length) {
      document.getElementById(`${idPrefix}-${Object.keys(localErrors)[0]}`)?.focus();
      return;
    }
    create.mutate(value, {
      onSuccess: (company) => onCreated(company),
      onError: (error) => {
        if (isApiError(error) && error.code === 'VALIDATION') {
          const mapped = issuesByField(error.issues());
          setErrors(mapped.fields);
          setFormErrors(mapped.form.length || Object.keys(mapped.fields).length ? mapped.form : [error.message]);
        } else setFormErrors([isApiError(error) ? `${error.message} ${error.hint}` : String(error)]);
      },
    });
  };
  const busy = create.isPending;
  return (
    <Card as="form" onSubmit={submit} noValidate data-testid="company-create-form">
      <FormSection
        title={t({ ja: '会社を追加', en: 'Add a company' })}
        description={t({
          ja: '作成すると、勘定科目・税率・会計年度・倉庫などの初期データが入り、あなたが管理者として所属します。',
          en: 'Creating it loads the initial data (chart of accounts, tax rates, fiscal year, warehouse, …) and makes you its administrator.',
        })}
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
          {COMPANY_FIELDS.map((field) => (
            <TextField
              key={field}
              field={field}
              value={draft[field]}
              onChange={(value) => setDraft((d) => ({ ...d, [field]: value }))}
              error={errors[field]}
              disabled={busy}
              help={help[field]}
              idPrefix={idPrefix}
            />
          ))}
        </div>
        {formErrors.length ? (
          <div role="alert" className="ui-notice ui-notice-danger mt-3">
            {formErrors.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={busy} data-testid="company-create-submit">
            {busy ? t({ ja: '作成中…', en: 'Creating…' }) : t({ ja: '会社を作成', en: 'Create company' })}
          </Button>
          <Button onClick={onCancel} disabled={busy}>
            {t(S.cancel)}
          </Button>
        </div>
      </FormSection>
    </Card>
  );
}

function CreatedPanel({ company, onDismiss }: { company: CreatedCompany; onDismiss: () => void }) {
  const { t } = useLocale();
  const [first, ...rest] = SETUP_DESTINATIONS;
  return (
    <Card data-testid="company-created">
      <FormSection
        title={t({ ja: `${company.name} を作成しました`, en: `${company.name} was created` })}
        description={t({
          ja: `初期データ（${company.seededModules.length} 業務分）を投入し、あなたを管理者として所属させました。新しい会社に切り替えて初期設定を続けてください。`,
          en: `Initial data for ${company.seededModules.length} modules was loaded and you are its administrator. Switch to the new company to continue its setup.`,
        })}
      >
        <p className="sr-only" role="status">
          {t({ ja: `${company.name} を作成しました`, en: `${company.name} was created` })}
        </p>
        <div className="flex flex-wrap gap-2">
          {first ? (
            <Button
              variant="primary"
              onClick={() => switchTo(company.id, first.href)}
              data-testid="company-switch-setup"
            >
              {t({ ja: '切り替えて', en: 'Switch and ' })}
              {t(first.label)}
            </Button>
          ) : null}
          {rest.map((destination) => (
            <Button key={destination.href} onClick={() => switchTo(company.id, destination.href)}>
              {t({ ja: '切り替えて', en: 'Switch and ' })}
              {t(destination.label)}
            </Button>
          ))}
          <Button variant="ghost" onClick={onDismiss}>
            {t({ ja: 'このまま一覧に戻る', en: 'Stay on the list' })}
          </Button>
        </div>
      </FormSection>
    </Card>
  );
}

function EditCompanyDialog({ company, onClose }: { company: AdminCompany; onClose: () => void }) {
  const { t } = useLocale();
  const idPrefix = useId();
  const toast = useToast();
  const update = useUpdateCompany();
  const [draft, setDraft] = useState<CompanyDraft>({ ...company });
  const [errors, setErrors] = useState<FieldErrors>({});
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = normalizeDraft(draft);
    const local = draftErrors(value, ['name', 'country']);
    const localErrors: FieldErrors = Object.fromEntries(Object.entries(local).map(([f, label]) => [f, t(label)]));
    setErrors(localErrors);
    if (Object.keys(localErrors).length) return;
    update.mutate(
      { id: company.id, name: value.name, country: value.country },
      {
        onSuccess: () => {
          toast.success(t({ ja: '会社を更新しました', en: 'Company updated' }));
          onClose();
        },
        onError: (error) => {
          if (isApiError(error) && error.code === 'VALIDATION') setErrors(issuesByField(error.issues()).fields);
          else toast.error(error);
        },
      },
    );
  };
  return (
    <Dialog
      title={t({ ja: `${company.code} を編集`, en: `Edit ${company.code}` })}
      description={t({
        ja: '会社名と国を変更できます。会社コードと通貨は作成後に変更できません。',
        en: 'You can change the name and country. The code and currency cannot change after creation.',
      })}
      onClose={onClose}
      closeLabel={t(S.close)}
      onSubmit={submit}
      actions={
        <>
          <Button onClick={onClose} disabled={update.isPending} data-autofocus>
            {t(S.cancel)}
          </Button>
          <Button type="submit" variant="primary" disabled={update.isPending}>
            {t(S.save)}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {(['name', 'country'] as const).map((field) => (
          <TextField
            key={field}
            field={field}
            value={draft[field]}
            onChange={(value) => setDraft((d) => ({ ...d, [field]: value }))}
            error={errors[field]}
            disabled={update.isPending}
            idPrefix={idPrefix}
          />
        ))}
      </div>
    </Dialog>
  );
}

function CompanyTable({
  items,
  currentId,
  busy,
  onEdit,
}: {
  items: readonly AdminCompany[];
  currentId: string | null;
  busy: boolean;
  onEdit: (company: AdminCompany) => void;
}) {
  const { t, locale } = useLocale();
  return (
    <DataTableShell
      label={t({ ja: '会社の一覧', en: 'Companies' })}
      columnCount={6}
      busy={busy}
      testId="company-table"
      head={
        <tr>
          <th scope="col">{t(COMPANY_FIELD_LABEL.code)}</th>
          <th scope="col">{t(COMPANY_FIELD_LABEL.name)}</th>
          <th scope="col">{t({ ja: '国・通貨', en: 'Country / currency' })}</th>
          <th scope="col">{t({ ja: '作成日時', en: 'Created' })}</th>
          <th scope="col">{t({ ja: '所属', en: 'Membership' })}</th>
          <th scope="col">{t({ ja: '操作', en: 'Actions' })}</th>
        </tr>
      }
    >
      {items.map((company) => (
        <tr key={company.id} data-testid={`company-row-${company.code}`}>
          <td>
            <code>{company.code}</code>
          </td>
          <td>
            {company.name}{' '}
            {company.id === currentId ? <Badge tone="accent">{t({ ja: '表示中', en: 'Current' })}</Badge> : null}
          </td>
          <td>
            {company.country} / {company.currency}
          </td>
          <td>{formatTimestamp(company.createdAt, locale)}</td>
          <td>
            <Badge tone={company.member ? 'success' : 'neutral'}>
              {company.member
                ? t({ ja: '管理者として所属', en: 'Member' })
                : t({ ja: '所属なし（テナント管理者として表示）', en: 'No membership (tenant administrator)' })}
            </Badge>
          </td>
          <td>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => onEdit(company)}
                aria-label={t({ ja: `${company.name} を編集`, en: `Edit ${company.name}` })}
              >
                {t({ ja: '編集', en: 'Edit' })}
              </Button>
              {company.id !== currentId ? (
                <Button
                  size="sm"
                  onClick={() => switchTo(company.id, '/')}
                  aria-label={t({ ja: `${company.name} に切り替える`, en: `Switch to ${company.name}` })}
                >
                  {t({ ja: '切り替える', en: 'Switch' })}
                </Button>
              ) : null}
            </div>
          </td>
        </tr>
      ))}
    </DataTableShell>
  );
}

export function CompaniesPage() {
  const { t } = useLocale();
  const me = useMe();
  const admin = me.data?.user.tenantAdmin === true;
  const companies = useAdminCompanies(admin);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedCompany | null>(null);
  const [editing, setEditing] = useState<AdminCompany | null>(null);
  if (me.isError && !me.data) return <MetaError error={me.error} retry={() => void me.refetch()} />;
  if (!me.data) return <LoadingView />;
  // AC-2/AC-10: the navigation hides the screen; a direct URL explains instead of failing.
  if (!admin)
    return (
      <div className="workspace-page">
        <EmptyState
          titleAs="h1"
          testId="companies-forbidden"
          title={t({
            ja: '会社の管理はテナント管理者だけが行えます',
            en: 'Only tenant administrators manage companies',
          })}
          description={t({
            ja: '会社の追加や名称の変更が必要なら、テナント管理者に依頼してください。',
            en: 'Ask a tenant administrator if a company needs to be added or renamed.',
          })}
        />
      </div>
    );
  if (companies.isError && !companies.data)
    return <MetaError error={companies.error} retry={() => void companies.refetch()} />;
  return (
    <div className="workspace-page flex flex-col gap-4" data-testid="companies-page">
      <PageHeader
        eyebrow="COMPANIES"
        title={t({ ja: '会社の管理', en: 'Companies' })}
        subtitle={t({
          ja: 'テナントの会社を追加し、名称と国を管理します。新しい会社には初期データが入ります。',
          en: 'Add companies to the tenant and manage their name and country. New companies receive the initial data.',
        })}
        icon={<Icon name="building" size={24} />}
        actions={
          !creating ? (
            <Button
              variant="primary"
              onClick={() => {
                setCreated(null);
                setCreating(true);
              }}
              data-testid="company-add"
            >
              {t({ ja: '会社を追加', en: 'Add company' })}
            </Button>
          ) : null
        }
      />
      {created ? <CreatedPanel company={created} onDismiss={() => setCreated(null)} /> : null}
      {creating ? (
        <CreateCompanyForm
          onCancel={() => setCreating(false)}
          onCreated={(company) => {
            setCreating(false);
            setCreated(company);
          }}
        />
      ) : null}
      <Card>
        <FormSection
          landmark
          title={t({ ja: '会社の一覧', en: 'Company list' })}
          description={t({
            ja: '会社コードと通貨は作成後に変更できません。会社の削除・無効化はできません。',
            en: 'The code and currency are fixed after creation. Companies cannot be deleted or deactivated.',
          })}
        >
          <CompanyTable
            items={companies.data?.items ?? []}
            currentId={me.data.companyId}
            busy={companies.isFetching}
            onEdit={setEditing}
          />
          {!companies.data ? <p className="text-sm text-text-muted">{t(S.loading)}</p> : null}
        </FormSection>
      </Card>
      {editing ? <EditCompanyDialog company={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
