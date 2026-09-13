// Attachments panel (web-phase1 AC-4) against docs/specs/attachments.md:
//   POST /actions/attachment.for_record { entity, recordId }   -> attachments of a record ({ items } or a bare array tolerated)
//   POST /api/attachments/upload  multipart: file + kind/txnDate/amount/partnerId/linkedEntity/linkedId/note -> attachment row
//   GET  /api/attachments/:id/download                          -> bytes with Content-Disposition (RFC 5987)
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { filenameFromDisposition, saveBlob } from '../lib/download.ts';
import { download, request, upload } from './client.ts';
import type { AppMeta, AttachmentJson } from './types.ts';

export const ATTACHMENT_ENTITY = 'attachment';

export const attachmentKeys = {
  forRecord: (entity: string, id: string) => ['attachments', entity, id] as const,
};

/** The panel only renders when the attachments module is installed and readable by the caller. */
export function attachmentsAvailable(meta: AppMeta | undefined): boolean {
  return (
    (meta?.entities ?? []).some((e) => e.name === ATTACHMENT_ENTITY) &&
    (meta?.actions ?? []).some((a) => a.name === 'attachment.for_record')
  );
}

function normalize(raw: unknown): AttachmentJson[] {
  if (Array.isArray(raw)) return raw as AttachmentJson[];
  if (typeof raw === 'object' && raw !== null) {
    const rec = raw as Record<string, unknown>;
    const inner = rec.items ?? rec.attachments ?? rec.rows;
    if (Array.isArray(inner)) return inner as AttachmentJson[];
  }
  return [];
}

export function useAttachmentsFor(
  entity: string,
  id: string | undefined,
  enabled: boolean,
): UseQueryResult<AttachmentJson[]> {
  return useQuery({
    queryKey: attachmentKeys.forRecord(entity, id ?? ''),
    queryFn: async () =>
      normalize(
        await request<unknown>('/actions/attachment.for_record', { method: 'POST', body: { entity, recordId: id } }),
      ),
    enabled: enabled && id !== undefined,
  });
}

export interface UploadInput {
  file: File;
  kind: string;
  txnDate?: string;
  amount?: string;
  partnerId?: string;
  note?: string;
}

export function useUploadAttachment(entity: string, id: string): UseMutationResult<AttachmentJson, Error, UploadInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UploadInput) => {
      const form = new FormData();
      form.append('kind', input.kind);
      if (input.txnDate) form.append('txnDate', input.txnDate);
      if (input.amount) form.append('amount', input.amount);
      if (input.partnerId) form.append('partnerId', input.partnerId);
      if (input.note) form.append('note', input.note);
      form.append('linkedEntity', entity);
      form.append('linkedId', id);
      // The file goes last so the server can read the metadata fields before streaming the bytes.
      form.append('file', input.file, input.file.name);
      return upload<AttachmentJson>('/api/attachments/upload', form);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: attachmentKeys.forRecord(entity, id) }),
  });
}

export async function downloadAttachment(att: Pick<AttachmentJson, 'id' | 'filename'>): Promise<void> {
  const res = await download(`/api/attachments/${att.id}/download`);
  saveBlob(res.blob, filenameFromDisposition(res.contentDisposition, att.filename));
}
