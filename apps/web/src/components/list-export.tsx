// list-workbench AC-7/AC-8: CSV of what the list shows. On click the rows are read again through the fresh export
// authorization route (POST /actions/<entity>.export_rows/export), never from the cached page; the browser builds the
// CSV (UTF-8 with BOM, CRLF, spreadsheet formula cells neutralised by lib/csv.ts).
import { useMutation } from '@tanstack/react-query';
import { request } from '../api/client.ts';
import type { TableResult } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { csvFilename, tableToCsv } from '../lib/csv.ts';
import { saveBlob } from '../lib/download.ts';
import { countLabel, exportActionName, ROWS } from '../lib/list-workbench.ts';
import { S } from '../strings.ts';
import { Button } from '../ui/index.ts';
import { Icon } from './icon.tsx';
import { useToast } from './toast.tsx';

/** Mirrors the kernel's EXPORT_ROWS_LIMIT (kernel/src/actions/export-rows.ts). */
export const EXPORT_ROWS_LIMIT = 5000;

function number(n: unknown, locale: 'ja' | 'en'): string {
  return typeof n === 'number' ? n.toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US') : '';
}

export function ListExportButton({
  entity,
  input,
  total,
}: {
  entity: string;
  input: Record<string, unknown>;
  /** Rows matching the list's criteria (all pages), when known. */
  total: number | undefined;
}) {
  const { locale, t } = useLocale();
  const toast = useToast();
  const run = useMutation({
    mutationFn: () =>
      request<TableResult>(`/actions/${exportActionName(entity)}/export`, { method: 'POST', body: input }),
  });
  const over = total !== undefined && total > EXPORT_ROWS_LIMIT;
  const download = () =>
    run.mutate(undefined, {
      onSuccess: (result) => {
        saveBlob(
          new Blob([tableToCsv(result, locale, t(S.sums))], { type: 'text/csv;charset=utf-8' }),
          csvFilename(entity, new Date()),
        );
        const meta = result.meta ?? {};
        if (meta.truncated === true)
          toast.push({
            kind: 'info',
            title:
              locale === 'ja'
                ? `該当 ${number(meta.total, locale)} 件のうち先頭 ${number(meta.rowCount, locale)} 件を出力しました（上限 ${number(EXPORT_ROWS_LIMIT, locale)} 件）`
                : `Exported the first ${number(meta.rowCount, locale)} of ${number(meta.total, locale)} rows (limit ${number(EXPORT_ROWS_LIMIT, locale)})`,
          });
        else
          toast.success(
            locale === 'ja'
              ? `${countLabel(result.rows.length, locale, ROWS)}の CSV を作成しました`
              : `CSV created with ${countLabel(result.rows.length, locale, ROWS)}`,
          );
      },
      onError: (e) => toast.error(e),
    });
  return (
    <Button onClick={download} disabled={run.isPending} data-testid="list-export">
      <Icon name="document" size={15} />
      {run.isPending
        ? t({ ja: '出力を確認中…', en: 'Checking export…' })
        : over
          ? t({
              ja: `CSV 出力（先頭 ${number(EXPORT_ROWS_LIMIT, locale)} 件）`,
              en: `Export CSV (first ${number(EXPORT_ROWS_LIMIT, locale)})`,
            })
          : t({ ja: 'CSV 出力', en: 'Export CSV' })}
    </Button>
  );
}
