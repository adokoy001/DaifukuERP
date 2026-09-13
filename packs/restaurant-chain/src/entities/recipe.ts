import { defineDocument, f, label } from '@daifuku/kernel';

export const RestaurantRecipe = defineDocument({
  name: 'restaurant_chain_recipe',
  label: label('メニュー・レシピ', 'Menu recipes'),
  naming: { type: 'sequence', prefix: 'RCP-', period: 'year' },
  fields: {
    code: f.text({
      label: label('レシピコード・版', 'Recipe code / revision'),
      required: true,
      index: true,
      immutable: true,
      maxLength: 40,
    }),
    name: f.text({ label: label('メニュー名', 'Menu name'), required: true, maxLength: 100 }),
    productId: f.ref('product', { label: label('販売品目（サービス）', 'Menu product (service)'), required: true }),
    unitPrice: f.money({ label: label('税込標準単価', 'Default price incl. tax'), required: true, min: '0' }),
    alcohol: f.bool({ label: label('酒類', 'Alcohol'), required: true, default: false }),
    note: f.text({ label: label('備考', 'Notes'), multiline: true, maxLength: 1000 }),
  },
  displayField: 'name',
  lines: [{ entity: 'restaurant_chain_recipe_ingredient', parentField: 'recipeId' }],
  storeAccess: { kind: 'sharedRead' },
  permissions: {
    roles: {
      chain_staff: ['read', 'export'],
      chain_manager: ['read', 'export'],
      inventory: ['read', 'export', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'],
      sales: ['read', 'export'],
      accounting: ['read', 'export'],
      viewer: ['read', 'export'],
    },
  },
  views: {
    list: ['code', 'name', 'unitPrice', 'alcohol'],
    search: ['code', 'name'],
    form: [['code', 'name'], ['productId', 'unitPrice', 'alcohol'], ['note']],
  },
});
