import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { isApiError, request } from '../api/client.ts';
import { useMeta } from '../api/queries.ts';
import type { ActionMeta, AppMeta } from '../api/types.ts';
import { ActionConfirm } from '../components/action-confirm.tsx';
import { SchemaFields, useSchemaForm } from '../components/schema-form.tsx';
import { useToast } from '../components/toast.tsx';
import { Icon } from '../components/icon.tsx';
import { useLocale } from '../i18n.tsx';
import { issuesToFieldErrors } from '../lib/form.ts';
import { reportTitle } from '../lib/report.ts';
import { refResolverFrom, schemaFields } from '../lib/schema.ts';
import { LoadingView, MetaError } from './status-views.tsx';

function ActionView({ action, meta }: { action: ActionMeta; meta: AppMeta }) {
  const { t } = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const fields = useMemo(
    () => schemaFields(action.inputSchema, refResolverFrom(meta.entities, action.module)),
    [action, meta.entities],
  );
  const form = useSchemaForm(fields, {
    jsonOnly: action.inputSchema !== undefined && action.inputSchema.type !== 'object',
  });
  const [pending, setPending] = useState<Record<string, unknown>>();
  const [completed, setCompleted] = useState<{ input: Record<string, unknown>; result: unknown }>();
  const inFlight = useRef(false);
  const run = useMutation({
    mutationFn: (input: Record<string, unknown>) => request(`/actions/${action.name}`, { method: 'POST', body: input }),
  });
  const execute = (input: Record<string, unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(undefined);
    setCompleted(undefined);
    run.mutate(input, {
      onSuccess: async (result) => {
        setCompleted({ input, result });
        await qc.invalidateQueries();
      },
      onError: (err) => {
        if (isApiError(err) && err.code === 'VALIDATION')
          form.setErrors(
            issuesToFieldErrors(
              err.issues(),
              fields.map((f) => f.name),
            ).fieldErrors,
          );
        toast.error(err);
      },
      onSettled: () => {
        inFlight.current = false;
      },
    });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (run.isPending) return;
    const built = form.build();
    if (!built.ok) {
      form.setErrors(built.errors);
      return;
    }
    const input = built.payload as Record<string, unknown>;
    if (action.mutates) setPending(input);
    else execute(input);
  };
  return (
    <div className="workspace-page business-action-page">
      <Link className="text-sky-700" to="/templates">
        ← {t({ ja: '業界テンプレート', en: 'Industry templates' })}
      </Link>
      <header className="business-action-heading">
        <span className="icon-tile">
          <Icon name="document" />
        </span>
        <div>
          <h1>{t(reportTitle(action))}</h1>
          <p>{t(action.description)}</p>
        </div>
      </header>
      <form data-testid="business-action-form" className="business-action-form" onSubmit={submit}>
        <SchemaFields fields={fields} form={form} disabled={run.isPending} idPrefix="action" />
        {form.canToggle ? (
          <details>
            <summary>{t({ ja: '詳細入力', en: 'Advanced input' })}</summary>
            <button type="button" className="btn" onClick={form.toggleJson}>
              {t(form.state.jsonMode ? { ja: 'フォーム入力へ', en: 'Use form' } : { ja: 'JSON入力へ', en: 'Use JSON' })}
            </button>
          </details>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={run.isPending}>
          {t(run.isPending ? { ja: '処理中…', en: 'Working…' } : { ja: '実行', en: 'Run' })}
        </button>
      </form>
      {completed ? (
        <section className="business-action-result" role="status" data-testid="business-action-result">
          <h2>
            <Icon name="check" />
            {t({ ja: '処理が完了しました', en: 'Completed' })}
          </h2>
          <div>
            {fields
              .filter((f) => f.ref && typeof completed.input[f.name] === 'string')
              .map((field) => (
                <Link
                  key={field.name}
                  className="btn"
                  to="/e/$entity/$id"
                  params={{ entity: field.ref ?? '', id: String(completed.input[field.name]) }}
                >
                  {t(field.label)}
                  {t({ ja: 'を確認', en: ' — view record' })}
                </Link>
              ))}
          </div>
          <details>
            <summary>{t({ ja: '処理結果の詳細', en: 'Result details' })}</summary>
            <pre>{JSON.stringify(completed.result, null, 2)}</pre>
          </details>
        </section>
      ) : null}
      {pending ? (
        <ActionConfirm
          title={t({ ja: '実行する', en: 'Run action' })}
          message={t(action.description)}
          cancelDocument={false}
          destructive={false}
          onConfirm={() => execute(pending)}
          onClose={() => setPending(undefined)}
        />
      ) : null}
    </div>
  );
}

export function ActionPage() {
  const { action: name } = useParams({ strict: false }) as { action?: string };
  const meta = useMeta();
  const { t } = useLocale();
  if (meta.isError) return <MetaError error={meta.error} retry={() => void meta.refetch()} />;
  if (!meta.data) return <LoadingView />;
  const action = meta.data.actions.find(
    (a) => a.name === name && !a.generic && a.resultKind !== 'table' && a.module !== 'pack',
  );
  return action ? (
    <ActionView key={action.name} action={action} meta={meta.data} />
  ) : (
    <p role="alert" className="p-4">
      {t({
        ja: 'この操作は現在の会社・権限では利用できません。',
        en: 'This action is unavailable for the current company or role.',
      })}
    </p>
  );
}
