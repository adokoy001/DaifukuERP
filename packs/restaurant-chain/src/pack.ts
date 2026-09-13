import { definePack, label, registerStoreAccess } from '@daifuku/kernel';
import { JapanModule } from '@daifuku/l10n-jp';
import { AccountingModule } from '@daifuku/mod-accounting';
import { InventoryModule } from '@daifuku/mod-inventory';
import { PartnerModule } from '@daifuku/mod-partner';
import { PaymentModule } from '@daifuku/mod-payment';
import { ProductModule } from '@daifuku/mod-product';
import { PurchaseModule } from '@daifuku/mod-purchase';
import { SalesModule } from '@daifuku/mod-sales';
import { TaxModule } from '@daifuku/mod-tax';
import { RestaurantDayPlan } from './entities/day-plan.ts';
import { registerDayPlanHooks } from './hooks/day-plan.ts';
import { registerReviewFreeze } from './hooks/review-freeze.ts';
import { submitForReviewAction, reviewClosingAction, finalizeClosingAction } from './actions/review.ts';
import { planDaysAction, recordDayStatusAction } from './actions/planning.ts';
import { operationsSnapshotAction, operationsSourcesAction } from './actions/operations.ts';
import { settlementEvidenceAction } from './actions/settlement-evidence.ts';
import { dailySummaryAction } from './actions/daily-summary.ts';
import { RestaurantStore } from './entities/store.ts';
import { RestaurantRecipe } from './entities/recipe.ts';
import { RecipeIngredient } from './entities/recipe-ingredient.ts';
import { RestaurantClosing } from './entities/closing.ts';
import { RestaurantClosingLine } from './entities/closing-line.ts';
import { RestaurantWasteLine } from './entities/waste-line.ts';
import { registerRecipeHooks } from './hooks/recipe.ts';
import { registerClosingLineHooks } from './hooks/lines.ts';
import { registerRecalcHooks } from './hooks/recalc.ts';
import { registerSubmitHooks } from './hooks/submit.ts';
import { registerCancelHooks } from './hooks/cancel.ts';
import { seedRestaurantChain } from './seed.ts';
import { sampleRestaurantChain } from './sample.ts';

export const RestaurantChainPack = definePack({
  name: 'restaurant_chain',
  label: label('飲食店（チェーン）', 'Restaurant chain'),
  version: '0.1.0',
  depends: [
    PartnerModule.name,
    ProductModule.name,
    TaxModule.name,
    AccountingModule.name,
    SalesModule.name,
    PurchaseModule.name,
    PaymentModule.name,
    InventoryModule.name,
    JapanModule.name,
  ],
  entities: [
    RestaurantDayPlan,
    RestaurantStore,
    RestaurantRecipe,
    RecipeIngredient,
    RestaurantClosing,
    RestaurantClosingLine,
    RestaurantWasteLine,
  ],
  actions: [
    operationsSnapshotAction,
    operationsSourcesAction,
    settlementEvidenceAction,
    dailySummaryAction,
    submitForReviewAction,
    reviewClosingAction,
    finalizeClosingAction,
    planDaysAction,
    recordDayStatusAction,
  ],
  hooks: () => {
    for (const name of ['product', 'uom', 'tax_rate']) registerStoreAccess(name, { kind: 'sharedRead' });
    registerReviewFreeze();
    registerDayPlanHooks();
    registerRecipeHooks();
    registerClosingLineHooks();
    registerRecalcHooks();
    registerSubmitHooks();
    registerCancelHooks();
  },
  menus: [
    { label: label('チェーン運営ボード', 'Chain operations'), route: '/operations', order: 48 },
    { label: label('営業予定・目標', 'Day plans and targets'), entity: RestaurantDayPlan.name, order: 49 },
    { label: label('店舗・厨房', 'Stores and kitchens'), entity: RestaurantStore.name, order: 50 },
    { label: label('メニュー・レシピ', 'Menus and recipes'), entity: RestaurantRecipe.name, order: 51 },
    { label: label('店舗の日次締め', 'Daily closings'), entity: RestaurantClosing.name, order: 52 },
    { label: label('店舗別日次集計', 'Daily restaurant summary'), route: `/r/${dailySummaryAction.name}`, order: 53 },
  ],
  seed: seedRestaurantChain,
  sample: sampleRestaurantChain,
});
