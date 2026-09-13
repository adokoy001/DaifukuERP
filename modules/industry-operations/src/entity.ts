import { defineDocument, f, label } from '@daifuku/kernel';
import type { IndustryJobConfig, JobDef } from './contracts.ts';

export function createJobEntity(config: IndustryJobConfig): JobDef {
  return defineDocument({
    name: `${config.name}_job`,
    label: config.label,
    naming: { type: 'sequence', prefix: `${config.name.toUpperCase().slice(0, 8)}-`, period: 'year' },
    fields: {
      reference: f.text({ label: label('管理参照番号', 'Reference'), unique: true, immutable: true, maxLength: 60 }),
      title: f.text({ label: label('案件名', 'Job title'), required: true, maxLength: 200 }),
      partnerId: f.ref('partner', { label: label('請求先', 'Customer'), required: true, immutable: true, index: true }),
      productId: f.ref('product', { label: label('請求品目', 'Billable item'), required: true, immutable: true }),
      date: f.date({ label: label('受付日', 'Received date'), required: true, default: 'today', index: true }),
      plannedDate: f.date({ label: label('完了予定日', 'Planned completion date'), index: true }),
      orderedQuantity: f.quantity({
        label: label('受注数量', 'Ordered quantity'),
        required: true,
        default: '1',
        min: '0',
      }),
      completedQuantity: f.quantity({ label: config.quantityLabel, required: true, default: '0', min: '0' }),
      unitPrice: f.money({
        label: label('税抜単価（円）', 'Unit price excluding tax (JPY)'),
        required: true,
        min: '0',
      }),
      taxCategory: f.enum(['standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'], {
        label: label('確認した税区分', 'Reviewed tax category'),
        required: true,
        labels: {
          standard: label('課税（標準）', 'Standard'),
          reduced: label('課税（軽減）', 'Reduced'),
          exempt: label('免税', 'Exempt'),
          non_taxable: label('非課税', 'Non-taxable'),
          out_of_scope: label('不課税', 'Out of scope'),
        },
      }),
      quotedAmount: f.money({
        label: label('受注金額（税計算前）', 'Ordered amount before tax'),
        required: true,
        default: '0',
        scale: 6,
        serverOwned: true,
      }),
      completedAmount: f.money({
        label: label('履行金額（税計算前）', 'Fulfilled amount before tax'),
        required: true,
        default: '0',
        scale: 6,
        serverOwned: true,
      }),
      unitCode: f.text({
        label: label('数量単位', 'Quantity unit'),
        required: true,
        default: config.unitCode,
        serverOwned: true,
      }),
      startedAt: f.timestamp({ label: label('開始操作日時', 'Started at'), serverOwned: true }),
      completedDate: f.date({ label: label('完了日', 'Completion date'), index: true }),
      completionNote: f.text({ label: label('履行・完了報告', 'Completion report'), multiline: true, maxLength: 3000 }),
      status: f.enum(['queued', 'in_progress', 'completed', 'cancelled'], {
        label: label('状態', 'Status'),
        required: true,
        default: 'queued',
        serverOwned: true,
        labels: {
          queued: label('受付', 'Queued'),
          in_progress: label('対応中', 'In progress'),
          completed: label('完了', 'Completed'),
          cancelled: label('取消', 'Cancelled'),
        },
        index: true,
      }),
      salesInvoiceId: f.ref('sales_invoice', { label: label('発行した請求書', 'Issued invoice'), serverOwned: true }),
      cancelledDate: f.date({ label: label('取消有効日', 'Cancellation date'), serverOwned: true }),
      ...config.fields,
    },
    allowOnSubmit: ['salesInvoiceId'],
    displayField: 'title',
    permissions: {
      roles: {
        sales: ['read', 'export', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'],
        accounting: ['read', 'export'],
        viewer: ['read'],
      },
    },
    views: {
      list: [
        'title',
        'partnerId',
        'plannedDate',
        'orderedQuantity',
        'completedQuantity',
        'unitCode',
        'status',
        'salesInvoiceId',
      ],
      search: ['reference', 'title', 'completionNote'],
      form: [
        ['reference', 'title'],
        ['partnerId', 'productId'],
        ['date', 'plannedDate'],
        ['orderedQuantity', 'unitPrice', 'taxCategory'],
        ...config.form.map((row) => [...row]),
        ['completedQuantity', 'completedDate'],
        ['completionNote'],
        ['quotedAmount', 'completedAmount', 'unitCode'],
        ['status', 'salesInvoiceId', 'cancelledDate'],
      ],
    },
  });
}
