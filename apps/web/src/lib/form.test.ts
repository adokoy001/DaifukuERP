import { describe, expect, it } from 'vitest';
import type { EntityMeta, FieldMeta, RecordJson } from '../api/types.ts';
import {
  diffPatch,
  formGroups,
  initialValues,
  isFieldEditable,
  issuesToFieldErrors,
  normalizeDecimalString,
  toPayload,
  widgetFor,
} from './form.ts';

function field(over: Partial<FieldMeta> & { name: string; kind: string }): FieldMeta {
  return {
    label: { ja: over.name, en: over.name },
    required: false,
    hasDefault: false,
    hidden: false,
    immutable: false,
    ...over,
  };
}

const fields: FieldMeta[] = [
  field({ name: 'code', kind: 'text', immutable: true }),
  field({ name: 'name', kind: 'text', required: true }),
  field({ name: 'notes', kind: 'text', multiline: true }),
  field({ name: 'qty', kind: 'int' }),
  field({ name: 'amount', kind: 'decimal', scale: 2 }),
  field({ name: 'active', kind: 'bool', required: true, hasDefault: true }),
  field({ name: 'since', kind: 'date' }),
  field({ name: 'seenAt', kind: 'timestamp' }),
  field({ name: 'status', kind: 'enum', values: ['a', 'b'] }),
  field({ name: 'partnerId', kind: 'ref', ref: 'partner', refDisplayField: 'name' }),
  field({ name: 'attrs', kind: 'json' }),
  field({ name: 'secret', kind: 'text', hidden: true }),
  field({ name: 'externalId', kind: 'uuid' }),
];

const record: RecordJson = {
  id: 'r1',
  tenantId: 't',
  companyId: 'c',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  createdBy: null,
  updatedBy: null,
  version: 3,
  code: 'P-1',
  name: 'Acme',
  notes: null,
  qty: 2,
  amount: '10.000000',
  active: true,
  since: '2026-01-02',
  seenAt: '2026-01-01T00:00:00Z',
  status: 'a',
  partnerId: null,
  attrs: { x: 1 },
};

describe('widgetFor (AC-4)', () => {
  it('maps every kind to a widget', () => {
    const map = Object.fromEntries(fields.map((f) => [f.name, widgetFor(f)]));
    expect(map).toEqual({
      code: 'text',
      name: 'text',
      notes: 'textarea',
      qty: 'int',
      amount: 'decimal',
      active: 'bool',
      since: 'date',
      seenAt: 'timestamp',
      status: 'enum',
      partnerId: 'ref',
      attrs: 'json',
      secret: 'text',
      externalId: 'text',
    });
  });
});

describe('formGroups (AC-4)', () => {
  const base = {
    name: 'x',
    kind: 'entity' as const,
    label: { ja: 'x', en: 'x' },
    module: undefined,
    scope: 'company' as const,
    displayField: 'name',
    hasExt: true,
    fields,
    ops: ['read' as const],
  };

  it("'auto' is one group of all non-hidden fields", () => {
    const entity: EntityMeta = { ...base, views: { list: [], form: 'auto', search: [] } };
    const groups = formGroups(entity);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.map((f) => f.name)).not.toContain('secret');
    expect(groups[0]).toHaveLength(fields.length - 1);
  });

  it('explicit groups keep order, skip unknown/hidden, and append leftovers', () => {
    const entity: EntityMeta = {
      ...base,
      views: { list: [], form: [['name', 'code', 'nope', 'secret'], ['qty']], search: [] },
    };
    const names = formGroups(entity).map((g) => g.map((f) => f.name));
    expect(names[0]).toEqual(['name', 'code']);
    expect(names[1]).toEqual(['qty']);
    expect(names[2]).toEqual([
      'notes',
      'amount',
      'active',
      'since',
      'seenAt',
      'status',
      'partnerId',
      'attrs',
      'externalId',
    ]);
  });
});

describe('initialValues', () => {
  it('blank form: strings empty, bools false', () => {
    const v = initialValues(fields);
    expect(v.name).toBe('');
    expect(v.active).toBe(false);
    expect(v.attrs).toBe('');
  });

  it('from record: null -> "", numbers/decimals as strings, json pretty-printed', () => {
    const v = initialValues(fields, record);
    expect(v.qty).toBe('2');
    expect(v.amount).toBe('10'); // canonical, not "10.000000"
    expect(v.notes).toBe('');
    expect(v.active).toBe(true);
    expect(v.attrs).toBe(JSON.stringify({ x: 1 }, null, 2));
  });
});

