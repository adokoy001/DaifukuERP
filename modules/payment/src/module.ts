// Module manifest (docs/conventions/layers.md). The dependency modules are imported first so `partner`, `account`,
// `journal_entry`, `sales_invoice` and `purchase_invoice` are registered before our entities/hooks reference them.
import { defineModule, label, registry } from '@daifuku/kernel';
import { AccountingModule } from '@daifuku/mod-accounting';
import { PartnerModule } from '@daifuku/mod-partner';
import { PurchaseModule } from '@daifuku/mod-purchase';
import { SalesModule } from '@daifuku/mod-sales';
import { outstandingAction } from './actions/outstanding.ts';
import { PaymentAllocation } from './entities/payment-allocation.ts';
import { Payment } from './entities/payment.ts';
import { registerCancelHook } from './hooks/cancel.ts';
import { registerLineHooks } from './hooks/lines.ts';
import { registerSubmitHooks } from './hooks/submit.ts';
import { registerValidateHooks } from './hooks/validate.ts';
import { PAYMENT_SETTING_DEFS } from './settings.ts';

export const PaymentModule = defineModule({
  name: 'payment',
  label: label('入出金', 'Payments'),
  depends: [PartnerModule.name, AccountingModule.name, SalesModule.name, PurchaseModule.name],
  entities: [Payment, PaymentAllocation],
  actions: [outstandingAction],
  hooks: () => {
    registerValidateHooks();
    registerLineHooks();
    registerSubmitHooks();
    registerCancelHook();
    for (const def of PAYMENT_SETTING_DEFS) registry.registerSetting(def);
  },
  menus: [
    { label: label('入出金', 'Payments'), entity: Payment.name, order: 60 },
    { label: label('未消込請求書', 'Outstanding invoices'), route: `/r/${outstandingAction.name}`, order: 61 },
  ],
});
