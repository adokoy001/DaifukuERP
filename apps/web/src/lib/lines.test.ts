import { describe, expect, it } from 'vitest';
import type { EntityMeta, FieldMeta, RecordJson } from '../api/types.ts';
import { columnSums, gridColumns, linesChanged, linesFromRecord, moveRow, newRow, polymorphicTarget, rowErrorsByKey, rowsFromRecord, rowsToPayload, splitLineIssues } from './lines.ts';

const L = (ja: string, en: string) => ({ ja, en });
function field(name: string, kind: string, extra: Partial<FieldMeta> = {}): FieldMeta {
  return { name, kind, label: L(name, name), required: false, hasDefault: false, hidden: false, immutable: false, ...extra };
}
const lineFields: FieldMeta[] = [
  field('entryId', 'ref', { required: true, ref: 'journal_entry' }),
  field('seq', 'int', { required: true, hasDefault: true }),
  field('accountId', 'ref', { required: true, ref: 'account', refDisplayField: 'name' }),
  field('debit', 'decimal', { required: true, hasDefault: true, scale: 2 }),
  field('credit', 'decimal', { required: true, hasDefault: true, scale: 2 }),
  field('partnerId', 'ref', { ref: 'partner' }),
  field('taxCategory', 'enum', { values: ['standard', 'reduced'] }),
  field('taxRate', 'decimal'),
  field('memo', 'text'),
  field('internal', 'text', { hidden: true }),
  field('createdAt2', 'timestamp'),
];
function lineMeta(list: string[]): EntityMeta {
  return { name: 'journal_line', kind: 'entity', label: L('明細', 'Line'), module: 'accounting', scope: 'company', displayField: undefined, hasExt: false, fields: lineFields, views: { list, form: 'auto', search: [] }, ops: ['read', 'create', 'update', 'delete'] };
}
const KERNEL_DEFAULT = ['entryId', 'seq', 'accountId', 'debit', 'credit', 'partnerId'];

function rec(fields: Record<string, unknown>): RecordJson {
  return { id: 'id-1', tenantId: 't', companyId: 'c', createdAt: '', updatedAt: '', createdBy: null, updatedBy: null, version: 1, ...fields };
}

describe('AC-1 gridColumns', () => {
  it('uses every non-hidden, non-timestamp field (minus parent ref and seq) when views.list is the kernel default', () => {
    expect(gridColumns(lineMeta(KERNEL_DEFAULT), 'entryId').map((f) => f.name)).toEqual(['accountId', 'debit', 'credit', 'partnerId', 'taxCategory', 'taxRate', 'memo']);
  });
  it('honours a declared views.list but still appends required fields without defaults', () => {
    expect(gridColumns(lineMeta(['debit', 'credit', 'memo']), 'entryId').map((f) => f.name)).toEqual(['debit', 'credit', 'memo', 'accountId']);
    expect(gridColumns(lineMeta(['entryId', 'seq', 'accountId', 'debit']), 'entryId').map((f) => f.name)).toEqual(['accountId', 'debit']);
  });
  it('an empty list falls back to all fields', () => {
    expect(gridColumns(lineMeta([]), 'entryId').map((f) => f.name)).toContain('memo');
  });
});

