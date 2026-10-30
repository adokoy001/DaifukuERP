// docs/specs/settings-console.md AC-8..AC-12 (pure parts): tabs and order, schema -> form fields with `fields`
// presentation, defaults and history text.
import { describe, expect, it } from 'vitest';
import type { JsonSchema, SettingChange, SettingMeta } from '../api/types.ts';
import { schemaFields, toFieldMeta } from './schema.ts';
import {
  actorText,
  canReset,
  changeRows,
  opLabel,
  resolveTab,
  SC,
  settingForm,
  settingFormValue,
  settingPayload,
  settingsInTab,
  settingTabs,
  valueParts,
  valueText,
} from './settings-console.ts';

const noRefs = () => undefined;
const accountsSchema: JsonSchema = {
  type: 'object',
  properties: {
    receivable: { type: 'string', minLength: 1 },
    revenue: { type: 'string', minLength: 1 },
    taxPayable: { type: 'string', minLength: 1 },
  },
  required: ['receivable', 'revenue', 'taxPayable'],
};

function setting(partial: Partial<SettingMeta> & Pick<SettingMeta, 'key'>): SettingMeta {
  return {
    label: { ja: partial.key, en: partial.key },
    schema: { type: 'boolean' },
    value: null,
    category: 'system',
    isDefault: true,
    ...partial,
  };
}

const salesAccounts = setting({
  key: 'sales.accounts',
  label: { ja: '売上転記の勘定科目', en: 'Sales posting accounts' },
  category: 'sales',
  order: 20,
  schema: accountsSchema,
  defaultValue: { receivable: '1300', revenue: '4000', taxPayable: '2200' },
  fields: {
    receivable: { label: { ja: '売掛金', en: 'Accounts receivable' }, widget: 'account-code' },
    revenue: {
      label: { ja: '売上高', en: 'Revenue' },
      description: { ja: '売上の計上先', en: 'Where sales post' },
      widget: 'account-code',
    },
  },
});

describe('settings-console AC-8: tabs and order', () => {
  const list = [
    setting({ key: 'packs.applied', category: 'system' }),
    salesAccounts,
    setting({
      key: 'sales.issuer',
      label: { ja: '請求書の発行者', en: 'Invoice issuer' },
      category: 'sales',
      order: 10,
    }),
    setting({ key: 'tax.rounding', category: 'tax', order: 10 }),
    setting({ key: 'wholesale.due_days', label: { ja: '卸売の日数', en: 'Wholesale days' }, category: 'industry' }),
    setting({ key: 'beauty_salon.due_days', label: { ja: '美容の日数', en: 'Salon days' }, category: 'industry' }),
    setting({ key: 'future.thing', category: 'future' }),
  ];

  it('AC-8: only categories with settings, in the kernel order; an unknown category comes last under its id', () => {
    expect(settingTabs(list).map((tab) => [tab.id, tab.label.ja, tab.count])).toEqual([
      ['tax', '消費税', 1],
      ['sales', '販売', 2],
      ['industry', '業界', 2],
      ['system', 'システム', 1],
      ['future', 'future', 1],
    ]);
  });

  it('AC-8: ?tab= selects a shown tab; a missing or unknown tab falls back to the first', () => {
    const tabs = settingTabs(list);
    expect(resolveTab('industry', tabs)).toBe('industry');
    expect(resolveTab(undefined, tabs)).toBe('tax');
    expect(resolveTab('workforce', tabs)).toBe('tax');
    expect(resolveTab('x', [])).toBeUndefined();
  });

  it('AC-8: inside a tab by order, then by the label in the current language', () => {
    expect(settingsInTab(list, 'sales', 'ja').map((s) => s.key)).toEqual(['sales.issuer', 'sales.accounts']);
    // No order: by label — "卸売" before "美容" in Japanese collation, "Salon" before "Wholesale" in English.
    expect(settingsInTab(list, 'industry', 'ja').map((s) => s.key)).toEqual([
      'wholesale.due_days',
      'beauty_salon.due_days',
    ]);
    expect(settingsInTab(list, 'industry', 'en').map((s) => s.key)).toEqual([
      'beauty_salon.due_days',
      'wholesale.due_days',
    ]);
  });
});

