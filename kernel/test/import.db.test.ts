// csv-import (docs/specs/csv-import.md) AC-1..AC-10 against PostgreSQL: the derived <entity>.import action, dry-run in a
// rolled-back savepoint, per-row savepoints, atomic mode, ref resolution, onExisting, permissions, limits and audit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerCrudActions } from '../src/actions/crud.ts';
import { runAction } from '../src/actions/run.ts';
import { auditTrail } from '../src/audit.ts';
import { Decimal } from '../src/decimal.ts';
import { PermissionDenied, StateError, ValidationError } from '../src/errors.ts';
import { importRecords, importTemplateCsv, type ImportResult } from '../src/import.ts';
import { registry } from '../src/registry.ts';
import { repo } from '../src/repository/repository.ts';
import { freshDb, type TestDb } from '../src/testing.ts';
import { TMemo, TPartner } from './fixtures/entities.ts';
import { ImpCategory, ImpItem } from './fixtures/import-entities.ts';

let db: TestDb;
const categories: Record<string, string> = {};
type Rows = Record<string, string | null>[];

const run = (roles: string[], input: Record<string, unknown>) =>
  db.run({ roles }, (ctx) => runAction(ctx, 'test_imp_item.import', input)) as Promise<ImportResult>;
const asAdmin = (input: Record<string, unknown>) => run(['admin'], input);
const itemCount = () => db.run({}, (ctx) => repo(ctx, ImpItem).count());
const itemByCode = (code: string) =>
  db.run({}, async (ctx) => (await repo(ctx, ImpItem).list({ where: { code } })).items[0]);
const auditCount = async () =>
  Number(
    (await db.owner.sql`select count(*)::int as n from audit_log where entity = 'test_imp_item'`)[0]?.n ?? Number.NaN,
  );
const unique = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

beforeAll(async () => {
  db = await freshDb();
  registerCrudActions();
  await db.run({}, async (ctx) => {
    const r = repo(ctx, ImpCategory);
    categories.C1 = (await r.create({ code: 'C1', name: 'Food' })).id;
    categories.C2 = (await r.create({ code: 'C2', name: 'Tools' })).id;
    categories.C3 = (await r.create({ code: 'C3', name: 'Food' })).id;
  });
});
afterAll(async () => {
  await db.close();
});

describe('AC-1: one derived import action per master entity', () => {
  it('AC-1: masters get a generic, mutating <entity>.import; documents and line entities get none', () => {
    const action = registry.action('test_imp_item.import');
    expect(action).toMatchObject({
      generic: true,
      mutates: true,
      permission: { entity: 'test_imp_item', op: 'create' },
    });
    expect(registry.hasAction('test_partner.import')).toBe(true);
    expect(registry.hasAction('test_memo.import')).toBe(false);
    expect(registry.hasAction('test_memo_line.import')).toBe(false);
    expect(registry.hasAction('test_imp_owned.import')).toBe(false);
  });
});

describe('AC-6: dry-run runs the real writes and rolls them back', () => {
  it('AC-6: per-row results (including hook and validation failures) without changing rows or audit', async () => {
    const before = await itemCount();
    const audits = await auditCount();
    const code = unique('DRY');
    const result = await asAdmin({
      mode: 'dry-run',
      onExisting: 'error',
      rows: [
        { code, name: 'Dry one', price: '1,200' },
        { code: unique('DRY'), name: 'REJECT' },
        { code: unique('DRY'), name: 'x'.repeat(101) },
        // the same key again: the first row's create is visible inside the dry-run, exactly as in execute
        { code, name: 'Dry duplicate' },
      ] satisfies Rows,
    });
    expect(result.committed).toBe(false);
    expect(result.rows.map((r) => r.status)).toEqual(['created', 'error', 'error', 'error']);
    expect(result.rows[1]?.messages?.[0]).toMatchObject({ code: 'VALIDATION', field: 'name', column: 'name' });
    expect(result.rows[2]?.messages?.[0]).toMatchObject({ code: 'VALIDATION', field: 'name' });
    expect(result.rows[3]?.messages?.[0]).toMatchObject({ code: 'exists', field: 'code' });
    expect(result.summary).toEqual({ created: 1, updated: 0, skipped: 0, errors: 3 });
    expect(await itemCount()).toBe(before);
    expect(await auditCount()).toBe(audits);
    expect(await itemByCode(code)).toBeUndefined();
  });
});

