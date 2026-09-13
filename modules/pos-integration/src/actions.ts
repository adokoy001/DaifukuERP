import { defineAction, label, repo, snapshot } from '@daifuku/kernel';
import { z } from 'zod';
import { retryInput, correctInput, posResult } from './contract.ts';
import { PosInbox } from './entities.ts';
import { processInbox } from './inbox.ts';
import { correctTransaction } from './posting.ts';
export const retryPosAction = defineAction({
  name: 'pos_integration.retry',
  description: label('POS受信を再試行', 'Retry a POS inbox item'),
  input: retryInput,
  output: posResult,
  permission: { roles: ['accounting'] },
  handler: (ctx, i) => processInbox(ctx, i.inboxId, i.expectedVersion),
});
export const correctPosAction = defineAction({
  name: 'pos_integration.correct',
  description: label('POS原資料の訂正取消', 'Reverse a POS source'),
  input: correctInput,
  output: z.object({ id: z.uuid(), version: z.number().int(), status: z.string() }),
  permission: { roles: ['accounting'] },
  handler: correctTransaction,
});
export const posInboxAction = defineAction({
  name: 'pos_integration.inbox',
  description: label('POS受信状態と再試行状況', 'POS inbox and retry status'),
  input: z.object({ status: z.string().optional(), offset: z.number().int().min(0).default(0) }),
  output: z.object({ items: z.array(PosInbox.schemas.json), total: z.number() }),
  permission: { entity: PosInbox.name, op: 'read' },
  mutates: false,
  handler: async (ctx, i) => {
    const rows = await repo(ctx, PosInbox).list({
      where: i.status ? { status: i.status } : {},
      limit: 100,
      offset: i.offset,
      orderBy: [{ field: 'receivedAt', dir: 'desc' }],
    });
    return { items: rows.items.map((row) => snapshot({ ...row })), total: rows.total };
  },
});
