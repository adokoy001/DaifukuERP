import { f, label } from '@daifuku/kernel';
import { amount, invalid } from '@daifuku/mod-industry-operations';
import { intField, needs, oneJob, textField, wholeUnits, type IndustryProfile } from './profile.ts';
export const wholesale: IndustryProfile = {
  job: {
    name: 'wholesale',
    label: label('卸売の受注・出荷', 'Wholesale delivery'),
    quantityLabel: label('納品した個数', 'Delivered units'),
    unitCode: 'IO-PCS',
    productKind: 'goods',
    dueDays: 45,
    fields: {
      purchaseOrder: textField('得意先注文番号', 'Customer purchase order'),
      deliveryAddress: textField('納品先', 'Delivery address'),
      lotReference: textField('納品ロット参照', 'Delivery lot reference'),
      deliveryProof: textField('受領・納品確認番号', 'Delivery proof'),
    },
    form: [
      ['purchaseOrder', 'deliveryAddress'],
      ['lotReference', 'deliveryProof'],
    ],
    validate(row, stage) {
      wholeUnits(row);
      needs(row, stage, ['purchaseOrder', 'deliveryAddress', 'lotReference'], ['deliveryProof']);
    },
  },
  productName: '卸売用保存容器（架空）',
  unitName: '個（業界案件）',
  unitPrice: '1000',
  orderedQuantity: '10',
  sample: () => ({
    purchaseOrder: 'DEMO-PO-001',
    deliveryAddress: '大福商店 倉庫（架空）',
    lotReference: 'DEMO-LOT-001',
  }),
};
export const manufacturing: IndustryProfile = {
  job: {
    name: 'manufacturing',
    label: label('製造の受託加工', 'Contract manufacturing'),
    quantityLabel: label('検収した加工個数', 'Accepted processed units'),
    unitCode: 'IO-PCS',
    productKind: 'service',
    dueDays: 30,
    fields: {
      batchReference: textField('加工ロット', 'Processing batch'),
      drawingRevision: textField('図面・仕様の版', 'Drawing revision'),
      rejectedQuantity: f.quantity({
        label: label('不合格個数', 'Rejected units'),
        required: true,
        default: '0',
        min: '0',
      }),
      inspectionReference: textField('検査記録参照', 'Inspection reference'),
    },
    form: [
      ['batchReference', 'drawingRevision'],
      ['rejectedQuantity', 'inspectionReference'],
    ],
    validate(row, stage) {
      wholeUnits(row);
      const rejected = amount(row.rejectedQuantity, 'rejectedQuantity');
      if (!rejected.eq(rejected.roundDown(0)) || rejected.gt(amount(row.orderedQuantity, 'orderedQuantity')))
        invalid('rejectedQuantity', '不合格数は受注数以内の整数です。');
      needs(row, stage, ['batchReference', 'drawingRevision'], ['inspectionReference']);
      if (
        stage === 'complete' &&
        !amount(row.completedQuantity, 'completedQuantity')
          .plus(rejected)
          .eq(amount(row.orderedQuantity, 'orderedQuantity'))
      )
        invalid('completedQuantity', '合格数と不合格数の合計を受注個数に一致させてください。');
    },
  },
  productName: '受託切削加工料（架空）',
  unitName: '個（業界案件）',
  unitPrice: '2500',
  orderedQuantity: '10',
  sample: () => ({ batchReference: 'DEMO-BATCH-001', drawingRevision: 'DRAW-DEMO Rev.2' }),
};
export const construction: IndustryProfile = {
  job: {
    name: 'construction',
    label: label('建設の工区検収', 'Construction work acceptance'),
    quantityLabel: label('検収した工区（一式）', 'Accepted work package'),
    unitCode: 'IO-JOB',
    productKind: 'service',
    dueDays: 30,
    fields: {
      site: textField('現場', 'Site'),
      workPackage: textField('対象工区・作業範囲', 'Work package'),
      contractReference: textField('工事契約参照', 'Construction contract'),
      completionPercent: intField('工区完了率（%）', 'Completion percent'),
      inspectionReference: textField('検収記録参照', 'Acceptance reference'),
    },
    form: [['site', 'workPackage'], ['contractReference', 'completionPercent'], ['inspectionReference']],
    validate(row, stage) {
      oneJob(row, stage);
      needs(row, stage, ['site', 'workPackage', 'contractReference'], ['inspectionReference']);
      if (Number(row.completionPercent) > 100 || (stage === 'complete' && row.completionPercent !== 100))
        invalid('completionPercent', '工区の検収確定には完了率100%が必要です。');
    },
  },
  productName: '内装工区の完成請負料（架空）',
  unitName: '一式（業界案件）',
  unitPrice: '300000',
  orderedQuantity: '1',
  sample: () => ({ site: '大福ビル2階（架空）', workPackage: '会議室の内装', contractReference: 'DEMO-CONTRACT-001' }),
};
export const logistics: IndustryProfile = {
  job: {
    name: 'logistics',
    label: label('運輸物流の配送完了', 'Freight delivery'),
    quantityLabel: label('完了した配送（一式）', 'Completed shipment'),
    unitCode: 'IO-JOB',
    productKind: 'service',
    dueDays: 30,
    fields: {
      origin: textField('集荷先', 'Origin'),
      destination: textField('配送先', 'Destination'),
      cargo: textField('荷物内容（一般貨物）', 'General cargo description'),
      weightKg: f.quantity({ label: label('申告重量（kg）', 'Declared weight (kg)'), required: true, min: '0' }),
      packageCount: intField('引受個口', 'Accepted packages', 1, 1),
      deliveredPackages: intField('配達済個口', 'Delivered packages'),
      deliveryProof: textField('受領確認番号', 'Proof of delivery'),
    },
    form: [
      ['origin', 'destination'],
      ['cargo', 'weightKg'],
      ['packageCount', 'deliveredPackages', 'deliveryProof'],
    ],
    validate(row, stage) {
      oneJob(row, stage);
      if (!amount(row.weightKg, 'weightKg').gt('0')) invalid('weightKg', '重量は0より大きいkgで記録してください。');
      if (Number(row.deliveredPackages) > Number(row.packageCount))
        invalid('deliveredPackages', '引受個口を超えています。');
      needs(row, stage, ['origin', 'destination', 'cargo'], ['deliveryProof']);
      if (stage === 'complete' && row.deliveredPackages !== row.packageCount)
        invalid('deliveredPackages', '全個口の配達確認が必要です。');
    },
  },
  productName: '一般貨物の配送運賃（架空）',
  unitName: '一式（業界案件）',
  unitPrice: '15000',
  orderedQuantity: '1',
  sample: () => ({
    origin: '大福物流センター（架空）',
    destination: '大福商店（架空）',
    cargo: '常温の梱包資材',
    weightKg: '120',
    packageCount: 6,
  }),
};
