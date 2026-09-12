// Module manifest (docs/conventions/layers.md). Depends on nothing but the kernel.
import { defineModule, label } from '@daifuku/kernel';
import { resolvePrice } from './actions/resolve-price.ts';
import { Product } from './entities/product.ts';
import { Uom } from './entities/uom.ts';
import { registerProductHooks } from './hooks/default-uom.ts';
import { seedProducts } from './seeds/products.ts';

export const ProductModule = defineModule({
  name: 'product',
  label: label('品目', 'Product'),
  depends: [],
  entities: [Uom, Product],
  actions: [resolvePrice],
  hooks: registerProductHooks,
  // seedProducts seeds the standard units first, so this covers AC-1 and AC-9.
  seed: seedProducts,
  menus: [
    { label: label('品目', 'Products'), entity: 'product', order: 20 },
    { label: label('単位', 'Units of measure'), entity: 'uom', order: 21 },
  ],
  roles: {
    viewer: label('閲覧', 'Viewer'),
    sales: label('販売', 'Sales'),
    purchasing: label('購買', 'Purchasing'),
  },
});
