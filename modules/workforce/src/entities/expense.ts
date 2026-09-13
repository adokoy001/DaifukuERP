import { defineEntity, f, label } from '@daifuku/kernel';
import { expenseStatuses } from '../contract.ts';
import { identityFields, owned, personPermissions, reviewFields, requestFields, edit } from './common.ts';
export const WorkforceExpense = defineEntity({
  name: 'workforce_expense',
  label: label('従業員経費', 'Employee expenses'),
  ext: false,
  siteAccess: { kind: 'store', field: 'siteId' },
  fields: {
    ...identityFields(),
    ...requestFields(),
    expenseDate: f.date({ ...owned, required: true, label: label('使用日', 'Expense date') }),
    category: f.text({ ...owned, required: true, maxLength: 80, label: label('費目', 'Category') }),
    description: f.text({ ...owned, required: true, maxLength: 1000, label: label('内容', 'Description') }),
    amount: f.money({ ...owned, required: true, min: '1', label: label('金額', 'Amount') }),
    evidence: f.text({
      ...owned,
      required: true,
      maxLength: 1000,
      label: label('証憑の保管先・参照', 'Evidence reference'),
    }),
    status: f.enum(expenseStatuses, { ...owned, required: true, default: 'draft' }),
    ...reviewFields(),
    paidOn: f.date({ ...owned, label: label('精算日', 'Settlement date') }),
    paymentReference: f.text({ ...owned, maxLength: 1000, label: label('精算記録番号', 'Settlement reference') }),
    settledBy: f.uuid({ ...owned, label: label('精算確認者', 'Settlement reviewer') }),
  },
  indexes: [['siteId', 'status', 'expenseDate']],
  permissions: personPermissions({ employee: edit, manager: edit, hr: edit, payroll: edit }),
  views: { list: ['employeeId', 'expenseDate', 'category', 'amount', 'status'] },
});
