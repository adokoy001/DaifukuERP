// Unit tests (spec AC-9): the tax-category rule of rental charges (docs/domain/real-estate.md#tax), the occupancy rule
// behind unit.status and the rent roll, and the arrears predicate. Proration is the contract module's and not re-tested.
import { Decimal } from '@daifuku/kernel';
import { describe, expect, it } from 'vitest';
import { arrearsRows, isInArrears, type ArrearsInput } from '../src/services/arrears.ts';
import { leaseOn, rentRoll, unitStatusOn, type RentRollLease, type RentRollUnit } from '../src/services/rent-roll.ts';
import {
  DEPOSIT_TAX_CATEGORY,
  isShortTerm,
  isTaxableCategory,
  oneMonthEnd,
  rentTaxCategory,
  UNIT_USAGES,
} from '../src/services/tax-rule.ts';

describe('rentTaxCategory (No.6226 / No.6225, 別表第二 十三)', () => {
  it('residential → non_taxable; office, store, parking → standard', () => {
    expect(Object.fromEntries(UNIT_USAGES.map((u) => [u, rentTaxCategory(u)]))).toEqual({
      residential: 'non_taxable',
      office: 'standard',
      store: 'standard',
      parking: 'standard',
    });
  });

  it('a returnable deposit is out of scope (不課税), never a rent category', () => {
    expect(DEPOSIT_TAX_CATEGORY).toBe('out_of_scope');
    for (const u of UNIT_USAGES) expect(rentTaxCategory(u)).not.toBe(DEPOSIT_TAX_CATEGORY);
  });

  it('residential lease shorter than one month → standard (貸付期間が1か月未満); open-ended or ≥ 1 month → non_taxable', () => {
    expect(rentTaxCategory('residential', { startDate: '2026-11-11', endDate: null })).toBe('non_taxable');
    expect(rentTaxCategory('residential', { startDate: '2026-11-11', endDate: '2026-12-10' })).toBe('non_taxable'); // exactly one month
    expect(rentTaxCategory('residential', { startDate: '2026-11-11', endDate: '2026-12-09' })).toBe('standard');
    expect(rentTaxCategory('office', { startDate: '2026-11-11', endDate: null })).toBe('standard');
  });

  it('oneMonthEnd: the day before the same day next month; no such day → that month ends the lease (民法 143 条の考え方)', () => {
    expect(oneMonthEnd('2026-11-11')).toBe('2026-12-10');
    expect(oneMonthEnd('2026-03-01')).toBe('2026-03-31');
    expect(oneMonthEnd('2026-12-15')).toBe('2027-01-14');
    expect(oneMonthEnd('2026-01-28')).toBe('2026-02-27');
    expect(oneMonthEnd('2026-01-29')).toBe('2026-02-28');
    expect(oneMonthEnd('2026-01-31')).toBe('2026-02-28');
    expect(oneMonthEnd('2028-01-31')).toBe('2028-02-29');
    expect(isShortTerm('2026-01-31', '2026-02-27')).toBe(true);
    expect(isShortTerm('2026-01-31', '2026-02-28')).toBe(false);
  });

  it('isTaxableCategory: standard / reduced / exempt (0%) are 課税売上; non_taxable and out_of_scope are not', () => {
    expect(['standard', 'reduced', 'exempt', 'non_taxable', 'out_of_scope'].map(isTaxableCategory)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe('occupancy (unit.status, rent roll)', () => {
  const lease = (startDate: string, endDate: string | null) => ({ startDate, endDate });

  it('occupied while a signed lease has not ended (an upcoming lease counts); vacant after endDate', () => {
    expect(unitStatusOn([], '2026-11-30')).toBe('vacant');
    expect(unitStatusOn([lease('2026-11-11', null)], '2026-11-10')).toBe('occupied');
    expect(unitStatusOn([lease('2026-04-01', '2026-12-20')], '2026-12-20')).toBe('occupied');
    expect(unitStatusOn([lease('2026-04-01', '2026-12-20')], '2026-12-21')).toBe('vacant');
  });

  it('leaseOn prefers the lease in force over an upcoming one', () => {
    const old = lease('2026-04-01', '2026-12-20');
    const next = lease('2027-01-01', null);
    expect(leaseOn([next, old], '2026-12-01')).toBe(old);
    expect(leaseOn([next, old], '2026-12-25')).toBe(next);
    expect(leaseOn([old], '2027-01-01')).toBeNull();
  });

  it('rentRoll: rows by property/unit code, occupied rent split taxable / non-taxable, vacant units at asking rent and out of totals', () => {
    const unit = (id: string, code: string, usage: RentRollUnit['usage'], rent: string): RentRollUnit => ({
      id,
      propertyCode: 'SH',
      propertyName: 'サンプルハイツ',
      code,
      name: code,
      usage,
      floorArea: null,
      monthlyRent: Decimal.from(rent),
    });
    const units = [
      unit('u2', '201', 'office', '100000'),
      unit('u1', '101', 'residential', '60000'),
      unit('u3', '102', 'residential', '65000'),
    ];
    const leases: RentRollLease[] = [
      {
        contractId: 'c1',
        unitId: 'u1',
        partnerId: 'p1',
        partnerName: 'T1',
        startDate: '2026-04-01',
        endDate: null,
        lines: [{ amount: Decimal.from('60000'), taxCategory: 'non_taxable' }],
      },
      {
        contractId: 'c2',
        unitId: 'u2',
        partnerId: 'p2',
        partnerName: 'T3',
        startDate: '2026-11-01',
        endDate: null,
        lines: [
          { amount: Decimal.from('100000'), taxCategory: 'standard' },
          { amount: Decimal.from('5000'), taxCategory: 'non_taxable' },
        ],
      },
    ];
    const { rows, totals, counts } = rentRoll(units, leases, '2026-11-30');
    expect(rows.map((r) => [r.unitCode, r.status, r.monthlyRent, r.tenantName, r.taxCategory])).toEqual([
      ['101', 'occupied', '60000', 'T1', 'non_taxable'],
      ['102', 'vacant', '65000', null, 'non_taxable'],
      ['201', 'occupied', '105000', 'T3', 'mixed'],
    ]);
    expect(totals).toEqual({ monthlyRent: '165000', taxableRent: '100000', nonTaxableRent: '65000' });
    expect(counts).toEqual({ vacant: 1, occupied: 2 });
  });
});

describe('arrears', () => {
  const input = (dueDate: string | null, invoiceDate = '2026-11-01', balance = '8800'): ArrearsInput => ({
    invoiceId: 'i',
    invoiceNumber: 'INV-2026-000003',
    invoiceDate,
    dueDate,
    balance: Decimal.from(balance),
    period: '2026-11',
    contractId: 'c',
    contractNumber: 'CTR-2026-000004',
    partnerId: 'p',
    tenantName: 'T4',
    unitId: 'u',
    propertyName: 'サンプルハイツ',
    unitCode: 'P1',
  });

  it('late only after the due date, for an invoice dated on or before asOf with a balance', () => {
    expect(isInArrears(input('2026-11-30'), '2026-11-30')).toBe(false); // due today
    expect(isInArrears(input('2026-11-30'), '2026-12-01')).toBe(true);
    expect(isInArrears(input('2026-12-31', '2026-12-01'), '2026-12-05')).toBe(false); // December rent: before its due date
    expect(isInArrears(input('2026-11-30', '2026-11-01', '0'), '2026-12-05')).toBe(false);
    expect(isInArrears(input(null), '2026-12-05')).toBe(false);
  });

  it('arrearsRows: days overdue = asOf − dueDate, total of balances', () => {
    const { rows, total } = arrearsRows([input('2026-11-30'), input('2026-12-31', '2026-12-01')], '2026-12-05');
    expect(rows.map((r) => [r.tenantName, r.unitCode, r.dueDate, r.daysOverdue, r.balance])).toEqual([
      ['T4', 'P1', '2026-11-30', 5, '8800'],
    ]);
    expect(total.toString()).toBe('8800');
  });
});
