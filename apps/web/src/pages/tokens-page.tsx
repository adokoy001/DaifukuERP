// /admin/tokens (docs/specs/machine-credentials.md AC-27..AC-32), built with the UI kit: the tenant's API keys, an
// issue Dialog that confirms the administrator's current password (step-up) and shows the secret exactly once, revoke
// in a kit Dialog and the per-key history. The secret lives only in the issue Dialog's mutation result: closing the
// Dialog unmounts it and resets the mutation, and nothing writes it to the URL, storage, toasts, the console or the list.
// Text inside the dialogs uses <div>: the legacy `.action-dialog p` rule (styles.css) mutes every paragraph to a grey
// that fails WCAG contrast at 12px, and it outranks the kit's notice and field-error colours.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getUser, isApiError } from '../api/client.ts';
import { useMe } from '../api/company.tsx';
import { accountSecurity, stepUp } from '../api/identity.ts';
import {
  useIssueMachineCredential,
  useMachineCredentialAudit,
  useMachineCredentials,
  useRevokeMachineCredential,
} from '../api/tokens.ts';
import type { Label } from '../api/types.ts';
import { AccessRoleOptions, accessRoleLabel } from '../components/access-role-options.tsx';
import { Icon } from '../components/icon.tsx';
import { useLocale } from '../i18n.tsx';
import { describeError } from '../lib/error-view.ts';
import { formatTimestamp } from '../lib/format.ts';
import {
  auditOpLabel,
  draftErrors,
  emptyDraft,
  EXPIRY_CHOICES,
  expiryNote,
  firstErrorField,
  issueField,
  outcomeUnknown,
  PURPOSE_LABEL,
  reasonText,
  STATUS_LABEL,
  STATUS_TONE,
  UNUSED,
  usageText,
  type MachineCredential,
  type MachineCredentialList,
  type MachinePurpose,
  type TokenDraft,
  type TokenField,
} from '../lib/machine-credentials.ts';
import { S } from '../strings.ts';
import { Badge, Button, Card, DataTableShell, Dialog, EmptyState, FormSection, PageHeader } from '../ui/index.ts';
import { LoadingView, MetaError } from './status-views.tsx';

const ISSUE_LABEL: Label = { ja: 'API キーを発行', en: 'Issue API key' };
/** A step-up token lives 5 minutes on the server; reuse it for a retry only well within that time. */
const STEP_UP_REUSE_MS = 240_000;

function FieldError({ id, text }: { id: string; text: string | undefined }) {
  return text ? (
    <div id={id} className="ui-field-error">
      {text}
    </div>
  ) : null;
}

function TextInput({
  id,
  label,
  value,
  error,
  busy,
  onChange,
  type = 'text',
  maxLength,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  error: string | undefined;
  busy: boolean;
  onChange: (value: string) => void;
  type?: 'text' | 'password';
  maxLength: number;
  autoComplete: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-text-secondary">
        {label}
      </label>
      <input
        id={id}
        className="input w-full"
        type={type}
        value={value}
        maxLength={maxLength}
        // Read-only rather than disabled while sending: a disabled focused input drops keyboard focus to <body>.
        readOnly={busy}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldError id={`${id}-error`} text={error} />
    </div>
  );
}

