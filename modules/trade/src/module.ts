import { defineModule, label } from '@daifuku/kernel';
import { InventoryModule } from '@daifuku/mod-inventory';
import { tradeEntities } from './entities.ts';
import * as actions from './actions.ts';
import { tradePrintActions } from './print.ts';
import { ensurePrintLayoutSettings } from '@daifuku/mod-print-layout';
import { registerPlanningHooks } from './planning.ts';
import { registerLifecycleHooks } from './lifecycle.ts';
import { registerPostingHooks } from './posting.ts';
export const TradeModule = defineModule({
  name: 'trade',
  label: label('商流', 'Trade workflow'),
  depends: [InventoryModule.name],
  entities: tradeEntities,
  actions: [...Object.values(actions), ...tradePrintActions],
  hooks: () => {
    registerPlanningHooks();
    registerLifecycleHooks();
    registerPostingHooks();
    ensurePrintLayoutSettings();
  },
  menus: [
    { label: label('見積書', 'Quotations'), entity: 'trade_quotation', order: 70 },
    { label: label('受発注書', 'Trade orders'), entity: 'trade_order', order: 71 },
  ],
});
