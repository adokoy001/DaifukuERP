// web-phase1 AC-5: /settings — one form per setting declared by modules (GET /meta/settings), rendered from its JSON
// Schema; PUT /meta/settings/:key saves. Admin or the `settings` role only (the API enforces the same).
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
    <form
      onSubmit={submit}
      noValidate
      aria-label={t(setting.label)}
      data-testid={`setting-${setting.key}`}
      className="flex flex-col gap-2 rounded border border-neutral-200 bg-white p-3"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold">{t(setting.label)}</h2>
        <span className="font-mono text-xs text-neutral-400">{setting.key}</span>
        {form.canToggle ? (
          <button type="button" className="ml-auto text-[11px] text-sky-700 hover:underline" onClick={form.toggleJson}>
            {form.state.jsonMode ? t(S.edit) : t(S.rawJson)}
          </button>
        ) : null}
      </div>
      {setting.description ? <p className="text-xs text-neutral-500">{t(setting.description)}</p> : null}
      <SchemaFields fields={fields} form={form} disabled={save.isPending} idPrefix={idPrefix} />
      {form.state.errors._json && !form.state.jsonMode ? (
        <div role="alert" className="text-xs text-red-700">
          {form.state.errors._json}
        </div>
      ) : null}
      <div>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? t(S.saving) : t(S.save)}
        </button>
      </div>
    </form>
  );
}

function SettingsView({ meta }: { meta: AppMeta }) {
  const { t } = useLocale();
  const allowed = canEditSettings(meta.roles);
  const settings = useSettings(allowed);
  if (!allowed) {
    return (
      <div role="alert" className="m-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
        {t(S.settingsForbidden)}
      </div>
    );
  }
  if (settings.isError) return <MetaError error={settings.error} retry={() => void settings.refetch()} />;
  if (settings.isPending) return <LoadingView />;
  return (
    <div className="flex flex-col gap-3">
      {settings.data.length === 0 ? <p className="text-neutral-500">{t(S.settingsEmpty)}</p> : null}
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
      <h1 className="text-base font-semibold">{t(S.settings)}</h1>
      <SettingsView meta={meta.data} />
    </div>
  );
}
