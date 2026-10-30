// docs/specs/recurring-journals.md AC-1 / AC-2 / AC-7 mechanism (ADR-0031): lines of an entity share the document line
// machinery (replace-all save, parent lock and version, 500-line limit, one after_lines_saved per save) but are never
// frozen by docstatus; a caller needs update on the parent, also for a direct `<line>.create`. A generic update that
// carries lines marks the aggregate as replacing while its header is written. Documents keep their freeze.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { registerCrudActions } from '../src/actions/crud.ts';
import { runAction } from '../src/actions/run.ts';
import { submitDocument } from '../src/document.ts';
import { defineEntity } from '../src/dsl/entity.ts';
import { f } from '../src/dsl/fields.ts';
import { DaifukuError } from '../src/errors.ts';
import { label } from '../src/i18n.ts';
import { newId } from '../src/ids.ts';
import { isSavingLines, saveLines } from '../src/lines.ts';
import { registry } from '../src/registry.ts';
import { repo } from '../src/repository/repository.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
import { TMemo, TMemoLine, TPartner } from './fixtures/entities.ts';

const Book = defineEntity({
  name: 'eld_book',
  label: label('明細つきマスタ', 'Master with lines'),
  fields: { name: f.text({ required: true }), note: f.text() },
  lines: [{ entity: 'eld_book_line', parentField: 'bookId' }],
  permissions: {
    roles: {
      clerk: ['read', 'create', 'update', 'delete'],
      // create but no update on the parent: may create a master (without lines) but never change an existing one
      creator: ['read', 'create'],
      viewer: ['read'],
    },
  },
});
const BookLine = defineEntity({
  name: 'eld_book_line',
  label: label('マスタ明細', 'Master line'),
  fields: {
    bookId: f.ref('eld_book', { required: true, onDelete: 'cascade' }),
    seq: f.int({ required: true, default: 1 }),
    note: f.text({ required: true }),
  },
  permissions: {
    roles: {
      clerk: ['read', 'create', 'update', 'delete'],
      creator: ['read', 'create', 'update', 'delete'],
      viewer: ['read'],
    },
  },
});

type Row = Record<string, unknown>;
type BookJson = Row & { id: string; version: number; lines: { eld_book_line: Row[] } };

let db: TestDb;
let linesSaved: { id: unknown; lines: number }[] = [];
let headerSawSaving: boolean[] = [];

const as = <T>(roles: string[], fn: Parameters<TestDb['run']>[1]) =>
  db.run({ roles, actor: { type: 'user', id: newId() } }, fn) as Promise<T>;

async function caught(p: Promise<unknown>): Promise<DaifukuError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof DaifukuError) return e;
    throw e;
  }
  throw new Error('expected a DaifukuError');
}

beforeAll(async () => {
  db = await freshDb();
  registerCrudActions();
  registry.registerHook(Book.name, 'after_lines_saved', (_ctx, { row, lines }) => {
    linesSaved.push({ id: row.id, lines: lines?.eld_book_line?.length ?? -1 });
  });
  registry.registerHook(Book.name, 'before_update', (ctx, { row }) => {
    headerSawSaving.push(isSavingLines(ctx, Book.name, row.id as string));
  });
});
afterAll(async () => {
  await db.close();
});
beforeEach(() => {
  linesSaved = [];
  headerSawSaving = [];
});