describe('settings-console AC-9: field labels from `fields`', () => {
  it('AC-9: labels, help and widgets come from fields; a property without an entry keeps the humanised name', () => {
    const fields = schemaFields(accountsSchema, noRefs, salesAccounts.fields);
    expect(fields.map((f) => f.label)).toEqual([
      { ja: '売掛金', en: 'Accounts receivable' },
      { ja: '売上高', en: 'Revenue' },
      { ja: 'Tax Payable', en: 'Tax Payable' },
    ]);
    expect(fields[1]).toMatchObject({ kind: 'text', widget: 'account-code', help: { ja: '売上の計上先' } });
    expect(fields.map(toFieldMeta)[1]?.description).toEqual({ ja: '売上の計上先', en: 'Where sales post' });
  });

  it('AC-9: enum value labels and textarea reach the field widgets; a code widget is never a ref or date by name', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['half_up', 'down'] },
        address: { type: 'string' },
        partnerId: { type: 'string' },
      },
    };
    const refs = (name: string) => (name === 'partner' ? { displayField: 'name' } : undefined);
    const fields = schemaFields(schema, refs, {
      mode: { label: { ja: '端数', en: 'Mode' }, valueLabels: { down: { ja: '切捨て', en: 'Round down' } } },
      address: { label: { ja: '住所', en: 'Address' }, widget: 'textarea' },
      partnerId: { label: { ja: '倉庫', en: 'Warehouse' }, widget: 'warehouse-code' },
    });
    const metas = fields.map(toFieldMeta);
    expect(metas[0]?.valueLabels?.down).toEqual({ ja: '切捨て', en: 'Round down' });
    expect(metas[1]?.multiline).toBe(true);
    expect(metas[2]).toMatchObject({ kind: 'text' });
    expect(metas[2]?.ref).toBeUndefined();
  });
});

describe('settings-console AC-10/AC-11: form modes and the default', () => {
  it('AC-10: a single boolean, enum, integer or code value becomes one field labelled with the setting', () => {
    const flag = setting({ key: 'inventory.allow_negative_stock', label: { ja: 'マイナス在庫', en: 'Negative' } });
    expect(settingForm(flag, noRefs)).toMatchObject({
      mode: 'scalar',
      fields: [{ name: 'value', kind: 'bool', label: { ja: 'マイナス在庫' }, required: false }],
    });
    const rank = setting({
      key: 'example.rank',
      schema: { type: 'string', enum: ['A', 'B'] },
      valueLabels: { A: { ja: '重点', en: 'Key' } },
    });
    expect(settingForm(rank, noRefs).fields[0]).toMatchObject({ kind: 'enum', values: ['A', 'B'] });
    expect(settingForm(rank, noRefs).fields[0]?.valueLabels?.A).toEqual({ ja: '重点', en: 'Key' });
    const days = setting({ key: 'wholesale.due_days', schema: { type: 'integer', minimum: 0 } });
    expect(settingForm(days, noRefs).fields[0]).toMatchObject({ kind: 'int', required: true });
    const warehouse = setting({
      key: 'inventory.default_warehouse',
      schema: { type: 'string' },
      widget: 'warehouse-code',
    });
    expect(settingForm(warehouse, noRefs).fields[0]).toMatchObject({ kind: 'text', widget: 'warehouse-code' });
  });

  it('AC-10: objects render per property; records stay raw JSON', () => {
    expect(settingForm(salesAccounts, noRefs).mode).toBe('object');
    const record = setting({
      key: 'packs.applied',
      schema: { type: 'object', additionalProperties: { type: 'object' } },
    });
    expect(settingForm(record, noRefs)).toEqual({ mode: 'json', fields: [] });
  });

  it('AC-11: reset is offered for a stored value, but not for a raw-JSON record without a default (packs.applied)', () => {
    expect(canReset(salesAccounts, 'object')).toBe(false);
    expect(canReset({ ...salesAccounts, isDefault: false }, 'object')).toBe(true);
    const issuer = setting({ key: 'sales.issuer', schema: accountsSchema, isDefault: false });
    expect(canReset(issuer, 'object')).toBe(true);
    const record = setting({ key: 'packs.applied', schema: { type: 'object' }, isDefault: false });
    expect(canReset(record, 'json')).toBe(false);
    expect(canReset({ ...record, defaultValue: {} }, 'json')).toBe(true);
  });

  it('AC-11: the form starts from the stored value, else the module default; a single value is unwrapped to PUT', () => {
    expect(settingFormValue(salesAccounts, 'object')).toEqual({
      receivable: '1300',
      revenue: '4000',
      taxPayable: '2200',
    });
    const stored = {
      ...salesAccounts,
      value: { receivable: '1310', revenue: '4000', taxPayable: '2200' },
      isDefault: false,
    };
    expect(settingFormValue(stored, 'object')).toEqual(stored.value);
    const flag = setting({ key: 'contract.auto_submit', defaultValue: false });
    expect(settingFormValue(flag, 'scalar')).toEqual({ value: false });
    expect(settingFormValue({ ...flag, value: true, isDefault: false }, 'scalar')).toEqual({ value: true });
    expect(settingPayload('scalar', { value: true })).toBe(true);
    expect(settingPayload('object', { a: 1 })).toEqual({ a: 1 });
  });

  it('AC-11: the default reads as labelled parts in the current language', () => {
    expect(valueText(salesAccounts, salesAccounts.defaultValue, 'ja')).toBe(
      '売掛金 1300、売上高 4000、taxPayable 2200',
    );
    expect(valueText(salesAccounts, salesAccounts.defaultValue, 'en')).toBe(
      'Accounts receivable 1300, Revenue 4000, taxPayable 2200',
    );
    const flag = setting({ key: 'inventory.auto_issue_on_sales' });
    expect(valueText(flag, true, 'ja')).toBe('はい');
    expect(valueText(flag, false, 'en')).toBe('No');
    const rule = setting({
      key: 'contract.default_proration',
      schema: { type: 'string', enum: ['daily', 'none'] },
      valueLabels: { daily: { ja: '日割り', en: 'Daily' } },
    });
    expect(valueParts(rule, 'daily', 'ja')).toEqual([{ name: 'value', label: '', text: '日割り' }]);
    expect(valueText(rule, null, 'ja')).toBe(SC.notSet.ja);
  });
});

