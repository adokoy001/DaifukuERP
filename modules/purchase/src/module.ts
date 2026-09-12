// Module manifest (docs/conventions/layers.md). The dependency modules are imported first so their entities (partner,
// product, account, journal_entry, tax_rate) are registered before ours reference them and `depends` is satisfied.
import { PurchaseSettlement } from './entities/settlement.ts';
import { registerSettlementHooks } from './settlements.ts';
import { defineModule, label, registry } from '@daifuku/kernel';
import { AccountingModule } from '@daifuku/mod-accounting';
import { PartnerModule } from '@daifuku/mod-partner';
import { ProductModule } from '@daifuku/mod-product';
import { TaxModule } from '@daifuku/mod-tax';
import { apAgingAction } from './actions/ap-aging.ts';
import { recordPaymentAction } from './actions/record-payment.ts';
import { PurchaseInvoice } from './entities/purchase-invoice.ts';
import { PurchaseInvoiceLine } from './entities/purchase-invoice-line.ts';
import { registerCancelHook } from './hooks/cancel.ts';
import { registerLineHooks } from './hooks/lines.ts';
import { registerRecalcHooks } from './hooks/recalc.ts';
import { registerSubmitHook } from './hooks/submit.ts';
import { PURCHASE_SETTING_DEFS } from './settings.ts';

export const PurchaseModule = defineModule({
  name: 'purchase',
  label: label('購買', 'Purchasing'),
  depends: [PartnerModule.name, ProductModule.name, TaxModule.name, AccountingModule.name],
  entities: [PurchaseSettlement, PurchaseInvoice, PurchaseInvoiceLine],
  actions: [apAgingAction, recordPaymentAction],
  hooks: () => {
    registerSettlementHooks();
    registerRecalcHooks();
    registerLineHooks();
    registerSubmitHook();
    registerCancelHook();
    for (const def of PURCHASE_SETTING_DEFS) registry.registerSetting(def);
  },
  menus: [
    { label: label('仕入請求書', 'Purchase invoices'), entity: PurchaseInvoice.name, order: 50 },
    { label: label('買掛金年齢表', 'AP aging'), route: `/r/${apAgingAction.name}`, order: 51 },
  ],
  roles: {
    purchasing: label('購買', 'Purchasing'),
    accounting: label('経理', 'Accounting'),
    viewer: label('閲覧者', 'Viewer'),
  },
});
