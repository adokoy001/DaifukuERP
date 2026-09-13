// Integrity rules that must hold on every write path, generic CRUD included (電帳法 真実性, docs/specs/attachments.md
// AC-1, AC-5, AC-6, AC-7): no deletes, duplicate content is a Conflict, supersede is write-once and acyclic,
// partner/link targets must be visible to the writer.
import { Conflict, registry, repo, StateError, ValidationError, type Context } from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { Attachment } from '../entities/attachment.ts';
import { assertSupersedable } from '../services/validate.ts';
import { assertLinkPair, assertLinkTarget } from './link-target.ts';

type Row = Record<string, unknown>;

/** AC-7: returns the id of the attachment in this company that already holds these bytes, if any. */
export async function findDuplicate(ctx: Context, sha256: string): Promise<string | null> {
  const res = await repo(ctx, Attachment).list({ where: { sha256 }, limit: 1 });
  return res.items[0]?.id ?? null;
}

export function duplicateConflict(existingId: string, sha256: string): Conflict {
  return new Conflict(
    `an attachment with the same content already exists (sha256 ${sha256})`,
    'The file is already stored as details.existingId. Link or supersede that attachment instead of uploading it again.',
    { existingId, sha256 },
  );
}

async function assertPartnerVisible(ctx: Context, row: Row, previous: Row | undefined): Promise<void> {
  const partnerId = row.partnerId;
  if (typeof partnerId !== 'string' || previous?.partnerId === partnerId) return;
  await repo(ctx, Partner).get(partnerId); // NotFound: other company, or no partner read permission
}

async function assertLink(ctx: Context, row: Row, previous: Row | undefined): Promise<void> {
  assertLinkPair(row.linkedEntity, row.linkedId);
  const entity = row.linkedEntity;
  const recordId = row.linkedId;
  if (typeof entity !== 'string' || typeof recordId !== 'string') return;
  if (previous?.linkedEntity === entity && previous.linkedId === recordId) return;
  await assertLinkTarget(ctx, entity, recordId);
}

/** partnerId and linkedEntity/linkedId (when set or changed) must point at records the writer may read. */
export async function assertReferences(ctx: Context, row: Row, previous: Row | undefined): Promise<void> {
  await assertPartnerVisible(ctx, row, previous);
  await assertLink(ctx, row, previous);
}

async function assertSupersedeChange(ctx: Context, row: Row, previous: Row): Promise<void> {
  const next = row.supersededById;
  const prev = (previous.supersededById as string | null | undefined) ?? null;
  if (next === prev) return;
  if (typeof next !== 'string') {
    throw new StateError(
      `attachment ${String(row.id)} is superseded by ${prev}; the link cannot be cleared`,
      'Supersede history is append-only (電帳法 訂正削除履歴).',
      { id: row.id, supersededById: prev },
    );
  }
  const replacement = await repo(ctx, Attachment).get(next);
  assertSupersedable(
    { id: row.id as string, supersededById: prev },
    { id: replacement.id, supersededById: replacement.supersededById },
  );
}

export function registerIntegrityHooks(): void {
  registry.registerHook('attachment', 'before_create', async (ctx, { row }) => {
    const sha256 = row.sha256;
    if (typeof sha256 === 'string') {
      const existing = await findDuplicate(ctx, sha256);
      if (existing) throw duplicateConflict(existing, sha256);
    }
    if (row.supersededById !== undefined && row.supersededById !== null) {
      throw new ValidationError(
        'supersededById cannot be set on create',
        [{ path: 'supersededById', message: 'use attachment.supersede' }],
        'Create the attachment first, then call attachment.supersede with a reason.',
      );
    }
    await assertReferences(ctx, row, undefined);
  });

  registry.registerHook('attachment', 'before_update', async (ctx, { row, previous }) => {
    const before = previous ?? {};
    await assertSupersedeChange(ctx, row, before);
    await assertReferences(ctx, row, before);
  });

  // Applies to admin as well: the permission table grants nobody `delete`, and this closes the implicit-admin path.
  registry.registerHook('attachment', 'before_delete', (_ctx, { row }) => {
    throw new StateError(
      `attachment ${String(row.id)} cannot be deleted`,
      'Evidence is never deleted (電子帳簿保存法). Upload the corrected file and call attachment.supersede with a reason.',
      { id: row.id },
    );
  });
}
