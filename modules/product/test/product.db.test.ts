// Postgres tests for docs/specs/product.md AC-1..AC-9. Test DB: daifuku_test_product (TEST_DATABASE_URL*).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Conflict,
  Decimal,
  NotFound,
  PermissionDenied,
  ValidationError,
  bootstrapTenant,
  registerCrudActions,
  repo,
  runAction,
  withContext,
  type Context,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import {
  DEFAULT_UOM_CODE,
  Product,
  SAMPLE_PRODUCTS,
  STANDARD_UOMS,
  Uom,
  findUomByCode,
  seedProducts,
  seedUoms,
} from '../src/index.ts';

type Row = Record<string, unknown>;
let db: TestDb;
/** id of the seeded 個 unit */
let pcsId: string;

const asRole = (roles: string[]) => ({ roles });
const systemCtx = { actor: { type: 'system' as const, id: 'system' }, roles: ['admin'] };

beforeAll(async () => {
  db = await freshDb();
  registerCrudActions();
});
afterAll(async () => {
  await db.close();
});

describe('uom (AC-1)', () => {
  it('AC-1 requires code and name; code is unique per company and immutable', async () => {
    await expect(db.run({}, (ctx) => repo(ctx, Uom).create({ code: 'NONAME' } as never))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(db.run({}, (ctx) => repo(ctx, Uom).create({ name: 'コードなし' } as never))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      db.run({}, (ctx) => repo(ctx, Uom).create({ code: 'x'.repeat(11), name: '長すぎ' })),
    ).rejects.toBeInstanceOf(ValidationError);
    const m = await db.run({}, (ctx) => repo(ctx, Uom).create({ code: 'MTR', name: 'メートル', symbol: 'm' }));
    expect(m.symbol).toBe('m');
    await expect(db.run({}, (ctx) => repo(ctx, Uom).create({ code: 'MTR', name: '重複' }))).rejects.toBeInstanceOf(
      Conflict,
    );
    await expect(db.run({}, (ctx) => repo(ctx, Uom).update(m.id, { code: 'M' }))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: 'code' }] },
    });
    const renamed = await db.run({}, (ctx) => repo(ctx, Uom).update(m.id, { name: 'メーター' }));
    expect(renamed.name).toBe('メーター');
  });

  it('AC-1 seeds 個, 式, 時間, kg, 箱 idempotently', async () => {
    await db.run(systemCtx, seedUoms);
    await db.run(systemCtx, seedUoms);
    const seeded = await db.run({}, (ctx) =>
      repo(ctx, Uom).list({
        where: { code: { $in: STANDARD_UOMS.map((u) => u.code) } },
        orderBy: [{ field: 'code', dir: 'asc' }],
      }),
    );
    expect(seeded.total).toBe(5);
    expect(seeded.items.map((u) => u.name).sort()).toEqual(['kg', '個', '式', '時間', '箱']);
    const pcs = await db.run({}, (ctx) => findUomByCode(ctx, DEFAULT_UOM_CODE));
    expect(pcs).not.toBeNull();
    pcsId = (pcs as { id: string }).id;
  });
});

