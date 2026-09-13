import { defineDocument, f, label } from '@daifuku/kernel';

export const SERVICE_STATUS_LABELS = {
  queued: label('受付', 'Received'),
  in_progress: label('作業中', 'In progress'),
  completed: label('作業完了', 'Completed'),
  cancelled: label('取消', 'Cancelled'),
};

export const ApplianceService = defineDocument({
  name: 'appliance_store_service',
  label: label('設置・修理受付', 'Installation / repair job'),
  naming: { type: 'sequence', prefix: 'APS-', period: 'year' },
  fields: {
    reference: f.text({ label: label('受付参照番号', 'Reception reference'), immutable: true, maxLength: 50 }),
    title: f.text({ label: label('依頼名', 'Title'), required: true, maxLength: 200 }),
    partnerId: f.ref('partner', { label: label('お客様', 'Customer'), required: true, immutable: true, index: true }),
    deviceId: f.ref('appliance_store_device', {
      label: label('対象機器', 'Appliance'),
      required: true,
      immutable: true,
      index: true,
    }),
    date: f.date({ label: label('受付日', 'Received date'), required: true, default: 'today' }),
    scheduledDate: f.date({ label: label('訪問・作業予定日', 'Scheduled date'), index: true }),
    kind: f.enum(['repair', 'installation'], {
      label: label('作業種別', 'Service kind'),
      required: true,
      default: 'repair',
      labels: { repair: label('修理', 'Repair'), installation: label('設置', 'Installation') },
    }),
    request: f.text({
      label: label('症状・ご依頼内容', 'Symptoms / request'),
      required: true,
      multiline: true,
      maxLength: 3000,
    }),
    assignee: f.text({ label: label('担当者', 'Assigned technician'), maxLength: 100 }),
    workReport: f.text({ label: label('作業報告', 'Work report'), multiline: true, maxLength: 3000 }),
    completedDate: f.date({ label: label('作業完了日', 'Completion date') }),
    billing: f.enum(['billable', 'no_charge'], {
      label: label('請求区分', 'Billing'),
      required: true,
      default: 'billable',
      labels: { billable: label('有償', 'Billable'), no_charge: label('無償・保証対応', 'No charge / warranty') },
    }),
    status: f.enum(['queued', 'in_progress', 'completed', 'cancelled'], {
      label: label('受付状態', 'Status'),
      required: true,
      default: 'queued',
      serverOwned: true,
      labels: SERVICE_STATUS_LABELS,
      index: true,
    }),
    salesInvoiceId: f.ref('sales_invoice', { label: label('請求書', 'Sales invoice'), serverOwned: true }),
    note: f.text({ label: label('備考', 'Note'), multiline: true, maxLength: 2000 }),
  },
  allowOnSubmit: ['salesInvoiceId'],
  lines: [{ entity: 'appliance_store_service_line', parentField: 'serviceId' }],
  indexes: [['status', 'scheduledDate']],
  displayField: 'title',
  permissions: {
    roles: {
      sales: ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend'],
      accounting: ['read'],
      viewer: ['read'],
    },
  },
  views: {
    list: ['title', 'partnerId', 'deviceId', 'kind', 'scheduledDate', 'assignee', 'status', 'salesInvoiceId'],
    search: ['reference', 'title', 'request', 'assignee'],
    form: [
      ['reference', 'title'],
      ['partnerId', 'deviceId', 'kind'],
      ['date', 'scheduledDate', 'assignee'],
      ['request'],
      ['billing', 'completedDate', 'workReport'],
      ['status', 'salesInvoiceId', 'note'],
    ],
  },
});
