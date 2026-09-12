// Module manifest (docs/conventions/layers.md). The dependency modules are imported first so that `partner`, `product`,
// `tax_rate` and `sales_invoice` are registered before the contract entities reference them.
import { defineModule, label } from '@daifuku/kernel';
import { PartnerModule } from '@daifuku/mod-partner';
import { ProductModule } from '@daifuku/mod-product';
import { TaxModule } from '@daifuku/mod-tax';
import { SalesModule } from '@daifuku/mod-sales';
import { Contract } from './entities/contract.ts';
import { ContractLine } from './entities/contract-line.ts';
import { ContractBilling } from './entities/contract-billing.ts';
import { endContractAction } from './actions/end.ts';
import { generateInvoicesAction } from './actions/generate-invoices.ts';
import { scheduleAction } from './actions/schedule.ts';
import { registerBillingHooks } from './hooks/billing.ts';
import { registerCancelHook } from './hooks/cancel.ts';
import { registerLineHooks } from './hooks/lines.ts';
import { registerRecalcHooks } from './hooks/recalc.ts';
import { registerSubmitHook } from './hooks/submit.ts';
import { registerContractSettings } from './settings.ts';

export const ContractModule = defineModule({
  name: 'contract',
  label: label('契約', 'Contracts'),
  depends: [PartnerModule.name, ProductModule.name, TaxModule.name, SalesModule.name],
  entities: [Contract, ContractLine, ContractBilling],
  actions: [generateInvoicesAction, endContractAction, scheduleAction],
  hooks: () => {
    registerRecalcHooks();
    registerLineHooks();
    registerSubmitHook();
    registerCancelHook();
    registerBillingHooks();
    registerContractSettings();
  },
  menus: [
    { label: label('契約一覧', 'Contracts'), entity: Contract.name, order: 45 },
    { label: label('請求予定', 'Billing schedule'), route: `/r/${scheduleAction.name}`, order: 46 },
  ],
  roles: { sales: label('販売', 'Sales') },
});
