// docs/specs/settings-console.md AC-1..AC-3 (ADR-0027): presentation attributes of SettingDef, checked at registerSetting.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  defaultSettingCategory,
  label,
  registry,
  SETTING_CATEGORIES,
  settingCategory,
  settingShape,
  type SettingDef,
} from '../src/index.ts';

const accounts = z.object({ receivable: z.string().min(1), revenue: z.string().min(1), memo: z.string().optional() });
let n = 0;
const key = (prefix = 'presentation') => `${prefix}.s${++n}`;
const register = (def: Omit<SettingDef, 'key'> & { key?: string }) =>
  registry.registerSetting({ key: key(), ...def } as SettingDef);

describe('settings-console AC-1: SettingDef accepts category, order and fields', () => {
  it('AC-1: a definition with every presentation attribute registers and keeps them', () => {
    const k = key('sales');
    registry.registerSetting({
      key: k,
      label: label('売上科目', 'Sales accounts'),
      schema: accounts,
      default: { receivable: '1300', revenue: '4000' },
      category: 'accounting',
      order: 5,
      fields: {
        receivable: { label: label('売掛金', 'Receivable'), widget: 'account-code' },
        revenue: {
          label: label('売上高', 'Revenue'),
          description: label('売上の計上先', 'Where sales post'),
          widget: 'account-code',
        },
        memo: { label: label('メモ', 'Memo'), widget: 'textarea' },
      },
    });
    const def = registry.setting(k);
    expect(def).toMatchObject({ category: 'accounting', order: 5 });
    expect(Object.keys(def.fields ?? {})).toEqual(['receivable', 'revenue', 'memo']);
    expect(settingCategory(def)).toBe('accounting');
  });

  it('AC-1: scalar settings take a widget and enum value labels instead of fields', () => {
    expect(() =>
      register({ label: label('倉庫', 'Warehouse'), schema: z.string().min(1), widget: 'warehouse-code' }),
    ).not.toThrow();
    expect(() =>
      register({
        label: label('ランク', 'Rank'),
        schema: z.enum(['A', 'B']),
        valueLabels: { A: label('重点', 'Key'), B: label('通常', 'Normal') },
      }),
    ).not.toThrow();
  });

  it('AC-1: the categories are the eleven tabs in display order', () => {
    expect(SETTING_CATEGORIES).toEqual([
      'company',
      'accounting',
      'tax',
      'sales',
      'purchase',
      'inventory',
      'contract',
      'workforce',
      'industry',
      'integration',
      'system',
    ]);
  });
});

describe('settings-console AC-2: definition errors at registration', () => {
  it('AC-2: a field name that is not a property of the object schema is refused', () => {
    expect(() =>
      register({
        label: label('科目', 'Accounts'),
        schema: accounts,
        fields: { payable: { label: label('買', 'P') } },
      }),
    ).toThrow(/fields\.payable is not a property of the schema \(properties: receivable, revenue, memo\)/);
  });

  it('AC-2: fields on a schema that is not an object (scalar or record) are refused', () => {
    expect(() =>
      register({
        label: label('日数', 'Days'),
        schema: z.number().int(),
        fields: { days: { label: label('日', 'D') } },
      }),
    ).toThrow(/fields are only for object schemas/);
    expect(() =>
      register({
        label: label('記録', 'Record'),
        schema: z.record(z.string(), z.string()),
        fields: { any: { label: label('任意', 'Any') } },
      }),
    ).toThrow(/fields are only for object schemas/);
  });

  it('AC-2: a field label without both languages, an unknown widget or a widget on a non-string is refused', () => {
    expect(() =>
      register({
        label: label('科目', 'Accounts'),
        schema: accounts,
        fields: { receivable: { label: { ja: '売掛金', en: '' } } },
      }),
    ).toThrow(/fields\.receivable: label must have non-empty ja and en/);
    expect(() =>
      register({
        label: label('科目', 'Accounts'),
        schema: accounts,
        fields: { receivable: { label: label('売掛金', 'AR'), widget: 'color' as never } },
      }),
    ).toThrow(/unknown widget "color"/);
    expect(() =>
      register({
        label: label('数', 'Count'),
        schema: z.object({ count: z.number() }),
        fields: { count: { label: label('数', 'Count'), widget: 'account-code' } },
      }),
    ).toThrow(/widget "account-code" needs a plain string value/);
  });

  it('AC-2: a setting description without both languages is refused (like labels and field descriptions)', () => {
    expect(() =>
      register({ label: label('a', 'a'), description: { ja: '説明', en: '' }, schema: z.boolean() }),
    ).toThrow(/description must have non-empty ja and en text/);
    expect(() =>
      register({ label: label('a', 'a'), description: { ja: ' ', en: 'Text' }, schema: z.boolean() }),
    ).toThrow(/description must have non-empty ja and en text/);
    expect(() =>
      register({ label: label('a', 'a'), description: label('説明', 'Text'), schema: z.boolean() }),
    ).not.toThrow();
  });

  it('AC-2: fields / widget on a nullable (top-level union) setting are refused: the console renders it as raw JSON', () => {
    expect(() =>
      register({
        label: label('科目', 'Accounts'),
        schema: accounts.nullable(),
        fields: { receivable: { label: label('売掛金', 'AR'), widget: 'account-code' } },
      }),
    ).toThrow(/fields are only for object schemas/);
    expect(() =>
      register({
        label: label('ランク', 'Rank'),
        schema: z.enum(['A', 'B']).nullable(),
        valueLabels: { A: label('重点', 'Key') },
      }),
    ).toThrow(/widget\/valueLabels describe a single value/);
    // A nullable string is `type: ["string", "null"]` (no union), which the console renders as one string field.
    expect(() =>
      register({ label: label('倉庫', 'Warehouse'), schema: z.string().nullable(), widget: 'warehouse-code' }),
    ).not.toThrow();
  });

  it('AC-2: value labels must name enum values; widget/valueLabels on an object schema are refused', () => {
    expect(() =>
      register({ label: label('ランク', 'Rank'), schema: z.enum(['A', 'B']), valueLabels: { Z: label('Z', 'Z') } }),
    ).toThrow(/valueLabels has "Z", which is not one of A, B/);
    expect(() => register({ label: label('科目', 'Accounts'), schema: accounts, widget: 'textarea' })).toThrow(
      /use fields for object schemas/,
    );
  });

  it('AC-2: an unknown category, a fractional order or a default the schema rejects is refused', () => {
    expect(() => register({ label: label('x', 'x'), schema: z.boolean(), category: 'billing' as never })).toThrow(
      /unknown category "billing"/,
    );
    expect(() => register({ label: label('x', 'x'), schema: z.boolean(), order: 1.5 })).toThrow(
      /order must be an integer/,
    );
    expect(() => register({ label: label('x', 'x'), schema: z.boolean(), default: 'yes' as never })).toThrow(
      /default does not match the schema/,
    );
  });

  it('AC-2: a refused definition is not registered (the key stays free)', () => {
    const k = key();
    expect(() =>
      registry.registerSetting({ key: k, label: label('x', 'x'), schema: z.boolean(), order: 0.5 }),
    ).toThrow();
    expect(registry.hasSetting(k)).toBe(false);
  });
});