function SecretPanel({ token, purpose }: { token: string; purpose: MachinePurpose }) {
  const { t } = useLocale();
  const headingId = useId();
  const secretId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<Label | null>(null);
  const usage = usageText(purpose);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const copy = async () => {
    try {
      if (!globalThis.navigator?.clipboard) throw new Error('no clipboard');
      await globalThis.navigator.clipboard.writeText(token);
      setCopied({ ja: 'API キーをコピーしました。', en: 'The API key was copied.' });
    } catch {
      input.current?.focus();
      input.current?.select();
      setCopied({
        ja: 'クリップボードを使えません。欄の文字を選択したので Ctrl+C（Mac は ⌘+C）でコピーしてください。',
        en: 'The clipboard is not available. The key is selected: press Ctrl+C (⌘+C on a Mac) to copy it.',
      });
    }
  };
  return (
    <div role="group" aria-labelledby={headingId} className="flex flex-col gap-3" data-testid="token-secret">
      <h3 id={headingId} ref={heading} tabIndex={-1} className="ui-section-title">
        {t({ ja: 'API キーを発行しました', en: 'The API key was issued' })}
      </h3>
      <div className="ui-notice ui-notice-warning" data-testid="token-secret-warning">
        {t({
          ja: 'この画面を閉じると二度と表示できません。安全な場所に保存してください。',
          en: 'It cannot be shown again after you close this window. Store it somewhere safe.',
        })}
      </div>
      <label htmlFor={secretId} className="text-sm font-semibold text-text-secondary">
        {t({ ja: 'API キー（一度だけ表示）', en: 'API key (shown once)' })}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={secretId}
          ref={input}
          className="input min-w-0 flex-1 font-mono"
          readOnly
          value={token}
          autoComplete="off"
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
          data-testid="token-secret-value"
        />
        <Button onClick={() => void copy()} data-testid="token-copy">
          {t({ ja: 'コピー', en: 'Copy' })}
        </Button>
      </div>
      <div role="status" aria-live="polite" className="text-sm" data-testid="token-copy-status">
        {copied ? t(copied) : ''}
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-sm">{t(usage.label)}</div>
        <code className="break-all text-sm">{usage.snippet}</code>
      </div>
    </div>
  );
}

