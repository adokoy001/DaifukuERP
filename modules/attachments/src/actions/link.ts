// attachment.link (docs/specs/attachments.md AC-6): attach evidence to any record. The target check (registered
// entity, record visible to the caller) runs in the before_update hook so the generic update path is covered too.
import { defineAction, label, repo } from '@daifuku/kernel';
import { z } from 'zod';
import { Attachment, attachmentJson } from '../entities/attachment.ts';

export const linkAction = defineAction({
  name: 'attachment.link',
  description: label(
    '証憑を任意のレコード（伝票・マスタ）にリンクします。対象エンティティが存在し、呼び出し側がそのレコードを参照できることを確認します。',
    'Link an attachment to a record of any entity. The entity must be registered and the record visible to the caller.',
  ),
  input: z.object({ id: z.uuid(), entity: z.string().min(1).max(100), recordId: z.uuid() }),
  output: Attachment.schemas.json,
  permission: { entity: 'attachment', op: 'update' },
  handler: async (ctx, { id, entity, recordId }) => attachmentJson(await repo(ctx, Attachment).update(id, { linkedEntity: entity, linkedId: recordId })),
});
