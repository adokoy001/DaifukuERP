// docs/specs/list-workbench.md AC-7..AC-9: the generic `<entity>.export_rows` action behind the list's CSV export.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appMeta,
  auditLog,
  checkActionExport,
  defineDocument,
  defineEntity,
  EXPORT_ROWS_LIMIT,
  f,
  label,
  PermissionDenied,
  registerCrudActions,
  registry,
  repo,
  runAction,
  ValidationError,
  type TableResult,
} from '../src/index.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
import { and, eq } from 'drizzle-orm';

const XrPartner = defineEntity({
  name: 'xr_partner',
  label: label('出力先取引先', 'Export partner'),
  displayField: 'name',
  fields: { code: f.text({ required: true, unique: true }), name: f.text({ required: true }) },
  permissions: {
    // xr_limited reads partners but may not export them: its order exports keep partner ids (ADR-0018).
    roles: { xr_exporter: ['read', 'create', 'export'], xr_limited: ['read'], xr_reader: ['read', 'create'] },
  },
});
const XrOrder = defineDocument({
  name: 'xr_order',
  label: label('出力検証伝票', 'Export order'),
  naming: { type: 'sequence', prefix: 'XR-' },
  fields: {
    partnerId: f.ref(XrPartner.name, { label: label('取引先', 'Partner'), required: true }),
    date: f.date({ label: label('日付', 'Date'), required: true }),
    amount: f.money({ label: label('金額', 'Amount'), required: true }),
    stage: f.enum(['open', 'closed'], {
      label: label('段階', 'Stage'),
      required: true,
      default: 'open',
      labels: { open: label('未完了', 'Open'), closed: label('完了', 'Closed') },
    }),
    owner: f.text({ label: label('担当', 'Owner'), required: true }),
    secret: f.text({ label: label('機密', 'Secret') }),
    vaultKey: f.text({ outputHidden: true }),
  },
  permissions: {
    roles: {
      xr_exporter: ['read', 'create', 'submit', 'export'],
      xr_limited: ['read', 'export'],
      xr_noref: ['read', 'export'],
      xr_reader: ['read', 'create'],
    },
    rowRules: [{ roles: ['xr_limited'], where: { owner: 'mine' } }],
    fieldGroups: { confidential: { fields: ['secret'], roles: ['xr_auditor'] } },
  },
  views: { list: ['partnerId', 'date', 'amount', 'stage', 'secret'], search: ['owner'] },
});
registry.registerExt(XrOrder.name, { region: f.text(), vaultTag: f.text({ outputHidden: true }) });
const XrBulk = defineEntity({
  name: 'xr_bulk',
  label: label('大量出力', 'Bulk export'),
  audit: 'none',
  fields: { name: f.text({ required: true }) },
  permissions: { roles: { xr_exporter: ['read', 'create', 'export'] } },
  views: { list: ['name'] },
});
registerCrudActions();

let db: TestDb;
let partnerId: string;
const exporter = ['xr_exporter'];
const run = (roles: string[], name: string, input: unknown) =>
  db.run({ roles }, (ctx) => runAction(ctx, name, input)) as Promise<TableResult>;

beforeAll(async () => {
  db = await freshDb();
  // admin: only it may write the masked `secret` field
  await db.run({}, async (ctx) => {
    partnerId = (await repo(ctx, XrPartner).create({ code: 'P1', name: 'Alpha 商事' })).id;
    const orders = repo(ctx, XrOrder);
    await orders.create({ partnerId, date: '2026-10-01', amount: '1200', owner: 'mine', secret: 'classified-1' });
    await orders.create({ partnerId, date: '2026-10-15', amount: '300.5', owner: 'other', stage: 'closed' });
    await orders.create({ partnerId, date: '2026-11-02', amount: '50', owner: 'mine', vaultKey: 'vault-secret' });
  });
}, 60_000);
afterAll(async () => {
  await db.close();
});

