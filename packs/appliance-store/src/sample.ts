import { repo, saveLines, todayLocal, type Context } from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { Product } from '@daifuku/mod-product';
import { ApplianceDevice } from './entities/device.ts';
import { ApplianceService } from './entities/service.ts';
import { ApplianceServiceLine } from './entities/service-line.ts';

export const SAMPLE_APPLIANCES = [
  {
    code: 'APP-AIR',
    name: '省エネエアコン（サンプル）',
    salePrice: '90000',
    purchasePrice: '60000',
    ext: { applianceManufacturer: '大福電機（架空）', applianceModel: 'DF-AC26', applianceWarrantyMonths: 12 },
  },
  {
    code: 'APP-FRIDGE',
    name: '冷蔵庫（サンプル）',
    salePrice: '70000',
    purchasePrice: '50000',
    ext: { applianceManufacturer: '大福電機（架空）', applianceModel: 'DF-RF26', applianceWarrantyMonths: 12 },
  },
] as const;

async function customer(ctx: Context): Promise<string> {
  const partners = repo(ctx, Partner);
  const existing = (await partners.list({ where: { code: 'APP-C001' }, limit: 1 })).items[0];
  return (
    existing?.id ?? (await partners.create({ code: 'APP-C001', name: '山田 花子（サンプル）', isCustomer: true })).id
  );
}

async function device(ctx: Context, customerId: string, item: (typeof SAMPLE_APPLIANCES)[number]): Promise<string> {
  const products = repo(ctx, Product);
  const existing = (await products.list({ where: { code: item.code }, limit: 1 })).items[0];
  const product =
    existing ?? (await products.create({ ...item, kind: 'goods', taxCategory: 'standard', ext: { ...item.ext } }));
  const devices = repo(ctx, ApplianceDevice);
  const code = `DEV-${item.code}`;
  const found = (await devices.list({ where: { code }, limit: 1 })).items[0];
  return (
    found?.id ??
    (
      await devices.create({
        code,
        partnerId: customerId,
        productId: product.id,
        name: item.name,
        manufacturer: item.ext.applianceManufacturer,
        model: item.ext.applianceModel,
        serialNumber: `DEMO-${item.code}-001`,
        location: '自宅（サンプル）',
        note: '架空の機器。保証期限は確認して入力してください。',
      })
    ).id
  );
}

export async function sampleApplianceStore(ctx: Context): Promise<void> {
  const customerId = await customer(ctx);
  const partners = repo(ctx, Partner);
  if (!(await partners.count({ code: 'APP-S001' })))
    await partners.create({
      code: 'APP-S001',
      name: '大福家電卸（サンプル）',
      isSupplier: true,
      taxStatus: 'registered',
    });
  for (const [index, item] of SAMPLE_APPLIANCES.entries()) {
    const deviceId = await device(ctx, customerId, item);
    const kind = index === 0 ? 'installation' : 'repair';
    const reference = `APP-DEMO-${kind.toUpperCase()}`;
    if (await repo(ctx, ApplianceService).count({ reference })) continue;
    const code = index === 0 ? 'APP-INSTALL' : 'APP-REPAIR';
    const product = (await repo(ctx, Product).list({ where: { code }, limit: 1 })).items[0];
    if (!product?.salePrice) throw new Error(`Service product ${code} is missing; run the pack seed first.`);
    const service = await repo(ctx, ApplianceService).create({
      reference,
      title: index === 0 ? 'エアコンの設置（サンプル）' : '冷蔵庫の異音点検（サンプル）',
      partnerId: customerId,
      deviceId,
      date: todayLocal(ctx.now()),
      scheduledDate: todayLocal(ctx.now()),
      kind,
      request:
        index === 0 ? '新しいエアコンの設置と試運転をお願いします。' : '運転中に異音がするので点検してください。',
      assignee: '佐藤（サンプル）',
    });
    await saveLines(ctx, ApplianceService, service.id, {
      [ApplianceServiceLine.name]: [
        {
          productId: product.id,
          description: product.name,
          quantity: '1',
          unitPrice: product.salePrice,
          taxCategory: product.taxCategory,
        },
      ],
    });
  }
}
