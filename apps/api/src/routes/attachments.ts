// docs/specs/attachments.md AC-2/AC-3: multipart upload and file download. This file is an adapter only — it parses
// the multipart body and streams bytes; validation, duplicate detection and storage go through the module use case
// (uploadAttachment) and the kernel storage port inside the request context.
import { DaifukuError, repo, ValidationError, type Database } from '@daifuku/kernel';
import { Attachment, MAX_UPLOAD_BYTES, uploadAttachment, UPLOAD_FIELDS } from '@daifuku/mod-attachments';
import fastifyMultipart from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { parse, withRequestContext } from '../request-context.ts';

const idParams = z.object({ id: z.uuid() });

const MULTIPART_HINT = `Send multipart/form-data with one "file" part plus optional text fields: ${UPLOAD_FIELDS.join(', ')}.`;

/** @fastify/multipart limit errors -> the standard error shape (413 keeps its meaning for the file size limit). */
const LIMIT_ERRORS: Record<string, { status: number; message: string }> = {
  FST_REQ_FILE_TOO_LARGE: { status: 413, message: `file exceeds the ${MAX_UPLOAD_BYTES} byte (20 MB) limit` },
  FST_FILES_LIMIT: { status: 400, message: 'only one file part is accepted' },
  FST_PARTS_LIMIT: { status: 400, message: 'too many multipart parts' },
  FST_FIELDS_LIMIT: { status: 400, message: 'too many form fields' },
};

function mapMultipartError(err: unknown): unknown {
  const code = (err as { code?: unknown }).code;
  const mapped = typeof code === 'string' ? LIMIT_ERRORS[code] : undefined;
  if (!mapped) return err;
  return new DaifukuError('VALIDATION', mapped.message, MULTIPART_HINT, { maxBytes: MAX_UPLOAD_BYTES, multipartCode: code }, mapped.status);
}

interface ParsedUpload {
  data: Uint8Array;
  filename: string;
  contentType: string;
  fields: Record<string, string | undefined>;
}

/** Consumes every part (busboy is serial, so fields after the file are only visible once the file is read). */
async function readUpload(req: FastifyRequest): Promise<ParsedUpload> {
  if (!req.isMultipart()) {
    throw new ValidationError('expected a multipart/form-data body', [{ path: 'body', message: 'not multipart' }], MULTIPART_HINT);
  }
  const fields: Record<string, string | undefined> = {};
  let file: Omit<ParsedUpload, 'fields'> | null = null;
  try {
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        if (file) throw new ValidationError('only one file part is accepted', [{ path: part.fieldname, message: 'second file' }], MULTIPART_HINT);
        file = { data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), filename: part.filename, contentType: part.mimetype };
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }
  } catch (err) {
    throw mapMultipartError(err);
  }
  if (!file) throw new ValidationError('missing file part', [{ path: 'file', message: 'required' }], MULTIPART_HINT);
  return { ...file, fields };
}

/** RFC 6266 / RFC 5987: ASCII fallback plus the UTF-8 encoded original (Japanese filenames survive). */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export function registerAttachmentRoutes(app: FastifyInstance, opts: { db: Database }): void {
  // Registered here (not in server.ts) so the multipart limits live next to the only routes that use them.
  void app.register(fastifyMultipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 20, parts: 30 } });

  app.post(
    '/api/attachments/upload',
    {
      schema: {
        tags: ['attachment'],
        summary: 'Upload evidence (multipart: file + kind/txnDate/amount/partnerId/linkedEntity/linkedId/note); returns the attachment',
        description: `${MULTIPART_HINT} Max 20 MB; pdf, png, jpeg, csv, xml, txt. Duplicate content (same sha256 in the company) answers 409 with details.existingId.`,
        consumes: ['multipart/form-data'],
      },
    },
    async (req) => {
      const upload = await readUpload(req);
      return withRequestContext(opts.db, req, async (ctx) => JSON.parse(JSON.stringify(await uploadAttachment(ctx, upload))) as unknown);
    },
  );

  app.get(
    '/api/attachments/:id/download',
    { schema: { tags: ['attachment'], summary: 'Download the stored file (same permission check as attachment.get)', params: idParams, produces: ['application/octet-stream'] } },
    async (req, reply: FastifyReply) => {
      const { id } = parse(idParams, req.params, 'params');
      const { row, bytes } = await withRequestContext(opts.db, req, async (ctx) => {
        const found = await repo(ctx, Attachment).get(id); // permission + visibility: NotFound when the caller may not see it
        if (!found.storageKey.startsWith(`${ctx.tenantId}/`)) {
          throw new DaifukuError('PERMISSION_DENIED', 'Attachment storage scope is invalid.', 'Ask an administrator to verify this evidence record.', undefined, 403);
        }
        const bytes = await ctx.storage.get(found.storageKey);
        if (bytes.byteLength !== found.size || createHash('sha256').update(bytes).digest('hex') !== found.sha256) {
          throw new DaifukuError('INVALID_STATE', 'Attachment content does not match its recorded digest.', 'Restore the original evidence from a verified backup.', undefined, 409);
        }
        return { row: found, bytes };
      });
      return reply
        .header('content-type', row.contentType)
        .header('content-length', bytes.byteLength)
        .header('content-disposition', contentDisposition(row.filename))
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, no-store')
        .send(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    },
  );
}
