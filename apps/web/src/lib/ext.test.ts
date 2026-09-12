import { describe, expect, it } from 'vitest';
import type { EntityMeta, FieldMeta, RecordJson } from '../api/types.ts';
import { extFieldsOf, extInitialValues, extKey, extPayload, fieldValue, isExtFieldEditable, isExtFieldName, listColumns } from './ext.ts';
import { initialValues, issuesToFieldErrors } from './form.ts';
import { planSave } from './save.ts';

const L = (ja: string, en: string) => ({ ja, en });
function field(name: string, kind: string, extra: Partial<FieldMeta> = {}): FieldMeta {
  return { name, kind, label: L(name, name), required: false, hasDefault: false, hidden: false, immutable: false, ...extra };
}

const extFields: FieldMeta[] = [
  field('ext.rank', 'enum', { values: ['a', 'b'], source: 'pack-demo' }),
  field('ext.creditLimit', 'decimal', { money: true, scale: 0 }),
  field('ext.jan', 'text', { required: true, searchable: true }),
  field('ext.vip', 'bool'),
  field('ext.secret', 'text', { hidden: true }),
];
const partner: EntityMeta = {
  name: 'partner',
  kind: 'entity',
  label: L('取引先', 'Partner'),
  module: 'partner',
  scope: 'company',
  displayField: 'name',
  hasExt: true,
  fields: [field('code', 'text', { immutable: true }), field('name', 'text', { required: true })],
  extFields,
  views: { list: ['code', 'name', 'ext.rank', 'ext.unknown', 'ext.creditLimit'], form: 'auto', search: ['name'] },
  ops: ['read', 'create', 'update'],
};
const visibleExt = extFieldsOf(partner);
const record: RecordJson = {
  id: 'p1',
  tenantId: 't',
  companyId: 'c',
  createdAt: '',
  updatedAt: '',
  createdBy: null,
  updatedBy: null,
  version: 2,
  code: 'C-1',
  name: 'Acme',
  ext: { rank: 'a', creditLimit: '100000.5', jan: '4901234567894', vip: true, legacyNote: 'free-form (ADR-0003)' },
};

describe('AC-3 ext field names, values and list columns', () => {
  it('ext.<key> names, keys and the rendered subset', () => {
    expect(isExtFieldName('ext.rank')).toBe(true);
    expect(isExtFieldName('ext.')).toBe(false);
    expect(isExtFieldName('extra')).toBe(false);
    expect(extKey('ext.creditLimit')).toBe('creditLimit');
    expect(visibleExt.map((f) => f.name)).toEqual(['ext.rank', 'ext.creditLimit', 'ext.jan', 'ext.vip']);
    const { extFields: _e, ...olderApi } = partner;
    expect(extFieldsOf(olderApi)).toEqual([]);
  });

  it('fieldValue reads row.ext[key] for ext fields and row[name] otherwise', () => {
    expect(fieldValue(record, { name: 'ext.rank' })).toBe('a');
    expect(fieldValue(record, { name: 'name' })).toBe('Acme');
    expect(fieldValue({ ...record, ext: null }, { name: 'ext.rank' })).toBeUndefined();
    expect(fieldValue({ ...record, ext: ['x'] }, { name: 'ext.rank' })).toBeUndefined();
  });

  it('views.list names that are ext fields become columns; unknown names are skipped', () => {
    expect(listColumns(partner).map((f) => f.name)).toEqual(['code', 'name', 'ext.rank', 'ext.creditLimit']);
  });
});

