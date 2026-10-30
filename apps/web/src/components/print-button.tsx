// Print buttons of a record (docs/specs/print-templates.md AC-3, AC-4, AC-23〜AC-25): one button per render action
// that /meta declares for this entity (lib/print.ts). The tab is opened synchronously inside the click or the dialog's
// submit (pop-up blockers), the action runs, and the returned HTML — plus a print/close bar hidden on paper — is
// shown there. An action with inputs besides the record id (the statement's closing date) asks for them first in a
// dialog built from its input schema, labelled in ja and en by the declaration's `fields`.
import { useMutation } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { isApiError, request } from '../api/client.ts';
import { useMeta } from '../api/queries.ts';
import type { EntityMeta } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { showHtmlIn } from '../lib/download.ts';
import { issuesToFieldErrors } from '../lib/form.ts';
import {
  extraInputSchema,
  htmlOf,
  printActionsFor,
  printFieldPresentation,
  printInputOf,
  withPrintBar,
  type PrintableRecord,
  type PrintAction,
} from '../lib/print.ts';
import { refResolverFrom, schemaFields } from '../lib/schema.ts';
import { S } from '../strings.ts';
import { Button, Dialog } from '../ui/index.ts';
import { Icon } from './icon.tsx';
import { SchemaFields, useSchemaForm } from './schema-form.tsx';
import { useToast } from './toast.tsx';

interface RenderJob {
  action: string;
  input: Record<string, unknown>;
  /** The tab opened inside the click; the hook-level callbacks fill or close it. */
  win: Window;
}

/** Opens a tab, runs the render action and shows its HTML there; failures close the tab (AC-4). */
function usePrint(action: PrintAction) {
  const { t } = useLocale();
  const toast = useToast();
  // The tab is filled or closed in the hook-level callbacks: TanStack Query runs them on the mutation even after this
  // component has unmounted (the dialog closed, or the page left, while rendering). The per-call callbacks of mutate()
  // are skipped then and would leave the tab on 「帳票を作成しています…」.
  const render = useMutation({
    mutationFn: (job: RenderJob) => request<unknown>(`/actions/${job.action}`, { method: 'POST', body: job.input }),
    onSuccess: (raw, job) => {
      const html = htmlOf(raw);
      if (!html) {
        job.win.close();
        toast.push({ kind: 'error', title: t(S.printNoHtml) });
        return;
      }
      showHtmlIn(job.win, withPrintBar(html, { print: t(S.print), close: t(S.close) }, globalThis.location.origin));
    },
    onError: (e, job) => {
      job.win.close();
      toast.error(e);
    },
  });
  /** Must be called synchronously from a user gesture. `onValidation` keeps the dialog open with field errors. */
  const open = (
    recordId: string,
    extra: Record<string, unknown>,
    handlers: { onDone?: () => void; onValidation?: (issues: Parameters<typeof issuesToFieldErrors>[0]) => void } = {},
  ) => {
    const win = globalThis.open('', '_blank');
    if (!win) {
      toast.push({ kind: 'error', title: t(S.popupBlocked) });
      return;
    }
    win.document.title = t(S.rendering);
    win.document.body.textContent = t(S.rendering);
    // Dialog follow-ups only; they are skipped (harmlessly) when the dialog is gone by the time the render ends.
    render.mutate(
      { action: action.name, input: printInputOf(action, recordId, extra), win },
      {
        onSuccess: (raw) => {
          if (htmlOf(raw)) handlers.onDone?.();
        },
        onError: (e) => {
          if (handlers.onValidation && isApiError(e) && e.code === 'VALIDATION') handlers.onValidation(e.issues());
        },
      },
    );
  };
  return { open, pending: render.isPending };
}

function PrintInputDialog({
  action,
  recordId,
  onClose,
}: {
  action: PrintAction;
  recordId: string;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const meta = useMeta();
  const { open, pending } = usePrint(action);
  const fields = useMemo(
    () =>
      schemaFields(
        extraInputSchema(action),
        refResolverFrom(meta.data?.entities, action.module),
        printFieldPresentation(action),
      ),
    [action, meta.data?.entities],
  );
  const form = useSchemaForm(fields);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const built = form.build();
    if (!built.ok) {
      form.setErrors(built.errors);
      return;
    }
    open(recordId, built.payload as Record<string, unknown>, {
      onDone: onClose,
      onValidation: (issues) =>
        form.setErrors(
          issuesToFieldErrors(
            issues,
            fields.map((f) => f.name),
          ).fieldErrors,
        ),
    });
  };
  return (
    <Dialog
      title={t(action.print.label)}
      description={t(S.printDialogHint)}
      closeLabel={t(S.close)}
      onClose={onClose}
      onSubmit={submit}
      icon={
        <span className="icon-tile">
          <Icon name="document" />
        </span>
      }
      actions={
        <>
          <Button onClick={onClose} data-autofocus>
            {t(S.cancel)}
          </Button>
          <Button type="submit" variant="primary" disabled={pending} data-testid="print-dialog-submit">
            {t(pending ? S.rendering : S.printDialogShow)}
          </Button>
        </>
      }
    >
      <div data-testid="print-dialog-fields">
        <SchemaFields fields={fields} form={form} disabled={pending} idPrefix={`print-${action.name}`} />
      </div>
    </Dialog>
  );
}

/** One print button for one render action and record id (also used by the workforce payslip panels; AC-24). */
export function PrintActionButton({ action, recordId }: { action: PrintAction; recordId: string }) {
  const { t } = useLocale();
  const { open, pending } = usePrint(action);
  const [asking, setAsking] = useState(false);
  const needsInput = useMemo(() => extraInputSchema(action) !== undefined, [action]);
  return (
    <>
      <Button
        disabled={pending}
        onClick={() => (needsInput ? setAsking(true) : open(recordId, {}))}
        aria-haspopup={needsInput ? 'dialog' : undefined}
        data-testid="print-button"
        data-print-action={action.name}
      >
        <Icon name="document" />
        {t(action.print.label)}
      </Button>
      {asking ? <PrintInputDialog action={action} recordId={recordId} onClose={() => setAsking(false)} /> : null}
    </>
  );
}

/** AC-3: the print buttons of a record page, in /meta order. Nothing when no declaration matches. */
export function PrintButtons({
  entity,
  record,
}: {
  entity: Pick<EntityMeta, 'name' | 'kind'>;
  record: PrintableRecord & { id: string };
}) {
  const meta = useMeta();
  const actions = useMemo(() => printActionsFor(entity, record, meta.data?.actions ?? []), [entity, record, meta.data]);
  return (
    <>
      {actions.map((action) => (
        <PrintActionButton key={action.name} action={action} recordId={record.id} />
      ))}
    </>
  );
}