function IssueDialog({
  list,
  defaultCompanyId,
  mfaEnabled,
  onClose,
}: {
  list: MachineCredentialList;
  defaultCompanyId: string;
  mfaEnabled: boolean;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const idPrefix = useId();
  const issue = useIssueMachineCredential();
  const [draft, setDraft] = useState<TokenDraft>(() => emptyDraft(defaultCompanyId));
  const [errors, setErrors] = useState<Partial<Record<TokenField, string>>>({});
  const [failure, setFailure] = useState<Label | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [focusField, setFocusField] = useState<TokenField | null>(null);
  const stepUpToken = useRef<{ token: string; at: number } | null>(null);
  const busy = verifying || issue.isPending;
  const fieldId = (field: TokenField) => `${idPrefix}-${field}`;
  useEffect(() => {
    if (!focusField || busy) return;
    document.getElementById(`${idPrefix}-${focusField}`)?.focus();
    setFocusField(null);
  }, [focusField, busy, idPrefix]);
  const close = () => {
    // AC-29: drop the secret from React Query and from this component before it unmounts.
    issue.reset();
    stepUpToken.current = null;
    onClose();
  };
  const set = <K extends keyof TokenDraft>(key: K, value: TokenDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || issue.data) return;
    const local = draftErrors(draft, mfaEnabled);
    if (stepUpToken.current && Date.now() - stepUpToken.current.at < STEP_UP_REUSE_MS) {
      delete local.password;
      delete local.code;
    }
    const localText = Object.fromEntries(Object.entries(local).map(([k, v]) => [k, t(v)]));
    setErrors(localText);
    setFailure(null);
    const firstLocal = firstErrorField(localText);
    if (firstLocal) {
      setFocusField(firstLocal);
      return;
    }
    let token =
      stepUpToken.current && Date.now() - stepUpToken.current.at < STEP_UP_REUSE_MS ? stepUpToken.current.token : null;
    if (!token) {
      setVerifying(true);
      try {
        token = (await stepUp(draft.password, draft.code.trim() || undefined)).stepUpToken;
        stepUpToken.current = { token, at: Date.now() };
        setDraft((d) => ({ ...d, password: '', code: '' }));
      } catch (error) {
        const wrong = isApiError(error) && error.code === 'VALIDATION';
        setErrors({
          [mfaEnabled && wrong && error.issues().some((i) => i.path === 'code') ? 'code' : 'password']: wrong
            ? t({ ja: 'パスワードまたは認証コードが正しくありません。', en: 'The password or code is incorrect.' })
            : t({ ja: '本人確認できませんでした。', en: 'Your identity could not be confirmed.' }),
        });
        setFocusField('password');
        return;
      } finally {
        setVerifying(false);
      }
    }
    issue.mutate(
      {
        name: draft.name.trim(),
        purpose: draft.purpose,
        companyId: draft.companyId,
        roles: draft.roles,
        expiresInDays: draft.expiresInDays,
        stepUpToken: token,
      },
      {
        onSuccess: () => {
          stepUpToken.current = null;
          setDraft((d) => ({ ...d, password: '', code: '' }));
        },
        onError: (error) => {
          if (isApiError(error) && error.code === 'VALIDATION') {
            const mapped: Partial<Record<TokenField, string>> = {};
            const rest: string[] = [];
            for (const issueItem of error.issues()) {
              const field = issueField(issueItem.path);
              if (field && !mapped[field]) mapped[field] = issueItem.message;
              else if (!field) rest.push(issueItem.message);
            }
            setErrors(mapped);
            const first = firstErrorField(mapped);
            if (first) setFocusField(first);
            if (rest.length || !first)
              setFailure({
                ja: `入力内容を確認してください。${rest.join(' ')}`,
                en: `Check the entered values. ${rest.join(' ')}`,
              });
          } else if (outcomeUnknown(isApiError(error) ? error.status : undefined)) {
            setFailure({
              ja: '発行されたか確認できません。一覧で「未使用」の鍵を確認し、心当たりのない鍵は失効させてください。',
              en: 'It is not known whether the key was issued. Check the list for an "Unused" key you do not recognize and revoke it.',
            });
          } else {
            const view = describeError(error);
            setFailure({ ja: view.message, en: view.message });
          }
        },
      },
    );
  };
  const issued = issue.data;
  const help = (field: TokenField) => (errors[field] ? `${fieldId(field)}-error` : undefined);
  return (
    <Dialog
      title={t(ISSUE_LABEL)}
      description={
        issued
          ? undefined
          : t({
              ja: '連携先や AI エージェントが使う鍵を発行します。鍵は人と同じ権限検査を通り、選んだ会社とロールの範囲だけを操作できます。',
              en: 'Issue a key for an integration or an AI agent. It passes the same permission checks as a person and works only in the chosen company with the chosen roles.',
            })
      }
      icon={<Icon name="key" />}
      onClose={close}
      closeLabel={t(S.close)}
      className="token-dialog"
      {...(issued ? {} : { onSubmit: (event: FormEvent<HTMLFormElement>) => void submit(event) })}
      actions={
        issued ? (
          <Button variant="primary" onClick={close} data-testid="token-secret-close">
            {t(S.close)}
          </Button>
        ) : (
          <>
            <Button onClick={close} disabled={busy} data-autofocus>
              {t(S.cancel)}
            </Button>
            {/* aria-disabled, not disabled, while sending: a natively disabled button drops keyboard focus. */}
            <Button type="submit" variant="primary" aria-disabled={busy || undefined} data-testid="token-issue-submit">
              {busy ? t({ ja: '発行中…', en: 'Issuing…' }) : t({ ja: '発行', en: 'Issue' })}
            </Button>
          </>
        )
      }
    >
      {issued ? (
        <SecretPanel token={issued.token} purpose={issued.credential.purpose} />
      ) : (
        <div className="flex flex-col gap-3" data-testid="token-issue-form">
          <TextInput
            id={fieldId('name')}
            label={t({ ja: '名前（用途がわかる名前）', en: 'Name (what it is for)' })}
            value={draft.name}
            error={errors.name}
            busy={busy}
            maxLength={100}
            autoComplete="off"
            onChange={(value) => set('name', value)}
          />
          <fieldset className="flex flex-col gap-1" id={fieldId('purpose')} tabIndex={-1}>
            <legend className="text-sm font-semibold text-text-secondary">{t({ ja: '用途', en: 'Purpose' })}</legend>
            {(['integration', 'mcp'] as const).map((purpose) => (
              <label key={purpose} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`${idPrefix}-purpose`}
                  value={purpose}
                  checked={draft.purpose === purpose}
                  disabled={busy}
                  onChange={() => set('purpose', purpose)}
                />
                {t(PURPOSE_LABEL[purpose])}
              </label>
            ))}
            <FieldError id={`${fieldId('purpose')}-error`} text={errors.purpose} />
          </fieldset>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={fieldId('companyId')} className="text-sm font-semibold text-text-secondary">
                {t({ ja: '会社', en: 'Company' })}
              </label>
              <select
                id={fieldId('companyId')}
                className="input w-full"
                value={draft.companyId}
                disabled={busy}
                aria-invalid={errors.companyId ? true : undefined}
                aria-describedby={help('companyId')}
                onChange={(event) => set('companyId', event.target.value)}
              >
                {list.companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.code} {company.name}
                  </option>
                ))}
              </select>
              <FieldError id={`${fieldId('companyId')}-error`} text={errors.companyId} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={fieldId('expiresInDays')} className="text-sm font-semibold text-text-secondary">
                {t({ ja: '有効期間', en: 'Valid for' })}
              </label>
              <select
                id={fieldId('expiresInDays')}
                className="input w-full"
                value={draft.expiresInDays}
                disabled={busy}
                aria-describedby={help('expiresInDays')}
                onChange={(event) => set('expiresInDays', Number(event.target.value))}
              >
                {EXPIRY_CHOICES.map((days) => (
                  <option key={days} value={days}>
                    {t({ ja: `${days} 日`, en: `${days} days` })}
                  </option>
                ))}
              </select>
              <FieldError id={`${fieldId('expiresInDays')}-error`} text={errors.expiresInDays} />
            </div>
          </div>
          <fieldset
            className="flex flex-col gap-1"
            id={fieldId('roles')}
            tabIndex={-1}
            aria-describedby={help('roles')}
            aria-invalid={errors.roles ? true : undefined}
          >
            <legend className="text-sm font-semibold text-text-secondary">
              {t({ ja: 'ロール（鍵が持つ業務権限）', en: 'Roles (what the key may do)' })}
            </legend>
            <AccessRoleOptions
              options={list.roles}
              value={draft.roles}
              onChange={(roles) => set('roles', roles)}
              disabled={busy}
            />
            <FieldError id={`${fieldId('roles')}-error`} text={errors.roles} />
            {draft.roles.includes('admin') ? (
              <div className="ui-notice ui-notice-warning" data-testid="token-admin-warning">
                {t({
                  ja: '会社のすべての業務を操作できる鍵になります。必要なロールだけを選ぶことを勧めます。',
                  en: 'This key can operate every business area of the company. Prefer choosing only the roles it needs.',
                })}
              </div>
            ) : null}
          </fieldset>
          <TextInput
            id={fieldId('password')}
            label={t({ ja: '現在のパスワード（本人確認）', en: 'Current password (confirm it is you)' })}
            type="password"
            value={draft.password}
            error={errors.password}
            busy={busy}
            maxLength={200}
            autoComplete="current-password"
            onChange={(value) => set('password', value)}
          />
          {mfaEnabled ? (
            <TextInput
              id={fieldId('code')}
              label={t({ ja: '認証コード・回復コード', en: 'Authenticator or recovery code' })}
              value={draft.code}
              error={errors.code}
              busy={busy}
              maxLength={64}
              autoComplete="one-time-code"
              onChange={(value) => set('code', value)}
            />
          ) : null}
          {failure ? (
            <div role="alert" className="ui-notice ui-notice-danger" data-testid="token-issue-error">
              {t(failure)}
            </div>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

function RevokeDialog({
  item,
  onClose,
  onRevoked,
}: {
  item: MachineCredential;
  onClose: () => void;
  onRevoked: (item: MachineCredential) => void;
}) {
  const { t } = useLocale();
  const reasonId = useId();
  const revoke = useRevokeMachineCredential();
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (revoke.isPending) return;
    setFailure(null);
    revoke.mutate(
      { id: item.id, ...(reason.trim() ? { reason: reason.trim() } : {}) },
      {
        onSuccess: (result) => onRevoked(result.credential),
        onError: (error) => setFailure(describeError(error).message),
      },
    );
  };
  return (
    <Dialog
      title={t({ ja: `「${item.name}」を失効`, en: `Revoke "${item.name}"` })}
      description={t({
        ja: 'この鍵を使う連携・エージェントは次の要求から拒否（401）されます。失効は取り消せません。必要なら新しい鍵を発行してください。',
        en: 'Integrations and agents using this key are refused (401) from their next request. This cannot be undone; issue a new key if needed.',
      })}
      onClose={onClose}
      closeLabel={t(S.close)}
      onSubmit={submit}
      actions={
        <>
          <Button onClick={onClose} disabled={revoke.isPending} data-autofocus>
            {t(S.cancel)}
          </Button>
          <Button
            type="submit"
            variant="danger"
            aria-disabled={revoke.isPending || undefined}
            data-testid="token-revoke-confirm"
          >
            {t({ ja: '失効する', en: 'Revoke' })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <label htmlFor={reasonId} className="text-sm font-semibold text-text-secondary">
          {t({ ja: '理由（任意、200 文字まで）', en: 'Reason (optional, up to 200 characters)' })}
        </label>
        <input
          id={reasonId}
          className="input w-full"
          value={reason}
          maxLength={200}
          readOnly={revoke.isPending}
          onChange={(event) => setReason(event.target.value)}
        />
        {failure ? (
          <div role="alert" className="ui-notice ui-notice-danger">
            {failure}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function HistoryDialog({ item, onClose }: { item: MachineCredential; onClose: () => void }) {
  const { t, locale } = useLocale();
  const audit = useMachineCredentialAudit(item.id);
  return (
    <Dialog
      title={t({ ja: `「${item.name}」の履歴`, en: `History of "${item.name}"` })}
      description={t({
        ja: '発行・失効と、拒否された利用（同じ理由は 1 時間に 1 件）を新しい順に表示します。鍵で行った業務の記録は各記録の履歴で確認します。',
        en: 'Issue, revoke and refused uses (one per reason per hour), newest first. Business changes made with the key are in each record’s own history.',
      })}
      onClose={onClose}
      closeLabel={t(S.close)}
      actions={
        <Button onClick={onClose} data-autofocus>
          {t(S.close)}
        </Button>
      }
    >
      {audit.isError ? (
        <div role="alert" className="ui-notice ui-notice-danger">
          {describeError(audit.error).message}
        </div>
      ) : (
        <DataTableShell
          label={t({ ja: '鍵の履歴', en: 'Key history' })}
          columnCount={4}
          skeleton={!audit.data}
          skeletonRows={3}
          loadingLabel={t(S.loading)}
          testId="token-history"
          head={
            <tr>
              <th scope="col">{t({ ja: '日時', en: 'Time' })}</th>
              <th scope="col">{t({ ja: '操作', en: 'Event' })}</th>
              <th scope="col">{t({ ja: '操作者', en: 'By' })}</th>
              <th scope="col">{t({ ja: '理由', en: 'Reason' })}</th>
            </tr>
          }
        >
          {(audit.data?.items ?? []).map((entry) => {
            const reason = reasonText(entry.reason);
            return (
              <tr key={entry.id} data-testid={`token-history-${entry.op}`}>
                <td>{formatTimestamp(entry.at, locale)}</td>
                <td>{t(auditOpLabel(entry.op))}</td>
                <td>
                  {entry.actorType === 'user'
                    ? (entry.actorName ?? entry.actorId)
                    : entry.actorType === 'machine'
                      ? t({ ja: 'この API キー', en: 'This API key' })
                      : entry.actorType}
                </td>
                <td>{reason ? t(reason) : '—'}</td>
              </tr>
            );
          })}
        </DataTableShell>
      )}
    </Dialog>
  );
}

function TokenTable({
  data,
  busy,
  loading,
  empty,
  onRevoke,
  onHistory,
}: {
  data: MachineCredentialList | undefined;
  busy: boolean;
  loading: boolean;
  empty: ReactNode;
  onRevoke: (item: MachineCredential) => void;
  onHistory: (item: MachineCredential) => void;
}) {
  const { t, locale } = useLocale();
  const now = new Date();
  return (
    <DataTableShell
      label={t({ ja: 'API キーの一覧', en: 'API keys' })}
      columnCount={10}
      busy={busy}
      skeleton={loading}
      loadingLabel={t(S.loading)}
      isEmpty={Boolean(data && !data.items.length)}
      empty={empty}
      testId="token-table"
      head={
        <tr>
          <th scope="col">{t({ ja: '名前', en: 'Name' })}</th>
          <th scope="col">{t({ ja: '用途', en: 'Purpose' })}</th>
          <th scope="col">{t({ ja: '会社', en: 'Company' })}</th>
          <th scope="col">{t({ ja: 'ロール', en: 'Roles' })}</th>
          <th scope="col">{t({ ja: '発行者', en: 'Issued by' })}</th>
          <th scope="col">{t({ ja: '発行日時', en: 'Issued' })}</th>
          <th scope="col">{t({ ja: '期限', en: 'Expires' })}</th>
          <th scope="col">{t({ ja: '最終使用', en: 'Last used' })}</th>
          <th scope="col">{t({ ja: '状態', en: 'Status' })}</th>
          <th scope="col">{t({ ja: '操作', en: 'Actions' })}</th>
        </tr>
      }
    >
      {(data?.items ?? []).map((item) => {
        const note = expiryNote(item, now);
        return (
          <tr key={item.id} data-testid={`token-row-${item.id}`}>
            <td>{item.name}</td>
            <td>{t(PURPOSE_LABEL[item.purpose])}</td>
            <td>
              <code>{item.companyCode}</code> {item.companyName}
            </td>
            <td>{item.roles.map((role) => t(accessRoleLabel(role))).join('、')}</td>
            <td>{item.issuedBy.name}</td>
            <td>{formatTimestamp(item.createdAt, locale)}</td>
            <td>
              {formatTimestamp(item.expiresAt, locale)}
              {note ? (
                <>
                  {' '}
                  <Badge tone="warning">{t(note)}</Badge>
                </>
              ) : null}
            </td>
            <td>{item.lastUsedAt ? formatTimestamp(item.lastUsedAt, locale) : t(UNUSED)}</td>
            <td>
              <Badge tone={STATUS_TONE[item.status]} data-testid="token-status">
                {t(STATUS_LABEL[item.status])}
              </Badge>
            </td>
            <td>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  id={`token-history-${item.id}`}
                  onClick={() => onHistory(item)}
                  aria-label={t({ ja: `${item.name} の履歴`, en: `History of ${item.name}` })}
                >
                  {t({ ja: '履歴', en: 'History' })}
                </Button>
                {item.status === 'active' || item.status === 'suspended' ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => onRevoke(item)}
                    aria-label={t({ ja: `${item.name} を失効`, en: `Revoke ${item.name}` })}
                    data-testid="token-revoke"
                  >
                    {t({ ja: '失効', en: 'Revoke' })}
                  </Button>
                ) : null}
              </div>
            </td>
          </tr>
        );
      })}
    </DataTableShell>
  );
}

export function TokensPage() {
  const { t } = useLocale();
  const me = useMe();
  const admin = me.data?.user.tenantAdmin === true;
  const list = useMachineCredentials(admin);
  const security = useQuery({
    queryKey: ['account-security', getUser()?.id],
    queryFn: ({ signal }) => accountSecurity(signal),
    enabled: admin,
    gcTime: 0,
    retry: false,
  });
  const [issuing, setIssuing] = useState(false);
  const [revoking, setRevoking] = useState<MachineCredential | null>(null);
  const [history, setHistory] = useState<MachineCredential | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [focusHistory, setFocusHistory] = useState<string | null>(null);
  const noticeId = useId();
  useEffect(() => {
    if (!focusHistory || revoking) return;
    document.getElementById(`token-history-${focusHistory}`)?.focus();
    setFocusHistory(null);
  }, [focusHistory, revoking]);
  if (me.isError && !me.data) return <MetaError error={me.error} retry={() => void me.refetch()} />;
  if (!me.data) return <LoadingView />;
  // AC-31: the navigation hides the screen; a direct URL explains instead of calling the API.
  if (!admin)
    return (
      <div className="workspace-page">
        <EmptyState
          titleAs="h1"
          testId="tokens-forbidden"
          title={t({
            ja: 'API キーの管理はテナント管理者だけが行えます',
            en: 'Only tenant administrators manage API keys',
          })}
          description={t({
            ja: '連携や AI エージェント用の鍵が必要なら、テナント管理者に発行を依頼してください。',
            en: 'Ask a tenant administrator to issue a key for an integration or an AI agent.',
          })}
        />
      </div>
    );
  if (list.isError && !list.data) return <MetaError error={list.error} retry={() => void list.refetch()} />;
  const configured = security.data?.configured === true;
  const canIssue = configured && Boolean(list.data);
  const openIssue = () => {
    if (!canIssue) return;
    setAnnouncement('');
    setIssuing(true);
  };
  const issueButton = (testId: string) => (
    <Button
      variant="primary"
      onClick={openIssue}
      aria-disabled={!canIssue || undefined}
      aria-describedby={security.data && !configured ? noticeId : undefined}
      data-testid={testId}
    >
      {t(ISSUE_LABEL)}
    </Button>
  );
  const defaultCompanyId = me.data.companyId ?? list.data?.companies[0]?.id ?? '';
  return (
    <div className="workspace-page flex flex-col gap-4" data-testid="tokens-page">
      <PageHeader
        eyebrow="API KEYS"
        title={t({ ja: 'API キー', en: 'API keys' })}
        subtitle={t({
          ja: '外部連携や AI エージェント（MCP）が使う鍵を、期限・会社・ロールを決めて発行・失効します。鍵は人と同じ権限検査を通ります。',
          en: 'Issue and revoke keys for integrations and AI agents (MCP) with an expiry, a company and roles. Keys pass the same permission checks as people.',
        })}
        icon={<Icon name="key" size={24} />}
        actions={issueButton('token-issue')}
      />
      {security.data && !configured ? (
        <p id={noticeId} className="ui-notice ui-notice-info" data-testid="tokens-unconfigured">
          {t({
            ja: 'API キーの発行には本人確認（パスワードの再確認）の設定が必要です。運用管理者に IDENTITY_ENCRYPTION_KEY の設定を依頼してください。一覧・失効・履歴はこのまま使えます。',
            en: 'Issuing API keys needs account verification (password re-confirmation). Ask the operator to configure IDENTITY_ENCRYPTION_KEY. Listing, revoking and the history work without it.',
          })}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite" data-testid="tokens-announcement">
        {announcement}
      </p>
      <Card>
        <FormSection
          landmark
          title={t({ ja: '鍵の一覧', en: 'Keys' })}
          description={t({
            ja: '有効な鍵は 100 件まで、期限は最長 365 日です。発行後に名前・ロール・期限は変えられません。変えるときは新しく発行し、古い鍵を失効させます。',
            en: 'Up to 100 active keys, valid for at most 365 days. Name, roles and expiry cannot change after issue: issue a new key and revoke the old one.',
          })}
        >
          <TokenTable
            data={list.data}
            busy={list.isFetching}
            loading={!list.data}
            onRevoke={setRevoking}
            onHistory={setHistory}
            empty={
              <EmptyState
                testId="tokens-empty"
                icon={<Icon name="key" />}
                title={t({ ja: 'API キーはまだありません', en: 'No API keys yet' })}
                description={t({
                  ja: '連携先のサーバーや AI エージェントに人のパスワードを渡す代わりに、用途ごとの鍵を発行します。',
                  en: "Issue a key per purpose instead of handing a person's password to an integration server or an AI agent.",
                })}
                action={issueButton('token-issue-empty')}
              />
            }
          />
          {list.data?.truncated ? (
            <p className="ui-notice ui-notice-info mt-3" data-testid="tokens-truncated">
              {t({
                ja: '古い失効済み・期限切れの鍵は表示していません。有効な鍵はすべて表示しています。',
                en: 'Older revoked and expired keys are not shown. Every active key is shown.',
              })}
            </p>
          ) : null}
        </FormSection>
      </Card>
      {issuing && list.data ? (
        <IssueDialog
          list={list.data}
          defaultCompanyId={defaultCompanyId}
          mfaEnabled={security.data?.mfaEnabled === true}
          onClose={() => setIssuing(false)}
        />
      ) : null}
      {revoking ? (
        <RevokeDialog
          item={revoking}
          onClose={() => setRevoking(null)}
          onRevoked={(item) => {
            setAnnouncement(t({ ja: `「${item.name}」を失効しました`, en: `"${item.name}" was revoked` }));
            setFocusHistory(item.id);
            setRevoking(null);
          }}
        />
      ) : null}
      {history ? <HistoryDialog item={history} onClose={() => setHistory(null)} /> : null}
    </div>
  );
}
