// Upload use case behind POST /api/attachments/upload (docs/specs/attachments.md AC-2, AC-7). Not a defineAction
// because its input is binary; the API route is a thin multipart adapter over this function.
import { assertOp, repo, ValidationError, type Context, type Infer, type InsertInput } from '@daifuku/kernel';
import { z } from 'zod';
import { withUpload } from '../write.ts';
import { Attachment } from '../entities/attachment.ts';
import { assertReferences, duplicateConflict, findDuplicate } from '../hooks/integrity.ts';
import { sha256Hex } from '../services/hash.ts';
import { cleanFormFields, validateUpload } from '../services/validate.ts';

export const UPLOAD_FIELDS = ['kind', 'txnDate', 'amount', 'partnerId', 'linkedEntity', 'linkedId', 'note'] as const;

const fi = Attachment.schemas.fieldInput;
const optional = (name: string): z.ZodType => {
  const s = fi[name];
  if (!s) throw new Error(`attachment has no field ${name}`);
  return s.optional();
};
/** Metadata fields accepted alongside the file; each reuses the DSL-derived per-field validation. */
export const uploadFieldsSchema = z
  .object(
    Object.fromEntries(UPLOAD_FIELDS.map((k) => [k, optional(k)])) as Record<(typeof UPLOAD_FIELDS)[number], z.ZodType>,
  )
  .strict();

export interface UploadInput {
  data: Uint8Array;
  filename: string;
  contentType: string;
  /** Multipart form fields as strings (empty strings are treated as absent). */
  fields: Record<string, string | undefined>;
}

export type AttachmentRow = Infer<typeof Attachment>;

function parseFields(fields: UploadInput['fields']): z.output<typeof uploadFieldsSchema> {
  const r = uploadFieldsSchema.safeParse(cleanFormFields(fields));
  if (r.success) return r.data;
  // An unrecognised form field is reported under its own name (zod reports the set at the root path).
  const issues = r.error.issues.flatMap((i) =>
    i.code === 'unrecognized_keys'
      ? i.keys.map((k) => ({ path: k, message: 'unknown field' }))
      : [{ path: i.path.map(String).join('.'), message: i.message }],
  );
  throw new ValidationError(
    'invalid upload fields',
    issues,
    `Allowed fields: ${UPLOAD_FIELDS.join(', ')} (unknown fields are rejected); dates are YYYY-MM-DD, amount a decimal string.`,
  );
}

/**
 * Validates everything (file, fields, duplicates, reference visibility) before touching storage — the store has no
 * delete API, so a row that fails after put would leave an orphan blob. Then stores the bytes via the kernel storage
 * port and creates the row. Runs in the caller's transaction; the before_create hook repeats the duplicate and
 * reference checks as the backstop for every create path.
 */
export async function uploadAttachment(ctx: Context, input: UploadInput): Promise<AttachmentRow> {
  assertOp(ctx, Attachment, 'create');
  const meta = validateUpload({
    filename: input.filename,
    contentType: input.contentType,
    size: input.data.byteLength,
  });
  const fields = parseFields(input.fields);
  const sha256 = await sha256Hex(input.data);
  const existing = await findDuplicate(ctx, sha256);
  if (existing) throw duplicateConflict(existing, sha256);
  await assertReferences(ctx, fields, undefined);
  const stored = await ctx.storage.put(ctx.tenantId, input.data, {
    filename: meta.filename,
    contentType: meta.contentType,
  });
  if (stored.sha256 !== sha256) {
    throw new ValidationError(
      'stored content hash does not match the uploaded bytes',
      [{ path: 'file', message: 'hash mismatch' }],
      'Retry the upload; if it persists this is a storage bug.',
    );
  }
  // `fields` came through the same per-field schemas repo.create applies again; the cast only bridges the
  // generic `Record<string, ZodType>` shape to the typed insert input.
  const insert = {
    storageKey: stored.key,
    filename: meta.filename,
    contentType: meta.contentType,
    size: stored.size,
    sha256,
    ...fields,
  } as InsertInput<typeof Attachment>;
  return withUpload(ctx, (internal) => repo(internal, Attachment).create(insert));
}
