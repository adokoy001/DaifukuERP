import { describe, expect, expectTypeOf, it } from 'vitest';
import { Decimal } from '../src/decimal.ts';
import type { Infer, InsertInput } from '../src/dsl/entity.ts';
import { registry } from '../src/registry.ts';
import { toHalfwidthKana } from '../src/normalize.ts';
import { TMemo, TPartner } from './fixtures/entities.ts';

describe('entity DSL (ADR-0002)', () => {
  it('AC-1 infers row and insert types without codegen', () => {
    type Row = Infer<typeof TPartner>;
    expectTypeOf<Row['name']>().toEqualTypeOf<string>();
    expectTypeOf<Row['nameKana']>().toEqualTypeOf<string | null>();
    expectTypeOf<Row['kind']>().toEqualTypeOf<'customer' | 'supplier' | 'both'>();
    expectTypeOf<Row['creditLimit']>().toEqualTypeOf<Decimal | null>();
    expectTypeOf<Row['id']>().toEqualTypeOf<string>();
    expectTypeOf<Row['version']>().toEqualTypeOf<number>();
    type Memo = Infer<typeof TMemo>;
    expectTypeOf<Memo['docstatus']>().toEqualTypeOf<0 | 1 | 2>();
    expectTypeOf<Memo['amount']>().toEqualTypeOf<Decimal>();
    type Ins = InsertInput<typeof TPartner>;
    expectTypeOf<Ins>().toHaveProperty('name');
    // kind has a default, so it is optional on insert
    expectTypeOf<Ins['kind']>().toEqualTypeOf<'customer' | 'supplier' | 'both' | null | undefined>();
  });

  it('AC-2 derives DB columns (snake_case) and system columns', () => {
    expect(TPartner.columnNames.nameKana).toBe('name_kana');
    expect(Object.keys(TPartner.columns)).toEqual(
      expect.arrayContaining(['id', 'tenantId', 'companyId', 'createdAt', 'version', 'ext', 'name']),
    );
    expect(Object.keys(TMemo.columns)).toEqual(expect.arrayContaining(['docstatus', 'number', 'amendedFrom']));
    expect(TPartner.displayField).toBe('name');
  });

  it('AC-3 derives zod insert schema: required, defaults, decimal strings -> Decimal, normalisation', () => {
    const bad = TPartner.schemas.insert.safeParse({});
    expect(bad.success).toBe(false);
    const ok = TPartner.schemas.insert.safeParse({ name: 'ACME', creditLimit: '1000.50', nameKana: 'ｶﾌﾞｼｷｶﾞｲｼｬ' });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.creditLimit).toBeInstanceOf(Decimal);
      expect(String(ok.data.creditLimit)).toBe('1000.5');
    }
    const float = TPartner.schemas.insert.safeParse({ name: 'X', creditLimit: 12.5 });
    expect(float.success).toBe(false);
    const kana = TPartner.schemas.insert.safeParse({ name: 'X', nameKana: 'カブシキガイシャ　テスト' });
    expect(kana.success && kana.data.nameKana).toBe('ｶﾌﾞｼｷｶﾞｲｼｬ ﾃｽﾄ');
    const unknownField = TPartner.schemas.insert.safeParse({ name: 'X', nope: 1 });
    expect(unknownField.success).toBe(false);
  });

  it('AC-4 registers entities, actions and module in the registry', () => {
    expect(registry.entity('test_partner').module).toBe('test');
    expect(registry.action('test.echo').module).toBe('test');
    expect(registry.module('test').entities.map((e) => e.name)).toEqual([
      'test_partner',
      'test_memo',
      'test_memo_line',
    ]);
    expect(registry.hooksFor('test_partner', 'before_validate')).toHaveLength(1);
  });

  it('AC-5 rejects invalid definitions with actionable errors', async () => {
    const { defineEntity } = await import('../src/dsl/entity.ts');
    const { f } = await import('../src/dsl/fields.ts');
    expect(() =>
      defineEntity({ name: 'BadName', label: { ja: 'x', en: 'x' }, fields: {}, permissions: { roles: {} } }),
    ).toThrow(/snake_case/);
    expect(() =>
      defineEntity({
        name: 'x_reserved',
        label: { ja: 'x', en: 'x' },
        fields: { id: f.text() },
        permissions: { roles: {} },
      }),
    ).toThrow(/reserved/);
    expect(() =>
      defineEntity({ name: 'test_partner', label: { ja: 'x', en: 'x' }, fields: {}, permissions: { roles: {} } }),
    ).toThrow(/already registered/);
  });
});

describe('normalisation', () => {
  it('converts full-width kana and ASCII to half-width, hiragana to katakana', () => {
    expect(toHalfwidthKana('ガギグゲゴ')).toBe('ｶﾞｷﾞｸﾞｹﾞｺﾞ');
    expect(toHalfwidthKana('ぱぴぷ')).toBe('ﾊﾟﾋﾟﾌﾟ');
    expect(toHalfwidthKana('ＡＢＣ１２３')).toBe('ABC123');
    expect(toHalfwidthKana('ヴィーナス')).toBe('ｳﾞｨｰﾅｽ');
  });
});
