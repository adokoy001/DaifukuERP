import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditTrail } from '../src/audit.ts';
import { amendDocument, cancelDocument, submitDocument, transitionDocument } from '../src/document.ts';
import { DependencyError, StateError } from '../src/errors.ts';
import { deliverPending } from '../src/events.ts';
import { getLines, saveLines } from '../src/lines.ts';
import { registry } from '../src/registry.ts';
import { repo } from '../src/repository/repository.ts';
import { TMemo, TPartner } from './fixtures/entities.ts';
import { freshDb, type TestDb } from '../src/testing.ts';

let db: TestDb;
let partnerId: string;
beforeAll(async () => {
  db = await freshDb();
  partnerId = (await db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'Doc Partner' }))).id;
});
afterAll(async () => {
  await db.close();
});

describe('Document lifecycle (ADR-0006)', () => {
  it('AC-1 submit assigns a no-gap, per-year number and emits an event; drafts have no number', async () => {
    const a = await db.run({}, (ctx) => repo(ctx, TMemo).create({ partnerId, date: '2026-09-10', amount: '10' }));
    expect(a.docstatus).toBe(0);
    expect(a.number).toBeNull();
    const b = await db.run({}, (ctx) => repo(ctx, TMemo).create({ partnerId, date: '2026-09-11', amount: '20' }));
    const sb = await db.run({}, (ctx) => submitDocument(ctx, TMemo, b.id));
    const sa = await db.run({}, (ctx) => submitDocument(ctx, TMemo, a.id));
    expect(sb.number).toBe('MEMO-2026-0001');
    expect(sa.number).toBe('MEMO-2026-0002');
    const nextYear = await db.run({}, async (ctx) =>
      submitDocument(ctx, TMemo, (await repo(ctx, TMemo).create({ partnerId, date: '2027-01-05', amount: '1' })).id),
    );
    expect(nextYear.number).toBe('MEMO-2027-0001');
    const delivered: string[] = [];
    registry.subscribe('test_memo.submitted', async (_ctx, payload) => {
      delivered.push((payload as { number: string }).number);
    });
    const result = await db.run({}, (ctx) => deliverPending(ctx));
    expect(result.failed).toBe(0);
    expect(delivered).toEqual(expect.arrayContaining(['MEMO-2026-0001', 'MEMO-2026-0002', 'MEMO-2027-0001']));
  });

  it('AC-2 a rolled-back submit does not consume a number (no gap)', async () => {
    const c = await db.run({}, (ctx) => repo(ctx, TMemo).create({ partnerId, date: '2026-09-12', amount: '1' }));
    await expect(
      db.run({}, async (ctx) => {
        await submitDocument(ctx, TMemo, c.id);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const d = await db.run({}, (ctx) => repo(ctx, TMemo).create({ partnerId, date: '2026-09-12', amount: '1' }));
    const sd = await db.run({}, (ctx) => submitDocument(ctx, TMemo, d.id));
    expect(sd.number).toBe('MEMO-2026-0003');
  });

  it('AC-3 submitted documents accept only allowOnSubmit fields; cancelled ones are read-only', async () => {
    const m = await db.run({}, async (ctx) =>
      submitDocument(ctx, TMemo, (await repo(ctx, TMemo).create({ partnerId, date: '2026-09-13', amount: '5' })).id),
    );
    const ok = await db.run({}, (ctx) => repo(ctx, TMemo).update(m.id, { remarks: 'late note' }));
    expect(ok.remarks).toBe('late note');
    await expect(db.run({}, (ctx) => repo(ctx, TMemo).update(m.id, { amount: '6' }))).rejects.toBeInstanceOf(
      StateError,
    );
    await expect(db.run({}, (ctx) => repo(ctx, TMemo).delete(m.id))).rejects.toBeInstanceOf(StateError);
    const cancelled = await db.run({}, (ctx) => cancelDocument(ctx, TMemo, m.id));
    expect(cancelled.docstatus).toBe(2);
    await expect(db.run({}, (ctx) => repo(ctx, TMemo).update(m.id, { remarks: 'x' }))).rejects.toBeInstanceOf(
      StateError,
    );
    const trail = await db.run({}, (ctx) => auditTrail(ctx, 'test_memo', m.id));
    expect(trail.map((t) => t.op)).toEqual(['cancel', 'update', 'submit', 'create']);
  });

  it('AC-4 amend copies a cancelled document into a new draft linked by amendedFrom', async () => {
    const m = await db.run({}, async (ctx) =>
      submitDocument(
        ctx,
        TMemo,
        (await repo(ctx, TMemo).create({ partnerId, date: '2026-09-14', amount: '7', note: 'orig' })).id,
      ),
    );
    await db.run({}, (ctx) => cancelDocument(ctx, TMemo, m.id));
    const amended = await db.run({}, (ctx) => amendDocument(ctx, TMemo, m.id));
    expect(amended.docstatus).toBe(0);
    expect(amended.amendedFrom).toBe(m.id);
    expect(amended.note).toBe('orig');
    expect(amended.amount.toString()).toBe('7');
    await expect(db.run({}, (ctx) => amendDocument(ctx, TMemo, amended.id))).rejects.toBeInstanceOf(StateError);
    // lines are copied and the amended document is numbered <original>-1 at submit (ADR-0006)
    const m2 = await db.run({}, async (ctx) => {
      const created = await repo(ctx, TMemo).create({ partnerId, date: '2026-09-14', amount: '9' });
      await saveLines(ctx, TMemo, created.id, {
        test_memo_line: [
          { description: 'L1', amount: '4' },
          { description: 'L2', amount: '5' },
        ],
      });
      return submitDocument(ctx, TMemo, created.id);
    });
    await db.run({}, (ctx) => cancelDocument(ctx, TMemo, m2.id));
    const amended2 = await db.run({}, (ctx) => amendDocument(ctx, TMemo, m2.id));
    const copiedLines = await db.run({}, (ctx) => getLines(ctx, TMemo, amended2.id));
    expect(copiedLines.test_memo_line?.map((l) => l.description)).toEqual(['L1', 'L2']);
    const resubmitted = await db.run({}, (ctx) => submitDocument(ctx, TMemo, amended2.id));
    expect(resubmitted.number).toBe(`${m2.number}-1`);
  });

  it('AC-5 cancelling a master record’s dependents is enforced via ref fields', async () => {
    const p2 = await db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'Dep Partner' }));
    await db.run({}, async (ctx) =>
      submitDocument(
        ctx,
        TMemo,
        (await repo(ctx, TMemo).create({ partnerId: p2.id, date: '2026-09-15', amount: '1' })).id,
      ),
    );
    // deleting a partner referenced by a submitted memo is blocked by the FK (restrict)
    await expect(db.run({}, (ctx) => repo(ctx, TPartner).delete(p2.id))).rejects.toThrow();
    expect(DependencyError).toBeDefined();
  });

  it('AC-6 declared transitions check roles and guards', async () => {
    const zero = await db.run({}, (ctx) => repo(ctx, TMemo).create({ partnerId, date: '2026-09-16', amount: '0' }));
    await expect(
      db.run({ roles: ['sales'] }, (ctx) => transitionDocument(ctx, TMemo, zero.id, 'approve')),
    ).rejects.toThrow(/requires roles/);
    await expect(
      db.run({ roles: ['manager'] }, (ctx) => transitionDocument(ctx, TMemo, zero.id, 'approve')),
    ).rejects.toThrow(/guard/);
    await db.run({}, (ctx) => repo(ctx, TMemo).update(zero.id, { amount: '3' }));
    const approved = await db.run({ roles: ['manager'] }, (ctx) => transitionDocument(ctx, TMemo, zero.id, 'approve'));
    expect(approved.docstatus).toBe(1);
    expect(approved.number).toMatch(/^MEMO-2026-\d{4}$/);
  });
});
