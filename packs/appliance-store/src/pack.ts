import { definePack, f, label } from '@daifuku/kernel';
import { AccountingModule } from '@daifuku/mod-accounting';
import { ContractModule } from '@daifuku/mod-contract';
import { InventoryModule } from '@daifuku/mod-inventory';
import { PartnerModule } from '@daifuku/mod-partner';
import { PaymentModule } from '@daifuku/mod-payment';
import { ProductModule } from '@daifuku/mod-product';
import { PurchaseModule } from '@daifuku/mod-purchase';
import { SalesModule } from '@daifuku/mod-sales';
import { TaxModule } from '@daifuku/mod-tax';
import { JapanModule } from '@daifuku/l10n-jp';
import { invoiceServiceAction } from './actions/invoice.ts';
import { openServicesAction } from './actions/open-services.ts';
import { completeServiceAction, startServiceAction } from './actions/workflow.ts';
import { ApplianceDevice } from './entities/device.ts';
import { ApplianceService } from './entities/service.ts';
import { ApplianceServiceLine } from './entities/service-line.ts';
import { registerApplianceHooks } from './hooks.ts';
import { sampleApplianceStore } from './sample.ts';
import { seedApplianceStore } from './seed.ts';

export const ApplianceStorePack = definePack({
  name: 'appliance_store', label: label('電器店', 'Appliance store'), version: '0.1.0',
  depends: [PartnerModule.name, ProductModule.name, TaxModule.name, AccountingModule.name, SalesModule.name, PurchaseModule.name, PaymentModule.name, InventoryModule.name, ContractModule.name, JapanModule.name],
  ext: { product: {
    applianceManufacturer: f.text({ label: label('家電メーカー', 'Appliance manufacturer'), maxLength: 100, searchable: true }),
    applianceModel: f.text({ label: label('家電型番', 'Appliance model'), maxLength: 100, searchable: true }),
    applianceWarrantyMonths: f.int({ label: label('標準保証月数（記録）', 'Recorded warranty months'), min: 0, max: 120 }),
  } },
  entities: [ApplianceDevice, ApplianceService, ApplianceServiceLine],
  actions: [startServiceAction, completeServiceAction, invoiceServiceAction, openServicesAction],
  hooks: registerApplianceHooks,
  settings: { 'inventory.auto_issue_on_sales': true, 'inventory.auto_receipt_on_purchase': true, 'inventory.allow_negative_stock': false },
  menus: [
    { label: label('顧客の家電', 'Customer appliances'), entity: ApplianceDevice.name, order: 100 },
    { label: label('設置・修理受付', 'Service reception'), entity: ApplianceService.name, order: 101 },
    { label: label('未完了・請求待ち', 'Open service jobs'), route: '/r/appliance_store.open_services', order: 102 },
    { label: label('作業を開始', 'Start work'), route: '/a/appliance_store.start_service', order: 103 },
    { label: label('作業完了を記録', 'Complete work'), route: '/a/appliance_store.complete_service', order: 104 },
    { label: label('作業の請求書を発行', 'Invoice service work'), route: '/a/appliance_store.invoice_service', order: 105 },
    { label: label('家電・作業商品', 'Appliances and services'), entity: 'product', order: 106 },
    { label: label('家電の仕入', 'Appliance purchases'), entity: 'purchase_invoice', order: 107 },
    { label: label('保守契約', 'Maintenance contracts'), entity: 'contract', order: 108 },
  ],
  seed: seedApplianceStore, sample: sampleApplianceStore,
});
