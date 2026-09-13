import { defineModule, label } from '@daifuku/kernel';
import { PartnerModule } from '@daifuku/mod-partner';
import { ProductModule } from '@daifuku/mod-product';
import { TaxModule } from '@daifuku/mod-tax';
import { SalesModule } from '@daifuku/mod-sales';
import { AccountingModule } from '@daifuku/mod-accounting';
import { PaymentModule } from '@daifuku/mod-payment';
import { InventoryModule } from '@daifuku/mod-inventory';

// Shared engine; industry-owned documents are defined only when their pack is loaded.
export const IndustryOperationsModule = defineModule({
  name: 'industry_operations',
  label: label('業界の履行案件基盤', 'Industry fulfillment engine'),
  depends: [
    PartnerModule.name,
    ProductModule.name,
    TaxModule.name,
    SalesModule.name,
    AccountingModule.name,
    PaymentModule.name,
    InventoryModule.name,
  ],
  entities: [],
  actions: [],
});
