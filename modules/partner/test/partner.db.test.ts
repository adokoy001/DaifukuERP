import {
  Conflict,
  NotFound,
  PermissionDenied,
  ValidationError,
  appMeta,
  newId,
  registerCrudActions,
  repo,
  runAction,
  systemParams,
  withContext,
} from '@daifuku/kernel';
import { freshDb, type TestDb } from '@daifuku/kernel/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Partner, PartnerModule, SEED_PARTNERS } from '../src/index.ts';

let db: TestDb;

beforeAll(async () => {
  registerCrudActions();
  db = await freshDb();
});
afterAll(async () => {
  await db.close();
});

const asRole = (roles: string[]) => ({ roles, actor: { type: 'user' as const, id: newId() } });

describe('partner entity (docs/specs/partner.md)', () => {
  it('AC-1 create with only name applies the Japanese defaults', async () => {
    const p = await db.run({}, (ctx) => repo(ctx, Partner).create({ name: '株式会社テスト' }));
    expect(p).toMatchObject({
      name: '株式会社テスト',
      isCustomer: false,
      isSupplier: false,
      taxStatus: 'registered',
      isActive: true,
      closingDay: 31,
      paymentMonthOffset: 1,
      paymentDay: 31,
      code: null,
      invoiceRegistrationNo: null,
    });
    expect(p.companyId).toBe(db.companyId);
    expect(p.version).toBe(1);
  });

  it('AC-2 invoiceRegistrationNo accepts T+13 digits only; the error names the field', async () => {
    const ok = await db.run({}, (ctx) =>
      repo(ctx, Partner).create({ name: 'OK', invoiceRegistrationNo: 'T1234567890123' }),
    );
    expect(ok.invoiceRegistrationNo).toBe('T1234567890123');
    for (const bad of ['1234567890123', 'T123456789012', 'T12345678901234', 't1234567890123', 'T-1234567890123']) {
      const err = await db
        .run({}, (ctx) => repo(ctx, Partner).create({ name: 'NG', invoiceRegistrationNo: bad }))
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).details).toMatchObject({ issues: [{ path: 'invoiceRegistrationNo' }] });
    }
  });

  it('AC-3 nameKana / bankAccountHolderKana are stored as upper-cased half-width katakana', async () => {
    const p = await db.run({}, (ctx) =>
      repo(ctx, Partner).create({
        name: 'カナ',
        nameKana: 'かぶしきがいしゃ　だいふく',
        bankAccountHolderKana: 'ｶ)ﾀﾞｲﾌｸ ｱｲｳ abc',
      }),
    );
    expect(p.nameKana).toBe('ｶﾌﾞｼｷｶﾞｲｼｬ ﾀﾞｲﾌｸ');
    expect(p.bankAccountHolderKana).toBe('ｶ)ﾀﾞｲﾌｸ ｱｲｳ ABC');
    const u = await db.run({}, (ctx) => repo(ctx, Partner).update(p.id, { nameKana: 'ヤマダ　タロウ' }));
    expect(u.nameKana).toBe('ﾔﾏﾀﾞ ﾀﾛｳ');
  });

  it('AC-4 code is unique per company (Conflict) and immutable after create', async () => {
    const a = await db.run({}, (ctx) => repo(ctx, Partner).create({ name: 'A', code: 'DUP-1' }));
    await expect(db.run({}, (ctx) => repo(ctx, Partner).create({ name: 'B', code: 'DUP-1' }))).rejects.toBeInstanceOf(
      Conflict,
    );
    await expect(db.run({}, (ctx) => repo(ctx, Partner).update(a.id, { code: 'DUP-2' }))).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: 'code' }] },
    });
    // a second company in the same tenant may reuse the code
    const otherCompany = newId();
    await db.owner
      .sql`insert into companies (id, tenant_id, code, name) values (${otherCompany}, ${db.tenantId}, 'T2', 'Second Co')`;
    const b = await withContext(db.app, systemParams(db.tenantId, otherCompany), (ctx) =>
      repo(ctx, Partner).create({ name: 'B', code: 'DUP-1' }),
    );
    expect(b.companyId).toBe(otherCompany);
  });

  it('AC-5 closingDay/paymentDay accept 1..31, paymentMonthOffset 0..3; everything else is rejected', async () => {
    const ok = await db.run({}, (ctx) =>
      repo(ctx, Partner).create({ name: 'Terms', closingDay: 1, paymentMonthOffset: 0, paymentDay: 31 }),
    );
    expect(ok).toMatchObject({ closingDay: 1, paymentMonthOffset: 0, paymentDay: 31 });
    const ok3 = await db.run({}, (ctx) =>
      repo(ctx, Partner).create({ name: 'Terms3', closingDay: 31, paymentMonthOffset: 3, paymentDay: 1 }),
    );
    expect(ok3.paymentMonthOffset).toBe(3);
    for (const bad of [
      { closingDay: 0 },
      { closingDay: 32 },
      { paymentDay: 0 },
      { paymentDay: 32 },
      { paymentMonthOffset: -1 },
      { paymentMonthOffset: 4 },
      { closingDay: 15.5 },
    ]) {
      const err = await db.run({}, (ctx) => repo(ctx, Partner).create({ name: 'NG', ...bad })).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).details).toMatchObject({ issues: [{ path: Object.keys(bad)[0] }] });
    }
  });

  it('AC-6 viewer may read but not create/update/delete', async () => {
    const target = await db.run({}, (ctx) => repo(ctx, Partner).create({ name: 'ViewerTarget' }));
    const viewer = asRole(['viewer']);
    const got = await db.run(viewer, (ctx) => repo(ctx, Partner).get(target.id));
    expect(got.name).toBe('ViewerTarget');
    await expect(db.run(viewer, (ctx) => repo(ctx, Partner).create({ name: 'x' }))).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(db.run(viewer, (ctx) => repo(ctx, Partner).update(target.id, { name: 'y' }))).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    await expect(db.run(viewer, (ctx) => repo(ctx, Partner).delete(target.id))).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it('AC-7 sales/purchasing: read+create+update; accounting: read+update+export; admin: everything', async () => {
    for (const role of ['sales', 'purchasing']) {
      const created = await db.run(asRole([role]), (ctx) => repo(ctx, Partner).create({ name: `by ${role}` }));
      const updated = await db.run(asRole([role]), (ctx) =>
        repo(ctx, Partner).update(created.id, { name: `by ${role} 2` }),
      );
      expect(updated.version).toBe(2);
      await expect(db.run(asRole([role]), (ctx) => repo(ctx, Partner).delete(created.id))).rejects.toBeInstanceOf(
        PermissionDenied,
      );
      const ops = await db.run(
        asRole([role]),
        async (ctx) => appMeta(ctx).entities.find((e) => e.name === 'partner')?.ops,
      );
      expect(ops).toEqual(['read', 'create', 'update']);
    }
    const acc = asRole(['accounting']);
    await expect(db.run(acc, (ctx) => repo(ctx, Partner).create({ name: 'x' }))).rejects.toBeInstanceOf(
      PermissionDenied,
    );
    const someone = await db.run({}, (ctx) => repo(ctx, Partner).create({ name: 'AccTarget' }));
    const u = await db.run(acc, (ctx) => repo(ctx, Partner).update(someone.id, { taxStatus: 'exempt' }));
    expect(u.taxStatus).toBe('exempt');
    const accOps = await db.run(acc, async (ctx) => appMeta(ctx).entities.find((e) => e.name === 'partner')?.ops);
    expect(accOps).toEqual(['read', 'update', 'export']);
    await db.run({}, (ctx) => repo(ctx, Partner).delete(someone.id));
    await expect(db.run({}, (ctx) => repo(ctx, Partner).get(someone.id))).rejects.toBeInstanceOf(NotFound);
    await expect(db.run(asRole(['nobody']), (ctx) => repo(ctx, Partner).list())).rejects.toBeInstanceOf(
      PermissionDenied,
    );
  });

  it('AC-8 partner.list search matches name, nameKana and code', async () => {
    await db.run({}, async (ctx) => {
      const r = repo(ctx, Partner);
      await r.create({ name: '検索テスト商会', nameKana: 'ケンサクテストショウカイ', code: 'SRCH-01' });
      await r.create({ name: 'Unrelated', nameKana: 'ムカンケイ', code: 'ZZZ-99' });
    });
    const byName = await db.run({}, (ctx) => runAction(ctx, 'partner.list', { search: '検索テスト' }));
    expect((byName as { items: { code: string }[] }).items.map((i) => i.code)).toEqual(['SRCH-01']);
    const byKana = await db.run({}, (ctx) => runAction(ctx, 'partner.list', { search: 'ｹﾝｻｸ' }));
    expect((byKana as { total: number }).total).toBe(1);
    const byCode = await db.run({}, (ctx) => runAction(ctx, 'partner.list', { search: 'srch-0' }));
    expect((byCode as { total: number }).total).toBe(1);
    const fullWidth = await db.run({}, (ctx) => runAction(ctx, 'partner.list', { search: 'ケンサク' }));
    expect((fullWidth as { total: number }).total).toBe(1); // kernel normalises the search term like the field (halfwidth-kana) since Phase 1
  });

  it('AC-9 seed creates 3 partners and is idempotent', async () => {
    const seed = () =>
      withContext(db.app, systemParams(db.tenantId, db.companyId), async (ctx) => PartnerModule.seed?.(ctx));
    const codes = SEED_PARTNERS.map((p) => p.code);
    const countSeeded = () => db.run({}, (ctx) => repo(ctx, Partner).count({ code: { $in: codes } }));
    expect(await countSeeded()).toBe(0);
    await seed();
    expect(await countSeeded()).toBe(3);
    await seed();
    await seed();
    expect(await countSeeded()).toBe(3);
    const s1 = await db.run({}, async (ctx) => (await repo(ctx, Partner).list({ where: { code: 'S-0001' } })).items[0]);
    expect(s1).toMatchObject({ isSupplier: true, closingDay: 20, paymentDay: 10, nameKana: 'ﾀﾞｲﾌｸﾌﾞｯｻﾝｶﾌﾞｼｷｶﾞｲｼｬ' });
    expect(s1?.version).toBe(1); // re-running the seed did not touch existing rows
  });

  it('AC-10 partner.compute_due_date uses the partner terms; 月末 clamps; after closing day -> next period', async () => {
    const p = await db.run({}, (ctx) =>
      repo(ctx, Partner).create({ name: 'Terms', closingDay: 20, paymentMonthOffset: 1, paymentDay: 31 }),
    );
    const inPeriod = await db.run({}, (ctx) =>
      runAction(ctx, 'partner.compute_due_date', { partnerId: p.id, invoiceDate: '2026-01-20' }),
    );
    expect(inPeriod).toEqual({
      partnerId: p.id,
      invoiceDate: '2026-01-20',
      closingDate: '2026-01-20',
      dueDate: '2026-02-28',
    });
    const nextPeriod = await db.run({}, (ctx) =>
      runAction(ctx, 'partner.compute_due_date', { partnerId: p.id, invoiceDate: '2026-01-21' }),
    );
    expect(nextPeriod).toMatchObject({ closingDate: '2026-02-20', dueDate: '2026-03-31' });
    await expect(
      db.run({}, (ctx) => runAction(ctx, 'partner.compute_due_date', { partnerId: p.id, invoiceDate: '2026-13-01' })),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [{ path: 'invoiceDate' }] },
    });
    await expect(
      db.run({}, (ctx) =>
        runAction(ctx, 'partner.compute_due_date', { partnerId: newId(), invoiceDate: '2026-01-01' }),
      ),
    ).rejects.toBeInstanceOf(NotFound);
    // permission: read on partner is enough; a role without read is denied
    const viewerResult = await db.run(asRole(['viewer']), (ctx) =>
      runAction(ctx, 'partner.compute_due_date', { partnerId: p.id, invoiceDate: '2026-01-01' }),
    );
    expect(viewerResult).toMatchObject({ dueDate: '2026-02-28' });
    await expect(
      db.run(asRole(['nobody']), (ctx) =>
        runAction(ctx, 'partner.compute_due_date', { partnerId: p.id, invoiceDate: '2026-01-01' }),
      ),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});
