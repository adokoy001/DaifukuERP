// @daifuku/pack-real-estate public API (docs/specs/pack-real-estate.md). Importing it registers the `real_estate` pack:
// ext on contract/partner, the property/unit/deposit entities, the move-in/out, deposit, rent roll and arrears actions,
// hooks, label overrides and menus. apps import RealEstatePack; applying it to a company is `pack.apply { name: 'real_estate' }`.
export { RealEstatePack, TENANT_KINDS } from './pack.ts';
export { RealEstateProperty } from './entities/property.ts';
export { RealEstateUnit, UNIT_USAGE_LABELS } from './entities/unit.ts';
export { RealEstateDeposit, DEPOSIT_SYSTEM_FIELDS } from './entities/deposit.ts';

export { moveInAction, moveIn, moveInInput, moveInOutput, assertLease, KEY_MONEY_PRODUCT_CODE, KEY_MONEY_DESCRIPTION, LEASE_HINT, type MoveInInput, type MoveInResult } from './actions/move-in.ts';
export { moveOutAction, moveOut, moveOutInput, moveOutOutput, type MoveOutInput, type MoveOutResult } from './actions/move-out.ts';
export { receiveDepositAction, receiveDeposit, receiveDepositInput, RECEIVED_HINT, type ReceiveDepositInput, type DepositRow } from './actions/receive-deposit.ts';
export { returnDepositAction, returnDeposit, returnDepositInput, DEPOSIT_RETURN_SOURCE, type ReturnDepositInput } from './actions/return-deposit.ts';
export { rentRollAction, rentRollReport, RENT_ROLL_COLUMNS } from './actions/rent-roll.ts';
export { arrearsAction, arrearsReport, ARREARS_COLUMNS } from './actions/arrears.ts';

export { UNIT_USAGES, DEPOSIT_TAX_CATEGORY, rentTaxCategory, isShortTerm, oneMonthEnd, isTaxableCategory, isUnitUsage, type UnitUsage, type RentTaxCategory } from './services/tax-rule.ts';
export { UNIT_STATUSES, liveLeases, leaseOn, unitStatusOn, rentRoll, type UnitStatus, type LeaseTerm, type RentRollUnit, type RentRollLease, type RentRollRow, type RentRollTotals } from './services/rent-roll.ts';
export { arrearsRows, isInArrears, type ArrearsInput, type ArrearsRow } from './services/arrears.ts';
export { derivedUnitStatus, refreshUnitStatus, UNIT_IN_USE_HINT } from './hooks/unit-status.ts';
export { LEASE_MONEY_KEYS } from './hooks/contract-defaults.ts';
export { DEPOSIT_LEDGER_HINT } from './hooks/deposit.ts';

export { SEED_ACCOUNTS, SEED_PRODUCTS, seedRealEstate } from './seed.ts';
export { SAMPLE_PROPERTY, SAMPLE_UNITS, SAMPLE_TENANTS, SAMPLE_LEASES, sampleRealEstate } from './sample.ts';
export {
  REAL_ESTATE_ACCOUNTS_KEY,
  REAL_ESTATE_ACCOUNTS_DEFAULT,
  REAL_ESTATE_ACCOUNTS_SETTING,
  PACK_SETTING_DEFAULTS,
  realEstateAccountsSchema,
  loadRealEstateAccounts,
  depositBankCode,
  type RealEstateAccounts,
} from './settings.ts';
