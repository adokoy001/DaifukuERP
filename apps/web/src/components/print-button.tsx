// web-polish: 「請求書を表示」 on a submitted document whose module exposes `<module>.render_invoice_html` in /meta
// (lib/print.ts). The tab is opened synchronously inside the click (pop-up blockers), the action runs, and the returned
// HTML — plus a print/close bar hidden on paper — is shown there.
import { useMutation } from '@tanstack/react-query';
import { useMemo } from 'react';
import { request } from '../api/client.ts';
import { useMeta } from '../api/queries.ts';
import { DOCSTATUS, type EntityMeta, type RecordJson } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { showHtmlIn } from '../lib/download.ts';
import { htmlOf, printActionFor, withPrintBar } from '../lib/print.ts';
import { S } from '../strings.ts';
import { useToast } from './toast.tsx';

interface RenderInput {
  action: string;
  id: string;
}

export function PrintButton({ entity, record }: { entity: EntityMeta; record: RecordJson }) {
  const { t } = useLocale();
  const toast = useToast();
  const meta = useMeta();
  const action = useMemo(() => printActionFor(entity, meta.data?.actions ?? []), [entity, meta.data]);
  const render = useMutation({ mutationFn: (input: RenderInput) => request<unknown>(`/actions/${input.action}`, { method: 'POST', body: { id: input.id } }) });
  if (!action || entity.kind !== 'document' || record.docstatus !== DOCSTATUS.submitted) return null;

  const open = () => {
    const win = globalThis.open('', '_blank');
    if (!win) {
      toast.push({ kind: 'error', title: t(S.popupBlocked) });
      return;
    }
    win.document.title = t(S.rendering);
    win.document.body.textContent = t(S.rendering);
    render.mutate(
      { action: action.name, id: record.id },
      {
        onSuccess: (raw) => {
          const html = htmlOf(raw);
          if (!html) {
            win.close();
            toast.push({ kind: 'error', title: t(S.printNoHtml) });
            return;
          }
          showHtmlIn(win, withPrintBar(html, { print: t(S.print), close: t(S.close) }));
        },
        onError: (e) => {
          win.close();
          toast.error(e);
        },
      },
    );
  };

  return (
    <button type="button" className="btn" disabled={render.isPending} onClick={open} title={t(action.description)} data-testid="print-button">
      🖨 {t(S.viewInvoice)}
    </button>
  );
}
