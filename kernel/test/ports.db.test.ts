// Kernel ports added for Phase 1: document lines, aggregate, company settings, storage (ADR-0013).
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { registerCrudActions } from '../src/actions/crud.ts';
import { runAction } from '../src/actions/run.ts';
import { auditTrail } from '../src/audit.ts';
import { Decimal } from '../src/decimal.ts';
import { submitDocument } from '../src/document.ts';
import { PermissionDenied, StateError, ValidationError } from '../src/errors.ts';
import { getLines, saveLines } from '../src/lines.ts';
import { entityMeta } from '../src/meta.ts';
import { repo } from '../src/repository/repository.ts';
import { getSetting, setSetting } from '../src/settings.ts';
import { configureStorage, LocalStorage } from '../src/storage.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
import { TMemo, TMemoLine, TPartner } from './fixtures/entities.ts';

let db: TestDb;
let partnerId: string;
type Row = Record<string, unknown>;

beforeAll(async () => {
  db = await freshDb();
  registerCrudActions();
  configureStorage(new LocalStorage(await mkdtemp(join(tmpdir(), 'daifuku-storage-'))));
  partnerId = (await db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'Lines Partner' }))).id;
});
afterAll(async () => {
  await db.close();
});

describe('document lines', () => {
  it('AC-1 create with lines via the generic action assigns seq and parent; get returns lines in order', async () => {
    const created = (await db.run({}, (ctx) =>
      runAction(ctx, 'test_memo.create', {
        partnerId,
        date: '2026-09-10',
        amount: '30',
        lines: {
          test_memo_line: [
            { description: 'B', amount: '20' },
            { description: 'A', amount: '10', qty: '2' },
          ],
        },
      }),
    )) as Row & { lines: { test_memo_line: Row[] } };
    expect(created.lines.test_memo_line.map((l) => l.description)).toEqual(['B', 'A']);
    expect(created.lines.test_memo_line.map((l) => l.seq)).toEqual([1, 2]);
    expect(created.lines.test_memo_line[0]?.memoId).toBe(created.id);
    const fetched = (await db.run({}, (ctx) => runAction(ctx, 'test_memo.get', { id: created.id }))) as Row & {
      lines: { test_memo_line: Row[] };
    };
    expect(fetched.lines.test_memo_line).toHaveLength(2);
    expect(entityMeta(await db.run({}, async (ctx) => ctx), TMemo).lines).toEqual([
      { entity: 'test_memo_line', parentField: 'memoId' },
    ]);
  });

  it('AC-2 update with lines replaces: keeps rows by id, deletes missing, inserts new', async () => {
    const created = (await db.run({}, (ctx) =>
      runAction(ctx, 'test_memo.create', {
        partnerId,
        date: '2026-09-10',
        amount: '1',
        lines: {
          test_memo_line: [
            { description: 'keep', amount: '1' },
            { description: 'drop', amount: '2' },
          ],
        },
      }),
    )) as Row & { lines: { test_memo_line: Row[] } };
    const keepId = created.lines.test_memo_line[0]?.id as string;
    const updated = (await db.run({}, (ctx) =>
      runAction(ctx, 'test_memo.update', {
        id: created.id,
        patch: {
          note: 'n',
          lines: {
            test_memo_line: [
              { id: keepId, description: 'kept', amount: '5' },
              { description: 'new', amount: '3' },
            ],
          },
        },
      }),
    )) as Row & { lines: { test_memo_line: Row[] } };
    expect(updated.note).toBe('n');
    expect(updated.lines.test_memo_line.map((l) => [l.id === keepId, l.description, l.seq])).toEqual([
      [true, 'kept', 1],
      [false, 'new', 2],
    ]);
    const all = await db.run({}, (ctx) => repo(ctx, TMemoLine).count({ memoId: created.id as string }));
    expect(all).toBe(2);
  });

  it('AC-3 lines are frozen after submit; unknown line entity is rejected with a hint', async () => {
    const m = await db.run({}, (ctx) => repo(ctx, TMemo).create({ partnerId, date: '2026-09-11', amount: '1' }));
    await db.run({}, (ctx) => saveLines(ctx, TMemo, m.id, { test_memo_line: [{ description: 'x', amount: '1' }] }));
    await db.run({}, (ctx) => submitDocument(ctx, TMemo, m.id));
    await expect(db.run({}, (ctx) => saveLines(ctx, TMemo, m.id, { test_memo_line: [] }))).rejects.toBeInstanceOf(
      StateError,
    );
    await expect(db.run({}, (ctx) => saveLines(ctx, TMemo, m.id, { nope: [] }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    const lines = await db.run({}, (ctx) => getLines(ctx, TMemo, m.id));
    expect(lines.test_memo_line).toHaveLength(1);
  });
});

describe('aggregate (report port)', () => {
  it('AC-4 groups and sums decimals as Decimal, counts as number, honours where/orderBy', async () => {
    const rows = await db.run({}, (ctx) =>
      repo(ctx, TMemoLine).aggregate({
        groupBy: ['memoId'],
        metrics: { total: { sum: 'amount' }, n: { count: true }, maxQty: { max: 'qty' } },
        orderBy: [{ field: 'total', dir: 'desc' }],
      }),
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const top = rows[0] as { total: Decimal; n: number };
    expect(top.total).toBeInstanceOf(Decimal);
    expect(top.total.toString()).toBe('30');
    expect(top.n).toBe(2);
    const filtered = await db.run({}, (ctx) =>
      repo(ctx, TMemoLine).aggregate({ where: { description: 'kept' }, metrics: { total: { sum: 'amount' } } }),
    );
    expect((filtered[0] as { total: Decimal }).total.toString()).toBe('5');
    await expect(
      db.run({}, (ctx) => repo(ctx, TMemoLine).aggregate({ groupBy: ['nope'], metrics: { n: { count: true } } })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      db.run({ roles: ['viewer'] }, (ctx) => repo(ctx, TMemoLine).aggregate({ metrics: { n: { count: true } } })),
    ).rejects.toBeInstanceOf(PermissionDenied);
  });
});

describe('company settings', () => {
  const schema = z.object({ unit: z.enum(['invoice', 'delivery_note']), mode: z.enum(['half_up', 'down', 'up']) });
  it('AC-5 falls back when unset, validates on set, audits, and requires admin/settings role', async () => {
    const fb = { unit: 'invoice', mode: 'down' } as const;
    expect(await db.run({}, (ctx) => getSetting(ctx, 'tax.rounding', schema, fb))).toEqual(fb);
    await expect(
      db.run({ roles: ['sales'] }, (ctx) => setSetting(ctx, 'tax.rounding', schema, { unit: 'invoice', mode: 'up' })),
    ).rejects.toBeInstanceOf(PermissionDenied);
    await expect(db.run({}, (ctx) => setSetting(ctx, 'tax.rounding', schema, { unit: 'bad' }))).rejects.toBeInstanceOf(
      ValidationError,
    );
    await db.run({}, (ctx) => setSetting(ctx, 'tax.rounding', schema, { unit: 'delivery_note', mode: 'up' }));
    expect(await db.run({ roles: ['sales'] }, (ctx) => getSetting(ctx, 'tax.rounding', schema, fb))).toEqual({
      unit: 'delivery_note',
      mode: 'up',
    });
    const trail = await db.run({}, (ctx) => auditTrail(ctx, 'company_settings', db.companyId));
    expect(trail[0]?.after).toEqual({ 'tax.rounding': { unit: 'delivery_note', mode: 'up' } });
  });
});

describe('storage port', () => {
  it('AC-6 put/get round-trips bytes with sha256 and refuses unsafe keys', async () => {
    const data = new TextEncoder().encode('領収書 PDF のつもり');
    const stored = await db.run({}, (ctx) =>
      ctx.storage.put(ctx.tenantId, data, { filename: 'receipt.pdf', contentType: 'application/pdf' }),
    );
    expect(stored.size).toBe(data.byteLength);
    expect(stored.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.key.startsWith(`${db.tenantId}/`)).toBe(true);
    const back = await db.run({}, (ctx) => ctx.storage.get(stored.key));
    expect(new TextDecoder().decode(back)).toBe('領収書 PDF のつもり');
    await expect(db.run({}, (ctx) => ctx.storage.get('../etc/passwd'))).rejects.toThrow(/invalid key/);
  });
});