describe('AC-3 ext form mapping (values read/written at row.ext[key])', () => {
  it('initial values come from record.ext through the same conversions as entity fields', () => {
    expect(extInitialValues(visibleExt, record)).toEqual({ 'ext.rank': 'a', 'ext.creditLimit': '100000.5', 'ext.jan': '4901234567894', 'ext.vip': true });
    expect(extInitialValues(visibleExt)).toEqual({ 'ext.rank': '', 'ext.creditLimit': '', 'ext.jan': '', 'ext.vip': false });
    expect(extInitialValues([], record)).toEqual({});
  });

  it('create: entered values become ext (decimal canonical string), empties omitted, required ext enforced', () => {
    const values = { 'ext.rank': 'b', 'ext.creditLimit': '2000.50', 'ext.jan': '', 'ext.vip': false };
    const r = extPayload({ values, fields: visibleExt, mode: 'create', requiredMessage: 'required' });
    expect(r.ext).toEqual({ rank: 'b', creditLimit: '2000.5', vip: false });
    expect(r.errors).toEqual({ 'ext.jan': 'required' });
    const blank = extPayload({ values: { 'ext.rank': '', 'ext.creditLimit': '', 'ext.jan': '' }, fields: visibleExt, mode: 'create', requiredMessage: 'required' });
    expect(blank.ext).toBeUndefined();
    expect(blank.errors).toEqual({ 'ext.jan': 'required' });
  });

  it('update: untouched ext is not re-sent (decimals compared canonically)', () => {
    const values = { ...extInitialValues(visibleExt, record), 'ext.creditLimit': '100000.50' };
    expect(extPayload({ values, fields: visibleExt, mode: 'update', record, requiredMessage: 'required' })).toEqual({ ext: undefined, errors: {} });
  });

  it('update: a change sends the whole ext, keeping unrendered keys and dropping emptied ones', () => {
    const values = { ...extInitialValues(visibleExt, record), 'ext.rank': '', 'ext.creditLimit': '5' };
    const r = extPayload({ values, fields: visibleExt, mode: 'update', record, requiredMessage: 'required' });
    expect(r.ext).toEqual({ creditLimit: '5', jan: '4901234567894', vip: true, legacyNote: 'free-form (ADR-0003)' });
    expect(r.errors).toEqual({});
    const cleared = extPayload({ values: { ...values, 'ext.jan': ' ' }, fields: visibleExt, mode: 'update', record, requiredMessage: 'required' });
    expect(cleared.errors).toEqual({ 'ext.jan': 'required' });
  });

  it('client conversion errors are reported on the ext field', () => {
    const r = extPayload({ values: { 'ext.creditLimit': 'abc', 'ext.jan': 'x' }, fields: visibleExt, mode: 'create', requiredMessage: 'required' });
    expect(r.errors).toEqual({ 'ext.creditLimit': 'number expected' });
  });

  it('server issues on ext.<key> (also under patch.) land on that field; unknown ext keys stay form errors', () => {
    const names = [...partner.fields, ...visibleExt].map((f) => f.name);
    const r = issuesToFieldErrors(
      [
        { path: 'ext.jan', message: 'Invalid' },
        { path: 'patch.ext.rank', message: 'Invalid option' },
        { path: 'ext.nope', message: 'x' },
        { path: 'patch.name', message: 'required' },
      ],
      names,
    );
    expect(r.fieldErrors).toEqual({ 'ext.jan': 'Invalid', 'ext.rank': 'Invalid option', name: 'required' });
    expect(r.formErrors).toEqual(['ext.nope: x']);
  });

  it('submitted documents: ext fields follow allowOnSubmit ("ext" unlocks all of them)', () => {
    const f = visibleExt[0] as FieldMeta;
    expect(isExtFieldEditable(f, { mode: 'update', docstatus: 1, allowOnSubmit: ['note'] })).toBe(false);
    expect(isExtFieldEditable(f, { mode: 'update', docstatus: 1, allowOnSubmit: ['ext'] })).toBe(true);
    expect(isExtFieldEditable(f, { mode: 'update', docstatus: 0 })).toBe(true);
  });
});

describe('AC-3 planSave carries ext in the same request', () => {
  const base = { entity: partner, specs: [], lines: {}, originalLines: {}, requiredMessage: 'required' };
  it('create body has ext next to the entity fields', () => {
    const values = { ...initialValues(partner.fields), name: 'New', ...extInitialValues(visibleExt), 'ext.jan': '490', 'ext.rank': 'a' };
    const plan = planSave({ ...base, mode: 'create', record: undefined, values });
    expect(plan.hasErrors).toBe(false);
    expect(plan.body).toEqual({ name: 'New', ext: { rank: 'a', jan: '490', vip: false } });
  });
  it('update patch has ext only when an ext value changed', () => {
    const values = { ...initialValues(partner.fields, record), ...extInitialValues(visibleExt, record) };
    expect(planSave({ ...base, mode: 'update', record, values }).empty).toBe(true);
    const plan = planSave({ ...base, mode: 'update', record, values: { ...values, 'ext.vip': false } });
    expect(plan.body).toEqual({ patch: { ext: { rank: 'a', creditLimit: '100000.5', jan: '4901234567894', vip: false, legacyNote: 'free-form (ADR-0003)' } }, expectedVersion: 2 });
  });
});