describe('list-workbench AC-8: export permission', () => {
  it('AC-8: a role without export cannot run export_rows, pass the fresh export check or see the action', async () => {
    await expect(run(['xr_reader'], 'xr_order.export_rows', {})).rejects.toBeInstanceOf(PermissionDenied);
    await db.run({ roles: ['xr_reader'] }, async (ctx) => {
      expect(() => checkActionExport(ctx, registry.action('xr_order.export_rows'))).toThrow(PermissionDenied);
      expect(appMeta(ctx).actions.some((a) => a.name === 'xr_order.export_rows')).toBe(false);
    });
    await db.run({ roles: exporter }, async (ctx) => {
      expect(() => checkActionExport(ctx, registry.action('xr_order.export_rows'))).not.toThrow();
      const action = appMeta(ctx).actions.find((a) => a.name === 'xr_order.export_rows');
      expect(action).toMatchObject({ generic: true, mutates: false, canExport: true });
    });
    expect(registry.action('xr_order.export_rows').permission).toEqual({ entity: 'xr_order', op: 'export' });
  });
});

describe('list-workbench AC-7/AC-8: rows, columns and masks', () => {
  it('AC-7: exports the criteria, order and columns with display values; raw values match the list', async () => {
    const where = { date: { $gte: '2026-10-01', $lte: '2026-10-31' } };
    const result = await run(exporter, 'xr_order.export_rows', {
      where,
      orderBy: [{ field: 'amount', dir: 'desc' }],
      columns: ['number', 'docstatus', 'partnerId', 'date', 'amount', 'stage'],
    });
    expect(result.columns.map((c) => [c.key, c.kind])).toEqual([
      ['number', 'text'],
      ['docstatus', 'text'],
      ['partnerId', 'text'],
      ['date', 'date'],
      ['amount', 'decimal'],
      ['stage', 'text'],
    ]);
    expect(result.columns.find((c) => c.key === 'amount')).toMatchObject({ label: { ja: '金額', en: 'Amount' } });
    const listed = (await db.run({ roles: exporter }, (ctx) =>
      runAction(ctx, 'xr_order.list', { where, orderBy: [{ field: 'amount', dir: 'desc' }] }),
    )) as { items: Record<string, unknown>[] };
    expect(result.rows.map((r) => r.amount)).toEqual(listed.items.map((i) => i.amount));
    expect(result.rows.map((r) => r.date)).toEqual(['2026-10-01', '2026-10-15']);
    expect(result.rows[0]).toMatchObject({ docstatus: '下書き', partnerId: 'Alpha 商事', stage: '未完了' });
    expect(result.rows[1]).toMatchObject({ stage: '完了' });
    expect(result.meta).toMatchObject({ entity: 'xr_order', total: 2, rowCount: 2, truncated: false, limit: 5000 });
    const english = await run(exporter, 'xr_order.export_rows', {
      where,
      columns: ['docstatus', 'stage'],
      locale: 'en',
    });
    expect(english.rows.map((r) => r.docstatus)).toEqual(['Draft', 'Draft']);
    expect(english.rows.map((r) => r.stage).sort()).toEqual(['Closed', 'Open']);
    const searched = await run(exporter, 'xr_order.export_rows', { search: 'other', columns: ['amount'] });
    expect(searched.rows).toHaveLength(1);
  });

  it('AC-8: default columns follow the caller-visible list view; masked and outputHidden columns are refused', async () => {
    const defaults = await run(exporter, 'xr_order.export_rows', {});
    expect(defaults.columns.map((c) => c.key)).toEqual(['number', 'docstatus', 'partnerId', 'date', 'amount', 'stage']);
    expect(JSON.stringify(defaults.rows)).not.toContain('classified-1');
    expect(JSON.stringify(defaults.rows)).not.toContain('vault-secret');
    await expect(run(exporter, 'xr_order.export_rows', { columns: ['secret'] })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    for (const roles of [exporter, ['admin']])
      for (const column of ['vaultKey', 'ext.vaultTag'])
        await expect(run(roles, 'xr_order.export_rows', { columns: [column] })).rejects.toBeInstanceOf(
          PermissionDenied,
        );
    const ext = await run(exporter, 'xr_order.export_rows', { columns: ['ext.region'] });
    expect(ext.columns.map((c) => c.key)).toEqual(['ext.region']);
    await expect(run(exporter, 'xr_order.export_rows', { columns: ['nope'] })).rejects.toBeInstanceOf(ValidationError);
    await expect(run(exporter, 'xr_order.export_rows', { columns: ['ext.nope'] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(run(exporter, 'xr_order.export_rows', { columns: ['date', 'date'] })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(run(exporter, 'xr_order.export_rows', { where: { secret: 'classified-1' } })).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    const admin = await run(['admin'], 'xr_order.export_rows', { columns: ['secret'] });
    expect(admin.rows.map((r) => r.secret)).toContain('classified-1');
  });

  it('AC-8: row rules limit the rows; a ref target the caller cannot export (or read) keeps its id', async () => {
    const limited = await run(['xr_limited'], 'xr_order.export_rows', { columns: ['owner', 'partnerId'] });
    expect(limited.rows.map((r) => r.owner)).toEqual(['mine', 'mine']);
    expect(limited.meta?.total).toBe(2);
    // ADR-0018: xr_limited may read partners but not export them, so their names are not output.
    expect(limited.rows.map((r) => r.partnerId)).toEqual([partnerId, partnerId]);
    expect(JSON.stringify(limited.rows)).not.toContain('Alpha 商事');
    const noRef = await run(['xr_noref'], 'xr_order.export_rows', { columns: ['partnerId'] });
    expect(noRef.rows.map((r) => r.partnerId)).toEqual([partnerId, partnerId, partnerId]);
    const exported = await run(exporter, 'xr_order.export_rows', { columns: ['partnerId'] });
    expect(exported.rows.map((r) => r.partnerId)).toEqual(['Alpha 商事', 'Alpha 商事', 'Alpha 商事']);
  });

  it('AC-8: an oversized where is refused before anything is read or audited', async () => {
    const where = { owner: { $in: Array.from({ length: 600 }, (_, i) => `owner-${i}`) } };
    await expect(run(exporter, 'xr_order.export_rows', { where })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('list-workbench AC-9: audit', () => {
  it('AC-9: each export writes one export entry with the entity, criteria summary, row count and actor', async () => {
    const where = { owner: 'mine' };
    await run(exporter, 'xr_order.export_rows', { where, search: 'mi', columns: ['date'] });
    const entries = await db.run({}, (ctx) =>
      ctx.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, 'xr_order.export_rows'), eq(auditLog.op, 'export'))),
    );
    const entry = entries.find((e) => JSON.stringify(e.after).includes('"search":"mi"'));
    expect(entry).toMatchObject({ entity: 'xr_order', actorType: 'user', actorId: db.adminUserId, before: null });
    expect(entry?.after).toEqual({
      export: { where, search: 'mi', columns: ['date'], rows: 2, total: 2, truncated: false },
    });
    expect(entries.length).toBeGreaterThanOrEqual(1);
  });

  it('AC-9: values of field-group fields in the audited criteria are replaced; names and operators stay', async () => {
    const where = { secret: { $ne: 'classified-zz' }, $or: [{ secret: 'classified-1' }, { owner: 'audit-or' }] };
    const result = await run(['admin'], 'xr_order.export_rows', { where, columns: ['owner'] });
    expect(result.rows.map((r) => r.owner)).toEqual(['mine']);
    const entries = await db.run({}, (ctx) =>
      ctx.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, 'xr_order.export_rows'), eq(auditLog.op, 'export'))),
    );
    const entry = entries.find((e) => JSON.stringify(e.after).includes('audit-or'));
    expect((entry?.after as { export: { where: unknown } }).export.where).toEqual({
      secret: { $ne: '[masked]' },
      $or: [{ secret: '[masked]' }, { owner: 'audit-or' }],
    });
    expect(JSON.stringify(entries.map((e) => e.after))).not.toContain('classified-');
  });
});

describe('list-workbench AC-7: row cap', () => {
  it(`AC-7: returns at most ${EXPORT_ROWS_LIMIT} rows in order and reports the full total as truncated`, async () => {
    const count = EXPORT_ROWS_LIMIT + 3;
    await db.run({ roles: exporter }, async (ctx) => {
      const bulk = repo(ctx, XrBulk);
      for (let i = 0; i < count; i += 1) await bulk.create({ name: `B-${String(i).padStart(5, '0')}` });
    });
    const result = await run(exporter, 'xr_bulk.export_rows', { orderBy: [{ field: 'name', dir: 'asc' }] });
    const names = result.rows.map((r) => r.name);
    expect(names).toHaveLength(EXPORT_ROWS_LIMIT);
    expect(new Set(names).size).toBe(EXPORT_ROWS_LIMIT);
    expect(names[0]).toBe('B-00000');
    expect(names.at(-1)).toBe(`B-${String(EXPORT_ROWS_LIMIT - 1).padStart(5, '0')}`);
    expect(result.meta).toMatchObject({ total: count, rowCount: EXPORT_ROWS_LIMIT, truncated: true });
  }, 180_000);
});
