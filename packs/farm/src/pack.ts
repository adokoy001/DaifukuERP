import { definePack, label } from '@daifuku/kernel';
import { JapanModule } from '@daifuku/l10n-jp';
import { AccountingModule } from '@daifuku/mod-accounting';
import { InventoryModule } from '@daifuku/mod-inventory';
import { PartnerModule } from '@daifuku/mod-partner';
import { PaymentModule } from '@daifuku/mod-payment';
import { ProductModule } from '@daifuku/mod-product';
import { PurchaseModule } from '@daifuku/mod-purchase';
import { SalesModule } from '@daifuku/mod-sales';
import { TaxModule } from '@daifuku/mod-tax';
import { closeSeasonAction } from './actions/close-season.ts';
import { seasonSummaryAction } from './actions/season-summary.ts';
import { FarmHarvest } from './entities/harvest.ts';
import { FarmCrop, FarmField } from './entities/masters.ts';
import { FarmSeason } from './entities/season.ts';
import { FarmMaterialLine, FarmWork } from './entities/work.ts';
import { registerHarvestHooks } from './hooks/harvest.ts';
import { registerMasterHooks } from './hooks/masters.ts';
import { registerWorkHooks } from './hooks/work.ts';
import { sampleFarm } from './sample.ts';
import { seedFarm } from './seed.ts';

export const FarmPack = definePack({
  name: 'farm', label: label('農家', 'Crop farm'), version: '0.1.0',
  depends: [PartnerModule.name, ProductModule.name, TaxModule.name, AccountingModule.name, SalesModule.name, PurchaseModule.name, PaymentModule.name, InventoryModule.name, JapanModule.name],
  entities: [FarmField, FarmCrop, FarmSeason, FarmWork, FarmMaterialLine, FarmHarvest],
  actions: [closeSeasonAction, seasonSummaryAction],
  hooks: () => { registerMasterHooks(); registerWorkHooks(); registerHarvestHooks(); },
  menus: [
    { label: label('圃場', 'Fields'), entity: FarmField.name, order: 150 },
    { label: label('作物', 'Crops'), entity: FarmCrop.name, order: 151 },
    { label: label('作期', 'Seasons'), entity: FarmSeason.name, order: 152 },
    { label: label('農作業・資材投入', 'Work and material use'), entity: FarmWork.name, order: 153 },
    { label: label('収穫', 'Harvests'), entity: FarmHarvest.name, order: 154 },
    { label: label('圃場・作期集計', 'Field and season summary'), route: '/r/farm.season_summary', order: 155 },
    { label: label('作期を終了', 'Close growing season'), route: '/a/farm.close_season', order: 156 },
  ], seed: seedFarm, sample: sampleFarm,
});
