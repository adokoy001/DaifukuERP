// Generic per-entity actions (ADR-0009): <entity>.list/get/create/update/delete (+ submit/cancel/amend).
import { z } from 'zod';
import { defineAction } from '../dsl/action.ts';
import type { EntityDef } from '../dsl/entity.ts';
import { amendDocument, cancelDocument, submitDocument, transitionDocument } from '../document.ts';
import { isLocalDate } from '../ids.ts';
import { label } from '../i18n.ts';
import { getLines, saveLines, type LinesInput } from '../lines.ts';
import { registry } from '../registry.ts';
import { listQuerySchema, type ListQuery } from '../repository/query.ts';
import { repo } from '../repository/repository.ts';
import { snapshot } from '../repository/rows.ts';
import { ValidationError } from '../errors.ts';
import { createInputSchema, followExtFields, hasLines, recordJsonSchema, updateInputSchema } from './crud-schemas.ts';
import { publicOutput } from '../public-output.ts';

const idInput = z.object({ id: z.uuid() });
const versionInput = idInput.extend({ expectedVersion: z.number().int().min(1).optional() });

function jsonOf(entity: EntityDef, row: unknown): Record<string, unknown> {
  return snapshot(publicOutput(entity, row as Record<string, unknown>));
}

async function withLines(
  ctx: Parameters<typeof getLines>[0],
  entity: EntityDef,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!hasLines(entity)) return jsonOf(entity, row);
  const lines = await getLines(ctx, entity, row.id as string);
  const publicLines = Object.fromEntries(
    Object.entries(lines).map(([name, rows]) => [name, rows.map((line) => jsonOf(registry.entity(name), line))]),
  );
  return { ...jsonOf(entity, row), lines: publicLines };
}

/** Registers generic CRUD actions for every entity that has none yet. Call once after all modules are imported. */
export function registerCrudActions(): void {
  for (const entity of registry.allEntities()) {
    if (registry.hasAction(`${entity.name}.list`)) continue;
    registerReadActions(entity);
    registerWriteActions(entity);
    if (entity.kind === 'document') registerDocumentActions(entity);
  }
}

function registerReadActions(entity: EntityDef): void {
  const { name } = entity;
  const { ja, en } = entity.config.label;
  const lines = hasLines(entity);
  defineAction(
    {
      name: `${name}.list`,
      description: label(
        `${ja}を検索・一覧します。where/search/orderBy/limit/offset を指定できます。`,
        `List ${en} records with optional where/search/orderBy/limit/offset.`,
      ),
      input: listQuerySchema,
      output: z.object({
        items: z.array(entity.schemas.json),
        total: z.number().int(),
        limit: z.number().int(),
        offset: z.number().int(),
      }),
      permission: { entity: name, op: 'read' },
      tx: 'none',
      mutates: false,
      handler: async (ctx, q) => {
        const res = await repo(ctx, entity).list(q as ListQuery);
        return { ...res, items: res.items.map((r) => jsonOf(entity, r)) };
      },
    },
    { generic: true },
  );
  defineAction(
    {
      name: `${name}.get`,
      description: label(
        `${ja}を1件取得します${lines ? '（明細 lines を含む）' : ''}。`,
        `Get one ${en} by id${lines ? ' (includes lines)' : ''}.`,
      ),
      input: idInput,
      output: recordJsonSchema(entity),
      permission: { entity: name, op: 'read' },
      tx: 'none',
      mutates: false,
      handler: async (ctx, { id }) => withLines(ctx, entity, await repo(ctx, entity).get(id)),
    },
    { generic: true },
  );
}

