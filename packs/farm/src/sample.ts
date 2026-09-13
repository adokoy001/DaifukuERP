import { repo, saveLines, StateError, withLock, type Context } from '@daifuku/kernel';
import { Warehouse } from '@daifuku/mod-inventory';
import { Partner } from '@daifuku/mod-partner';
import { Product, Uom } from '@daifuku/mod-product';
import { FarmHarvest } from './entities/harvest.ts';
import { FarmCrop, FarmField } from './entities/masters.ts';
import { FarmSeason } from './entities/season.ts';
import { FarmMaterialLine, FarmWork } from './entities/work.ts';
import { FARM_WAREHOUSE_CODE, seedFarm } from './seed.ts';
import { asFarm } from './system-write.ts';

export const FARM_SAMPLE = {
  fieldCode: 'FARM-DEMO-NORTH',
  cropCode: 'FARM-DEMO-TOMATO',
  productCode: 'FARM-DEMO-TOMATO',
  materialCode: 'FARM-DEMO-MATERIAL',
  customerCode: 'FARM-DEMO-BUYER',
  supplierCode: 'FARM-DEMO-SUPPLIER',
  seasonKey: 'farm.demo.2026.tomato',
  workKey: 'farm.demo.2026.work',
  harvestKey: 'farm.demo.2026.harvest',
} as const;
async function products(ctx: Context) {
  const unit = (await repo(ctx, Uom).list({ where: { code: 'KGM' }, limit: 1 })).items[0];
  if (!unit) throw new StateError('Farm sample stock unit is missing', 'Apply the farm seed first.');
  const p = repo(ctx, Product);
  const tomato =
    (await p.list({ where: { code: FARM_SAMPLE.productCode }, limit: 1 })).items[0] ??
    (await p.create({
      code: FARM_SAMPLE.productCode,
      name: 'トマト（デモ）',
      kind: 'goods',
      uomId: unit.id,
      taxCategory: 'reduced',
      salePrice: '400',
      isPurchased: false,
    }));
  const material =
    (await p.list({ where: { code: FARM_SAMPLE.materialCode }, limit: 1 })).items[0] ??
    (await p.create({
      code: FARM_SAMPLE.materialCode,
      name: '農業資材（デモ）',
      kind: 'goods',
      uomId: unit.id,
      taxCategory: 'standard',
      purchasePrice: '100',
      isSold: false,
    }));
  return { tomato, material };
}
async function partners(ctx: Context): Promise<void> {
  const p = repo(ctx, Partner);
  if (!(await p.count({ code: FARM_SAMPLE.customerCode })))
    await p.create({ code: FARM_SAMPLE.customerCode, name: '農産物販売先（デモ）', isCustomer: true });
  if (!(await p.count({ code: FARM_SAMPLE.supplierCode })))
    await p.create({
      code: FARM_SAMPLE.supplierCode,
      name: '農業資材仕入先（デモ）',
      isSupplier: true,
      taxStatus: 'registered',
    });
}
async function sample(ctx: Context): Promise<void> {
  await seedFarm(ctx);
  const { tomato, material } = await products(ctx);
  await partners(ctx);
  const warehouse = (await repo(ctx, Warehouse).list({ where: { code: FARM_WAREHOUSE_CODE }, limit: 1 })).items[0];
  if (!warehouse) throw new StateError('Farm sample warehouse is missing', 'Apply the farm seed first.');
  const field =
    (await repo(ctx, FarmField).list({ where: { code: FARM_SAMPLE.fieldCode }, limit: 1 })).items[0] ??
    (await repo(ctx, FarmField).create({
      code: FARM_SAMPLE.fieldCode,
      name: '北畑（デモ）',
      areaM2: '1000',
      location: 'デモ用の架空圃場',
    }));
  const crop =
    (await repo(ctx, FarmCrop).list({ where: { code: FARM_SAMPLE.cropCode }, limit: 1 })).items[0] ??
    (await repo(ctx, FarmCrop).create({
      code: FARM_SAMPLE.cropCode,
      name: 'トマト（デモ）',
      productId: tomato.id,
      variety: 'デモ品種',
    }));
  const season =
    (await repo(ctx, FarmSeason).list({ where: { sampleKey: FARM_SAMPLE.seasonKey }, limit: 1 })).items[0] ??
    (await repo(ctx, FarmSeason).create({
      sampleKey: FARM_SAMPLE.seasonKey,
      name: '2026年トマト（デモ）',
      fieldId: field.id,
      cropId: crop.id,
      startDate: '2026-04-01',
      endDate: '2026-10-31',
    }));
  // A changed/closed sample season is user data. Never reopen it or recreate missing drafts after closure/cancellation.
  if (season.closedDate || season.docstatus === 2) return;
  if (!(await repo(ctx, FarmWork).count({ sampleKey: FARM_SAMPLE.workKey }))) {
    const work = await repo(ctx, FarmWork).create({
      sampleKey: FARM_SAMPLE.workKey,
      seasonId: season.id,
      date: '2026-05-02',
      activity: 'fertilizing',
      laborHours: '3',
      warehouseId: warehouse.id,
      note: '先に資材を仕入れ・入庫し、内容を確認して確定してください。',
    });
    await saveLines(ctx, FarmWork, work.id, { [FarmMaterialLine.name]: [{ productId: material.id, quantity: '10' }] });
  }
  if (!(await repo(ctx, FarmHarvest).count({ sampleKey: FARM_SAMPLE.harvestKey })))
    await repo(ctx, FarmHarvest).create({
      sampleKey: FARM_SAMPLE.harvestKey,
      seasonId: season.id,
      date: '2026-07-01',
      warehouseId: warehouse.id,
      quantity: '100',
      valuationUnitCost: '200',
      note: '数量と評価単価はデモ値です。確認して確定してください。',
    });
}
export async function sampleFarm(ctx: Context): Promise<void> {
  await withLock(ctx, 'farm.sample', () => asFarm(ctx, sample));
}
