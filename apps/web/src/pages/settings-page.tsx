// web-phase1 AC-5: /settings — one form per setting declared by modules (GET /meta/settings), rendered from its JSON
// Schema; PUT /meta/settings/:key saves. Admin or the `settings` role only (the API enforces the same).
// ui-kit: each setting is a Card form with a FormSection; the page has a PageHeader.
import { useMemo } from 'react';
import { isApiError } from '../api/client.ts';
import { useMeta } from '../api/queries.ts';
import { canEditSettings, useSaveSetting, useSettings } from '../api/settings.ts';
import type { AppMeta, SettingMeta } from '../api/types.ts';
import { SchemaFields, useSchemaForm } from '../components/schema-form.tsx';
import { useToast } from '../components/toast.tsx';
import { useLocale } from '../i18n.tsx';
import { issuesToFieldErrors } from '../lib/form.ts';
import { refResolverFrom, schemaFields, stripSettingKey } from '../lib/schema.ts';
import { S } from '../strings.ts';
import { Button, Card, EmptyState, FormSection, PageHeader } from '../ui/index.ts';
import { LoadingView, MetaError } from './status-views.tsx';

function SettingCard({ setting, meta }: { setting: SettingMeta; meta: AppMeta }) {
  const { t } = useLocale();
  const toast = useToast();
  const fields = useMemo(
    () => schemaFields(setting.schema, refResolverFrom(meta.entities)),
    [setting.schema, meta.entities],
  );
  const form = useSchemaForm(fields, { current: setting.value, jsonOnly: setting.schema.type !== 'object' });
  const save = useSaveSetting();
  const idPrefix = `s-${setting.key.replace(/\./g, '-')}`;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const built = form.build();
    if (!built.ok) {
      form.setErrors(built.errors);
      return;
    }
    save.mutate(
      { key: setting.key, value: built.payload },
      {
        onSuccess: () => toast.success(t(S.settingSaved)),
        onError: (err) => {
          if (isApiError(err) && err.code === 'VALIDATION') {
            const mapped = issuesToFieldErrors(
              stripSettingKey(err.issues(), setting.key),
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

  return (
    <Card as="form" onSubmit={submit} noValidate aria-label={t(setting.label)} data-testid={`setting-${setting.key}`}>
      <FormSection
        title={t(setting.label)}
        meta={<span className="ui-code">{setting.key}</span>}
        actions={
          form.canToggle ? (
            <button type="button" className="ui-link" onClick={form.toggleJson}>
              {form.state.jsonMode ? t(S.edit) : t(S.rawJson)}
            </button>
          ) : null
        }
        description={setting.description ? t(setting.description) : undefined}
      >
        <SchemaFields fields={fields} form={form} disabled={save.isPending} idPrefix={idPrefix} />
        {form.state.errors._json && !form.state.jsonMode ? (
          <div role="alert" className="ui-field-error">
            {form.state.errors._json}
          </div>
        ) : null}
        <div>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? t(S.saving) : t(S.save)}
          </Button>
        </div>
      </FormSection>
    </Card>
  );
}

function SettingsView({ meta }: { meta: AppMeta }) {
  const { t } = useLocale();
  const allowed = canEditSettings(meta.roles);
  const settings = useSettings(allowed);
  if (!allowed) {
    return (
      <div role="alert" className="ui-notice ui-notice-warning">
        {t(S.settingsForbidden)}
      </div>
    );
  }
  if (settings.isError) return <MetaError error={settings.error} retry={() => void settings.refetch()} />;
  if (settings.isPending) return <LoadingView />;
  return (
    <div className="flex flex-col gap-3">
      {settings.data.length === 0 ? <EmptyState title={t(S.settingsEmpty)} /> : null}
      {settings.data.map((s) => (
        <SettingCard key={s.key} setting={s} meta={meta} />
      ))}
    </div>
  );
}

export function SettingsPage() {
  const { t } = useLocale();
  const meta = useMeta();
  if (meta.isError) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (meta.isPending) return <LoadingView />;
  return (
    <div className="flex flex-col gap-3 p-3">
      <PageHeader title={t(S.settings)} />
      <SettingsView meta={meta.data} />
    </div>
  );
}
