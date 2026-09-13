// web-phase1 AC-4: attachments (証憑) of a record — list via `attachment.for_record`, multipart upload to
// /api/attachments/upload with linkedEntity/linkedId, authenticated download. Field widgets/labels come from the
// `attachment` entity meta so the panel follows the module's declaration (kinds, labels, masking).
import { useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ATTACHMENT_ENTITY,
  attachmentsAvailable,
  downloadAttachment,
  useAttachmentsFor,
  useUploadAttachment,
  type UploadInput,
} from '../api/attachments.ts';
import { useCurrencyScale } from '../api/company.tsx';
import { useMeta, useRefLabelMaps } from '../api/queries.ts';
import type { AttachmentJson, EntityMeta, FieldMeta } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import { initialValues, toPayload, type FormValue, type FormValues } from '../lib/form.ts';
import { formatValue } from '../lib/format.ts';
import { S } from '../strings.ts';
import { FieldWidget } from './fields/field-widget.tsx';
import { useToast } from './toast.tsx';

const UPLOAD_FIELDS = ['kind', 'txnDate', 'amount', 'partnerId', 'note'] as const;
const LIST_FIELDS = ['kind', 'txnDate', 'amount', 'partnerId', 'size'] as const;

function fieldsOf(att: EntityMeta, names: readonly string[]): FieldMeta[] {
  return names.flatMap((n) => att.fields.filter((f) => f.name === n));
}

