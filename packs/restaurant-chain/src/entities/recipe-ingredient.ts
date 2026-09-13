import { defineEntity, f, label } from '@daifuku/kernel';

export const RecipeIngredient = defineEntity({
  name: 'restaurant_chain_recipe_ingredient',
  label: label('1食分の材料', 'Ingredients per serving'),
  fields: {
    recipeId: f.ref('restaurant_chain_recipe', {
      label: label('レシピ', 'Recipe'),
      required: true,
      onDelete: 'cascade',
    }),
    seq: f.int({ label: label('順番', 'Sequence'), required: true, default: 1, min: 1 }),
    productId: f.ref('product', { label: label('材料（物品）', 'Ingredient (goods)'), required: true }),
    quantity: f.quantity({
      label: label('1食分の基準単位数量', 'Base units per serving'),
      required: true,
      min: '0.000001',
    }),
  },
  storeAccess: { kind: 'sharedRead' },
  permissions: {
    roles: {
      chain_staff: ['read', 'export'],
      chain_manager: ['read', 'export'],
      inventory: ['read', 'export', 'create', 'update', 'delete'],
      sales: ['read', 'export'],
      accounting: ['read', 'export'],
      viewer: ['read', 'export'],
    },
  },
  views: { list: ['seq', 'productId', 'quantity'] },
});
