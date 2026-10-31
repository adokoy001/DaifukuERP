// /admin/companies (docs/specs/company-admin.md AC-9..AC-11), built with the UI kit: the tenant's companies, a create
// form, renaming in a kit Dialog, and after creation the switch to the new company with its first-setup links. Every
// write is the existing POST / PATCH /admin/companies (the API checks the tenant administrator); switching is the
// company picker's own path (stored selection + full page load, so no data of the previous company survives).
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { isApiError, setActiveCompany } from '../api/client.ts';
import {
  useAdminCompanies,
  useCreateCompany,
  useUpdateCompany,
  type AdminCompany,
  type CreatedCompany,
} from '../api/companies.ts';
import { useMe } from '../api/company.tsx';
import { ErrorDetails } from '../components/error-details.tsx';
import { Icon } from '../components/icon.tsx';
import { useToast } from '../components/toast.tsx';
import { useLocale } from '../i18n.tsx';
import {
  COMPANY_FIELD_LABEL,
  COMPANY_FIELDS,
  draftErrors,
  EMPTY_DRAFT,
  firstErrorField,
  issuesByField,
  normalizeDraft,
  SETUP_DESTINATIONS,
  type CompanyDraft,
  type CompanyField,
} from '../lib/companies.ts';
import { describeError, type ErrorView } from '../lib/error-view.ts';
import { formatTimestamp } from '../lib/format.ts';
import type { Label } from '../api/types.ts';
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
  readOnly,
  help,
  idPrefix,
}: {
  field: CompanyField;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  disabled: boolean;
  readOnly?: boolean;
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
        // Read-only rather than disabled while sending: a natively disabled input that has focus (Enter submits from it)
        // drops keyboard focus to <body> when the request fails with no field to return to.
        readOnly={readOnly || disabled}
        aria-disabled={disabled || undefined}
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

/** What a failed create shows: a localized lead first, then the server's text, then the technical details. */
interface CreateFailure {
  lead: Label;
  messages: string[];
  view?: ErrorView;
}

const NOT_CREATED: Label = {
  ja: '会社を作成できませんでした。何も保存されていません。',
  en: 'The company was not created; nothing was saved.',
};
const CHECK_VALUES: Label = { ja: '入力内容を確認してください。', en: 'Check the entered values.' };

/**
 * Moves focus to `field` once the form is editable again: a server answer arrives while the form is still busy
 * (inputs read-only), so the request is kept until the next render with `busy` false.
 */
function useFieldFocus(idPrefix: string, busy: boolean) {
  const [field, setField] = useState<CompanyField | null>(null);
  useEffect(() => {
    if (!field || busy) return;
    document.getElementById(`${idPrefix}-${field}`)?.focus();
    setField(null);
  }, [field, busy, idPrefix]);
  return setField;
}

function CreateCompanyForm({ onCreated, onCancel }: { onCreated: (c: CreatedCompany) => void; onCancel: () => void }) {
  const { t } = useLocale();
  const idPrefix = useId();
  const create = useCreateCompany();
  const busy = create.isPending;
  const [draft, setDraft] = useState<CompanyDraft>(EMPTY_DRAFT);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<CreateFailure | null>(null);
  const focusField = useFieldFocus(idPrefix, busy);
  // The form replaces the "Add company" button: start the keyboard user in its first field.
  useEffect(() => {
    document.getElementById(`${idPrefix}-code`)?.focus();
  }, [idPrefix]);
  const help: Partial<Record<CompanyField, string>> = {
    code: t({
      ja: '英大文字・数字・_・-（1〜20 文字）。作成後は変更できません。',
      en: 'A–Z, 0–9, _ and - (1–20). It cannot be changed later.',
    }),
    currency: t({
      ja: '現在は JPY の会社だけを作成できます（売上・仕入・入出金の伝票の確定が JPY だけに対応しているため）。作成後は変更できません。',
      en: 'Only JPY companies can be created for now (sales, purchase and payment documents can be submitted in JPY only). It cannot be changed later.',
    }),
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const value = normalizeDraft(draft);
    const local = draftErrors(value);
    const localErrors: FieldErrors = Object.fromEntries(
      Object.entries(local).map(([field, label]) => [field, t(label)]),
    );
    setErrors(localErrors);
    setFailure(null);
    const firstLocal = firstErrorField(localErrors);
    if (firstLocal) {
      focusField(firstLocal);
      return;
    }
    create.mutate(value, {
      onSuccess: (company) => onCreated(company),
      onError: (error) => {
        if (isApiError(error) && error.code === 'VALIDATION') {
          const mapped = issuesByField(error.issues(), t);
          setErrors(mapped.fields);
          const first = firstErrorField(mapped.fields);
          if (first) focusField(first);
          if (mapped.form.length || !first)
            setFailure({ lead: CHECK_VALUES, messages: mapped.form.length ? mapped.form : [error.message] });
        } else setFailure({ lead: NOT_CREATED, messages: [], view: describeError(error) });
      },
    });
  };
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
              readOnly={field === 'currency'}
              help={help[field]}
              idPrefix={idPrefix}
            />
          ))}
        </div>
        {failure ? (
          <div role="alert" className="ui-notice ui-notice-danger mt-3" data-testid="company-create-error">
            <p className="font-semibold">{t(failure.lead)}</p>
            {failure.view?.explanation ? <p>{t(failure.view.explanation)}</p> : null}
            {failure.view ? <p>{failure.view.message}</p> : null}
            {failure.messages.map((message) => (
              <p key={message}>{message}</p>
            ))}
            {failure.view ? <ErrorDetails view={failure.view} /> : null}
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {/* aria-disabled, not disabled, while sending: a natively disabled button drops keyboard focus to <body>. */}
          <Button type="submit" variant="primary" aria-disabled={busy || undefined} data-testid="company-create-submit">
            {busy ? t({ ja: '作成中…', en: 'Creating…' }) : t({ ja: '会社を作成', en: 'Create company' })}
          </Button>
          <Button onClick={onCancel} disabled={busy} data-testid="company-create-cancel">
            {t(S.cancel)}
          </Button>
        </div>
      </FormSection>
    </Card>
  );
}

