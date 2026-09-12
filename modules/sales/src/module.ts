// Module manifest (docs/conventions/layers.md). The dependency modules are imported first so that `partner`,
// `product`, `tax_rate` and `journal_entry` are registered before the invoice entities reference them.
import { SalesSettlement } from './entities/settlement.ts';
import { registerSettlementHooks } from './settlements.ts';
import { defineModule, label } from '@daifuku/kernel';
import { PartnerModule } from '@daifuku/mod-partner';
import { ProductModule } from '@daifuku/mod-product';
import { TaxModule } from '@daifuku/mod-tax';
import { AccountingModule } from '@daifuku/mod-accounting';
import { arAgingAction } from './actions/ar-aging.ts';
import { recordPaymentAction } from './actions/record-payment.ts';
import { renderInvoiceHtmlAction } from './actions/render-invoice-html.ts';
import { SalesInvoice } from './entities/sales-invoice.ts';
import { SalesInvoiceLine } from './entities/sales-invoice-line.ts';
import { registerCancelHook } from './hooks/cancel.ts';
import { registerLineHooks } from './hooks/lines.ts';
import { registerRecalcHooks } from './hooks/recalc.ts';
import { registerSubmitHooks } from './hooks/submit.ts';
import { registerSalesSettings } from './settings.ts';

export const SalesModule = defineModule({
  name: 'sales',
  label: label('販売', 'Sales'),
  depends: [PartnerModule.name, ProductModule.name, TaxModule.name, AccountingModule.name],
  entities: [SalesSettlement, SalesInvoice, SalesInvoiceLine],
  actions: [renderInvoiceHtmlAction, arAgingAction, recordPaymentAction],
  hooks: () => {
    registerSettlementHooks();
    registerRecalcHooks();
    registerLineHooks();
    registerSubmitHooks();
    registerCancelHook();
    registerSalesSettings();
  },
  menus: [
    { label: label('売上請求書', 'Sales invoices'), entity: SalesInvoice.name, order: 40 },
    { label: label('売掛金年齢表', 'AR aging'), route: `/r/${arAgingAction.name}`, order: 41 },
  ],
  roles: { sales: label('販売', 'Sales') },
});
