// settings-console AC-9..AC-12: one company setting as a kit Card form — labelled fields (code pickers, checkboxes,
// textareas), whether the module default applies and what it is, "reset to default" behind a kit Dialog, and the
// change history. Saving is PUT /meta/settings/:key; resetting is DELETE (the API checks the role either way).
import { useId, useMemo, useState, type FormEvent } from 'react';
import { isApiError } from '../api/client.ts';
import { useResetSetting, useSaveSetting, useSettingHistory } from '../api/settings.ts';
import type { AppMeta, SettingMeta } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { issuesToFieldErrors } from '../lib/form.ts';
import { refResolverFrom, stripSettingKey, toFieldMeta, type SchemaField } from '../lib/schema.ts';
import {
  actorText,
  canReset,
  changeRows,
  changeTime,
  fill,
  invalidStoredText,
  opLabel,
  SC,
  settingForm,
  settingFormValue,
  settingPayload,
  storedValueInvalid,
  valueText,
} from '../lib/settings-console.ts';
import { S } from '../strings.ts';
import { Badge, Button, Card, Dialog, FormSection, Skeleton } from '../ui/index.ts';
import { FieldWidget } from './fields/field-widget.tsx';
import { Icon } from './icon.tsx';
import { SchemaFields, useSchemaForm } from './schema-form.tsx';
import { SettingCodeField } from './setting-code-field.tsx';
import { useToast } from './toast.tsx';

type SettingForm = ReturnType<typeof useSchemaForm>;

function SettingFields({
  fields,
  form,
  disabled,
  idPrefix,
}: {
  fields: readonly SchemaField[];
  form: SettingForm;
  disabled: boolean;
  idPrefix: string;
}) {
  if (form.state.jsonMode) return <SchemaFields fields={fields} form={form} disabled={disabled} idPrefix={idPrefix} />;
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-3">
      {fields.map((f) =>
        f.widget === 'account-code' || f.widget === 'warehouse-code' ? (
          <SettingCodeField
            key={f.name}
            field={f}
            widget={f.widget}
            value={form.state.values[f.name] ?? ''}
            onChange={(v) => form.setValue(f.name, v)}
            disabled={disabled}
            error={form.state.errors[f.name]}
            idPrefix={idPrefix}
          />
        ) : (
          <FieldWidget
            key={f.name}
            idPrefix={idPrefix}
            field={toFieldMeta(f)}
            value={form.state.values[f.name] ?? ''}
            onChange={(v) => form.setValue(f.name, v)}
            disabled={disabled}
            error={form.state.errors[f.name]}
          />
        ),
      )}
    </div>
  );
}

