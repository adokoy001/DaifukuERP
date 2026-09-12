// attachment.search (docs/specs/attachments.md AC-4): the 電子帳簿保存法 検索要件 — 取引年月日・取引金額・取引先 with
// range and combination search (docs/domain/japan-tax.md#電子帳簿保存法).
import { defineAction, isLocalDate, label, repo } from '@daifuku/kernel';
import { z } from 'zod';
import { Attachment, ATTACHMENT_KINDS, attachmentJson } from '../entities/attachment.ts';
import { buildSearchDomain } from '../services/search.ts';

const localDate = z.string().refine(isLocalDate, 'must be YYYY-MM-DD');
const decimalString = z.string().min(1).max(40);

export const searchAction = defineAction({
  name: 'attachment.search',
  description: label(
    '証憑を取引年月日の範囲・取引金額の範囲・取引先・種別で検索します（指定した条件の AND。電子帳簿保存法の検索要件）。',
    'Search attachments by transaction date range, amount range, partner and kind (AND of the given criteria; the 電子帳簿保存法 search requirement).',
  ),
  input: z.object({
    txnDateFrom: localDate.optional(),
    txnDateTo: localDate.optional(),
    amountFrom: decimalString.optional(),
    amountTo: decimalString.optional(),
    partnerId: z.uuid().optional(),
    kind: z.enum(ATTACHMENT_KINDS).optional(),
    limit: z.number().int().min(1).max(500).optional(),
    offset: z.number().int().min(0).optional(),
  }),
  output: z.object({ items: z.array(Attachment.schemas.json), total: z.number().int(), limit: z.number().int(), offset: z.number().int() }),
  permission: { entity: 'attachment', op: 'read' },
  tx: 'none',
  mutates: false,
  handler: async (ctx, q) => {
    const where = buildSearchDomain(q);
    const res = await repo(ctx, Attachment).list({
      ...(where ? { where } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      ...(q.offset !== undefined ? { offset: q.offset } : {}),
      orderBy: [
        { field: 'txnDate', dir: 'desc' },
        { field: 'createdAt', dir: 'desc' },
      ],
    });
    return { ...res, items: res.items.map(attachmentJson) };
  },
});
