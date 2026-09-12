// Monthly fiscal period (会計期間, spec AC-2, AC-10). Submits are refused when the period (or its year) is closed.
import { defineEntity, f, label } from '@daifuku/kernel';

export const FiscalPeriod = defineEntity({
  name: 'fiscal_period',
  label: label('会計期間', 'Fiscal period'),
  fields: {
    fiscalYearId: f.ref('fiscal_year', { immutable: true, label: label('会計年度', 'Fiscal year'), required: true, onDelete: 'cascade' }),
    code: f.text({ label: label('期間コード', 'Code'), description: label('YYYY-MM', 'YYYY-MM'), required: true, unique: true, maxLength: 20 }),
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
  views: { list: ['code', 'fiscalYearId', 'startDate', 'endDate', 'isClosed'], search: ['code'] },
});

export type FiscalPeriodDef = typeof FiscalPeriod;
