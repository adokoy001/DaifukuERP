// @daifuku/mod-product public API. Importing this module registers its entities, action, hooks and seed.
export { ProductModule } from './module.ts';
export { Uom } from './entities/uom.ts';
export { Product, PRODUCT_KINDS, TAX_CATEGORIES, type ProductKind, type TaxCategory } from './entities/product.ts';
export { resolvePrice, resolvePriceInput, resolvePriceOutput, PRICE_SIDES, type PriceSide } from './actions/resolve-price.ts';
export { seedUoms, findUomByCode, STANDARD_UOMS, DEFAULT_UOM_CODE, type StandardUom } from './seeds/uoms.ts';
export { seedProducts, SAMPLE_PRODUCTS } from './seeds/products.ts';

export { fillLineUom } from './line-uom.ts';
