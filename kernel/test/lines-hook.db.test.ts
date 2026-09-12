// docs/specs/kernel-phase15.md B (AC-6): `after_lines_saved` fires once per saveLines call with the re-read parent and every
// line set; line hooks can tell (isSavingLines) that a replace-all save is in progress. Fixture: test_memo / test_memo_line.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerCrudActions } from '../src/actions/crud.ts';
import { runAction } from '../src/actions/run.ts';
import { Decimal } from '../src/decimal.ts';
import { amendDocument, cancelDocument, submitDocument } from '../src/document.ts';
import { ValidationError } from '../src/errors.ts';
import { isSavingLines, saveLines } from '../src/lines.ts';
import { registry, type HookArgs } from '../src/registry.ts';
import { repo } from '../src/repository/repository.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
import { TMemo, TMemoLine, TPartner } from './fixtures/entities.ts';

type Row = Record<string, unknown>;
type MemoWithLines = Row & { id: string; amount: string; version: number; lines: { test_memo_line: Row[] } };

interface Seen {
  entity: string;
  rowId: unknown;
  rowAmount: unknown;
  rowVersion: unknown;
  lineSets: string[];
  lines: Row[];
}

let db: TestDb;
let partnerId: string;
/** after_lines_saved calls observed by the SECOND hook (after the first one updated the parent). */
let seen: Seen[] = [];
/** isSavingLines(test_memo, memoId) as seen by the line's after_create hook. */
let lineCreateSawSaving: boolean[] = [];

beforeAll(async () => {
  db = await freshDb();
  registerCrudActions();
  partnerId = (await db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'Hook Partner' }))).id;
  // 1st hook: the typical recalculation — header amount = Σ line amounts, one parent update per save
  registry.registerHook(TMemo.name, 'after_lines_saved', async (ctx, { row, lines }) => {
    const total = Decimal.sum((lines?.test_memo_line ?? []).map((l) => l.amount as Decimal));
    await repo(ctx, TMemo).update(row.id as string, { amount: total });
  });
  // 2nd hook: records what it receives; `row` must already carry the 1st hook's update (re-read by the kernel)
  registry.registerHook(TMemo.name, 'after_lines_saved', (_ctx, args: HookArgs) => {
    seen.push({ entity: args.entity, rowId: args.row.id, rowAmount: args.row.amount, rowVersion: args.row.version, lineSets: Object.keys(args.lines ?? {}), lines: args.lines?.test_memo_line ?? [] });
  });
  registry.registerHook(TMemoLine.name, 'after_create', (ctx, { row }) => {
    lineCreateSawSaving.push(isSavingLines(ctx, TMemo.name, row.memoId as string));
  });
});
afterAll(async () => {
  await db.close();
});
beforeEach(() => {
  seen = [];
  lineCreateSawSaving = [];
});

