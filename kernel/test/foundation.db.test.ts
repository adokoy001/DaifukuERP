// ADR-0016: adversarial checks at the shared repository, lifecycle and event boundaries.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerCrudActions } from '../src/actions/crud.ts';
import { runAction } from '../src/actions/run.ts';
import { auditTrail } from '../src/audit.ts';
import { authenticate, bootstrapTenant } from '../src/auth.ts';
import { companies } from '../src/db/system-tables.ts';
import { defineEntity } from '../src/dsl/entity.ts';
import { f } from '../src/dsl/fields.ts';
import { cancelDocument, submitDocument } from '../src/document.ts';
import { deliverPending } from '../src/events.ts';
import { label } from '../src/i18n.ts';
import { newId } from '../src/ids.ts';
import { getLines, saveLines } from '../src/lines.ts';
import { registry } from '../src/registry.ts';
import { repo } from '../src/repository/repository.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
import { defineWriteCapability, withWriteCapability } from '../src/write-capability.ts';
import { TMemo, TMemoLine, TPartner } from './fixtures/entities.ts';

const Owned = defineEntity({
  name: 'test_owned',
  label: label('所有権', 'Ownership'),
  fields: {
    name: f.text({ required: true }),
    result: f.int({ default: 0, serverOwned: true }),
  },
  permissions: { roles: { editor: ['read', 'create', 'update'], viewer: ['read'] } },
});
const TenantItem = defineEntity({
  name: 'test_tenant_item',
  scope: 'tenant',
  label: label('共通', 'Tenant item'),
  fields: { name: f.text({ required: true }) },
  permissions: { roles: { viewer: ['read'] } },
});
const ownedWrite = defineWriteCapability({
  name: 'test-owned-compute',
  entity: Owned.name,
  fields: ['result'],
  operations: ['update'],
});
registry.registerHook(Owned.name, 'before_validate', (_ctx, { row }) => {
  if (row.name === 'computed') row.result = 7;
});
let db: TestDb;
let partnerId: string;
let companyB: string;
beforeAll(async () => {
  db = await freshDb();
  registerCrudActions();
  registry.registerExt(TPartner.name, {
    foundationTag: f.text(),
    relatedPartner: f.ref(TPartner.name),
    controlled: f.text({ serverOwned: true }),
  });
  companyB = newId();
  await db.owner.drizzle
    .insert(companies)
    .values({ id: companyB, tenantId: db.tenantId, code: 'B', name: 'Company B' });
  partnerId = (await db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'Foundation partner' }))).id;
});
afterAll(async () => {
  await db.close();
});
const draft = (extra = {}) =>
  db.run({}, (ctx) => repo(ctx, TMemo).create({ partnerId, date: '2026-09-12', amount: '1', ...extra }));