describe('product create (AC-2..AC-5)', () => {
  it('AC-2 create with only name defaults kind, taxCategory, flags and uomId = the company’s 個', async () => {
    const p = (await db.run(asRole(['sales']), (ctx) =>
      runAction(ctx, 'product.create', { name: 'ボールペン' }),
    )) as Row;
    expect(p).toMatchObject({
      name: 'ボールペン',
      kind: 'goods',
      taxCategory: 'standard',
      isActive: true,
      isSold: true,
      isPurchased: true,
      uomId: pcsId,
      salePrice: null,
      code: null,
    });
    // an explicitly passed uomId is kept; uomId stays required: null is rejected on create and on update
    const hrId = ((await db.run({}, (ctx) => findUomByCode(ctx, 'HUR'))) as { id: string }).id;
    const s = await db.run({}, (ctx) => repo(ctx, Product).create({ name: '出張作業', kind: 'service', uomId: hrId }));
    expect(s.uomId).toBe(hrId);
    await expect(db.run({}, (ctx) => repo(ctx, Product).update(s.id, { uomId: null }))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: 'uomId' }] },
    });
    const withNull = (await db.run({}, (ctx) =>
      runAction(ctx, 'product.create', { name: 'null uom', uomId: null }),
    )) as Row;
    expect(withNull.uomId).toBe(pcsId);
    // The foundation contract freezes the base unit so historical quantities keep their meaning.
    await expect(db.run({}, (ctx) => repo(ctx, Product).update(s.id, { uomId: pcsId }))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: 'uomId' }] },
    });
    expect((await db.run({}, (ctx) => repo(ctx, Product).get(s.id))).uomId).toBe(hrId);
  });

  it('AC-2 a company without the seeded 個 gets a ValidationError with a hint instead of a DB error', async () => {
    const other = await bootstrapTenant(db.owner, {
      tenantName: 'NoSeed',
      companyCode: 'N1',
      companyName: 'No Seed Co',
      adminEmail: 'noseed@example.com',
      adminName: 'N',
      adminPassword: 'pw',
    });
    const run = <T>(fn: (ctx: Context) => Promise<T>) =>
      withContext(
        db.app,
        {
          tenantId: other.tenantId,
          companyId: other.companyId,
          actor: { type: 'user', id: other.userId },
          roles: ['admin'],
        },
        fn,
      );
    await expect(run((ctx) => runAction(ctx, 'product.create', { name: 'x' }))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: 'uomId' }] },
    });
    await expect(run((ctx) => runAction(ctx, 'product.create', { name: 'x' }))).rejects.toMatchObject({
      hint: expect.stringContaining('seed'),
    });
    // the other company must not see this company's units (seeds are per company)
    expect(await run((ctx) => repo(ctx, Uom).count())).toBe(0);
  });

  it('AC-3 code is unique per company and immutable; products without code do not collide', async () => {
    const a = await db.run({}, (ctx) => repo(ctx, Product).create({ name: 'A', code: 'P-001', uomId: pcsId }));
    await expect(
      db.run({}, (ctx) => repo(ctx, Product).create({ name: 'A2', code: 'P-001', uomId: pcsId })),
    ).rejects.toBeInstanceOf(Conflict);
    await expect(db.run({}, (ctx) => repo(ctx, Product).update(a.id, { code: 'P-002' }))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: 'code' }] },
    });
    await expect(
      db.run({}, (ctx) => repo(ctx, Product).create({ name: 'long', code: 'x'.repeat(31), uomId: pcsId })),
    ).rejects.toBeInstanceOf(ValidationError);
    await db.run({}, async (ctx) => {
      await repo(ctx, Product).create({ name: 'no code 1', uomId: pcsId });
      await repo(ctx, Product).create({ name: 'no code 2', uomId: pcsId });
    });
    const updated = await db.run({}, (ctx) =>
      repo(ctx, Product).update(a.id, { name: 'A renamed' }, { expectedVersion: 1 }),
    );
    expect(updated.code).toBe('P-001');
    expect(updated.version).toBe(2);
  });

  it('AC-4 prices are stored as Decimal (strings on the API) and negatives are rejected', async () => {
    const p = await db.run({}, (ctx) =>
      repo(ctx, Product).create({ name: '価格あり', uomId: pcsId, salePrice: '1234.50', purchasePrice: '0' }),
    );
    expect(p.salePrice).toBeInstanceOf(Decimal);
    expect(p.salePrice?.toString()).toBe('1234.5');
    expect(p.purchasePrice?.toString()).toBe('0');
    const viaApi = (await db.run({}, (ctx) => runAction(ctx, 'product.get', { id: p.id }))) as Row;
    expect(viaApi.salePrice).toBe('1234.5');
    expect(typeof viaApi.salePrice).toBe('string');
    await expect(
      db.run({}, (ctx) => repo(ctx, Product).create({ name: 'neg', uomId: pcsId, salePrice: '-1' })),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'salePrice' }] } });
    await expect(db.run({}, (ctx) => repo(ctx, Product).update(p.id, { purchasePrice: '-0.5' }))).rejects.toMatchObject(
      { code: 'VALIDATION', details: { issues: [{ path: 'purchasePrice' }] } },
    );
    await expect(
      db.run({}, (ctx) => runAction(ctx, 'product.create', { name: 'float', salePrice: 12.5 })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('AC-5 taxCategory accepts only the five categories', async () => {
    const created = await db.run({}, async (ctx) => {
      const r = repo(ctx, Product);
      const out: string[] = [];
      for (const taxCategory of ['standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'] as const)
        out.push((await r.create({ name: `tax ${taxCategory}`, uomId: pcsId, taxCategory })).taxCategory);
      return out;
    });
    expect(created).toEqual(['standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope']);
    await expect(
      db.run({}, (ctx) => runAction(ctx, 'product.create', { name: 'bad tax', taxCategory: 'taxable' })),
    ).rejects.toMatchObject({ code: 'VALIDATION', details: { issues: [{ path: 'taxCategory' }] } });
  });
});

