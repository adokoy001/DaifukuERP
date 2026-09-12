import type { ReceiptInfo } from '@daifuku/mod-workforce-evidence';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { download, getCompanyId, getUser, isApiError, request, upload } from '../api/client.ts';
import type { ExpenseSummary } from '../api/workforce.ts';
import { useLocale } from '../i18n.tsx';
import { filenameFromDisposition, saveBlob } from '../lib/download.ts';
import { WorkforceDialog } from './workforce-dialog.tsx';
import { WorkforceEmpty, WorkforceError } from './workforce-shared.tsx';

export function WorkforceReceipts({ expense, canUpload, onClose }: { expense: ExpenseSummary; canUpload: boolean; onClose: () => void }) {
  const { t } = useLocale(), qc = useQueryClient();
  const [error, setError] = useState<unknown>();
  const user = getUser(), companyId = getCompanyId();
  const path = '/api/workforce/expenses/' + expense.id + '/receipts';
  const query = useQuery({ queryKey: ['workforce', user?.tenantId, user?.id, companyId, 'receipts', expense.id], queryFn: ({ signal }) => request<{ items: ReceiptInfo[] }>(path, { signal, cache: 'no-store' }), staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: 'always', networkMode: 'always' });
  const task = useMutation({ mutationFn: (form: FormData) => upload<{ receipt: ReceiptInfo; expenseVersion: number }>(path, form), onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['workforce'] }); }, onError: async (failure) => { if (isApiError(failure) && [401, 403].includes(failure.status)) await Promise.all([qc.resetQueries({ queryKey: ['workforce'] }), qc.invalidateQueries({ queryKey: ['meta'] })]); }, retry: false, gcTime: 0, networkMode: 'always' });
  const editable = canUpload && ['draft', 'returned'].includes(expense.status) && !query.isError;
  const downloadFile = async (row: ReceiptInfo) => { setError(undefined); try { const result = await download('/api/workforce/receipts/' + row.id + '/download'); saveBlob(result.blob, filenameFromDisposition(result.contentDisposition, row.filename)); } catch (e) { setError(e); await query.refetch(); } };
  return <WorkforceDialog title={t({ ja: '領収書・証憑', en: 'Receipts and evidence' })} description={expense.expenseDate + ' · ' + expense.description} submitLabel={t({ ja: '領収書を添付', en: 'Attach receipt' })} readOnly={!editable} onClose={onClose} onSubmit={async (data) => {
    if (companyId !== getCompanyId() || user?.id !== getUser()?.id) throw new Error(t({ ja: '会社または利用者が変わりました。画面を開き直してください。', en: 'Your company or user changed. Reopen the page.' }));
    const files = data.getAll('file').filter((file): file is File => file instanceof File && file.size > 0);
    if (files.length !== 1) throw new Error(t({ ja: '写真またはPDFを1つ選択してください。', en: 'Select one photo or PDF.' }));
    const file = files[0];
    if (!file || file.size > 10 * 1024 * 1024 || !['image/png', 'image/jpeg', 'application/pdf'].includes(file.type)) throw new Error(t({ ja: '10MB以下のPNG・JPEG・PDFを選択してください。', en: 'Choose a PNG, JPEG or PDF of up to 10 MB.' }));
    const form = new FormData(); form.append('expectedVersion', String(expense.version)); form.append('file', file, file.name);
    await task.mutateAsync(form);
  }}>
    {query.isError ? <WorkforceError error={query.error} onRetry={() => void query.refetch()} /> : query.data?.items.length ? <div className="workforce-record-list">{query.data.items.map((row) => <div className="workforce-record" key={row.id}><h3>{row.filename}</h3><p>{Math.ceil(row.size / 1024)} KB · {row.createdAt.slice(0, 10)}</p><button type="button" className="btn" onClick={() => void downloadFile(row)}>{t({ ja: 'ダウンロード', en: 'Download' })}</button></div>)}</div> : query.isPending ? <p role="status">{t({ ja: '証憑を読み込み中…', en: 'Loading receipts…' })}</p> : <WorkforceEmpty icon="document">{t({ ja: '添付された領収書はありません。', en: 'No receipts attached yet.' })}</WorkforceEmpty>}
    {error ? <WorkforceError error={error} /> : null}
    {editable ? <><label>{t({ ja: '写真を撮る・写真やPDFを選ぶ', en: 'Take a photo or choose a photo/PDF' })}<input className="input" name="file" aria-label={t({ ja: '写真を撮る・写真やPDFを選ぶ', en: 'Take a photo or choose a photo/PDF' })} type="file" accept="image/png,image/jpeg,application/pdf" capture="environment" /><small>{t({ ja: 'PNG・JPEG・PDF、1枚10MBまで。1申請に10枚まで添付できます。', en: 'PNG, JPEG or PDF, up to 10 MB each and 10 files per expense.' })}</small></label><p className="workforce-notice">{t({ ja: '提出後は証憑を追加できません。提出前に内容をご確認ください。', en: 'Receipts are frozen after submission. Check them before submitting.' })}</p></> : <p className="workforce-notice">{t({ ja: 'この申請の証憑は閲覧のみです。', en: 'Receipts for this request are read-only.' })}</p>}
  </WorkforceDialog>;
}
