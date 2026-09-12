import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLog, auditTrail, defineDocument, defineEntity, entityMeta, f, label, newId, registerCrudActions, registry, repo, runAction } from '../src/index.ts';
import { freshDb, type TestDb } from '../src/testing.ts';

const roles = { output_reader: ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend', 'export'] as const };
const Private = defineEntity({ name: 'output_private', label: label('非公開出力', 'Private output'), fields: {
  name: f.text({ required: true }), storageKey: f.text({ required: true, outputHidden: true }), internalScore: f.int({ required: true, outputHidden: true }), uiOnly: f.text({ required: true, hidden: true }),
  privateDefault: f.text({ required: true, outputHidden: true, default: 'synthetic-default-secret' }),
}, permissions: { roles }, views: { list: ['name', 'storageKey'], search: ['name', 'storageKey'] } });
registry.registerExt(Private.name, { internalTag: f.text({ outputHidden: true, searchable: true }), visibleTag: f.text({ searchable: true }) });
const Document = defineDocument({ name: 'output_document', label: label('非公開伝票', 'Private document'), naming: { type: 'sequence', prefix: 'HIDDEN-' }, fields: { name: f.text({ required: true }), internalKey: f.text({ required: true, outputHidden: true, default: 'synthetic-document-key' }) }, permissions: { roles }, lines: [{ entity: 'output_line', parentField: 'documentId' }] });
const Line = defineEntity({ name: 'output_line', label: label('非公開明細', 'Private line'), fields: { documentId: f.ref(Document.name, { required: true }), name: f.text({ required: true }), internalKey: f.text({ required: true, outputHidden: true }) }, permissions: { roles } });
registerCrudActions();
let db: TestDb;
let id: string;
beforeAll(async () => { db = await freshDb(); });
afterAll(async () => { await db.close(); });
async function action(name: string, input: unknown, roles = ['output_reader']) {
  return db.run({ roles }, (ctx) => runAction(ctx, name, input)) as Promise<Record<string, unknown>>;
}
function expectPublic(row: Record<string, unknown>): void {
  expect(row).not.toHaveProperty('storageKey'); expect(row).not.toHaveProperty('internalScore'); expect(row).not.toHaveProperty('privateDefault');
  expect(row).toHaveProperty('uiOnly', 'ui-hidden-still-public');
  expect(row.ext).toEqual({ visibleTag: 'visible' });
}
describe('outputHidden is a transport/audit boundary for every role', () => {
  it('removes fields from generated create/get/list/update while internal rows retain original values', async () => {
    const created = await action('output_private.create', { name: 'Visible name', storageKey: 'synthetic-storage-secret', internalScore: 42, uiOnly: 'ui-hidden-still-public', ext: { internalTag: 'synthetic-ext-secret', visibleTag: 'visible' } });
    id = String(created.id); expectPublic(created);
    for (const roles of [['output_reader'], ['admin']]) {
      expectPublic(await action('output_private.get', { id }, roles));
      const listed = await action('output_private.list', {}, roles);
      expectPublic((listed.items as Record<string, unknown>[])[0] as Record<string, unknown>);
      expectPublic(await action('output_private.update', { id, patch: { name: 'Renamed' } }, roles));
      const internal = await db.run({ roles }, (ctx) => repo(ctx, Private).get(id));
      expect(internal.storageKey).toBe('synthetic-storage-secret'); expect(internal.ext).toHaveProperty('internalTag', 'synthetic-ext-secret');
      const parsed = Private.schemas.json.parse(JSON.parse(JSON.stringify(internal)));
      expect(parsed).not.toHaveProperty('storageKey'); expect(parsed).not.toHaveProperty('internalScore');
    }
  });
  it('filters metadata and declared search fields without changing UI-only hidden semantics', async () => {
    await db.run({}, async (ctx) => {
      const meta = entityMeta(ctx, Private);
      expect(meta.fields.map((field) => field.name)).toEqual(['name', 'uiOnly']);
      expect(meta.extFields.map((field) => field.name)).toEqual(['ext.visibleTag']);
      expect(meta.views.search).toEqual(['name']); expect(meta.views.list).toEqual(['name']);
      expect(Private.schemas.json.shape).not.toHaveProperty('storageKey');
      expect(Private.schemas.json.shape).not.toHaveProperty('privateDefault');
      expect((await repo(ctx, Private).list({ search: 'synthetic-storage-secret' })).total).toBe(0);
      expect((await repo(ctx, Private).list({ search: 'synthetic-ext-secret' })).total).toBe(0);
      expect((await repo(ctx, Private).list({ search: 'visible' })).total).toBe(1);
    });
  });
  it('rejects private-field filter/order/group/metrics including nested conditions and admin', async () => {
    for (const roles of [['output_reader'], ['admin']]) {
      for (const where of [{ storageKey: 'guess' }, { $or: [{ internalScore: { $gt: 1 } }] }, { 'ext.internalTag': 'guess' }, { ext: null }]) {
        await expect(action('output_private.list', { where }, roles)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
        await expect(db.run({ roles }, (ctx) => repo(ctx, Private).count(where))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      }
      await expect(action('output_private.list', { orderBy: [{ field: 'storageKey' }] }, roles)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(db.run({ roles }, (ctx) => repo(ctx, Private).aggregate({ groupBy: ['storageKey'], metrics: { count: { count: true } } }))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(db.run({ roles }, (ctx) => repo(ctx, Private).aggregate({ metrics: { maximum: { max: 'internalScore' } } }))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
      await expect(db.run({ roles }, (ctx) => repo(ctx, Private).aggregate({ groupBy: ['ext'], metrics: { count: { count: true } } }))).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    }
  });
  it('never writes private audit values and redacts legacy snapshots when reading them', async () => {
    await db.run({}, async (ctx) => {
      const stored = await ctx.db.select().from(auditLog);
      expect(JSON.stringify(stored)).not.toContain('synthetic-storage-secret'); expect(JSON.stringify(stored)).not.toContain('synthetic-ext-secret');
      await ctx.db.insert(auditLog).values({ id: newId(), tenantId: ctx.tenantId, companyId: ctx.companyId, entity: Private.name, recordId: id, op: 'legacy', actorType: 'user', actorId: db.adminUserId, at: ctx.now(), before: { storageKey: 'legacy-secret', ext: { internalTag: 'legacy-ext', visibleTag: 'old' } }, after: { storageKey: 'legacy-secret', name: 'Legacy' } });
    });
    for (const roles of [['output_reader'], ['admin']]) {
      const history = await db.run({ roles }, (ctx) => auditTrail(ctx, Private.name, id));
      expect(history.length).toBeGreaterThan(1);
      expect(JSON.stringify(history)).not.toContain('secret'); expect(JSON.stringify(history)).not.toContain('legacy-ext');
      expect(JSON.stringify(history)).toContain('Legacy');
    }
  });
  it('redacts child rows and document lifecycle output through create/get/update/submit/cancel/amend', async () => {
    const created = await action('output_document.create', { name: 'Document', lines: { output_line: [{ name: 'Line', internalKey: 'synthetic-child-secret' }] } });
    expect(created).not.toHaveProperty('internalKey'); expect(JSON.stringify(created)).not.toContain('synthetic-child-secret');
    const lines = created.lines as Record<string, Record<string, unknown>[]>;
    expect(lines.output_line?.[0]).not.toHaveProperty('internalKey');
    const documentId = String(created.id);
    expect(JSON.stringify(await action('output_document.get', { id: documentId }, ['admin']))).not.toContain('synthetic-');
    expect(await action('output_document.update', { id: documentId, patch: { name: 'Changed' } })).not.toHaveProperty('internalKey');
    expect(await action('output_document.submit', { id: documentId })).not.toHaveProperty('internalKey');
    expect(await action('output_document.cancel', { id: documentId })).not.toHaveProperty('internalKey');
    expect(await action('output_document.amend', { id: documentId })).not.toHaveProperty('internalKey');
    const internal = await db.run({}, (ctx) => repo(ctx, Line).list());
    expect(internal.items[0]?.internalKey).toBe('synthetic-child-secret');
  });
});