describe('after_lines_saved (AC-6)', () => {
  it('AC-6 generic create with 3 lines fires once, after all lines exist, with the fresh parent and every line set', async () => {
    const created = (await db.run({}, (ctx) =>
      runAction(ctx, 'test_memo.create', {
        partnerId,
        date: '2026-09-11',
        amount: '0',
        lines: { test_memo_line: [{ description: 'a', amount: '10' }, { description: 'b', amount: '20.5' }, { description: 'c', amount: '30' }] },
      }),
    )) as MemoWithLines;
    expect(seen).toHaveLength(1);
    const call = seen[0];
    expect(call).toMatchObject({ entity: 'test_memo', rowId: created.id, lineSets: ['test_memo_line'] });
    expect(call?.lines.map((l) => [l.seq, l.description, String(l.amount)])).toEqual([
      [1, 'a', '10'],
      [2, 'b', '20.5'],
      [3, 'c', '30'],
    ]);
    expect(call?.lines[0]?.amount).toBeInstanceOf(Decimal);
    // fresh parent: the 2nd hook sees the 1st hook's update (amount 60.5, version 2), not the row saveLines started with.
    // Like other after_* hooks, `row` is the raw DB row (numeric as '60.500000'); lines are domain rows (Decimal).
    expect(Decimal.from(String(call?.rowAmount)).eq('60.5')).toBe(true);
    expect(call?.rowVersion).toBe(2);
    // one parent recalculation regardless of the line count; the generic create re-reads it
    expect(created).toMatchObject({ amount: '60.5', version: 2 });
    expect(lineCreateSawSaving).toEqual([true, true, true]);
  });

  it('AC-6 generic update with header patch + lines fires once; saveLines called directly fires once; empty input still fires once', async () => {
    const m = await db.run({}, (ctx) => repo(ctx, TMemo).create({ partnerId, date: '2026-09-11', amount: '0' }));
    const updated = (await db.run({}, (ctx) =>
      runAction(ctx, 'test_memo.update', { id: m.id, patch: { note: 'n', lines: { test_memo_line: [{ description: 'x', amount: '1' }, { description: 'y', amount: '2' }] } } }),
    )) as MemoWithLines;
    expect(seen).toHaveLength(1);
    expect(updated).toMatchObject({ note: 'n', amount: '3', version: 3 }); // 1 create, +1 header patch, +1 hook update
    const keep = updated.lines.test_memo_line[0]?.id as string;
    await db.run({}, (ctx) => saveLines(ctx, TMemo, m.id, { test_memo_line: [{ id: keep, description: 'x', amount: '5' }] }));
    expect(seen).toHaveLength(2);
    expect(seen[1]?.lines.map((l) => l.description)).toEqual(['x']);
    expect(Decimal.from(String(seen[1]?.rowAmount)).eq('5')).toBe(true);
    await db.run({}, (ctx) => saveLines(ctx, TMemo, m.id, {}));
    expect(seen).toHaveLength(3);
    expect(seen[2]?.lines).toHaveLength(1); // lines untouched, still reported
  });

  it('AC-6 direct line writes do not fire it and do not look like a save in progress; isSavingLines is false after saveLines, also when it fails', async () => {
    const m = await db.run({}, (ctx) => repo(ctx, TMemo).create({ partnerId, date: '2026-09-11', amount: '0' }));
    await db.run({}, (ctx) => repo(ctx, TMemoLine).create({ memoId: m.id, description: 'direct', amount: '7' }));
    expect(seen).toEqual([]);
    expect(lineCreateSawSaving).toEqual([false]);
    const after = await db.run({}, async (ctx) => {
      await saveLines(ctx, TMemo, m.id, { test_memo_line: [{ description: 'z', amount: '1' }] });
      const ok = isSavingLines(ctx, TMemo.name, m.id);
      // a failing save (missing required description) must not leave the marker set either
      const err = await saveLines(ctx, TMemo, m.id, { test_memo_line: [{ amount: '1' }] }).then(
        () => null,
        (e: unknown) => e,
      );
      return { ok, err, failed: isSavingLines(ctx, TMemo.name, m.id) };
    });
    expect(after.ok).toBe(false);
    expect(after.err).toBeInstanceOf(ValidationError);
    expect(after.failed).toBe(false);
    expect(seen).toHaveLength(1); // only the successful save fired
  });

  it('AC-6 amend copies the lines through saveLines: one call for the new draft', async () => {
    const m = (await db.run({}, (ctx) =>
      runAction(ctx, 'test_memo.create', { partnerId, date: '2026-09-11', amount: '0', lines: { test_memo_line: [{ description: 'p', amount: '4' }, { description: 'q', amount: '6' }] } }),
    )) as MemoWithLines;
    await db.run({ roles: ['manager'] }, (ctx) => submitDocument(ctx, TMemo, m.id));
    await db.run({ roles: ['manager'] }, (ctx) => cancelDocument(ctx, TMemo, m.id));
    seen = [];
    const amended = await db.run({ roles: ['manager'] }, (ctx) => amendDocument(ctx, TMemo, m.id));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ rowId: amended.id });
    expect(seen[0]?.lines.map((l) => l.description)).toEqual(['p', 'q']);
    expect(amended.amount.toString()).toBe('10');
  });
});