describe('entity lines (recurring-journals AC-1, AC-2, ADR-0031)', () => {
  it('AC-1 generic create with lines saves them, get returns them in seq order, after_lines_saved fires once', async () => {
    const created = await as<BookJson>(['clerk'], (ctx) =>
      runAction(ctx, 'eld_book.create', {
        name: 'Rent',
        lines: { eld_book_line: [{ note: 'a' }, { note: 'b' }, { note: 'c' }] },
      }),
    );
    expect(created.lines.eld_book_line.map((l) => [l.seq, l.note])).toEqual([
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ]);
    expect(linesSaved).toEqual([{ id: created.id, lines: 3 }]);
    const got = await as<BookJson>(['viewer'], (ctx) => runAction(ctx, 'eld_book.get', { id: created.id }));
    expect(got.lines.eld_book_line.map((l) => l.note)).toEqual(['a', 'b', 'c']);
  });

  it('AC-1 replace-all update keeps rows by id, deletes absent ones, bumps the parent version once per save', async () => {
    const created = await as<BookJson>(['clerk'], (ctx) =>
      runAction(ctx, 'eld_book.create', { name: 'Lease', lines: { eld_book_line: [{ note: 'x' }, { note: 'y' }] } }),
    );
    const keep = created.lines.eld_book_line[1] as Row;
    const updated = await as<BookJson>(['clerk'], (ctx) =>
      runAction(ctx, 'eld_book.update', {
        id: created.id,
        expectedVersion: created.version,
        patch: { lines: { eld_book_line: [{ id: keep.id, note: 'y2' }, { note: 'z' }] } },
      }),
    );
    expect(updated.lines.eld_book_line.map((l) => [l.seq, l.note])).toEqual([
      [1, 'y2'],
      [2, 'z'],
    ]);
    expect(updated.lines.eld_book_line[0]?.id).toBe(keep.id);
    expect(updated.version).toBe(created.version + 1);
    // a direct line write locks the parent and touches its version too
    await as(['clerk'], (ctx) => repo(ctx, BookLine).create({ bookId: created.id, note: 'direct', seq: 3 }));
    const after = await as<Row>(['clerk'], (ctx) => repo(ctx, Book).get(created.id));
    expect(after.version).toBe(updated.version + 1);
  });

  it('AC-1 at most 500 lines per parent (saveLines and a direct create)', async () => {
    const book = await as<Row>(['clerk'], (ctx) => repo(ctx, Book).create({ name: 'Big' }));
    const tooMany = Array.from({ length: 501 }, (_, i) => ({ note: `n${i}` }));
    const err = await caught(
      as(['clerk'], (ctx) => saveLines(ctx, Book, book.id as string, { eld_book_line: tooMany })),
    );
    expect(err.code).toBe('VALIDATION');
    const full = Array.from({ length: 500 }, (_, i) => ({ note: `n${i}` }));
    await as(['clerk'], (ctx) => saveLines(ctx, Book, book.id as string, { eld_book_line: full }));
    const over = await caught(
      as(['clerk'], (ctx) => repo(ctx, BookLine).create({ bookId: book.id as string, note: 'one more' })),
    );
    expect(over.code).toBe('VALIDATION');
  });

  it('AC-2 an entity parent is never frozen: lines change again and again with update on the parent', async () => {
    const created = await as<BookJson>(['clerk'], (ctx) =>
      runAction(ctx, 'eld_book.create', { name: 'Fee', lines: { eld_book_line: [{ note: '1' }] } }),
    );
    for (const note of ['2', '3']) {
      const res = await as<BookJson>(['clerk'], (ctx) =>
        runAction(ctx, 'eld_book.update', { id: created.id, patch: { lines: { eld_book_line: [{ note }] } } }),
      );
      expect(res.lines.eld_book_line.map((l) => l.note)).toEqual([note]);
    }
    const line = (await as<Row[]>(
      ['clerk'],
      async (ctx) => (await repo(ctx, BookLine).list({ where: { bookId: created.id } })).items,
    )) as Row[];
    await as(['clerk'], (ctx) => repo(ctx, BookLine).update(line[0]?.id as string, { note: 'edited' }));
    await as(['clerk'], (ctx) => repo(ctx, BookLine).delete(line[0]?.id as string));
  });

  it('AC-2 without update on the parent: saveLines and a direct line create/update/delete are PERMISSION_DENIED; nothing is written', async () => {
    const created = await as<BookJson>(['clerk'], (ctx) =>
      runAction(ctx, 'eld_book.create', { name: 'Locked', lines: { eld_book_line: [{ note: 'keep' }] } }),
    );
    const lineId = created.lines.eld_book_line[0]?.id as string;
    const viaSave = await caught(
      as(['creator'], (ctx) => saveLines(ctx, Book, created.id, { eld_book_line: [{ note: 'new' }] })),
    );
    expect(viaSave.code).toBe('PERMISSION_DENIED');
    // the line entity grants create to `creator`, but the parent lock needs update (an entity parent, ADR-0031)
    const direct = await caught(
      as(['creator'], (ctx) => runAction(ctx, 'eld_book_line.create', { bookId: created.id, note: 'sneak' })),
    );
    expect(direct.code).toBe('PERMISSION_DENIED');
    const upd = await caught(
      as(['creator'], (ctx) => runAction(ctx, 'eld_book_line.update', { id: lineId, patch: { note: 'x' } })),
    );
    expect(upd.code).toBe('PERMISSION_DENIED');
    const del = await caught(as(['creator'], (ctx) => runAction(ctx, 'eld_book_line.delete', { id: lineId })));
    expect(del.code).toBe('PERMISSION_DENIED');
    const after = await as<BookJson>(['clerk'], (ctx) => runAction(ctx, 'eld_book.get', { id: created.id }));
    expect(after.lines.eld_book_line.map((l) => l.note)).toEqual(['keep']);
    expect(after.version).toBe(created.version);
    // creating a new master without lines stays allowed for `creator`
    await as(['creator'], (ctx) => runAction(ctx, 'eld_book.create', { name: 'Own' }));
  });

  it('AC-7 mechanism: a generic update carrying lines marks the aggregate as replacing during the header update; without lines it does not', async () => {
    const created = await as<BookJson>(['clerk'], (ctx) =>
      runAction(ctx, 'eld_book.create', { name: 'Flag', lines: { eld_book_line: [{ note: 'a' }] } }),
    );
    headerSawSaving = [];
    await as(['clerk'], (ctx) =>
      runAction(ctx, 'eld_book.update', {
        id: created.id,
        patch: { note: 'with lines', lines: { eld_book_line: [{ note: 'b' }] } },
      }),
    );
    expect(headerSawSaving[0]).toBe(true);
    const flagAfter = await as<boolean>(['clerk'], async (ctx) => {
      await runAction(ctx, 'eld_book.update', { id: created.id, patch: { note: 'header only' } });
      return isSavingLines(ctx, Book.name, created.id);
    });
    expect(headerSawSaving.at(-1)).toBe(false);
    expect(flagAfter).toBe(false);
  });
});

describe('documents keep their freeze (AC-2)', () => {
  it('AC-2 a submitted document refuses saveLines and a direct line create with INVALID_STATE', async () => {
    const partner = await db.run({}, (ctx) => repo(ctx, TPartner).create({ name: 'Doc Partner' }));
    const memo = await db.run({}, (ctx) =>
      repo(ctx, TMemo).create({ partnerId: partner.id, date: '2026-10-30', amount: '1' }),
    );
    await db.run({}, (ctx) => saveLines(ctx, TMemo, memo.id, { test_memo_line: [{ description: 'd' }] }));
    await db.run({}, (ctx) => submitDocument(ctx, TMemo, memo.id));
    const save = await caught(
      db.run({}, (ctx) => saveLines(ctx, TMemo, memo.id, { test_memo_line: [{ description: 'e' }] })),
    );
    expect(save.code).toBe('INVALID_STATE');
    const direct = await caught(
      db.run({}, (ctx) => repo(ctx, TMemoLine).create({ memoId: memo.id, description: 'f' })),
    );
    expect(direct.code).toBe('INVALID_STATE');
  });
});
