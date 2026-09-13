import { describe, expect, it } from 'vitest';
import type { EntityMeta, FieldMeta, RecordJson } from '../api/types.ts';
import { initialValues } from './form.ts';
import { linesFromRecord, newRow } from './lines.ts';
import { lineSpecsOf, planSave } from './save.ts';

const L = (ja: string, en: string) => ({ ja, en });
function field(name: string, kind: string, extra: Partial<FieldMeta> = {}): FieldMeta {
  return {
    name,
    kind,
    label: L(name, name),
    required: false,
    hasDefault: false,
    hidden: false,
    immutable: false,
    ...extra,
  };
}
const entry: EntityMeta = {
  name: 'journal_entry',
  kind: 'document',
  label: L('仕訳', 'Journal entry'),
  module: 'accounting',
  scope: 'company',
  displayField: undefined,
  hasExt: false,
  fields: [
    field('date', 'date', { required: true }),
    field('description', 'text'),
    field('totalDebit', 'decimal', { hasDefault: true, required: true }),
  ],
  views: { list: ['date', 'description'], form: 'auto', search: [] },
  ops: ['read', 'create', 'update', 'submit'],
  allowOnSubmit: ['description'],
  lines: [
    { entity: 'journal_line', parentField: 'entryId' },
    { entity: 'hidden_line', parentField: 'entryId' },
  ],
};
const line: EntityMeta = {
  name: 'journal_line',
  kind: 'entity',
  label: L('仕訳明細', 'Journal line'),
  module: 'accounting',
  scope: 'company',
  displayField: undefined,
  hasExt: false,
  fields: [
    field('entryId', 'ref', { required: true, ref: 'journal_entry' }),
    field('seq', 'int', { required: true, hasDefault: true }),
    field('accountId', 'ref', { required: true, ref: 'account' }),
    field('debit', 'decimal', { required: true, hasDefault: true }),
    field('credit', 'decimal', { required: true, hasDefault: true }),
  ],
  views: { list: ['entryId', 'seq', 'accountId', 'debit', 'credit'], form: 'auto', search: [] },
  ops: ['read', 'create', 'update', 'delete'],
};
const specs = lineSpecsOf(entry, [entry, line]);
const record: RecordJson = {
  id: 'e1',
  tenantId: 't',
  companyId: 'c',
  createdAt: '',
  updatedAt: '',
  createdBy: null,
  updatedBy: null,
  version: 3,
  docstatus: 0,
  date: '2026-09-10',
  description: 'd',
  totalDebit: '100.000000',
  lines: {
    journal_line: [
      {
        id: 'l1',
        tenantId: 't',
        companyId: 'c',
        createdAt: '',
        updatedAt: '',
        createdBy: null,
        updatedBy: null,
        version: 1,
        entryId: 'e1',
        seq: 1,
        accountId: 'a1',
        debit: '100.000000',
        credit: '0',
      },
    ],
  },
};

describe('AC-1 lineSpecsOf', () => {
  it('joins entity.lines with readable line metas and derives grid columns; unreadable line entities are skipped', () => {
    expect(specs.map((s) => s.line.name)).toEqual(['journal_line']);
    expect(specs[0]?.columns.map((c) => c.name)).toEqual(['accountId', 'debit', 'credit']);
  });
});

describe('AC-1 planSave', () => {
  it('create: POST body carries insert fields plus lines (no ids, no seq, no parent ref); missing required header fields are errors', () => {
    const values = initialValues(entry.fields);
    values.date = '2026-09-11';
    const r1 = newRow(specs[0]?.columns ?? []);
    r1.values.accountId = 'a1';
    r1.values.debit = '50';
    const r2 = newRow(specs[0]?.columns ?? []);
    r2.values.accountId = 'a2';
    r2.values.credit = '50';
    const plan = planSave({
      entity: entry,
      mode: 'create',
      record: undefined,
      values,
      specs,
      lines: { journal_line: [r1, r2] },
      originalLines: {},
      requiredMessage: 'req',
    });
    expect(plan.hasErrors).toBe(false);
    expect(plan.body).toEqual({
      date: '2026-09-11',
      lines: {
        journal_line: [
          { accountId: 'a1', debit: '50' },
          { accountId: 'a2', credit: '50' },
        ],
      },
    });
    const missing = planSave({
      entity: entry,
      mode: 'create',
      record: undefined,
      values: initialValues(entry.fields),
      specs,
      lines: { journal_line: [] },
      originalLines: {},
      requiredMessage: 'req',
    });
    expect(missing.fieldErrors).toEqual({ date: 'req' });
    expect(missing.hasErrors).toBe(true);
    expect(missing.body).toEqual({});
  });

  it('update: unchanged lines are not sent; changed lines go inside patch with ids kept; nothing changed -> empty', () => {
    const original = linesFromRecord(specs, record);
    const values = initialValues(entry.fields, record);
    const same = planSave({
      entity: entry,
      mode: 'update',
      record,
      values,
      specs,
      lines: original,
      originalLines: original,
      requiredMessage: 'req',
    });
    expect(same.empty).toBe(true);
    expect(same.body).toEqual({ patch: {}, expectedVersion: 3 });
    const edited = linesFromRecord(specs, record);
    const first = edited.journal_line?.[0];
    if (first) first.values.debit = '120';
    const extra = newRow(specs[0]?.columns ?? []);
    extra.values.accountId = 'a2';
    extra.values.credit = '120';
    const plan = planSave({
      entity: entry,
      mode: 'update',
      record,
      values: { ...values, description: 'changed' },
      specs,
      lines: { journal_line: [...(edited.journal_line ?? []), extra] },
      originalLines: original,
      requiredMessage: 'req',
    });
    expect(plan.empty).toBe(false);
    expect(plan.body).toEqual({
      patch: {
        description: 'changed',
        lines: {
          journal_line: [
            { id: 'l1', accountId: 'a1', debit: '120', credit: '0' },
            { accountId: 'a2', credit: '120' },
          ],
        },
      },
      expectedVersion: 3,
    });
    const onlyLines = planSave({
      entity: entry,
      mode: 'update',
      record,
      values,
      specs,
      lines: { journal_line: [] },
      originalLines: original,
      requiredMessage: 'req',
    });
    expect(onlyLines.body).toEqual({ patch: { lines: { journal_line: [] } }, expectedVersion: 3 });
  });

  it('cell conversion errors surface per row and block the save', () => {
    const rows = linesFromRecord(specs, record);
    const first = rows.journal_line?.[0];
    if (first) first.values.debit = 'abc';
    const plan = planSave({
      entity: entry,
      mode: 'update',
      record,
      values: initialValues(entry.fields, record),
      specs,
      lines: rows,
      originalLines: linesFromRecord(specs, record),
      requiredMessage: 'req',
    });
    expect(plan.hasErrors).toBe(true);
    expect(plan.lineErrors).toEqual({ journal_line: { [first?.key ?? '']: { debit: 'number expected' } } });
  });
});