function UploadForm({ entity, id, att }: { entity: EntityMeta; id: string; att: EntityMeta }) {
  const { t } = useLocale();
  const toast = useToast();
  const upload = useUploadAttachment(entity.name, id);
  const fields = useMemo(() => fieldsOf(att, UPLOAD_FIELDS).map((f) => ({ ...f, multiline: false })), [att]);
  const [values, setValues] = useState<FormValues>(() => initialValues(fields));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const setValue = (name: string, v: FormValue) => setValues((s) => ({ ...s, [name]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      toast.push({ kind: 'error', title: t(S.fileRequired) });
      return;
    }
    const { payload, errors: errs } = toPayload(values, fields, 'create');
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    const input: UploadInput = { file, kind: typeof payload.kind === 'string' ? payload.kind : 'other' };
    if (typeof payload.txnDate === 'string') input.txnDate = payload.txnDate;
    if (typeof payload.amount === 'string') input.amount = payload.amount;
    if (typeof payload.partnerId === 'string') input.partnerId = payload.partnerId;
    if (typeof payload.note === 'string') input.note = payload.note;
    upload.mutate(input, {
      onSuccess: () => {
        toast.success(t(S.uploaded));
        setValues(initialValues(fields));
        setErrors({});
        setFile(null);
        if (fileInput.current) fileInput.current.value = '';
      },
      onError: (err) => toast.error(err),
    });
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label={t(S.upload)}
      data-testid="attachment-upload"
      className="grid grid-cols-1 gap-x-4 gap-y-2 border-t border-neutral-200 px-3 py-2 md:grid-cols-3"
    >
      <div className="flex flex-col gap-0.5">
        <label htmlFor="att-file" className="text-xs font-medium text-neutral-700">
          {t(S.file)}
          <span className="ml-0.5 text-red-600">*</span>
        </label>
        <input
          id="att-file"
          ref={fileInput}
          type="file"
          className="text-xs"
          disabled={upload.isPending}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      {fields.map((f) => (
        <FieldWidget
          key={f.name}
          idPrefix="att"
          field={f}
          value={values[f.name] ?? ''}
          onChange={(v) => setValue(f.name, v)}
          disabled={upload.isPending}
          error={errors[f.name]}
        />
      ))}
      <div className="flex items-end">
        <button type="submit" className="btn btn-primary" disabled={upload.isPending}>
          {upload.isPending ? t(S.uploading) : t(S.upload)}
        </button>
      </div>
    </form>
  );
}

function AttachmentRows({ att, rows }: { att: EntityMeta; rows: AttachmentJson[] }) {
  const { t, locale } = useLocale();
  const toast = useToast();
  const currencyScale = useCurrencyScale();
  const columns = useMemo(() => fieldsOf(att, LIST_FIELDS), [att]);
  const refFields = useMemo(() => columns.filter((f) => f.kind === 'ref'), [columns]);
  const refLabel = useRefLabelMaps(refFields, rows);
  const download = (a: AttachmentJson) => downloadAttachment(a).catch((e: unknown) => toast.error(e));
  return (
    <table className="w-full text-xs">
      <thead className="bg-neutral-50 text-left text-neutral-600">
        <tr>
          <th className="px-3 py-1 font-medium">{t(S.file)}</th>
          {columns.map((c) => (
            <th
              key={c.name}
              className={`px-3 py-1 font-medium ${c.kind === 'decimal' || c.kind === 'int' ? 'text-right' : ''}`}
            >
              {t(c.label)}
            </th>
          ))}
          <th className="w-24" />
        </tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <tr
            key={a.id}
            data-testid="attachment-row"
            className={`border-t border-neutral-100 ${a.supersededById ? 'text-neutral-400 line-through' : ''}`}
          >
            <td className="px-3 py-1">
              <button
                type="button"
                className="text-sky-700 hover:underline"
                onClick={() => void download(a)}
                title={t(S.download)}
              >
                {a.filename}
              </button>
              {a.supersededById ? <span className="ml-1 text-[10px] no-underline">({t(S.superseded)})</span> : null}
            </td>
            {columns.map((c) => {
              const v = a[c.name];
              const fmt = formatValue(c, v, locale, {
                refLabel: c.kind === 'ref' && typeof v === 'string' ? refLabel(c, v) : undefined,
                currencyScale,
              });
              return (
                <td
                  key={c.name}
                  className={`px-3 py-1 whitespace-nowrap ${fmt.mono ? 'font-mono tabular-nums' : ''} ${fmt.align === 'right' ? 'text-right' : ''}`}
                >
                  {fmt.text}
                </td>
              );
            })}
            <td className="px-3 py-1 text-right whitespace-nowrap">
              <button type="button" className="btn px-2 py-0.5 whitespace-nowrap" onClick={() => void download(a)}>
                ⬇ {t(S.download)}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AttachmentsPanel({ entity, id }: { entity: EntityMeta; id: string }) {
  const { t } = useLocale();
  const meta = useMeta();
  const available = attachmentsAvailable(meta.data);
  const att = meta.data?.entities.find((e) => e.name === ATTACHMENT_ENTITY);
  const list = useAttachmentsFor(entity.name, id, available);
  if (!available || !att) return null;
  return (
    <section
      aria-label={t(S.attachments)}
      data-testid="attachments-panel"
      className="rounded border border-neutral-200 bg-white"
    >
      <h2 className="border-b border-neutral-200 px-3 py-1.5 text-sm font-semibold">
        {t(S.attachments)}
        {list.data ? <span className="ml-2 text-xs font-normal text-neutral-500">({list.data.length})</span> : null}
      </h2>
      {list.isPending ? <div className="px-3 py-2 text-xs text-neutral-500">{t(S.loading)}</div> : null}
      {list.isError ? <div className="px-3 py-2 text-xs text-red-700">{t(S.loadFailed)}</div> : null}
      {list.data && list.data.length === 0 ? (
        <div className="px-3 py-2 text-xs text-neutral-500">{t(S.attachmentsEmpty)}</div>
      ) : null}
      {list.data && list.data.length > 0 ? (
        <div className="overflow-x-auto">
          <AttachmentRows att={att} rows={list.data} />
        </div>
      ) : null}
      {att.ops.includes('create') ? <UploadForm entity={entity} id={id} att={att} /> : null}
    </section>
  );
}
