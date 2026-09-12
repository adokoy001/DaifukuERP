import { describe, expect, it } from 'vitest';
import type { EntityMeta, FieldMeta, RecordJson, TableResult } from '../api/types.ts';
import { formFingerprint } from './dirty.ts';
import { initialValues, isFieldEditable, toPayload } from './form.ts';
import { rowsToPayload } from './lines.ts';
import { productDefaults } from './product-fill.ts';
import { planSave } from './save.ts';
import { switchSchemaMode } from './schema-mode.ts';
import { tableToCsv } from './csv.ts';
import { lineLockReason } from './line-lock.ts';
import { parseTaxSummary, percentRate } from './tax-summary.ts';

const field = (name: string, kind: string, extra: Partial<FieldMeta> = {}): FieldMeta => ({ name, kind, label: { ja: name, en: name }, required: false, hasDefault: false, immutable: false, hidden: false, ...extra });

describe('UI refresh input contract', () => {
  it('shows literal defaults without replacing existing false/null values', () => {
    const fields = [field('active', 'bool', { hasDefault: true, defaultValue: true }), field('taxCategory', 'enum', { defaultValue: 'standard' }), field('taxes', 'json', { defaultValue: [] })];
    expect(initialValues(fields)).toEqual({ active: true, taxCategory: 'standard', taxes: '[]' });
    expect(initialValues(fields, { active: false, taxCategory: null, taxes: null })).toEqual({ active: false, taxCategory: '', taxes: '' });
    expect(toPayload(initialValues(fields), fields, 'create').payload.active).toBe(true);
  });
  it('never requires or sends computed fields, even when a client supplied a value', () => {
    const fields = [field('name', 'text', { required: true }), field('taxes', 'json', { required: true, serverOwned: true }), field('balance', 'decimal', { required: true, readOnly: true })];
    const entity = { name: 'invoice', fields, extFields: [] } as unknown as EntityMeta;
    const plan = planSave({ entity, mode: 'create', record: undefined, values: { name: 'Invoice', taxes: 'broken JSON', balance: '0' }, specs: [], lines: {}, originalLines: {}, requiredMessage: 'required' });
    expect(plan.hasErrors).toBe(false);
    expect(plan.body).toEqual({ name: 'Invoice' });
    expect(rowsToPayload([{ key: 'a', values: { name: 'line', taxes: 'broken JSON' } }], fields).errors).toEqual({});
    for (const f of fields.slice(1)) expect(isFieldEditable(f, { mode: 'update', docstatus: 1, allowOnSubmit: [f.name] })).toBe(false);
  });
  it('compares unsaved rows by values/order, not regenerated UI row keys', () => {
    const original = { key: 'r1', id: 'line1', values: { quantity: '2' } };
    const before = [original];
    expect(formFingerprint({}, { lines: before })).toBe(formFingerprint({}, { lines: [{ ...original, key: 'r99' }] }));
    expect(formFingerprint({}, { lines: before })).not.toBe(formFingerprint({}, { lines: [{ ...original, values: { quantity: '3' } }] }));
    expect(formFingerprint({ name: 'changed' }, {})).not.toBe(formFingerprint({ name: 'saved' }, {}));
  });
});

describe('product selection', () => {
  const product: RecordJson = { id: 'p1', name: '商品', salePrice: '100.123456', purchasePrice: '80', taxCategory: 'standard', uomId: 'u1', tenantId: 't', companyId: 'c', createdAt: '', updatedAt: '', createdBy: null, updatedBy: null, version: 1 };
  const columns = [field('description', 'text'), field('unitPrice', 'decimal'), field('taxCategory', 'enum'), field('uomId', 'ref')];
  it('fills the displayed invoice cells using exact Decimal strings', () => {
    expect(productDefaults(product, columns, false)).toEqual({ description: '商品', unitPrice: '100.123456', taxCategory: 'standard', uomId: 'u1' });
    expect(productDefaults(product, columns, true).unitPrice).toBe('80');
  });
  it('does not invent prices or overwrite server-owned cells', () => {
    expect(productDefaults({ ...product, salePrice: null }, [...columns, field('amount', 'decimal', { serverOwned: true })], false)).not.toHaveProperty('unitPrice');
    expect(productDefaults(product, [field('description', 'text', { serverOwned: true })], false)).toEqual({});
  });
});