describe('settings-console AC-3: default category from the key prefix', () => {
  it.each([
    ['tax.rounding', 'tax'],
    ['sales.accounts', 'sales'],
    ['purchase.accounts', 'purchase'],
    ['payment.accounts', 'accounting'],
    ['accounting.closing', 'accounting'],
    ['inventory.default_warehouse', 'inventory'],
    ['contract.auto_submit', 'contract'],
    ['workforce.policy', 'workforce'],
    ['packs.applied', 'system'],
    ['company.profile', 'company'],
    ['retail.closing_accounts', 'industry'],
    ['wholesale.due_days', 'industry'],
    ['constructor.x', 'industry'],
  ] as const)('AC-3: %s -> %s', (k, category) => {
    expect(defaultSettingCategory(k)).toBe(category);
    expect(settingCategory({ key: k })).toBe(category);
  });

  it('AC-3: an explicit category wins over the prefix', () => {
    expect(settingCategory({ key: 'retail.closing_accounts', category: 'accounting' })).toBe('accounting');
  });
});

describe('settingShape (the JSON Schema view the console renders)', () => {
  it('objects list their properties with type and enum; nullable wrappers are removed', () => {
    expect(
      settingShape(z.object({ mode: z.enum(['a', 'b']).default('a'), note: z.string().nullable(), n: z.number() })),
    ).toEqual({
      kind: 'object',
      properties: { mode: { type: 'string', enum: ['a', 'b'] }, note: { type: 'string' }, n: { type: 'number' } },
    });
  });

  it('a union at the top level (nullable object or enum) is "other", as the console renders it as raw JSON', () => {
    expect(settingShape(accounts.nullable())).toEqual({ kind: 'other' });
    expect(settingShape(z.enum(['a', 'b']).nullable())).toEqual({ kind: 'other' });
    expect(settingShape(z.string().nullable())).toEqual({ kind: 'scalar', type: 'string' });
    expect(settingShape(z.union([z.string(), z.number()]))).toEqual({ kind: 'other' });
    // A default around an object keeps a plain `type: object`, so it is still an object.
    expect(settingShape(accounts.default({ receivable: '1', revenue: '2' }))).toMatchObject({ kind: 'object' });
  });

  it('scalars keep their type; records and arrays are "other"', () => {
    expect(settingShape(z.boolean())).toEqual({ kind: 'scalar', type: 'boolean' });
    expect(settingShape(z.enum(['x']))).toEqual({ kind: 'scalar', type: 'string', enum: ['x'] });
    expect(settingShape(z.record(z.string(), z.number()))).toEqual({ kind: 'other' });
    expect(settingShape(z.array(z.string()))).toEqual({ kind: 'other' });
  });
});
