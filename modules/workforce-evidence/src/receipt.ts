import { defineEntity, f, label, type Infer } from '@daifuku/kernel';

const owned = { serverOwned: true, immutable: true, required: true } as const;
const ownUpload = ['read', 'create', 'export'] as const;
export const WorkforceReceipt = defineEntity({
  name: 'workforce_receipt', label: label('経費の領収書', 'Expense receipts'), ext: false,
  siteAccess: { kind: 'parent', field: 'expenseId', entity: 'workforce_expense' },
  fields: {
    expenseId: f.ref('workforce_expense', { ...owned, label: label('経費申請', 'Expense') }),
    employeeId: f.ref('workforce_employee', { ...owned, label: label('従業員', 'Employee') }),
    siteId: f.ref('workforce_site', { ...owned, label: label('所属拠点', 'Site') }),
    userId: f.uuid({ ...owned, hidden: true }),
    filename: f.text({ ...owned, maxLength: 255, label: label('ファイル名', 'Filename') }),
    contentType: f.text({ ...owned, maxLength: 100 }),
    size: f.int({ ...owned, min: 1 }),
    storageKey: f.text({ ...owned, hidden: true, outputHidden: true, maxLength: 200 }),
    sha256: f.text({ ...owned, pattern: /^[0-9a-f]{64}$/, maxLength: 64 }),
  },
  permissions: {
    roles: { workforce_employee: ownUpload, workforce_manager: ownUpload, workforce_hr: ownUpload, workforce_payroll: ownUpload },
    rowRules: [{ roles: ['workforce_employee'], where: { userId: '$ctx.userId' } }],
  },
  unique: [['expenseId', 'sha256']],
  displayField: 'filename', views: { list: ['expenseId', 'filename', 'contentType', 'size'] },
});
export type ReceiptInfo = Pick<Infer<typeof WorkforceReceipt>, 'id' | 'expenseId' | 'filename' | 'contentType' | 'size' | 'sha256' | 'version'> & { createdAt: string };
export function receiptInfo(row: Infer<typeof WorkforceReceipt>): ReceiptInfo {
  return { id: row.id, expenseId: row.expenseId, filename: row.filename, contentType: row.contentType, size: row.size, sha256: row.sha256, version: row.version, createdAt: row.createdAt.toISOString() };
}
