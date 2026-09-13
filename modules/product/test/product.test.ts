// Unit / property tests: DSL derivation and seed data shape (no database). docs/specs/product.md AC-4, AC-5, AC-7, AC-9.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Decimal, isDecimal, registry } from '@daifuku/kernel';
import {
  DEFAULT_UOM_CODE,
  Product,
  ProductModule,
  SAMPLE_PRODUCTS,
  STANDARD_UOMS,
  TAX_CATEGORIES,
  Uom,
  resolvePriceInput,
} from '../src/index.ts';

describe('product module registration', () => {
  it('registers uom, product and product.resolve_price under module "product"', () => {
    expect(ProductModule.depends).toEqual([]);
    expect(registry.module('product').entities.map((e) => e.name)).toEqual(['uom', 'product']);
    expect(registry.entity('product').module).toBe('product');
    expect(registry.entity('uom').module).toBe('product');
    expect(registry.action('product.resolve_price').module).toBe('product');
    expect(registry.action('product.resolve_price').mutates).toBe(false);
    expect(registry.hooksFor('product', 'before_validate')).toHaveLength(1);
  });

  it('AC-7 declares list/search/form views as specified', () => {
    expect(Product.config.views?.list).toEqual(['code', 'name', 'kind', 'taxCategory', 'salePrice']);
    expect(Product.config.views?.search).toEqual(['name', 'nameKana', 'code']);
    expect(Product.config.views?.form).toEqual([
      ['code', 'name', 'nameKana'],
      ['kind', 'taxCategory', 'uomId'],
      ['salePrice', 'purchasePrice'],
      ['isSold', 'isPurchased', 'isActive'],
      ['description'],
    ]);
    expect(Product.displayField).toBe('name');
    expect(Uom.displayField).toBe('name');
  });
});

describe('product insert schema', () => {
  const uomId = '0192a8b0-0000-7000-8000-000000000001';

  it('AC-5 accepts exactly the five tax categories', () => {
    for (const taxCategory of TAX_CATEGORIES)
      expect(Product.schemas.insert.safeParse({ name: 'x', uomId, taxCategory }).success).toBe(true);
    expect(TAX_CATEGORIES).toEqual(['standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope']);
    const bad = Product.schemas.insert.safeParse({ name: 'x', uomId, taxCategory: 'taxable' });
    expect(bad.success).toBe(false);
  });

  it('AC-4 converts decimal strings to Decimal and rejects negatives and JS floats', () => {
    const ok = Product.schemas.insert.safeParse({ name: 'x', uomId, salePrice: '1234.50', purchasePrice: '0' });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.salePrice).toBeInstanceOf(Decimal);
      expect(String(ok.data.salePrice)).toBe('1234.5');
      expect(String(ok.data.purchasePrice)).toBe('0');
    }
    expect(Product.schemas.insert.safeParse({ name: 'x', uomId, salePrice: '-1' }).success).toBe(false);
    expect(Product.schemas.insert.safeParse({ name: 'x', uomId, purchasePrice: '-0.000001' }).success).toBe(false);
    expect(Product.schemas.insert.safeParse({ name: 'x', uomId, salePrice: 12.5 }).success).toBe(false);
  });

  it('AC-4 [property] any non-negative decimal string is accepted verbatim; any negative one is rejected', () => {
    const digits = fc.stringMatching(/^[0-9]{1,14}(\.[0-9]{1,6})?$/);
    fc.assert(
      fc.property(digits, (s) => {
        const r = Product.schemas.insert.safeParse({ name: 'x', uomId, salePrice: s });
        return r.success && isDecimal(r.data.salePrice) && r.data.salePrice.eq(s);
      }),
    );
    fc.assert(
      fc.property(
        digits.filter((s) => !Decimal.from(s).isZero()),
        (s) => !Product.schemas.insert.safeParse({ name: 'x', uomId, salePrice: `-${s}` }).success,
      ),
    );
  });

  it('AC-7 normalises nameKana to half-width katakana', () => {
    const r = Product.schemas.insert.safeParse({ name: 'りんご', uomId, nameKana: 'りんご　ジュース' });
    expect(r.success && r.data.nameKana).toBe('ﾘﾝｺﾞ ｼﾞｭｰｽ');
  });
});

describe('resolve_price input and seed data', () => {
  it('AC-8 input requires a uuid productId and side sale|purchase', () => {
    expect(
      resolvePriceInput.safeParse({ productId: '0192a8b0-0000-7000-8000-000000000001', side: 'sale' }).success,
    ).toBe(true);
    expect(resolvePriceInput.safeParse({ productId: 'nope', side: 'sale' }).success).toBe(false);
    expect(
      resolvePriceInput.safeParse({ productId: '0192a8b0-0000-7000-8000-000000000001', side: 'buy' }).success,
    ).toBe(false);
  });

  it('AC-1 standard units are 個, 式, 時間, kg, 箱 with unique codes; the default unit is 個', () => {
    expect(STANDARD_UOMS.map((u) => u.name)).toEqual(['個', '式', '時間', 'kg', '箱']);
    expect(new Set(STANDARD_UOMS.map((u) => u.code)).size).toBe(5);
    for (const u of STANDARD_UOMS) expect(u.code.length).toBeLessThanOrEqual(10);
    expect(STANDARD_UOMS.find((u) => u.code === DEFAULT_UOM_CODE)?.name).toBe('個');
  });

  it('AC-9 sample products are a goods item, a service item and a reduced-rate food item using standard units', () => {
    expect(SAMPLE_PRODUCTS).toHaveLength(3);
    expect(SAMPLE_PRODUCTS.map((p) => [p.kind, p.taxCategory])).toEqual([
      ['goods', 'standard'],
      ['service', 'standard'],
      ['goods', 'reduced'],
    ]);
    const codes = new Set(STANDARD_UOMS.map((u) => u.code));
    for (const p of SAMPLE_PRODUCTS) expect(codes.has(p.uomCode)).toBe(true);
    expect(new Set(SAMPLE_PRODUCTS.map((p) => p.code)).size).toBe(3);
  });
});
