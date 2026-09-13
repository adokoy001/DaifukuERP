// 導入テンプレート「小売」 (docs/specs/pack-retail.md; docs/conventions/packs.md). Adds only what a small food retailer needs on
// top of the modules: the daily register closing (sales + stock issue + cash receipt from one document) and the month-end
// 三分法 inventory transfer. The modules are imported first so every entity the pack extends, references or relabels is
// registered before the pack's own definitions (definePack checks depends and targets at import time).
import { definePack, f, label, registry } from '@daifuku/kernel';
import { JapanModule } from '@daifuku/l10n-jp';
import { AccountingModule } from '@daifuku/mod-accounting';
import { InventoryModule } from '@daifuku/mod-inventory';
import { PartnerModule } from '@daifuku/mod-partner';
import { PaymentModule } from '@daifuku/mod-payment';
import { ProductModule } from '@daifuku/mod-product';
import { PurchaseModule } from '@daifuku/mod-purchase';
import { SalesModule } from '@daifuku/mod-sales';
import { TaxModule } from '@daifuku/mod-tax';
import { closeMonthAction, registerMonthCloseGuards } from './actions/close-month.ts';
import { dailySalesAction } from './actions/daily-sales.ts';
import { RetailClosingLine } from './entities/retail-closing-line.ts';
import { RetailClosing } from './entities/retail-closing.ts';
import { RetailMonthClose } from './entities/retail-month-close.ts';
import { registerCancelHooks } from './hooks/cancel.ts';
import { registerLineHooks } from './hooks/lines.ts';
import { registerRecalcHooks } from './hooks/recalc.ts';
import { registerSubmitHooks } from './hooks/submit.ts';
import { sampleRetail } from './sample.ts';
import { RETAIL_KINDS, seedRetail } from './seed.ts';
import { CLOSING_ACCOUNTS_SETTING, RETAIL_SETTING_DEFAULTS } from './settings.ts';

export const RetailPack = definePack({
  name: 'retail',
  label: label('小売', 'Retail'),
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
  ext: {
    product: {
      jan: f.text({ label: label('JANコード', 'JAN code'), searchable: true, maxLength: 13 }),
      supplierCode: f.text({ label: label('仕入先品番', 'Supplier item code'), maxLength: 50 }),
      shelf: f.text({ label: label('棚番', 'Shelf'), maxLength: 20 }),
    },
    partner: {
      retailKind: f.enum(RETAIL_KINDS, {
        label: label('小売区分', 'Retail kind'),
        labels: {
          walk_in: label('店頭客', 'Walk-in customer'),
          card_company: label('カード会社', 'Card company'),
          wholesaler: label('仕入先（卸）', 'Wholesaler'),
        },
      }),
    },
  },
  entities: [RetailClosing, RetailClosingLine, RetailMonthClose],
  actions: [dailySalesAction, closeMonthAction],
  hooks: () => {
    registry.registerSetting(CLOSING_ACCOUNTS_SETTING);
    registerRecalcHooks();
    registerLineHooks();
    registerSubmitHooks();
    registerCancelHooks();
    registerMonthCloseGuards();
  },
  settings: RETAIL_SETTING_DEFAULTS,
  labels: {
    sales_invoice: { entity: label('売上（店頭/掛）', 'Sales (register / credit)') },
    partner: { entity: label('取引先（店頭客・仕入先）', 'Partners (walk-in / suppliers)') },
  },
  menus: [
    { label: label('レジ締め', 'Register closings'), entity: RetailClosing.name, order: 45 },
    { label: label('日次売上', 'Daily sales'), route: `/r/${dailySalesAction.name}`, order: 46 },
    { label: label('月次締め', 'Month closes'), entity: RetailMonthClose.name, order: 47 },
  ],
  seed: seedRetail,
  sample: sampleRetail,
});
