// Fiscal year (会計年度, spec AC-2): 12 calendar months from any month's 1st. Created by accounting.open_fiscal_year;
// overlap and date-order rules live in hooks/fiscal-dates.ts so the generic create/update path is covered too.
import { defineEntity, f, label } from '@daifuku/kernel';

export const FiscalYear = defineEntity({
  name: 'fiscal_year',
  label: label('会計年度', 'Fiscal year'),
  fields: {
    code: f.text({
      label: label('年度コード', 'Code'),
      description: label('例: FY2026（開始日の暦年）', 'e.g. FY2026 (calendar year of the start date)'),
      required: true,
      unique: true,
      maxLength: 20,
    }),
    startDate: f.date({ immutable: true, label: label('開始日', 'Start date'), required: true }),
    endDate: f.date({ immutable: true, label: label('終了日', 'End date'), required: true }),
    isClosed: f.bool({ label: label('締め済み', 'Closed'), required: true, default: false }),
  },
  permissions: {
    roles: {
      accounting: ['read', 'create', 'update'],
      sales: ['read'],
      purchasing: ['read'],
      viewer: ['read'],
    },
  },
  views: { list: ['code', 'startDate', 'endDate', 'isClosed'], search: ['code'] },
});

export type FiscalYearDef = typeof FiscalYear;
