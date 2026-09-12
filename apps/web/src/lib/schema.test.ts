import { describe, expect, it } from 'vitest';
import type { JsonSchema } from '../api/types.ts';
import { refResolverFrom, schemaFields, schemaInitialValues, schemaToPayload, stripSettingKey, toFieldMeta, toSnake } from './schema.ts';

const refOf = (name: string) => (name === 'partner' ? { displayField: 'name' } : name === 'fiscal_year' ? { displayField: undefined } : undefined);

const reportInput: JsonSchema = {
  type: 'object',
  properties: {
    from: { type: 'string' },
    to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    partnerId: { type: 'string', format: 'uuid' },
    fiscalYearId: { type: 'string', format: 'uuid' },
    accountId: { type: 'string', format: 'uuid' },
    defaultPartnerId: { type: 'string', format: 'uuid' },
    userId: { type: 'string' },
    kind: { type: 'string', enum: ['a', 'b'], default: 'a', description: 'which' },
    limit: { type: 'integer', minimum: 1, default: 100 },
    ratio: { type: 'number' },
    includeZero: { type: 'boolean', default: false },
    note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    dueDate: { type: ['string', 'null'] },
    filters: { type: 'object', properties: { x: { type: 'string' } } },
  },
  required: ['from', 'to', 'kind', 'limit'],
};

describe('AC-3/AC-5 schemaFields', () => {
  const fields = schemaFields(reportInput, refOf);
  const byName = new Map(fields.map((f) => [f.name, f] as const));

  it('maps types: date by name/pattern, ref-by-name for known entities, enum, int, number, bool, nullable unwrap, json fallback', () => {
    expect(byName.get('from')?.kind).toBe('date');
    expect(byName.get('to')?.kind).toBe('date');
    expect(byName.get('dueDate')?.kind).toBe('date');
    expect(byName.get('partnerId')).toMatchObject({ kind: 'ref', ref: 'partner', refDisplayField: 'name' });
    expect(byName.get('fiscalYearId')).toMatchObject({ kind: 'ref', ref: 'fiscal_year' });
    expect(byName.get('fiscalYearId')?.refDisplayField).toBeUndefined();
    expect(byName.get('accountId')?.kind).toBe('text'); // unknown entity: plain text
    expect(byName.get('defaultPartnerId')).toMatchObject({ kind: 'ref', ref: 'partner', refDisplayField: 'name' }); // qualified prefix
    expect(byName.get('userId')?.kind).toBe('text');
    expect(byName.get('kind')).toMatchObject({ kind: 'enum', values: ['a', 'b'], default: 'a', description: 'which', required: false });
    expect(byName.get('limit')).toMatchObject({ kind: 'int', default: 100 });
    expect(byName.get('ratio')?.kind).toBe('number');
    expect(byName.get('includeZero')).toMatchObject({ kind: 'bool', default: false });
    expect(byName.get('note')?.kind).toBe('text');
    expect(byName.get('filters')?.kind).toBe('json');
  });

  it('required = listed in `required` and without a default; labels are humanised', () => {
    expect(byName.get('from')?.required).toBe(true);
    expect(byName.get('limit')?.required).toBe(false);
    expect(byName.get('includeZero')?.label).toEqual({ ja: 'Include Zero', en: 'Include Zero' });
    expect(schemaFields({ type: 'string' }, refOf)).toEqual([]);
    expect(schemaFields(undefined, refOf)).toEqual([]);
  });

  it('toFieldMeta adapts to the entity widgets', () => {
    expect(toFieldMeta(byName.get('partnerId') ?? fields[0] ?? { name: 'x', kind: 'text', label: { ja: '', en: '' }, required: false })).toMatchObject({ kind: 'ref', ref: 'partner', refDisplayField: 'name', hasDefault: false });
    expect(toFieldMeta(byName.get('ratio') ?? fields[0] ?? { name: 'x', kind: 'text', label: { ja: '', en: '' }, required: false }).kind).toBe('decimal');
    expect(toSnake('fiscalYear')).toBe('fiscal_year');
  });

  it('initial values come from defaults, overridden by a stored value; payload omits empties, converts numbers, flags required', () => {
    const initial = schemaInitialValues(fields);
    expect(initial).toMatchObject({ from: '', kind: 'a', limit: '100', includeZero: false, ratio: '' });
    const stored = schemaInitialValues(fields, { kind: 'b', includeZero: true, filters: { x: 1 } });
    expect(stored).toMatchObject({ kind: 'b', includeZero: true, filters: '{\n  "x": 1\n}' });
    const { payload, errors } = schemaToPayload({ ...initial, from: '2026-01-01', ratio: '0.5', limit: '10' }, fields);
    expect(payload).toEqual({ from: '2026-01-01', kind: 'a', limit: 10, ratio: 0.5, includeZero: false });
    expect(errors).toEqual({ to: 'required' });
    expect(schemaToPayload({ ...initial, from: 'x', to: 'y', limit: '1.5' }, fields).errors).toEqual({ limit: 'integer expected' });
  });
});

describe('AC-5 setting issue paths / AC-3 ref resolver', () => {
  it('stripSettingKey drops the `<key>.` prefix so issues land on the form field', () => {
    expect(
      stripSettingKey(
        [
          { path: 'tax.rounding.mode', message: 'bad' },
          { path: 'tax.rounding', message: 'whole' },
          { path: 'other', message: 'x' },
        ],
        'tax.rounding',
      ),
    ).toEqual([
      { path: 'mode', message: 'bad' },
      { path: '', message: 'whole' },
      { path: 'other', message: 'x' },
    ]);
  });

  it('refResolverFrom resolves entities visible in /meta with their display field', () => {
    const refOf2 = refResolverFrom([{ name: 'partner', displayField: 'name' } as never, { name: 'account', displayField: undefined } as never]);
    expect(refOf2('partner')).toEqual({ displayField: 'name' });
    expect(refOf2('account')).toEqual({ displayField: undefined });
    expect(refOf2('nope')).toBeUndefined();
    expect(refResolverFrom(undefined)('partner')).toBeUndefined();
  });
});