describe('schema mode switching', () => {
  const fields = [{ name: 'title', kind: 'text' as const, label: { ja: '題名', en: 'Title' }, required: true }];
  it('round-trips unsaved changes in both directions and retains unknown JSON keys', () => {
    const json = switchSchemaMode({ values: { title: 'new value' }, errors: {}, json: '{"title":"old","extra":true}', jsonMode: false }, fields);
    expect(JSON.parse(json.json)).toEqual({ title: 'new value', extra: true });
    const form = switchSchemaMode({ ...json, json: '{"title":"edited JSON","extra":true}' }, fields);
    expect(form.values.title).toBe('edited JSON');
    expect(switchSchemaMode(form, fields).json).toContain('"extra": true');
  });
  it('blocks the switch for malformed JSON or invalid required form values', () => {
    const state = { values: { title: '' }, errors: {}, json: '{', jsonMode: true };
    expect(switchSchemaMode(state, fields).jsonMode).toBe(true);
    expect(switchSchemaMode(state, fields).errors._json).toBeDefined();
    expect(switchSchemaMode({ ...state, jsonMode: false }, fields).jsonMode).toBe(false);
    expect(switchSchemaMode({ ...state, jsonMode: false }, fields).errors.title).toBeDefined();
  });
});

describe('CSV formula safety', () => {
  it('escapes dangerous textual prefixes, preserves genuine negative decimal amounts', () => {
    const result: TableResult = { title: { ja: '', en: '' }, columns: [{ key: 'name', kind: 'text', label: { ja: '=HEADER', en: 'Name' } }, { key: 'amount', kind: 'decimal', label: { ja: '金額', en: 'Amount' } }], rows: [{ name: '=1+1', amount: '-123.45' }, { name: '\t@SUM(A1)', amount: '=1+1' }, { name: '-text', amount: '+100' }] };
    const csv = tableToCsv(result, 'ja', '合計');
    expect(csv).toContain("'=HEADER");
    expect(csv).toContain("'=1+1,-123.45");
    expect(csv).toContain("'\t@SUM(A1),'=1+1");
    expect(csv).toContain("'-text,+100");
  });
});

describe('saved invoice display', () => {
  it('distinguishes temporary save locks from frozen documents and viewing permissions', () => {
    const state = { canWrite: true, saving: false, actionBusy: false, conflict: false, frozen: false };
    expect(lineLockReason(state)).toBeUndefined();
    expect(lineLockReason({ ...state, saving: true })?.ja).toContain('保存中');
    expect(lineLockReason({ ...state, frozen: true })?.ja).toContain('確定済み');
    expect(lineLockReason({ ...state, canWrite: false })?.ja).toContain('閲覧モード');
    expect(lineLockReason({ ...state, conflict: true })?.ja).toContain('競合');
  });
  it('preserves the server tax figures and renders rates exactly without recalculation', () => {
    const rows = [{ category: 'reduced', label: '軽減8%', rate: '0.08', taxable: '12345678901234.5', tax: '987654312098', gross: '13333333213332.5' }];
    expect(parseTaxSummary(JSON.stringify(rows))).toEqual(rows);
    expect(percentRate('0.08')).toBe('8%');
    expect(percentRate('0.075001')).toBe('7.5001%');
    expect(percentRate('0')).toBe('0%');
    expect(parseTaxSummary('[]')).toEqual([]);
    expect(parseTaxSummary('[{"category":"standard","tax":"bad"}]')).toBeUndefined();
    expect(parseTaxSummary('{')).toBeUndefined();
  });
});
