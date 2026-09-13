// 導入テンプレート「不動産（賃貸管理・自主管理）」(docs/specs/pack-real-estate.md; docs/conventions/packs.md; ADR-0015).
// The modules are imported first so they are registered before the ext/labels that target their entities; payment is
// imported for its settings and posting, l10n/jp for the chart of accounts (預り金 2500, 雑収入 4100) the actions post to.
import { definePack, f, label, registry } from '@daifuku/kernel';
import { AccountingModule } from '@daifuku/mod-accounting';
import { Contract, ContractModule } from '@daifuku/mod-contract';
import { PartnerModule } from '@daifuku/mod-partner';
import { PaymentModule } from '@daifuku/mod-payment';
import { ProductModule } from '@daifuku/mod-product';
import { SalesModule } from '@daifuku/mod-sales';
import { TaxModule } from '@daifuku/mod-tax';
import { JapanModule } from '@daifuku/l10n-jp';
import { arrearsAction } from './actions/arrears.ts';
import { moveInAction } from './actions/move-in.ts';
import { moveOutAction } from './actions/move-out.ts';
import { receiveDepositAction } from './actions/receive-deposit.ts';
import { rentRollAction } from './actions/rent-roll.ts';
import { returnDepositAction } from './actions/return-deposit.ts';
import { RealEstateDeposit } from './entities/deposit.ts';
import { RealEstateProperty } from './entities/property.ts';
import { RealEstateUnit } from './entities/unit.ts';
import { registerLeasePeriodHooks } from './hooks/lease-period.ts';
import { registerContractDefaultHooks } from './hooks/contract-defaults.ts';
import { registerDepositHooks } from './hooks/deposit.ts';
import { registerUnitStatusHooks } from './hooks/unit-status.ts';
import { sampleRealEstate } from './sample.ts';
import { seedRealEstate } from './seed.ts';
import { PACK_SETTING_DEFAULTS, REAL_ESTATE_ACCOUNTS_SETTING } from './settings.ts';

export const TENANT_KINDS = ['individual', 'corporate'] as const;

export const RealEstatePack = definePack({
  name: 'real_estate',
  label: label('賃貸管理（不動産）', 'Rental management (real estate)'),
  version: '0.1.0',
  depends: [
    PartnerModule.name,
    ProductModule.name,
    TaxModule.name,
    AccountingModule.name,
    SalesModule.name,
    PaymentModule.name,
    ContractModule.name,
    JapanModule.name,
  ],
  ext: {
    contract: {
      unitId: f.ref(RealEstateUnit.name, { label: label('部屋・区画', 'Unit') }),
      keyMoney: f.money({
        label: label('礼金', 'Key money'),
        description: label(
          '入居時に 1 回請求（返還しない）。住宅は非課税',
          'Billed once at move-in (not returned); non-taxable for housing',
        ),
        min: '0',
      }),
      depositMonths: f.decimal({
        label: label('敷金（月数）', 'Deposit (months)'),
        description: label(
          '敷金 = 月数 × 月額賃料。返還するので不課税（請求書に載せない）',
          'Deposit = months × monthly rent; returnable, so out of scope (never invoiced)',
        ),
        scale: 2,
        min: '0',
      }),
      renewalFee: f.money({
        label: label('更新料', 'Renewal fee'),
        description: label('v1 は記録のみ（自動請求しない）', 'Recorded only in v1 (not billed automatically)'),
        min: '0',
      }),
    },
    partner: {
      tenantKind: f.enum(TENANT_KINDS, {
        label: label('入居者区分', 'Tenant kind'),
        labels: { individual: label('個人', 'Individual'), corporate: label('法人', 'Corporate') },
      }),
      emergencyContact: f.text({ label: label('緊急連絡先', 'Emergency contact'), maxLength: 200 }),
    },
  },
  entities: [RealEstateProperty, RealEstateUnit, RealEstateDeposit],
  actions: [moveInAction, receiveDepositAction, returnDepositAction, moveOutAction, rentRollAction, arrearsAction],
  hooks: () => {
    registry.registerSetting(REAL_ESTATE_ACCOUNTS_SETTING);
    registerContractDefaultHooks();
    registerLeasePeriodHooks();
    registerUnitStatusHooks();
    registerDepositHooks();
  },
  settings: PACK_SETTING_DEFAULTS,
  labels: {
    [Contract.name]: { entity: label('賃貸借契約', 'Lease') },
    sales_invoice: { entity: label('家賃請求書', 'Rent invoice') },
    partner: { entity: label('入居者/取引先', 'Tenant/Partner') },
  },
  menus: [
    { label: label('物件', 'Properties'), entity: RealEstateProperty.name, order: 70 },
    { label: label('部屋・区画', 'Units'), entity: RealEstateUnit.name, order: 71 },
    { label: label('賃貸借契約', 'Leases'), entity: Contract.name, order: 72 },
    { label: label('敷金台帳', 'Deposits'), entity: RealEstateDeposit.name, order: 73 },
    { label: label('レントロール', 'Rent roll'), route: `/r/${rentRollAction.name}`, order: 74 },
    { label: label('滞納一覧', 'Arrears'), route: `/r/${arrearsAction.name}`, order: 75 },
  ],
  seed: seedRealEstate,
  sample: sampleRealEstate,
});