describe('Scoped identity and ownership', () => {
  it('rejects another company reference in repository and direct SQL; rejects a foreign company context', async () => {
    const p = await db.run({ companyId: companyB }, (ctx) => repo(ctx, TPartner).create({ name: 'Other company' }));
    await expect(draft({ partnerId: p.id })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'Ext cross-company', ext: { relatedPartner: p.id } })),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const m = await draft();
    await expect(db.run({}, (ctx) => repo(ctx, TMemo).update(m.id, { partnerId: p.id }))).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(db.owner.sql`update test_memo set partner_id = ${p.id} where id = ${m.id}`).rejects.toMatchObject({
      code: '23503',
    });
    const other = await bootstrapTenant(db.owner, {
      tenantName: 'Other',
      companyCode: 'O',
      companyName: 'Other',
      adminEmail: 'other@foundation.test',
      adminName: 'Other',
      adminPassword: 'pw',
    });
    await expect(db.run({ companyId: other.companyId }, (ctx) => repo(ctx, TPartner).count())).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('server-owned caller input is denied even to admin; hooks and private grants preserve op checks', async () => {
    await expect(db.run({}, (ctx) => repo(ctx, Owned).create({ name: 'forged', result: 99 }))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(
      db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'Ext owned', ext: { controlled: 'forged' } })),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const row = await db.run({}, (ctx) => repo(ctx, Owned).create({ name: 'computed' }));
    expect(row.result).toBe(7);
    await expect(db.run({}, (ctx) => repo(ctx, Owned).update(row.id, { result: 99 }))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    const updated = await db.run({ roles: ['editor'] }, (ctx) =>
      withWriteCapability(ctx, ownedWrite, (inner) => repo(inner, Owned).update(row.id, { result: 8 })),
    );
    expect(updated.result).toBe(8);
    await expect(
      db.run({}, (ctx) =>
        withWriteCapability(ctx, ownedWrite, (inner) =>
          repo(inner, Owned).create({ name: 'wrong operation', result: 9 }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      db.run({ roles: ['viewer'] }, (ctx) =>
        withWriteCapability(ctx, ownedWrite, (inner) => repo(inner, Owned).update(row.id, { result: 9 })),
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(db.run({}, (ctx) => withWriteCapability(ctx, { ...ownedWrite }, async () => 1))).rejects.toMatchObject(
      { code: 'PERMISSION_DENIED' },
    );
    await expect(
      db.run({}, (ctx) => repo(ctx, Owned).rawUpdate(row.id, { result: 99 }, 'update', { ...row })),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('tenant entities satisfy generic action output; ambiguous email needs tenant identity; bootstrap replay is tenant-scoped', async () => {
    const item = await db.run({}, (ctx) => runAction(ctx, `${TenantItem.name}.create`, { name: 'shared' }));
    expect(item).toMatchObject({ companyId: null, name: 'shared' });
    const input = {
      tenantName: 'Same mail',
      companyCode: 'S',
      companyName: 'Same mail',
      adminEmail: 'same@foundation.test',
      adminName: 'Same',
      adminPassword: 'pw',
    };
    const a = await bootstrapTenant(db.owner, input);
    const b = await bootstrapTenant(db.owner, input);
    expect(a.tenantId).not.toBe(b.tenantId);
    expect(await authenticate(db.owner, input.adminEmail, 'pw')).toBeNull();
    expect(await authenticate(db.owner, input.adminEmail, 'pw', a.tenantId)).toMatchObject({ tenantId: a.tenantId });
    expect(await bootstrapTenant(db.owner, { ...input, tenantId: a.tenantId })).toEqual(a);
  });
});

describe('Aggregate serialization and lifecycle', () => {
  it('direct lines bump the parent version and every public mutation freezes after submit', async () => {
    const m = await draft();
    const line = await db.run({}, (ctx) => repo(ctx, TMemoLine).create({ memoId: m.id, description: 'line' }));
    expect((await db.run({}, (ctx) => repo(ctx, TMemo).get(m.id))).version).toBe(m.version + 1);
    await expect(
      db.run({}, (ctx) =>
        runAction(ctx, 'test_memo.update', {
          id: m.id,
          expectedVersion: m.version,
          patch: { lines: { test_memo_line: [] } },
        }),
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await db.run({}, (ctx) => submitDocument(ctx, TMemo, m.id));
    await expect(db.run({}, (ctx) => repo(ctx, TMemoLine).update(line.id, { amount: '10' }))).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    await expect(db.run({}, (ctx) => repo(ctx, TMemoLine).delete(line.id))).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    await expect(
      db.run({}, (ctx) => repo(ctx, TMemoLine).create({ memoId: m.id, description: 'extra' })),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(db.run({}, (ctx) => repo(ctx, TMemo).update(m.id, { ext: { injected: true } }))).rejects.toMatchObject(
      { code: 'INVALID_STATE' },
    );
  });

  it('generic submit honors declared role and guard; lifecycle stale versions fail under lock', async () => {
    const zero = await draft({ amount: '0', ext: { immutableValue: 1 } });
    await expect(
      db.run({ roles: ['sales'] }, (ctx) => runAction(ctx, 'test_memo.submit', { id: zero.id })),
    ).rejects.toThrow(/requires roles/);
    await expect(db.run({ roles: ['manager'] }, (ctx) => submitDocument(ctx, TMemo, zero.id))).rejects.toThrow(/guard/);
    const updated = await db.run({}, (ctx) => repo(ctx, TMemo).update(zero.id, { amount: '1' }));
    await expect(
      db.run({}, (ctx) => submitDocument(ctx, TMemo, zero.id, { expectedVersion: zero.version })),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const submitted = await db.run({}, (ctx) =>
      submitDocument(ctx, TMemo, zero.id, { expectedVersion: updated.version }),
    );
    await expect(db.run({}, (ctx) => repo(ctx, TMemo).update(zero.id, { ext: {} }))).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
    await expect(
      db.run({}, (ctx) => cancelDocument(ctx, TMemo, zero.id, { expectedVersion: updated.version })),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(submitted.version).toBe(updated.version + 1);
  });

  it('a before_submit hook can update its lines without conflicting with its own parent version', async () => {
    const m = await draft();
    const line = await db.run({}, (ctx) => repo(ctx, TMemoLine).create({ memoId: m.id, description: 'computed line' }));
    registry.registerHook(TMemo.name, 'before_submit', async (ctx, { row }) => {
      if (row.id === m.id) await repo(ctx, TMemoLine).update(line.id, { amount: '5' });
    });
    const latest = await db.run({}, (ctx) => repo(ctx, TMemo).get(m.id));
    const submitted = await db.run({}, (ctx) => submitDocument(ctx, TMemo, m.id));
    expect(submitted.version).toBe(latest.version + 1);
    expect((await db.run({}, (ctx) => repo(ctx, TMemoLine).get(line.id))).amount.toString()).toBe('5');
  });

  it('saveLines rejects duplicate/foreign ids and 501; direct row 501 and oversized legacy reads fail', async () => {
    const a = await draft();
    const b = await draft();
    const line = await db.run({}, (ctx) => repo(ctx, TMemoLine).create({ memoId: a.id, description: 'original' }));
    await expect(
      db.run({}, (ctx) => saveLines(ctx, TMemo, b.id, { test_memo_line: [{ id: line.id, description: 'stolen' }] })),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      db.run({}, (ctx) => saveLines(ctx, TMemo, a.id, { test_memo_line: [{ id: line.id }, { id: line.id }] })),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      db.run({}, (ctx) =>
        saveLines(ctx, TMemo, b.id, {
          test_memo_line: Array.from({ length: 501 }, () => ({ description: 'too many' })),
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    // Simulate an imported legacy record at the exact boundary without 500 unrelated transactions.
    await db.owner
      .sql`insert into test_memo_line (id, tenant_id, company_id, memo_id, seq, description, qty, amount) select gen_random_uuid(), ${db.tenantId}::uuid, ${db.companyId}::uuid, ${b.id}::uuid, n, 'boundary', 1, 0 from generate_series(1,500) n`;
    expect((await db.run({}, (ctx) => getLines(ctx, TMemo, b.id))).test_memo_line).toHaveLength(500);
    await expect(
      db.run({}, (ctx) => repo(ctx, TMemoLine).create({ memoId: b.id, description: '501' })),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await db.owner
      .sql`insert into test_memo_line (id, tenant_id, company_id, memo_id, seq, description, qty, amount) values (${newId()}, ${db.tenantId}, ${db.companyId}, ${b.id}, 501, 'legacy', 1, 0)`;
    await expect(db.run({}, (ctx) => getLines(ctx, TMemo, b.id))).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(db.run({}, (ctx) => saveLines(ctx, TMemo, b.id, { test_memo_line: [] }))).rejects.toMatchObject({
      code: 'INVALID_STATE',
    });
  });

  it('delete holds the parent lock through hooks, so a simultaneous submit cannot leave a submitted deletion', async () => {
    const m = await draft();
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    registry.registerHook(TMemo.name, 'before_delete', async (_ctx, { row }) => {
      if (row.id === m.id) {
        entered();
        await blocked;
      }
    });
    const deleting = db.run({}, (ctx) => repo(ctx, TMemo).delete(m.id));
    await started;
    const submitting = db.run({}, (ctx) => submitDocument(ctx, TMemo, m.id));
    release();
    const result = await Promise.allSettled([deleting, submitting]);
    expect(result[0].status).toBe('fulfilled');
    expect(result[1]).toMatchObject({ status: 'rejected', reason: { code: 'NOT_FOUND' } });
    const trail = await db.run({}, (ctx) => auditTrail(ctx, TMemo.name, m.id));
    expect(trail.some((event) => event.op === 'submit')).toBe(false);
  });
});

describe('Read authority, precision and outbox atomicity', () => {
  it('masked fields cannot be filtered, sorted, grouped, aggregated or recovered from audit; empty OR matches none', async () => {
    const p = await db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'Masked', secretNote: 'classified' }));
    const asSales = { roles: ['sales'] };
    await expect(
      db.run(asSales, (ctx) => repo(ctx, TPartner).list({ where: { $or: [{ secretNote: 'classified' }] } })),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      db.run(asSales, (ctx) => repo(ctx, TPartner).list({ orderBy: [{ field: 'secretNote' }] })),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      db.run(asSales, (ctx) => repo(ctx, TPartner).aggregate({ metrics: { leak: { max: 'secretNote' } } })),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      db.run(asSales, (ctx) =>
        repo(ctx, TPartner).aggregate({ groupBy: ['secretNote'], metrics: { n: { count: true } } }),
      ),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    const audit = await db.run(asSales, (ctx) => auditTrail(ctx, TPartner.name, p.id));
    expect(audit[0]?.after).not.toHaveProperty('secretNote');
    expect(await db.run({}, (ctx) => repo(ctx, TPartner).count({ $or: [] }))).toBe(0);
    const withNull = await db.run({}, (ctx) =>
      repo(ctx, TPartner).list({ where: { id: p.id, 'ext.foundationTag': { $in: [null, 'present'] } } }),
    );
    expect(withNull.total).toBe(1);
  });

  it('rejects decimals that numeric(20,6) would round or overflow', async () => {
    for (const creditLimit of ['0.0000001', '100000000000000']) {
      await expect(
        db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'precision', creditLimit })),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    }
    expect(
      (
        await db.run({}, (ctx) =>
          repo(ctx, TPartner).create({ name: 'precision valid', creditLimit: '99999999999999.999999' }),
        )
      ).creditLimit?.toString(),
    ).toBe('99999999999999.999999');
  });

  it('outbox restores event company, rolls back failed subscribers, and concurrent claims run each event once', async () => {
    let fail = true;
    let first = true;
    registry.subscribe('foundation.atomic', async (ctx) => {
      expect(ctx.companyId).toBe(companyB);
      await repo(ctx, Owned).create({ name: 'event side effect' });
      if (fail) {
        fail = false;
        throw new Error('injected subscriber failure');
      }
    });
    await db.run({ companyId: companyB }, (ctx) => ctx.emit('foundation.atomic', {}));
    const result = await db.run({ companyId: null }, (ctx) => deliverPending(ctx));
    expect(result.failed).toBe(1);
    expect(await db.run({ companyId: companyB }, (ctx) => repo(ctx, Owned).count())).toBe(0);
    await db.run({ companyId: null }, (ctx) => deliverPending(ctx));
    expect(await db.run({ companyId: companyB }, (ctx) => repo(ctx, Owned).count())).toBe(1);
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    registry.subscribe('foundation.claim', async (ctx) => {
      await repo(ctx, Owned).create({ name: 'claimed' });
      if (first) {
        first = false;
        entered();
        await blocked;
      }
    });
    await db.run({}, (ctx) => ctx.emit('foundation.claim', {}));
    const one = db.run({}, (ctx) => deliverPending(ctx));
    await started;
    const two = await db.run({}, (ctx) => deliverPending(ctx));
    release();
    await one;
    expect(two.delivered).toBe(0);
    expect(await db.run({}, (ctx) => repo(ctx, Owned).count({ name: 'claimed' }))).toBe(1);
    const rows = await db.owner.drizzle.execute(sql`select attempts from outbox where topic = 'foundation.atomic'`);
    expect(rows[0]).toMatchObject({ attempts: 2 });
  });
});