function SettingHistory({ setting, id }: { setting: SettingMeta; id: string }) {
  const { t, locale } = useLocale();
  const history = useSettingHistory(setting.key, true);
  return (
    <div id={id} className="flex flex-col gap-1 border-t border-border-subtle pt-2" data-testid="setting-history">
      <p className="text-[11px] text-text-muted">{t(SC.historyNote)}</p>
      {history.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-1">
          <Skeleton width="70%" />
          <Skeleton width="50%" />
        </div>
      ) : null}
      {history.isError ? (
        <div role="alert" className="ui-notice ui-notice-danger text-xs">
          {t(S.loadFailed)}
          {isApiError(history.error) ? ` (${history.error.code})` : null}
        </div>
      ) : null}
      {history.data && history.data.length === 0 ? (
        <p className="text-xs text-text-muted">{t(SC.historyEmpty)}</p>
      ) : null}
      {history.data && history.data.length > 0 ? (
        <ol className="flex flex-col gap-1.5">
          {history.data.map((change) => (
            <li key={change.id} data-testid="setting-history-entry" className="flex min-w-0 flex-col gap-0.5 text-xs">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <time dateTime={change.at} className="font-mono">
                  {changeTime(change, locale)}
                </time>
                <Badge tone={change.op === 'delete' ? 'warning' : 'neutral'}>{t(opLabel(change.op))}</Badge>
                <span className="text-text-secondary">{actorText(change, locale)}</span>
                {change.action ? <span className="ui-code">{change.action}</span> : null}
              </div>
              <ul className="flex flex-col gap-0.5 pl-2">
                {changeRows(setting, change, locale).map((row, i) => (
                  <li key={i} className="break-words">
                    {row.label ? <span className="text-text-secondary">{row.label}: </span> : null}
                    <span className="font-mono text-text-muted">{row.before}</span>
                    <span aria-hidden="true" className="mx-1 text-text-muted">
                      →
                    </span>
                    <span className="sr-only"> → </span>
                    <span className="font-mono">{row.after}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function ResetDialog({
  setting,
  busy,
  templateNote,
  onConfirm,
  onClose,
}: {
  setting: SettingMeta;
  /** The DELETE is in flight: the confirm button is disabled and says so. */
  busy: boolean;
  /** A template is applied in this company: say that reset goes to the module default, not the template value. */
  templateNote: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
  const description =
    setting.defaultValue !== undefined
      ? fill(SC.resetDescriptionDefault, locale, { value: valueText(setting, setting.defaultValue, locale) })
      : t(SC.resetDescriptionNoDefault);
  return (
    <Dialog
      title={fill(SC.resetTitle, locale, { label: t(setting.label) })}
      description={description}
      closeLabel={t(S.close)}
      onClose={onClose}
      icon={
        <span className="icon-tile">
          <Icon name="settings" />
        </span>
      }
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onConfirm();
      }}
      actions={
        <>
          <Button onClick={onClose} data-autofocus>
            {t(SC.resetBack)}
          </Button>
          <Button type="submit" variant="danger" disabled={busy} aria-busy={busy}>
            {busy ? t(SC.resetting) : t(SC.reset)}
          </Button>
        </>
      }
    >
      {templateNote ? (
        <p className="text-xs text-text-secondary" data-testid="reset-template-note">
          {t(SC.resetTemplateNote)}
        </p>
      ) : null}
    </Dialog>
  );
}

export function SettingCard({
  setting,
  meta,
  templatesApplied = false,
}: {
  setting: SettingMeta;
  meta: AppMeta;
  /** Some template is applied in this company (its values are company values; reset does not return to them). */
  templatesApplied?: boolean;
}) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const refOf = useMemo(() => refResolverFrom(meta.entities), [meta.entities]);
  const { mode, fields } = useMemo(() => settingForm(setting, refOf), [setting, refOf]);
  const current = useMemo(() => settingFormValue(setting, mode), [setting, mode]);
  const form = useSchemaForm(fields, { current, jsonOnly: mode === 'json' });
  const save = useSaveSetting();
  const reset = useResetSetting();
  const [confirming, setConfirming] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyId = useId();
  const idPrefix = `s-${setting.key.replace(/\./g, '-')}`;
  const busy = save.isPending || reset.isPending;
  const invalidStored = storedValueInvalid(setting);
  const resettable = canReset(setting, mode);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const built = form.build();
    if (!built.ok) {
      form.setErrors(built.errors);
      return;
    }
    save.mutate(
      { key: setting.key, value: form.state.jsonMode ? built.payload : settingPayload(mode, built.payload) },
      {
        onSuccess: () => toast.success(t(S.settingSaved)),
        onError: (err) => {
          if (isApiError(err) && err.code === 'VALIDATION') {
            const issues = stripSettingKey(err.issues(), setting.key).map((i) =>
              mode === 'scalar' && i.path === '' ? { ...i, path: 'value' } : i,
            );
            const mapped = issuesToFieldErrors(
              issues,
              fields.map((f) => f.name),
            );
            form.setErrors(
              form.state.jsonMode
                ? { _json: [...Object.values(mapped.fieldErrors), ...mapped.formErrors].join('; ') }
                : {
                    ...mapped.fieldErrors,
                    ...(mapped.formErrors.length > 0 ? { _json: mapped.formErrors.join('; ') } : {}),
                  },
            );
          }
          toast.error(err);
        },
      },
    );
  };

  const confirmReset = () =>
    reset.mutate(setting.key, {
      onSuccess: () => {
        setConfirming(false);
        toast.success(t(SC.resetDone));
        // The reset button is gone now (the value is the default), so focus goes to the card's save button.
        globalThis.setTimeout(() => document.getElementById(`${idPrefix}-save`)?.focus(), 0);
      },
      onError: (err) => {
        setConfirming(false);
        toast.error(err);
      },
    });

  const status = setting.isDefault ? (
    <Badge tone="neutral" data-testid="setting-status">
      {t(setting.defaultValue !== undefined ? SC.usingDefault : SC.notSet)}
    </Badge>
  ) : invalidStored ? (
    <Badge tone="warning" data-testid="setting-status">
      {t(SC.invalidBadge)}
    </Badge>
  ) : (
    <Badge tone="accent" data-testid="setting-status">
      {t(SC.customized)}
    </Badge>
  );

  return (
    <>
      <Card
        as="form"
        onSubmit={submit}
        noValidate
        aria-label={t(setting.label)}
        data-testid={`setting-${setting.key}`}
        data-default={setting.isDefault ? 'true' : 'false'}
      >
        <FormSection
          title={t(setting.label)}
          meta={
            <>
              {status}
              <span className="ui-code break-all">{setting.key}</span>
            </>
          }
          actions={
            form.canToggle && mode === 'object' ? (
              <button type="button" className="ui-link" onClick={form.toggleJson}>
                {form.state.jsonMode ? t(S.edit) : t(S.rawJson)}
              </button>
            ) : null
          }
          description={setting.description ? t(setting.description) : undefined}
        >
          {setting.defaultValue !== undefined ? (
            <p className="text-xs text-text-muted" data-testid="setting-default">
              <span className="font-medium text-text-secondary">{t(SC.defaultIs)}: </span>
              {valueText(setting, setting.defaultValue, locale)}
            </p>
          ) : null}
          {invalidStored ? (
            <div role="alert" className="ui-notice ui-notice-warning text-xs" data-testid="setting-invalid">
              {t(invalidStoredText(setting))}
            </div>
          ) : null}
          <SettingFields fields={fields} form={form} disabled={busy} idPrefix={idPrefix} />
          {form.state.errors._json && !form.state.jsonMode ? (
            <div role="alert" className="ui-field-error">
              {form.state.errors._json}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button id={`${idPrefix}-save`} type="submit" variant="primary" disabled={busy}>
              {save.isPending ? t(S.saving) : t(S.save)}
            </Button>
            {resettable ? (
              <Button onClick={() => setConfirming(true)} disabled={busy}>
                {t(SC.reset)}
              </Button>
            ) : null}
            <Button
              variant="ghost"
              aria-expanded={historyOpen}
              aria-controls={historyOpen ? historyId : undefined}
              onClick={() => setHistoryOpen((open) => !open)}
            >
              {t(SC.history)}
            </Button>
          </div>
          {historyOpen ? <SettingHistory setting={setting} id={historyId} /> : null}
        </FormSection>
      </Card>
      {/* Outside the card: the dialog is a form of its own, and forms do not nest. */}
      {confirming ? (
        <ResetDialog
          setting={setting}
          busy={reset.isPending}
          templateNote={templatesApplied}
          onConfirm={confirmReset}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
}