describe('AC-7/AC-8: execute keeps good rows; atomic keeps none on failure', () => {
  it('AC-7/AC-8: a failed row is rolled back alone; created rows are audited; lines are 1-based', async () => {
    const before = await itemCount();
    const codes = [unique('EX'), unique('EX'), unique('EX')];
    const result = await asAdmin({
      mode: 'execute',
      onExisting: 'error',
      rows: [
        { code: codes[0] ?? '', name: 'Exec one', qty: '3' },
        { code: codes[1] ?? '', name: 'Exec two', qty: 'three' },
        { code: codes[2] ?? '', name: 'Exec three', since: '2026/4/1' },
      ] satisfies Rows,
    });
    expect(result).toMatchObject({ mode: 'execute', committed: true, keyField: 'code' });
    expect(result.rows.map((r) => [r.line, r.status])).toEqual([
      [1, 'created'],
      [2, 'error'],
      [3, 'created'],
    ]);
    expect(result.rows[1]?.messages).toEqual([
      { code: 'invalid_value', field: 'qty', column: 'qty', message: '"three" is not an integer' },
    ]);
    expect(await itemCount()).toBe(before + 2);
    const created = result.rows[0]?.id as string;
    const trail = await db.run({}, (ctx) => auditTrail(ctx, 'test_imp_item', created));
    expect(trail.map((a) => a.op)).toEqual(['create']);
    expect((await itemByCode(codes[2] ?? ''))?.since).toBe('2026-04-01');
  });

  it('AC-7: atomic rolls everything back when one row fails, and commits when none does', async () => {
    const before = await itemCount();
    const failed = await asAdmin({
      mode: 'execute',
      onExisting: 'error',
      atomic: true,
      rows: [{ code: unique('AT'), name: 'Atomic ok' }, { code: unique('AT') }] satisfies Rows,
    });
    expect(failed.committed).toBe(false);
    expect(failed.rows.map((r) => r.status)).toEqual(['created', 'error']);
    expect(await itemCount()).toBe(before);
    const ok = await asAdmin({
      mode: 'execute',
      onExisting: 'error',
      atomic: true,
      rows: [
        { code: unique('AT'), name: 'Atomic a' },
        { code: unique('AT'), name: 'Atomic b' },
      ] satisfies Rows,
    });
    expect(ok.committed).toBe(true);
    expect(await itemCount()).toBe(before + 2);
  });
});