describe('isFieldEditable (AC-4, AC-5)', () => {
  const code = fields[0] as FieldMeta;
  const name = fields[1] as FieldMeta;
  const seenAt = fields[7] as FieldMeta;
  it('timestamps are never editable', () => {
    expect(isFieldEditable(seenAt, { mode: 'create' })).toBe(false);
  });
  it('immutable fields lock on edit only', () => {
    expect(isFieldEditable(code, { mode: 'create' })).toBe(true);
    expect(isFieldEditable(code, { mode: 'update' })).toBe(false);
  });
  it('submitted documents allow only allowOnSubmit; cancelled are frozen', () => {
    expect(isFieldEditable(name, { mode: 'update', docstatus: 1, allowOnSubmit: ['notes'] })).toBe(false);
    expect(isFieldEditable(fields[2] as FieldMeta, { mode: 'update', docstatus: 1, allowOnSubmit: ['notes'] })).toBe(
      true,
    );
    expect(isFieldEditable(name, { mode: 'update', docstatus: 2 })).toBe(false);
    expect(isFieldEditable(name, { mode: 'update', docstatus: 0 })).toBe(true);
  });
});

describe('toPayload (AC-4)', () => {
  it('create: omits empties, converts int, keeps decimal as string, parses json', () => {
    const { payload, errors } = toPayload(
      {
        name: ' Acme ',
        qty: '12',
        amount: '1,5'.replace(',', '.'),
        active: true,
        attrs: '{"a":1}',
        notes: '',
        since: '',
        seenAt: 'x',
      },
      fields,
      'create',
    );
    expect(errors).toEqual({});
    expect(payload).toEqual({ name: 'Acme', qty: 12, amount: '1.5', active: true, attrs: { a: 1 } });
    expect(typeof payload.amount).toBe('string');
  });

  it('update: empties become null, bools always sent', () => {
    const { payload } = toPayload({ notes: '', qty: '', active: false }, fields, 'update');
    expect(payload).toEqual({ notes: null, qty: null, active: false });
  });

  it('reports client-side conversion errors per field', () => {
    const { payload, errors } = toPayload({ qty: '1.5', amount: 'abc', attrs: '{oops' }, fields, 'create');
    expect(Object.keys(errors).sort()).toEqual(['amount', 'attrs', 'qty']);
    expect(payload).toEqual({});
  });

  it('never sends timestamps or hidden fields', () => {
    const { payload } = toPayload({ seenAt: '2026-01-01T00:00:00Z', secret: 'x' }, fields, 'update');
    expect(payload).toEqual({});
  });
});

describe('normalizeDecimalString', () => {
  it('drops trailing zeros and leading zeros, keeps sign', () => {
    expect(normalizeDecimalString('10.000000')).toBe('10');
    expect(normalizeDecimalString('0010.50')).toBe('10.5');
    expect(normalizeDecimalString('-0.0')).toBe('0');
    expect(normalizeDecimalString('-1.20')).toBe('-1.2');
    expect(normalizeDecimalString('.5')).toBe('0.5');
    expect(normalizeDecimalString('abc')).toBe('abc');
  });
});

describe('diffPatch (AC-7 keeps patches minimal)', () => {
  it('only changed fields; decimals compared canonically; immutable unchanged fields dropped', () => {
    const { payload } = toPayload(
      { code: 'P-1', name: 'Acme Inc', amount: '10', qty: '2', active: true, attrs: '{"x":1}' },
      fields,
      'update',
    );
    expect(diffPatch(payload, record, fields)).toEqual({ name: 'Acme Inc' });
  });
  it('null vs missing counts as unchanged', () => {
    expect(diffPatch({ notes: null, partnerId: null }, record, fields)).toEqual({});
  });
});

describe('issuesToFieldErrors (AC-4)', () => {
  const names = fields.map((f) => f.name);
  it('maps plain and patch-prefixed paths to fields', () => {
    const r = issuesToFieldErrors(
      [
        { path: 'name', message: 'required' },
        { path: 'patch.qty', message: 'too big' },
        { path: 'attrs.x', message: 'bad' },
      ],
      names,
    );
    expect(r.fieldErrors).toEqual({ name: 'required', qty: 'too big', attrs: 'bad' });
    expect(r.formErrors).toEqual([]);
  });
  it('unknown paths go to formErrors and duplicates concatenate', () => {
    const r = issuesToFieldErrors(
      [
        { path: 'where.foo', message: 'unknown field' },
        { path: '', message: 'boom' },
        { path: 'name', message: 'a' },
        { path: 'name', message: 'b' },
      ],
      names,
    );
    expect(r.formErrors).toEqual(['where.foo: unknown field', 'boom']);
    expect(r.fieldErrors.name).toBe('a; b');
  });
});