describe('AC-1 rows and payload', () => {
  const columns = gridColumns(lineMeta(KERNEL_DEFAULT), 'entryId');

  it('rows from a record keep ids, normalise decimals and get unique keys', () => {
    const rows = rowsFromRecord(columns, [rec({ id: 'a', accountId: 'acc', debit: '100.000000', credit: '0.000000' }), rec({ id: 'b', accountId: 'acc2', debit: '0', credit: '100' })]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(rows[0]?.values.debit).toBe('100');
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    const empty = linesFromRecord([{ line: lineMeta(KERNEL_DEFAULT), columns }], undefined);
    expect(empty).toEqual({ journal_line: [] });
  });

  it('existing rows carry id and null for cleared cells; new rows omit empty cells; bad cells become errors', () => {
    const rows = rowsFromRecord(columns, [rec({ id: 'a', accountId: 'acc', debit: '1', credit: '0', memo: 'm' })]);
    const fresh = newRow(columns);
    fresh.values.accountId = 'acc9';
    fresh.values.debit = '12.5';
    fresh.values.credit = 'oops';
    if (rows[0]) rows[0].values.memo = '';
    const { rows: payload, errors } = rowsToPayload([...rows, fresh], columns);
    expect(payload[0]).toEqual({ id: 'a', accountId: 'acc', debit: '1', credit: '0', memo: null, partnerId: null, taxCategory: null, taxRate: null });
    expect(payload[1]).toEqual({ accountId: 'acc9', debit: '12.5' });
    expect(errors).toEqual({ [fresh.key]: { credit: 'number expected' } });
    expect(payload[1]).not.toHaveProperty('seq');
    expect(payload[1]).not.toHaveProperty('entryId');
  });

  it('required cells are never sent as null: with a default they are omitted, without one the row is an error', () => {
    const rows = rowsFromRecord(columns, [rec({ id: 'a', accountId: 'acc', debit: '1', credit: '0' })]);
    const fresh = newRow(columns);
    fresh.values.debit = '5';
    if (rows[0]) {
      rows[0].values.debit = ''; // required with default -> omitted (server keeps/defaults it)
      rows[0].values.accountId = ''; // required without default -> error
    }
    const { rows: payload, errors } = rowsToPayload([...rows, fresh], columns, '必須');
    expect(payload[0]).toEqual({ id: 'a', credit: '0', memo: null, partnerId: null, taxCategory: null, taxRate: null });
    expect(payload[1]).toEqual({ debit: '5' });
    expect(errors).toEqual({ [rows[0]?.key ?? '']: { accountId: '必須' }, [fresh.key]: { accountId: '必須' } });
  });

  it('linesChanged detects edits, additions, removals and reordering but not decimal formatting', () => {
    const original = rowsFromRecord(columns, [rec({ id: 'a', accountId: 'x', debit: '10.00', credit: '0' }), rec({ id: 'b', accountId: 'y', debit: '0', credit: '10' })]);
    const same = rowsFromRecord(columns, [rec({ id: 'a', accountId: 'x', debit: '10', credit: '0.000' }), rec({ id: 'b', accountId: 'y', debit: '0', credit: '10' })]);
    expect(linesChanged(same, original, columns)).toBe(false);
    expect(linesChanged(moveRow(original, 0, 1), original, columns)).toBe(true);
    expect(linesChanged([...original, newRow(columns)], original, columns)).toBe(true);
    expect(linesChanged(original.slice(0, 1), original, columns)).toBe(true);
    const edited = rowsFromRecord(columns, [rec({ id: 'a', accountId: 'x', debit: '11', credit: '0' }), rec({ id: 'b', accountId: 'y', debit: '0', credit: '10' })]);
    expect(linesChanged(edited, original, columns)).toBe(true);
  });

  it('moveRow reorders and ignores out-of-range moves', () => {
    const rows = [newRow(columns), newRow(columns), newRow(columns)];
    expect(moveRow(rows, 2, 0).map((r) => r.key)).toEqual([rows[2]?.key, rows[0]?.key, rows[1]?.key]);
    expect(moveRow(rows, 0, 5)).toEqual(rows);
  });
});

describe('AC-2 columnSums', () => {
  it('sums decimal and int columns with string arithmetic, skipping blanks and invalid input', () => {
    const columns = gridColumns(lineMeta(KERNEL_DEFAULT), 'entryId');
    const rows = rowsFromRecord(columns, [rec({ id: 'a', debit: '0.1', credit: '100' }), rec({ id: 'b', debit: '0.2', credit: '' }), rec({ id: 'c', debit: 'abc', credit: '0.005' })]);
    expect(columnSums(rows, columns)).toEqual({ debit: '0.3', credit: '100.005', taxRate: '0' });
  });
});

describe('AC-1 server issues -> cells', () => {
  it('splits patch.lines.<entity>.<i>.<field> and lines.<entity>.<i>.<field> from header issues', () => {
    const split = splitLineIssues([
      { path: 'patch.lines.journal_line.1.debit', message: 'must be >= 0' },
      { path: 'lines.journal_line.1.debit', message: 'also' },
      { path: 'lines.journal_line.0.accountId', message: 'required' },
      { path: 'patch.date', message: 'bad date' },
      { path: 'lines.nope', message: 'unknown line entity' },
    ]);
    expect(split.lines).toEqual({ journal_line: { 1: { debit: 'must be >= 0; also' }, 0: { accountId: 'required' } } });
    expect(split.rest.map((i) => i.path)).toEqual(['patch.date', 'lines.nope']);
    const columns = gridColumns(lineMeta(KERNEL_DEFAULT), 'entryId');
    const rows = [newRow(columns), newRow(columns)];
    expect(rowErrorsByKey(rows, split.lines.journal_line)).toEqual({ [rows[0]?.key ?? '']: { accountId: 'required' }, [rows[1]?.key ?? '']: { debit: 'must be >= 0; also' } });
    expect(rowErrorsByKey(rows, undefined)).toEqual({});
  });
});

describe('web-phase15 polymorphicTarget (`<x>Id` + `<x>Entity` cells link to the record)', () => {
  const cols = [field('invoiceEntity', 'enum', { values: ['sales_invoice', 'purchase_invoice'] }), field('invoiceId', 'uuid'), field('amount', 'decimal')];
  const salesInvoice = lineMeta([]);
  const entities: EntityMeta[] = [{ ...salesInvoice, name: 'sales_invoice', kind: 'document' }];
  const id = '01a09014-6edc-710d-8285-2cd2b51e1b93';
  const invoiceId = cols[1] as FieldMeta;
  it('resolves the entity named by the sibling enum when the id is a uuid', () => {
    expect(polymorphicTarget(invoiceId, { invoiceEntity: 'sales_invoice', invoiceId: id }, cols, entities)).toEqual({ entity: entities[0], id });
  });
  it('nothing for other fields, a partial id, an unknown/unreadable entity or a missing sibling enum', () => {
    expect(polymorphicTarget(cols[2] as FieldMeta, { invoiceEntity: 'sales_invoice', amount: '1' }, cols, entities)).toBeUndefined();
    expect(polymorphicTarget(invoiceId, { invoiceEntity: 'sales_invoice', invoiceId: '01a09014' }, cols, entities)).toBeUndefined();
    expect(polymorphicTarget(invoiceId, { invoiceEntity: 'purchase_invoice', invoiceId: id }, cols, entities)).toBeUndefined();
    expect(polymorphicTarget(invoiceId, { invoiceEntity: 'sales_invoice', invoiceId: id }, cols.slice(1), entities)).toBeUndefined();
    expect(polymorphicTarget(field('accountId', 'ref', { ref: 'account' }), { accountEntity: 'sales_invoice', accountId: id }, [...cols, field('accountEntity', 'enum')], entities)).toBeUndefined();
  });
});