/** Generic update input as it arrives (lenient): id is checked here, the patch by the Repository. */
function splitUpdate(
  name: string,
  raw: unknown,
): {
  id: string;
  expectedVersion: number | undefined;
  head: Record<string, unknown>;
  lineRows: LinesInput | undefined;
} {
  const parsed = z
    .object({
      id: z.uuid(),
      patch: z.record(z.string(), z.unknown()),
      expectedVersion: z.number().int().min(1).optional(),
    })
    .strict()
    .safeParse(raw);
  if (!parsed.success)
    throw new ValidationError(
      `invalid input for ${name}.update`,
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  const head0 = parsed.data;
  const idOk = z.uuid().safeParse(head0.id);
  if (!idOk.success)
    throw new ValidationError(`invalid input for ${name}.update`, [{ path: 'id', message: 'uuid required' }]);
  const patch = (head0.patch && typeof head0.patch === 'object' ? head0.patch : {}) as Record<string, unknown>;
  const { lines: lineRows, ...head } = patch as Record<string, unknown> & { lines?: LinesInput };
  return {
    id: idOk.data,
    expectedVersion: typeof head0.expectedVersion === 'number' ? head0.expectedVersion : undefined,
    head,
    lineRows,
  };
}

function registerWriteActions(entity: EntityDef): void {
  const { name } = entity;
  const { ja, en } = entity.config.label;
  const lines = hasLines(entity);
  const json = recordJsonSchema(entity);
  const create = defineAction(
    {
      name: `${name}.create`,
      description: label(
        `${ja}を新規作成します${lines ? '（lines で明細も同時に作成）' : ''}。`,
        `Create a ${en}${lines ? ' with optional lines' : ''}.`,
      ),
      input: createInputSchema(entity),
      output: json,
      permission: { entity: name, op: 'create' },
      inputMode: 'lenient',
      handler: async (ctx, input) => {
        const { lines: lineRows, ...head } = input as Record<string, unknown> & { lines?: LinesInput };
        const r = repo(ctx, entity);
        const created = await r.create(head as never);
        if (lineRows) await saveLines(ctx, entity, created.id, lineRows);
        // re-read: after_lines_saved hooks may have recomputed header totals
        return withLines(ctx, entity, lineRows ? await r.get(created.id) : created);
      },
    },
    { generic: true },
  );
  followExtFields(create, entity, createInputSchema);
  const update = defineAction(
    {
      name: `${name}.update`,
      description: label(
        `${ja}を更新します。expectedVersion を渡すと楽観ロックします。`,
        `Update a ${en}. Pass expectedVersion for optimistic locking.`,
      ),
      input: updateInputSchema(entity),
      output: json,
      permission: { entity: name, op: 'update' },
      inputMode: 'lenient',
      handler: async (ctx, raw) => {
        const { id, expectedVersion, head, lineRows } = splitUpdate(name, raw);
        const r = repo(ctx, entity);
        if (lineRows !== undefined && Object.keys(head).length === 0) {
          const before = await r.lock(id);
          if (expectedVersion !== undefined && before.version !== expectedVersion) await r.touch(id, expectedVersion);
        }
        const updated =
          Object.keys(head).length > 0 || !lineRows
            ? await r.update(id, head as never, expectedVersion !== undefined ? { expectedVersion } : {})
            : await r.get(id);
        if (lineRows) await saveLines(ctx, entity, id, lineRows);
        return withLines(ctx, entity, lineRows ? await r.get(id) : updated);
      },
    },
    { generic: true },
  );
  followExtFields(update, entity, updateInputSchema);
  defineAction(
    {
      name: `${name}.delete`,
      description: label(`${ja}を削除します（伝票は下書きのみ）。`, `Delete a ${en} (documents: drafts only).`),
      input: versionInput,
      output: z.object({ ok: z.literal(true) }),
      permission: { entity: name, op: 'delete' },
      handler: async (ctx, { id, expectedVersion }) => {
        await repo(ctx, entity).delete(id, { expectedVersion });
        return { ok: true as const };
      },
    },
    { generic: true },
  );
}

function registerDocumentActions(entity: EntityDef): void {
  const name = entity.name;
  const ja = entity.config.label.ja;
  const en = entity.config.label.en;
  const json = entity.schemas.json;
  defineAction(
    {
      name: `${name}.submit`,
      description: label(`${ja}を確定（submit）し採番します。`, `Submit a ${en}; assigns its number.`),
      input: versionInput,
      output: json,
      permission: { entity: name, op: 'submit' },
      handler: async (ctx, { id, expectedVersion }) =>
        jsonOf(entity, await submitDocument(ctx, entity, id, { expectedVersion })),
    },
    { generic: true },
  );
  defineAction(
    {
      name: `${name}.cancel`,
      description: label(
        `確定済みの${ja}を取消します。依存する確定伝票があると失敗します。`,
        `Cancel a submitted ${en}. Fails if submitted dependents exist.`,
      ),
      input: idInput.extend({
        expectedVersion: z.number().int().min(1).optional(),
        correctionDate: z.string().refine(isLocalDate).optional(),
      }),
      output: json,
      permission: { entity: name, op: 'cancel' },
      handler: async (ctx, { id, ...opts }) => jsonOf(entity, await cancelDocument(ctx, entity, id, opts)),
    },
    { generic: true },
  );
  defineAction(
    {
      name: `${name}.amend`,
      description: label(
        `取消済みの${ja}から訂正用の新しい下書きを作ります。`,
        `Create a new draft amended from a cancelled ${en}.`,
      ),
      input: versionInput,
      output: json,
      permission: { entity: name, op: 'amend' },
      handler: async (ctx, { id, expectedVersion }) =>
        jsonOf(entity, await amendDocument(ctx, entity, id, { expectedVersion })),
    },
    { generic: true },
  );
  if (Object.keys(entity.doc?.transitions ?? {}).length)
    defineAction(
      {
        name: `${name}.transition`,
        description: label(`${ja}の名前付き状態遷移を実行します。`, `Run a named transition on ${en}.`),
        input: z.object({ id: z.uuid(), transition: z.string() }),
        output: json,
        permission: { entity: name, op: 'update' },
        handler: async (ctx, { id, transition }) =>
          jsonOf(entity, await transitionDocument(ctx, entity, id, transition)),
      },
      { generic: true },
    );
}
