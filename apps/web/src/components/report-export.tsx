import { useMutation } from '@tanstack/react-query';
import { request } from '../api/client.ts';
import type { TableResult } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { csvFilename, tableToCsv } from '../lib/csv.ts';
import { saveBlob } from '../lib/download.ts';
import { S } from '../strings.ts';
import { Icon } from './icon.tsx';
import { useToast } from './toast.tsx';
/** Re-run the exact visible criteria with fresh export authority; never export a stale cached result. */
export function ReportExport({ actionName, input, allowed, disabled = false }: { actionName: string; input: Record<string, unknown>; allowed: boolean; disabled?: boolean }) {
  const { locale, t } = useLocale();
  const toast = useToast();
  const run = useMutation({ mutationFn: () => request<TableResult>('/actions/' + actionName + '/export', { method: 'POST', body: input }) });
  if (!allowed) return <small className="muted">{t({ ja: 'CSV出力権限なし', en: 'CSV export is not permitted' })}</small>;
  const download = () => run.mutate(undefined, { onSuccess: (result) => { saveBlob(new Blob([tableToCsv(result, locale, t(S.sums))], { type: 'text/csv;charset=utf-8' }), csvFilename(actionName, new Date())); toast.success(t({ ja: '最新データのCSVを作成しました', en: 'CSV created from fresh data' })); }, onError: (e) => toast.error(e) });
  return <button className="btn" type="button" onClick={download} disabled={disabled || run.isPending}><Icon name="document" size={15} />{t(run.isPending ? { ja: '出力を確認中…', en: 'Checking export…' } : S.downloadCsv)}</button>;
}
