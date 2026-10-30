import { describe, expect, it } from 'vitest';
import {
  dateTimeInput,
  DEFAULT_EXPENSE_PAYMENT_METHOD,
  EXPENSE_PAYMENT_METHODS,
  expensePaymentMethodLabel,
  minutesLabel,
  timeLabel,
} from './workforce.ts';
import { EXPENSE_PAYMENT_METHODS as CONTRACT_METHODS } from '@daifuku/mod-workforce/contract';
import type { EntityMeta } from '../api/types.ts';
import { workforceEntityForUi } from './workforce-entity.ts';

describe('workforce time presentation', () => {
  it('keeps seconds and the correct Japanese date across a UTC month boundary', () => {
    expect(dateTimeInput('2026-09-30T15:03:47Z')).toBe('2026-10-01T00:03:47');
    expect(dateTimeInput('2026-10-01T00:03:47+09:00')).toBe('2026-10-01T00:03:47');
    expect(timeLabel('2026-09-30T15:03:47Z')).toBe('00:03');
  });
  it('does not display invalid or missing timestamps as real attendance', () => {
    expect(timeLabel(null)).toBe('—');
    expect(timeLabel('invalid')).toBe('—');
    expect(dateTimeInput('invalid')).toBe('');
  });
  it('shows elapsed time without rounding partial minutes upward or wrapping a long shift', () => {
    expect(minutesLabel(479.99, 'ja')).toBe('7時間 59分');
    expect(minutesLabel(1500, 'en')).toBe('25h 0m');
    expect(minutesLabel(Number.NaN, 'ja')).toBe('—');
    expect(minutesLabel(-1, 'ja')).toBe('—');
  });
});

describe('workforce generic screens', () => {
  const entity = (name: string) =>
    ({ name, ops: ['read', 'create', 'update', 'delete', 'submit', 'cancel', 'amend', 'export'] }) as EntityMeta;
  it('keeps workflow transactions read-only while preserving authorized employee maintenance', () => {
    expect(workforceEntityForUi(entity('workforce_expense')).ops).toEqual(['read', 'export']);
    expect(workforceEntityForUi(entity('workforce_payroll')).ops).toEqual(['read', 'export']);
    for (const name of [
      'workforce_shift_profile',
      'workforce_shift_availability',
      'workforce_shift_plan',
      'workforce_shift_assignment',
      'workforce_payroll_rules',
      'workforce_payroll_condition',
      'workforce_payroll_tax_evidence',
      'workforce_year_end_declaration',
      'workforce_year_end_adjustment',
      'workforce_work_system_period',
    ])
      expect(workforceEntityForUi(entity(name)).ops).toEqual(['read', 'export']);
    expect(workforceEntityForUi(entity('workforce_employee')).ops).toEqual(['read', 'update', 'export']);
  });
  it('keeps normal site, policy, pay-term and other business metadata unchanged', () => {
    for (const name of ['workforce_site', 'workforce_pay_policy', 'workforce_pay_terms', 'sales_invoice']) {
      const original = entity(name);
      expect(workforceEntityForUi(original)).toBe(original);
    }
  });
});

describe('expense payment methods (expense-settlement AC-1, AC-22)', () => {
  it('AC-1 lists the contract methods with Japanese and English labels and defaults to paid personally', () => {
    expect([...EXPENSE_PAYMENT_METHODS]).toEqual([...CONTRACT_METHODS]);
    expect(DEFAULT_EXPENSE_PAYMENT_METHOD).toBe('personal');
    expect(expensePaymentMethodLabel('corporate_card')).toEqual({ ja: '法人カード', en: 'Corporate card' });
    expect(expensePaymentMethodLabel('advance').ja).toBe('仮払金から支払');
  });
  it('AC-22 an unknown or missing method reads as the default', () => {
    expect(expensePaymentMethodLabel(undefined)).toEqual({ ja: '立替', en: 'Paid personally' });
    expect(expensePaymentMethodLabel('cheque')).toEqual({ ja: '立替', en: 'Paid personally' });
  });
});