function CreatedPanel({ company, onDismiss }: { company: CreatedCompany; onDismiss: () => void }) {
  const { t } = useLocale();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // The form (and the button that sent it) is gone: focus the result's heading, which also announces it.
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <Card as="div" role="group" aria-labelledby={headingId} data-testid="company-created">
      <div className="ui-form-section">
        <div className="ui-section-head">
          <h2 id={headingId} ref={heading} tabIndex={-1} className="ui-section-title">
            {t({ ja: `${company.name} を作成しました`, en: `${company.name} was created` })}
          </h2>
        </div>
        <p className="ui-section-description">
          {t({
            ja: `初期データ（${company.seededModules.length} 業務分）を投入し、あなたを管理者として所属させました。新しい会社に切り替えて初期設定を続けてください。`,
            en: `Initial data for ${company.seededModules.length} modules was loaded and you are its administrator. Switch to the new company to continue its setup.`,
          })}
        </p>
        <div className="flex flex-wrap gap-2">
          {SETUP_DESTINATIONS.map((destination, index) => (
            <Button
              key={destination.href}
              variant={index === 0 ? 'primary' : 'default'}
              onClick={() => switchTo(company.id, destination.href)}
              data-testid={index === 0 ? 'company-switch-setup' : undefined}
            >
              {t(destination.switchLabel)}
            </Button>
          ))}
          <Button variant="ghost" onClick={onDismiss} data-testid="company-created-dismiss">
            {t({ ja: 'このまま一覧に戻る', en: 'Stay on the list' })}
          </Button>
        </div>
      </div>
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
  const focusField = useFieldFocus(idPrefix, update.isPending);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (update.isPending) return;
    const value = normalizeDraft(draft);
    const local = draftErrors(value, ['name', 'country']);
    const localErrors: FieldErrors = Object.fromEntries(Object.entries(local).map(([f, label]) => [f, t(label)]));
    setErrors(localErrors);
    const firstLocal = firstErrorField(localErrors);
    if (firstLocal) {
      focusField(firstLocal);
      return;
    }
    update.mutate(
      { id: company.id, name: value.name, country: value.country },
      {
        onSuccess: () => {
          toast.success(t({ ja: '会社を更新しました', en: 'Company updated' }));
          onClose();
        },
        onError: (error) => {
          const mapped = isApiError(error) && error.code === 'VALIDATION' ? issuesByField(error.issues(), t) : null;
          const first = mapped ? firstErrorField(mapped.fields) : undefined;
          if (mapped) setErrors(mapped.fields);
          if (first) focusField(first);
          // Issues on no field of the dialog (or any other failure): the toast shows the message, hint and code.
          if (!first || mapped?.form.length) toast.error(error);
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
          <Button type="submit" variant="primary" aria-disabled={update.isPending || undefined}>
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
  loading,
  onEdit,
}: {
  items: readonly AdminCompany[];
  currentId: string | null;
  busy: boolean;
  /** First load: skeleton rows and a polite "Loading…" instead of an empty table. */
  loading: boolean;
  onEdit: (company: AdminCompany) => void;
}) {
  const { t, locale } = useLocale();
  return (
    <DataTableShell
      label={t({ ja: '会社の一覧', en: 'Companies' })}
      columnCount={6}
      busy={busy}
      skeleton={loading}
      loadingLabel={t(S.loading)}
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
  const addId = useId();
  // Cancelling the form or leaving the result panel unmounts what had focus: return it to "Add company".
  const [restoreAdd, setRestoreAdd] = useState(false);
  useEffect(() => {
    if (!restoreAdd || creating) return;
    document.getElementById(addId)?.focus();
    setRestoreAdd(false);
  }, [restoreAdd, creating, addId]);
  if (me.isError && !me.data) return <MetaError error={me.error} retry={() => void me.refetch()} />;
  if (!me.data) return <LoadingView />;
  // AC-2/AC-11: the navigation hides the screen; a direct URL explains instead of failing.
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
              id={addId}
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
      {created ? (
        <CreatedPanel
          company={created}
          onDismiss={() => {
            setCreated(null);
            setRestoreAdd(true);
          }}
        />
      ) : null}
      {creating ? (
        <CreateCompanyForm
          onCancel={() => {
            setCreating(false);
            setRestoreAdd(true);
          }}
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
            loading={!companies.data}
            onEdit={setEditing}
          />
        </FormSection>
      </Card>
      {editing ? <EditCompanyDialog company={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}
