// attachment.supersede (docs/specs/attachments.md AC-5): 訂正削除履歴 — the old row points at its replacement and the
// reason is recorded in the audit trail; the old file stays retrievable. The invariants (write-once, no self, acyclic)
// are checked here so a repeated call is an error rather than a silent no-op; hooks/integrity.ts backstops generic updates.
import { defineAction, label, repo, writeAudit, withLock } from '@daifuku/kernel';
import { z } from 'zod';
import { withSupersede } from '../write.ts';
import { Attachment, attachmentJson } from '../entities/attachment.ts';
import { assertSupersedable } from '../services/validate.ts';

export const supersedeAction = defineAction({
  name: 'attachment.supersede',
  description: label(
    '証憑を訂正版で差し替えます。旧行に差替先を記録し、理由を監査ログに残します。旧ファイルは削除されず取得できます。',
    'Supersede an attachment with a corrected one: records supersededById on the old row and the reason in the audit trail. The old file remains retrievable.',
  ),
  input: z.object({ id: z.uuid(), newAttachmentId: z.uuid(), reason: z.string().trim().min(1).max(2000) }),
  output: Attachment.schemas.json,
  permission: { entity: 'attachment', op: 'update' },
  handler: async (ctx, { id, newAttachmentId, reason }) => {
    await withLock(ctx, 'attachment-supersede', async () => undefined);
    const r = repo(ctx, Attachment);
    const before = await r.lock(id);
    const replacement = await r.get(newAttachmentId);
    assertSupersedable(
      { id: before.id, supersededById: before.supersededById },
      { id: replacement.id, supersededById: replacement.supersededById },
    );
    const updated = await withSupersede(ctx, (internal) =>
      repo(internal, Attachment).update(id, { supersededById: newAttachmentId }, { expectedVersion: before.version }),
    );
    await writeAudit(
      ctx,
      'attachment',
      id,
      'supersede',
      { supersededById: before.supersededById },
      { supersededById: newAttachmentId, reason },
      'attachment.supersede',
    );
    return attachmentJson(updated);
  },
});
