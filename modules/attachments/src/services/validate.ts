// Pure validation rules for uploads and supersede (docs/specs/attachments.md AC-2, AC-5). No DB access.
import { StateError, ValidationError } from '@daifuku/kernel';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Spec AC-2: pdf, png, jpeg, csv, xml, txt. Keys are the canonical types stored on the row. */
export const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/csv',
  'application/xml',
  'text/xml',
  'text/plain',
]);

const MAX_FILENAME_LENGTH = 255;

/** `text/csv; charset=utf-8` -> `text/csv`. Browsers and curl add parameters; the row keeps the bare type. */
export function normalizeContentType(raw: string): string {
  return (raw.split(';')[0] ?? '').trim().toLowerCase();
}

/** Clients sometimes send a path; only the last segment is a filename. */
export function basenameOf(raw: string): string {
  const parts = raw.split(/[\\/]/);
  return (parts[parts.length - 1] ?? '').trim();
}

export interface UploadMeta {
  filename: string;
  contentType: string;
  size: number;
}

/** Normalises and validates the file part of an upload. Throws ValidationError naming the offending field. */
export function validateUpload(input: UploadMeta): UploadMeta {
  const filename = basenameOf(input.filename);
  const contentType = normalizeContentType(input.contentType);
  const issues: { path: string; message: string }[] = [];
  if (filename.length === 0) issues.push({ path: 'file.filename', message: 'filename is required' });
  if (filename.length > MAX_FILENAME_LENGTH)
    issues.push({ path: 'file.filename', message: `filename must be at most ${MAX_FILENAME_LENGTH} characters` });
  if (!ALLOWED_CONTENT_TYPES.has(contentType))
    issues.push({ path: 'file.contentType', message: `content type "${contentType}" is not allowed` });
  if (!Number.isInteger(input.size) || input.size <= 0) issues.push({ path: 'file', message: 'file is empty' });
  if (input.size > MAX_UPLOAD_BYTES)
    issues.push({ path: 'file', message: `file exceeds ${MAX_UPLOAD_BYTES} bytes (20 MB)` });
  if (issues.length > 0) {
    throw new ValidationError(
      'invalid upload',
      issues,
      `Allowed content types: ${[...ALLOWED_CONTENT_TYPES].join(', ')}. Max size 20 MB. Fix the file and retry.`,
    );
  }
  return { filename, contentType, size: input.size };
}

/**
 * Multipart form fields arrive as strings; empty strings mean "not given". Unknown keys are kept so the strict
 * field schema rejects them by name — a misspelt `txn_date` must not silently store evidence without its metadata.
 */
export function cleanFormFields(fields: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(fields)) {
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (trimmed.length > 0) out[key] = trimmed;
  }
  return out;
}

export interface SupersedeRow {
  id: string;
  supersededById: string | null;
}

/**
 * Spec AC-5 invariants (訂正削除履歴): a row is superseded at most once, never by itself, and only by a
 * replacement that is itself current — which also makes supersede chains acyclic.
 */
export function assertSupersedable(old: SupersedeRow, replacement: SupersedeRow): void {
  if (old.id === replacement.id) {
    throw new ValidationError(
      'an attachment cannot supersede itself',
      [{ path: 'newAttachmentId', message: 'must differ from id' }],
      'Upload the corrected file first, then pass its id as newAttachmentId.',
    );
  }
  if (old.supersededById !== null) {
    throw new StateError(
      `attachment ${old.id} is already superseded by ${old.supersededById}`,
      'Supersede history is append-only. Supersede the current version (details.supersededById) instead.',
      { id: old.id, supersededById: old.supersededById },
    );
  }
  if (replacement.supersededById !== null) {
    throw new StateError(
      `attachment ${replacement.id} is itself superseded by ${replacement.supersededById}`,
      'Use the current version of the replacement as newAttachmentId.',
      { newAttachmentId: replacement.id, supersededById: replacement.supersededById },
    );
  }
}