describe('permissions (AC-6)', () => {
  it('AC-6 viewer reads only; sales and purchasing read/create/update but not delete; admin deletes', async () => {
    const viewer = asRole(['viewer']);
    const listed = await db.run(viewer, (ctx) => repo(ctx, Product).list({ limit: 1 }));
    expect(listed.total).toBeGreaterThan(0);
    expect(await db.run(viewer, (ctx) => repo(ctx, Uom).count())).toBeGreaterThan(0);
    await expect(
      db.run(viewer, (ctx) => repo(ctx, Product).create({ name: 'v', uomId: pcsId })),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(db.run(viewer, (ctx) => repo(ctx, Uom).create({ code: 'V', name: 'v' }))).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    const target = listed.items[0] as { id: string };
    await expect(
      db.run(viewer, (ctx) => repo(ctx, Product).update(target.id, { description: 'x' })),
    ).rejects.toBeInstanceOf(PermissionDenied);

    const ids: string[] = [];
    for (const role of ['sales', 'purchasing']) {
      const p = await db.run(asRole([role]), (ctx) => repo(ctx, Product).create({ name: `by ${role}`, uomId: pcsId }));
      const u = await db.run(asRole([role]), (ctx) => repo(ctx, Product).update(p.id, { description: role }));
      expect(u.description).toBe(role);
      const unit = await db.run(asRole([role]), (ctx) =>
        repo(ctx, Uom).create({ code: `U-${role.slice(0, 3)}`, name: role }),
      );
      expect(await db.run(asRole([role]), (ctx) => repo(ctx, Uom).update(unit.id, { symbol: 'u' }))).toMatchObject({
        symbol: 'u',
      });
      await expect(db.run(asRole([role]), (ctx) => repo(ctx, Product).delete(p.id))).rejects.toBeInstanceOf(
        PermissionDenied,
      );
      await expect(db.run(asRole([role]), (ctx) => repo(ctx, Uom).delete(unit.id))).rejects.toBeInstanceOf(
        PermissionDenied,
      );
      ids.push(p.id);
    }
    await expect(db.run(asRole(['nobody']), (ctx) => repo(ctx, Product).list())).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    for (const id of ids) await db.run(asRole(['admin']), (ctx) => repo(ctx, Product).delete(id));
    expect(await db.run({}, (ctx) => repo(ctx, Product).count({ id: { $in: ids } }))).toBe(0);
  });
});

describe('list / search (AC-7)', () => {
  it('AC-7 product.list with search matches name, nameKana and code', async () => {
    await db.run({}, async (ctx) => {
      const r = repo(ctx, Product);
      await r.create({ name: 'りんご', nameKana: 'リンゴ', code: 'APL-1', uomId: pcsId });
      await r.create({ name: 'バナナ', nameKana: 'バナナ', code: 'BNN-1', uomId: pcsId });
    });
    const names = async (search: string) =>
      ((await db.run({}, (ctx) => runAction(ctx, 'product.list', { search }))) as { items: Row[] }).items
        .map((i) => i.name)
        .sort();
    expect(await names('りんご')).toEqual(['りんご']);
    expect(await names('ﾊﾞﾅﾅ')).toEqual(['バナナ']); // nameKana is stored half-width
    expect(await names('bnn-')).toEqual(['バナナ']); // code, case-insensitive
    expect(await names('存在しない品目')).toEqual([]);
    const byCode = (await db.run({}, (ctx) =>
      runAction(ctx, 'product.list', {
        where: { code: { $in: ['APL-1', 'BNN-1'] } },
        orderBy: [{ field: 'code', dir: 'asc' }],
      }),
    )) as { items: Row[]; total: number };
    expect(byCode.items.map((i) => i.code)).toEqual(['APL-1', 'BNN-1']);
    expect(byCode.total).toBe(2);
  });
});

describe('product.resolve_price (AC-8)', () => {
  it('AC-8 returns { price, taxCategory, uomId } for sale and purchase; price null when unset', async () => {
    const kgId = ((await db.run({}, (ctx) => findUomByCode(ctx, 'KGM'))) as { id: string }).id;
    const p = await db.run({}, (ctx) =>
      repo(ctx, Product).create({ name: '米', uomId: kgId, taxCategory: 'reduced', salePrice: '480.5' }),
    );
    const sale = await db.run(asRole(['viewer']), (ctx) =>
      runAction(ctx, 'product.resolve_price', { productId: p.id, side: 'sale' }),
    );
    expect(sale).toEqual({ price: '480.5', taxCategory: 'reduced', uomId: kgId });
    const purchase = await db.run(asRole(['purchasing']), (ctx) =>
      runAction(ctx, 'product.resolve_price', { productId: p.id, side: 'purchase' }),
    );
    expect(purchase).toEqual({ price: null, taxCategory: 'reduced', uomId: kgId });
    await expect(
      db.run({}, (ctx) =>
        runAction(ctx, 'product.resolve_price', { productId: '0192a8b0-0000-7000-8000-000000000001', side: 'sale' }),
      ),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      db.run({}, (ctx) => runAction(ctx, 'product.resolve_price', { productId: p.id, side: 'rent' })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      db.run(asRole(['nobody']), (ctx) => runAction(ctx, 'product.resolve_price', { productId: p.id, side: 'sale' })),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});

describe('seed (AC-9)', () => {
  it('AC-9 seeds a goods item, a service item and a reduced-rate food item idempotently', async () => {
    await db.run(systemCtx, seedProducts);
    await db.run(systemCtx, seedProducts);
    const codes = SAMPLE_PRODUCTS.map((p) => p.code);
    const rows = await db.run({}, (ctx) =>
      repo(ctx, Product).list({ where: { code: { $in: codes } }, orderBy: [{ field: 'code', dir: 'asc' }] }),
    );
    expect(rows.total).toBe(3);
    expect(rows.items.map((p) => [p.kind, p.taxCategory]).sort()).toEqual([
      ['goods', 'reduced'],
      ['goods', 'standard'],
      ['service', 'standard'],
    ]);
    for (const p of rows.items) expect(p.salePrice).toBeInstanceOf(Decimal);
    const uomIds = new Set(
      (
        await db.run({}, (ctx) => repo(ctx, Uom).list({ where: { code: { $in: STANDARD_UOMS.map((u) => u.code) } } }))
      ).items.map((u) => u.id),
    );
    for (const p of rows.items) expect(p.uomId !== null && uomIds.has(p.uomId)).toBe(true);
    expect(await db.run({}, (ctx) => repo(ctx, Uom).count({ code: { $in: STANDARD_UOMS.map((u) => u.code) } }))).toBe(
      5,
    );
  });
});
