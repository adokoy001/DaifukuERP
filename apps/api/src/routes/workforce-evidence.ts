// Binary adapter for private employee receipts. Domain authorization lives in workforce-evidence.
import { DaifukuError, ValidationError, type Database } from '@daifuku/kernel';
import { downloadReceipt, listReceipts, MAX_RECEIPT_BYTES, uploadReceipt, type ReceiptUpload } from '@daifuku/mod-workforce-evidence';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse, withRequestContext } from '../request-context.ts';
import { contentDisposition } from './attachments.ts';

const idParams = z.object({ id: z.uuid() });
async function readReceipt(req: FastifyRequest): Promise<ReceiptUpload> {
  if (!req.isMultipart()) throw new ValidationError('Use multipart/form-data.', [{ path: 'file', message: 'One file and expectedVersion are required.' }]);
  let file: Omit<ReceiptUpload, 'expectedVersion'> | undefined;
  let expectedVersion: string | undefined;
  try {
    for await (const part of req.parts({ limits: { files: 1, fields: 1, parts: 2, fileSize: MAX_RECEIPT_BYTES } })) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file' || file) throw new ValidationError('Only a single file field is accepted.', [{ path: 'file', message: 'Unknown file field.' }]);
        file = { data: new Uint8Array(await part.toBuffer()), filename: part.filename, contentType: part.mimetype };
      } else {
        if (part.fieldname !== 'expectedVersion' || expectedVersion !== undefined || typeof part.value !== 'string') throw new ValidationError('Unexpected receipt field.', [{ path: part.fieldname, message: 'Only expectedVersion is accepted.' }]);
        expectedVersion = part.value;
      }
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if ((code?.startsWith('FST_') && code.includes('LIMIT')) || code === 'FST_REQ_FILE_TOO_LARGE') throw new DaifukuError('VALIDATION', 'Receipt upload exceeds the permitted size or parts.', 'Send one PNG, JPEG or PDF up to 10 MB, plus expectedVersion.', undefined, code === 'FST_REQ_FILE_TOO_LARGE' ? 413 : 400);
    throw error;
  }
  if (!file || !expectedVersion || !/^[1-9]\d*$/.test(expectedVersion)) throw new ValidationError('File and current expense version are required.', [{ path: 'expectedVersion', message: 'Reload the expense and retry.' }]);
  return { ...file, expectedVersion: Number(expectedVersion) };
}

export function registerWorkforceEvidenceRoutes(app: FastifyInstance, opts: { db: Database }): void {
  app.post('/api/workforce/expenses/:id/receipts', { schema: { tags: ['workforce'], summary: 'Attach a private receipt to your draft or returned expense', params: idParams, consumes: ['multipart/form-data'] } }, async (req, reply) => {
    const { id } = parse(idParams, req.params, 'params');
    const input = await readReceipt(req);
    const result = await withRequestContext(opts.db, req, (ctx) => uploadReceipt(ctx, id, input));
    return reply.header('cache-control', 'private, no-store').send(result);
  });
  app.get('/api/workforce/expenses/:id/receipts', { schema: { tags: ['workforce'], summary: 'List receipts visible through the expense', params: idParams } }, async (req, reply) => {
    const { id } = parse(idParams, req.params, 'params');
    return reply.header('cache-control', 'private, no-store').send(await withRequestContext(opts.db, req, (ctx) => listReceipts(ctx, id)));
  });
  app.get('/api/workforce/receipts/:id/download', { schema: { tags: ['workforce'], summary: 'Download authorized private receipt bytes', params: idParams, produces: ['application/octet-stream'] } }, async (req, reply) => {
    const { id } = parse(idParams, req.params, 'params');
    const { receipt, bytes } = await withRequestContext(opts.db, req, (ctx) => downloadReceipt(ctx, id));
    return reply.header('content-type', receipt.contentType).header('content-length', bytes.byteLength).header('content-disposition', contentDisposition(receipt.filename)).header('x-content-type-options', 'nosniff').header('cache-control', 'private, no-store').send(Buffer.from(bytes));
  });
}
