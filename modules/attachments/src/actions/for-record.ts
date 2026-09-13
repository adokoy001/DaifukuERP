// attachment.for_record (docs/specs/attachments.md AC-6): the attachments panel of a record page (web-phase1 AC-4).
import { defineAction, label, repo } from '@daifuku/kernel';
import { z } from 'zod';
import { Attachment, attachmentJson } from '../entities/attachment.ts';
import { assertLinkTarget } from '../hooks/link-target.ts';

export const forRecordAction = defineAction({
  name: 'attachment.for_record',
  description: label(
    'レコードにリンクされた証憑を一覧します（新しい順）。',
    'List the attachments linked to a record (newest first).',
  ),
  input: z.object({ entity: z.string().min(1).max(100), recordId: z.uuid() }),
  output: z.object({ items: z.array(Attachment.schemas.json), total: z.number().int() }),
  permission: { entity: 'attachment', op: 'read' },
  tx: 'none',
  mutates: false,
  handler: async (ctx, { entity, recordId }) => {
    await assertLinkTarget(ctx, entity, recordId);
    const res = await repo(ctx, Attachment).list({ where: { linkedEntity: entity, linkedId: recordId }, limit: 500 });
    return { items: res.items.map(attachmentJson), total: res.total };
  },
});