describe('AC-3/AC-4: values and references', () => {
  it('AC-3: Decimal strings keep every digit; labels and words map to enum and bool values', async () => {
    const code = unique('VAL');
    const result = await asAdmin({
      mode: 'execute',
      onExisting: 'error',
      rows: [
        {
          品目コード: code,
          名称: '値の検証',
          単価: '12,345,678.123456',
          等級: '並',
          Active: 'いいえ',
          カナ: 'テスト',
          同期日時: '2026-04-01T09:00:00+09:00',
        },
      ] satisfies Rows,
    });
    expect(result.rows[0]?.status).toBe('created');
    const row = await itemByCode(code);
    expect(row?.price?.eq(Decimal.from('12345678.123456'))).toBe(true);
    expect(row?.price?.toString()).toBe('12345678.123456');
    expect(row).toMatchObject({ grade: 'b', active: false, nameKana: 'ﾃｽﾄ' });
    expect(row?.syncedAt?.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('AC-4: refs resolve by code (normalised), display name or id; none and several matches fail the row', async () => {
    const result = await asAdmin({
      mode: 'dry-run',
      onExisting: 'error',
      rows: [
        { code: unique('REF'), name: 'by code', categoryId: 'c1' },
        { code: unique('REF'), name: 'by name', categoryId: 'Tools' },
        { code: unique('REF'), name: 'by id', categoryId: categories.C3 ?? '' },
        { code: unique('REF'), name: 'ambiguous', categoryId: 'Food' },
        { code: unique('REF'), name: 'missing', categoryId: 'Nope' },
      ] satisfies Rows,
    });
    expect(result.rows.map((r) => r.status)).toEqual(['created', 'created', 'created', 'error', 'error']);
    expect(result.rows[3]?.messages?.[0]).toMatchObject({ code: 'ref_ambiguous', field: 'categoryId' });
    expect(result.rows[4]?.messages?.[0]).toMatchObject({ code: 'ref_not_found', field: 'categoryId' });
    const exec = await asAdmin({
      mode: 'execute',
      onExisting: 'error',
      rows: [{ code: unique('REF'), name: 'stored ref', 分類: 'C2' }] satisfies Rows,
    });
    const created = await db.run({}, (ctx) => repo(ctx, ImpItem).get(exec.rows[0]?.id as string));
    expect(created.categoryId).toBe(categories.C2);
  });
});

describe('AC-5: existing rows by keyField', () => {
  it('AC-5: skip leaves the record; error reports it; update changes only differing fields', async () => {
    const code = unique('KEY');
    await asAdmin({
      mode: 'execute',
      onExisting: 'error',
      rows: [{ code, name: 'Original', qty: '1', kind: 'goods' }],
    });
    const original = await itemByCode(code);
    const row = { code, name: 'Renamed', qty: '1', kind: 'goods' };
    const skipped = await asAdmin({ mode: 'execute', onExisting: 'skip', rows: [row] });
    expect(skipped.rows[0]).toEqual({ line: 1, status: 'skipped', id: original?.id });
    const errored = await asAdmin({ mode: 'execute', onExisting: 'error', rows: [row] });
    expect(errored.rows[0]?.messages?.[0]).toMatchObject({ code: 'exists', field: 'code' });
    expect((await itemByCode(code))?.name).toBe('Original');
    // `kind` is immutable but repeats its value: compared, not sent.
    const updated = await asAdmin({ mode: 'execute', onExisting: 'update', rows: [row] });
    expect(updated.rows[0]).toEqual({ line: 1, status: 'updated', id: original?.id });
    const after = await itemByCode(code);
    expect(after).toMatchObject({ name: 'Renamed', qty: 1, version: (original?.version ?? 0) + 1 });
    const trail = await db.run({}, (ctx) => auditTrail(ctx, 'test_imp_item', original?.id as string));
    expect(trail[0]).toMatchObject({ op: 'update', before: { name: 'Original' }, after: { name: 'Renamed' } });
    const same = await asAdmin({ mode: 'execute', onExisting: 'update', rows: [row] });
    expect(same.rows[0]).toMatchObject({ status: 'skipped', messages: [{ code: 'unchanged' }] });
    const immutable = await asAdmin({ mode: 'execute', onExisting: 'update', rows: [{ ...row, kind: 'service' }] });
    expect(immutable.rows[0]?.messages?.[0]).toMatchObject({ code: 'immutable', field: 'kind' });
    expect((await itemByCode(code))?.kind).toBe('goods');
  });

  it('AC-5: an explicit keyField must be a unique field with a column; without a key column every row creates', async () => {
    await expect(
      asAdmin({ mode: 'dry-run', onExisting: 'skip', keyField: 'name', rows: [{ name: 'x' }] }),
    ).rejects.toThrow(ValidationError);
    await expect(
      asAdmin({ mode: 'dry-run', onExisting: 'skip', keyField: 'code', rows: [{ name: 'x' }] }),
    ).rejects.toThrow(/no column for keyField/);
    const noKey = await asAdmin({ mode: 'dry-run', onExisting: 'skip', rows: [{ name: 'no key' }] });
    expect(noKey).toMatchObject({ keyField: null, rows: [{ status: 'created' }] });
  });

  it('AC-5: an int keyField matches existing records (numbers stay numbers in the lookup)', async () => {
    const serial = String(100_000 + Math.floor(Math.random() * 800_000));
    await asAdmin({ mode: 'execute', onExisting: 'error', rows: [{ serial, name: 'By serial' }] });
    const updated = await asAdmin({
      mode: 'execute',
      onExisting: 'update',
      keyField: 'serial',
      rows: [
        { 連番: serial.replace(/^(\d{3})/, '$1,'), name: 'By serial, renamed' },
        { 連番: '1', name: 'New serial' },
      ],
    });
    expect(updated).toMatchObject({ keyField: 'serial', summary: { updated: 1, created: 1 } });
    const row = await db.run(
      {},
      async (ctx) => (await repo(ctx, ImpItem).list({ where: { serial: Number(serial) } })).items[0],
    );
    expect(row?.name).toBe('By serial, renamed');
  });
});

describe('AC-9: permissions and ignored columns', () => {
  it('AC-9: without create (or update for onExisting=update) the whole import is refused', async () => {
    const rows = [{ code: unique('PERM'), name: 'perm' }];
    await expect(run(['viewer'], { mode: 'dry-run', onExisting: 'skip', rows })).rejects.toThrow(PermissionDenied);
    await expect(run(['clerk'], { mode: 'dry-run', onExisting: 'update', rows })).rejects.toThrow(PermissionDenied);
    expect((await run(['clerk'], { mode: 'dry-run', onExisting: 'skip', rows })).rows[0]?.status).toBe('created');
    // a field-group column the caller may not write, or a ref target it may not read, refuses the whole file
    await expect(
      run(['clerk'], { mode: 'dry-run', onExisting: 'skip', rows: [{ ...rows[0], cost: '1' }] }),
    ).rejects.toThrow(PermissionDenied);
    await expect(
      run(['blind'], { mode: 'dry-run', onExisting: 'skip', rows: [{ name: 'x', categoryId: 'C1' }] }),
    ).rejects.toThrow(PermissionDenied);
    expect(
      (await run(['editor'], { mode: 'dry-run', onExisting: 'update', rows: [{ ...rows[0], cost: '1' }] })).rows,
    ).toEqual([{ line: 1, status: 'created', id: expect.any(String) }]);
  });

  it('AC-9: server-owned and system columns are ignored with notices; unknown columns refuse the import', async () => {
    const code = unique('OWN');
    const result = await asAdmin({
      mode: 'execute',
      onExisting: 'error',
      rows: [{ code, name: 'owned', stockNote: 'forged', id: crypto.randomUUID(), version: '9', 'ext.jan': '1' }],
    });
    expect(result.notices.map((n) => [n.column, n.reason])).toEqual([
      ['stockNote', 'server-owned'],
      ['id', 'system'],
      ['version', 'system'],
      ['ext.jan', 'ext'],
    ]);
    const row = await itemByCode(code);
    expect(row).toMatchObject({ stockNote: null, version: 1 });
    expect(row?.id).toBe(result.rows[0]?.id);
    const unknown = asAdmin({ mode: 'dry-run', onExisting: 'error', rows: [{ name: 'x', 謎の列: '1' }] });
    await expect(unknown).rejects.toThrow(ValidationError);
    await expect(unknown).rejects.toMatchObject({
      details: { issues: [{ path: 'rows.謎の列', message: 'unknown column' }] },
    });
    await expect(asAdmin({ mode: 'dry-run', onExisting: 'error', rows: [{ name: 'x', 名称: 'y' }] })).rejects.toThrow(
      /do not match/,
    );
  });
});

describe('AC-2: limits and request shape', () => {
  it('AC-2: more than 5,000 rows or more than 2 MB is refused before any row is written', async () => {
    const before = await itemCount();
    const many = Array.from({ length: 5001 }, (_, i) => ({ name: `row ${i}` }));
    await expect(asAdmin({ mode: 'execute', onExisting: 'skip', rows: many })).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { issues: [expect.objectContaining({ path: 'rows' })] },
    });
    const big = Array.from({ length: 260 }, () => ({ name: 'n', nameKana: 'x'.repeat(8_200) }));
    await expect(asAdmin({ mode: 'execute', onExisting: 'skip', rows: big })).rejects.toThrow(/exceeds 2097152 bytes/);
    await expect(asAdmin({ mode: 'execute', onExisting: 'skip', rows: [{ name: 1 }] })).rejects.toThrow(
      ValidationError,
    );
    await expect(asAdmin({ mode: 'execute', rows: [{ name: 'x' }] })).rejects.toThrow(ValidationError);
    expect(await itemCount()).toBe(before);
  });

  it('AC-2: the port refuses documents and validates its own input for in-process callers', async () => {
    await expect(
      db.run({}, (ctx) => importRecords(ctx, TMemo, { mode: 'dry-run', onExisting: 'skip', rows: [{ note: 'x' }] })),
    ).rejects.toThrow(StateError);
    await expect(db.run({}, (ctx) => importRecords(ctx, TPartner, { mode: 'later', rows: [] }))).rejects.toThrow(
      ValidationError,
    );
  });
});

describe('AC-10: template', () => {
  it('AC-10: BOM + labels of the importable fields the caller may write, in ja or en; create permission required', async () => {
    const ja = await db.run({ roles: ['clerk'] }, async (ctx) => importTemplateCsv(ctx, ImpItem, 'ja'));
    expect(ja).toBe('\uFEFF品目コード,名称,カナ,分類,単価,数量,有効,開始日,等級,種別,担当者,同期日時,連番\r\n');
    const en = await db.run({ roles: ['editor'] }, async (ctx) => importTemplateCsv(ctx, ImpItem, 'en'));
    expect(en.trimEnd().split(',')).toEqual(expect.arrayContaining(['\uFEFFItem code', 'Cost']));
    await expect(db.run({ roles: ['viewer'] }, async (ctx) => importTemplateCsv(ctx, ImpItem, 'ja'))).rejects.toThrow(
      PermissionDenied,
    );
    await expect(db.run({}, async (ctx) => importTemplateCsv(ctx, TMemo, 'ja'))).rejects.toThrow(StateError);
  });
});
