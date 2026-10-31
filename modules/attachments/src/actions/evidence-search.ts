// attachment.evidence_search (docs/specs/evidence-search.md AC-1..AC-9): the 電子帳簿保存法 search over evidence —
// 取引年月日 range, 取引金額 range and 取引先 in any combination (AND), plus kind, supersede state and "search keys
// missing" — returning a public row (no storage key) with what it links to and how many versions it replaced. Reads only,
// through Repository with the caller's Context: attachment's own read rules decide the rows (AC-6), the linked entity's
// rules decide the link summary (AC-5).
import { defineAction, isLocalDate, label, repo } from '@daifuku/kernel';
import { z } from 'zod';
import { Attachment, ATTACHMENT_KINDS, attachmentJson } from '../entities/attachment.ts';
import {
  EVIDENCE_PAGE_DEFAULT,
  EVIDENCE_PAGE_MAX,
  evidenceItemSchema,
  isIncomplete,
  withoutStorageKey,
} from '../services/evidence.ts';
import { linkedSummaries } from '../services/linked.ts';
import { buildSearchDomain, SUPERSEDED_FILTERS } from '../services/search.ts';

const localDate = z.string().refine(isLocalDate, 'must be YYYY-MM-DD');
const decimalString = z.string().min(1).max(40);

export const evidenceSearchInput = z.object({
  txnDateFrom: localDate.optional(),
  txnDateTo: localDate.optional(),
  amountFrom: decimalString.optional(),
  amountTo: decimalString.optional(),
  partnerId: z.uuid().optional(),
  kind: z.enum(ATTACHMENT_KINDS).optional(),
  superseded: z.enum(SUPERSEDED_FILTERS).optional(),
  incomplete: z.boolean().optional(),
  limit: z.number().int().min(1).max(EVIDENCE_PAGE_MAX).optional(),
  offset: z.number().int().min(0).optional(),
});
export type EvidenceSearchInput = z.infer<typeof evidenceSearchInput>;

export const evidenceSearchAction = defineAction({
  name: 'attachment.evidence_search',
  description: label(
    '証憑を取引年月日の範囲・取引金額の範囲・取引先（任意の組合せの AND）、種別、差替の状態、検索項目の未入力で検索します（電子帳簿保存法の検索要件）。各行にリンク先の要約（読めないときは readable: false）と差替前の件数が付きます。保存キーは含みません。',
    'Search evidence by transaction date range, amount range and partner (AND of any combination), kind, supersede state and missing search keys (the 電子帳簿保存法 search requirement). Each row carries a summary of its linked record (readable: false when the caller cannot see it) and how many attachments it superseded. Storage keys are not returned.',
  ),
  input: evidenceSearchInput,
  output: z.object({
    items: z.array(evidenceItemSchema),
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
  }),
  permission: { entity: 'attachment', op: 'read' },
  tx: 'none',
  mutates: false,
  handler: async (ctx, q) => {
    const where = buildSearchDomain(q);
    const r = repo(ctx, Attachment);
    const res = await r.list({
      ...(where ? { where } : {}),
      limit: q.limit ?? EVIDENCE_PAGE_DEFAULT,
      offset: q.offset ?? 0,
      orderBy: [
        { field: 'txnDate', dir: 'desc' },
        { field: 'createdAt', dir: 'desc' },
      ],
    });
    const pageIds = res.items.map((row) => row.id);
    const counts = new Map<string, number>();
    if (pageIds.length > 0) {
      const grouped = await r.aggregate({
        where: { supersededById: { $in: pageIds } },
        groupBy: ['supersededById'],
        metrics: { n: { count: true } },
      });
      for (const g of grouped) counts.set(String(g.supersededById), Number(g.n));
    }
    const linked = await linkedSummaries(ctx, res.items);
    return {
      ...res,
      items: res.items.map((row) => ({
        ...withoutStorageKey(attachmentJson(row)),
        linked: linked.get(row.id) ?? null,
        supersedes: counts.get(row.id) ?? 0,
        incomplete: isIncomplete(row),
      })),
    };
  },
});