describe('settings-console AC-12: history entries', () => {
  const base: SettingChange = {
    id: 'a1',
    at: '2026-10-29T01:02:03.000Z',
    op: 'update',
    actorType: 'user',
    actorId: '0192f3a4-0000-7000-8000-000000000001',
    actorName: '管理者',
    onBehalfOf: null,
    onBehalfOfName: null,
    action: null,
    before: { receivable: '1300', revenue: '4000', taxPayable: '2200' },
    after: { receivable: '1300', revenue: '4100', taxPayable: '2200' },
  };

  it('AC-12: an object change lists only the changed properties with their labels', () => {
    expect(changeRows(salesAccounts, base, 'ja')).toEqual([{ label: '売上高', before: '4000', after: '4100' }]);
  });

  it('AC-12: the first save and a reset show every property against "not set"', () => {
    const first = changeRows(salesAccounts, { ...base, before: null }, 'ja');
    expect(first.map((r) => [r.label, r.before, r.after])).toEqual([
      ['売掛金', '未設定', '1300'],
      ['売上高', '未設定', '4100'],
      ['taxPayable', '未設定', '2200'],
    ]);
    const reset = changeRows(salesAccounts, { ...base, op: 'delete', after: null }, 'en');
    expect(reset[1]).toEqual({ label: 'Revenue', before: '4000', after: 'Not set' });
    expect(opLabel('delete')).toEqual(SC.opDelete);
    expect(opLabel('update')).toEqual(SC.opUpdate);
  });

  it('AC-12: a single value change is one row; booleans read yes/no', () => {
    const flag = setting({ key: 'contract.auto_submit' });
    expect(changeRows(flag, { ...base, before: false, after: true }, 'ja')).toEqual([
      { label: '', before: 'いいえ', after: 'はい' },
    ]);
  });

  it('AC-12: the actor is the user name; unknown actors show type and a short id; agents name the user', () => {
    expect(actorText(base, 'ja')).toBe('管理者');
    expect(actorText({ ...base, actorName: null }, 'en')).toBe('user:0192f3a4…');
    expect(
      actorText(
        { ...base, actorType: 'agent', actorId: 'mcp', actorName: null, onBehalfOf: 'u1', onBehalfOfName: '佐藤' },
        'ja',
      ),
    ).toBe('agent:mcp（佐藤 の代理）');
    expect(
      actorText(
        { ...base, actorType: 'agent', actorId: 'mcp', actorName: null, onBehalfOf: 'u1', onBehalfOfName: 'Sato' },
        'en',
      ),
    ).toBe('agent:mcp (for Sato)');
  });
});
