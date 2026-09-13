// Pure services of the payment module: allocation rules (AC-2), role vs direction (AC-6), journal lines (AC-3) and
// fast-check properties (balanced entries, allocated + unallocated = amount).
import { Decimal, DOCSTATUS } from '@daifuku/kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocatedOf,
  directionOf,
  invoiceEntityFor,
  isOpenInvoice,
  lineIssues,
  roleAllowsDirection,
  rolesForDirection,
  tryDecimal,
  unallocatedOf,
  validateAllocations,
  type AllocationLine,
  type InvoiceSnapshot,
} from '../src/services/allocate.ts';
import {
  entryDescription,
  imbalance,
  journalLinesFor,
  MEMO,
  type JournalLineSpec,
  type PostingInput,
} from '../src/services/posting.ts';
import { defaultAccountCodeFor, PAYMENT_ACCOUNTS_DEFAULT, paymentAccountsSchema } from '../src/settings.ts';

const P = 'partner-a';
const ACCOUNTS = { receivable: 'acc-1300', payable: 'acc-2100', advanceReceived: 'acc-2400', advancePaid: 'acc-1900' };

function invoice(over: Partial<InvoiceSnapshot> = {}): InvoiceSnapshot {
  const total = over.total ?? Decimal.from('3000');
  const paidAmount = over.paidAmount ?? Decimal.zero();
  return {
    entity: 'sales_invoice',
    id: 'inv-1',
    number: 'INV-2026-000001',
    partnerId: P,
    docstatus: DOCSTATUS.submitted,
    status: 'open',
    total,
    paidAmount,
    balance: total.minus(paidAmount),
    ...over,
  };
}
function line(over: Partial<AllocationLine> = {}): AllocationLine {
  return { seq: 1, invoiceEntity: 'sales_invoice', invoiceId: 'inv-1', amount: Decimal.from('1000'), ...over };
}
const head = { direction: 'receive' as const, partnerId: P, amount: Decimal.from('2500') };
const paths = (issues: { path: string }[]) => issues.map((i) => i.path);

describe('allocation rules (AC-2)', () => {
  it('direction <-> invoice entity', () => {
    expect(invoiceEntityFor('receive')).toBe('sales_invoice');
    expect(invoiceEntityFor('pay')).toBe('purchase_invoice');
    expect(directionOf('sales_invoice')).toBe('receive');
    expect(directionOf('purchase_invoice')).toBe('pay');
  });

  it('open = submitted + status open; drafts, paid and cancelled invoices are not allocatable', () => {
    expect(isOpenInvoice(invoice())).toBe(true);
    expect(isOpenInvoice(invoice({ docstatus: DOCSTATUS.draft, status: 'draft' }))).toBe(false);
    expect(isOpenInvoice(invoice({ status: 'paid' }))).toBe(false);
    expect(isOpenInvoice(invoice({ docstatus: DOCSTATUS.cancelled, status: 'cancelled' }))).toBe(false);
  });

  it('lineIssues: a valid line has none; each broken rule names its field', () => {
    expect(lineIssues(line(), head, invoice())).toEqual([]);
    expect(lineIssues(line({ amount: Decimal.from('3000') }), head, invoice())).toEqual([
      { path: 'lines.1.amount', message: 'must be <= the payment amount 2500' },
    ]);
    expect(
      lineIssues(line({ amount: Decimal.from('2001') }), head, invoice({ paidAmount: Decimal.from('1000') })),
    ).toEqual([{ path: 'lines.1.amount', message: 'must be <= the invoice balance 2000' }]);
    expect(
      lineIssues(line({ amount: Decimal.from('2000') }), head, invoice({ paidAmount: Decimal.from('1000') })),
    ).toEqual([]);
    expect(paths(lineIssues(line({ amount: Decimal.zero() }), head, invoice()))).toEqual(['lines.1.amount']);
    expect(paths(lineIssues(line({ amount: Decimal.from('-1') }), head, invoice()))).toEqual(['lines.1.amount']);
    expect(lineIssues(line({ invoiceEntity: 'purchase_invoice' }), head, invoice())).toEqual([
      { path: 'lines.1.invoiceEntity', message: 'must be sales_invoice for direction receive' },
    ]);
    expect(lineIssues(line(), { ...head, direction: 'pay' }, invoice())).toEqual([
      { path: 'lines.1.invoiceEntity', message: 'must be purchase_invoice for direction pay' },
    ]);
    expect(lineIssues(line(), head, null)).toEqual([
      { path: 'lines.1.invoiceId', message: 'sales_invoice inv-1 does not exist or is not visible' },
    ]);
    expect(lineIssues(line(), head, invoice({ partnerId: 'partner-b' }))).toEqual([
      { path: 'lines.1.invoiceId', message: 'sales_invoice INV-2026-000001 belongs to another partner' },
    ]);
    expect(lineIssues(line(), head, invoice({ status: 'paid', paidAmount: Decimal.from('3000') }))).toEqual([
      { path: 'lines.1.invoiceId', message: 'sales_invoice INV-2026-000001 is not open (docstatus 1, status paid)' },
      { path: 'lines.1.amount', message: 'must be <= the invoice balance 0' },
    ]);
    expect(
      paths(lineIssues(line({ seq: 3 }), head, invoice({ docstatus: DOCSTATUS.draft, status: 'draft', number: null }))),
    ).toEqual(['lines.3.invoiceId']);
    // a bare prefix gives field paths (used by the line hook)
    expect(paths(lineIssues(line({ amount: Decimal.from('2600') }), head, invoice(), ''))).toEqual(['amount']);
  });

  it('validateAllocations: totals, Σ <= amount, one line per invoice, missing snapshot, wrong entity in the map', () => {
    const inv2 = invoice({ id: 'inv-2', number: 'INV-2026-000002', total: Decimal.from('500') });
    const invoices = new Map([
      ['inv-1', invoice()],
      ['inv-2', inv2],
    ]);
    const ok = validateAllocations({
      ...head,
      lines: [line(), line({ seq: 2, invoiceId: 'inv-2', amount: Decimal.from('500') })],
      invoices,
    });
    expect(ok.issues).toEqual([]);
    expect([ok.allocated.toString(), ok.unallocated.toString()]).toEqual(['1500', '1000']);
    // no lines: everything is an advance
    const none = validateAllocations({ ...head, lines: [], invoices });
    expect(none.issues).toEqual([]);
    expect([none.allocated.toString(), none.unallocated.toString()]).toEqual(['0', '2500']);
    // Σ > amount (each line alone fits)
    const over = validateAllocations({
      ...head,
      lines: [
        line({ amount: Decimal.from('2000') }),
        line({ seq: 2, invoiceId: 'inv-2', amount: Decimal.from('500') }),
        line({ seq: 3, invoiceId: 'inv-2', amount: Decimal.from('1') }),
      ],
      invoices,
    });
    expect(over.issues).toEqual([
      { path: 'lines.3.invoiceId', message: 'sales_invoice INV-2026-000002 is allocated twice; merge the lines' },
      { path: 'lines', message: 'allocations 2501 exceed the payment amount 2500' },
    ]);
    expect(over.unallocated.toString()).toBe('-1');
    // amount <= 0 on the header, unknown invoice, snapshot of the other entity
    const bad = validateAllocations({
      ...head,
      amount: Decimal.zero(),
      lines: [line({ invoiceId: 'nope' }), line({ seq: 2, invoiceId: 'inv-2' })],
      invoices: new Map([['inv-2', { ...inv2, entity: 'purchase_invoice' }]]),
    });
    expect(paths(bad.issues)).toEqual(['amount', 'lines.1.invoiceId', 'lines.2.invoiceId', 'lines']);
  });

  it('allocatedOf / unallocatedOf / tryDecimal', () => {
    expect(allocatedOf([{ amount: '1' }, { amount: Decimal.from('2.5') }]).toString()).toBe('3.5');
    expect(allocatedOf([]).toString()).toBe('0');
    expect(unallocatedOf('10', '3.5').toString()).toBe('6.5');
    expect(tryDecimal('12.50')?.toString()).toBe('12.5');
    expect(tryDecimal(7)?.toString()).toBe('7');
    expect(tryDecimal(Decimal.from('1'))?.toString()).toBe('1');
    expect(tryDecimal('abc')).toBeNull();
    expect(tryDecimal(1.5)).toBeNull();
    expect(tryDecimal(null)).toBeNull();
  });
});

describe('roles vs direction (AC-6)', () => {
  it('accounting/admin both; sales receive; purchasing pay; viewer/nobody neither', () => {
    for (const d of ['receive', 'pay'] as const) {
      expect(roleAllowsDirection(['accounting'], d)).toBe(true);
      expect(roleAllowsDirection(['admin'], d)).toBe(true);
      expect(roleAllowsDirection(['viewer'], d)).toBe(false);
      expect(roleAllowsDirection([], d)).toBe(false);
    }
    expect(roleAllowsDirection(['sales'], 'receive')).toBe(true);
    expect(roleAllowsDirection(['sales'], 'pay')).toBe(false);
    expect(roleAllowsDirection(['purchasing'], 'pay')).toBe(true);
    expect(roleAllowsDirection(['purchasing'], 'receive')).toBe(false);
    expect(roleAllowsDirection(['sales', 'purchasing'], 'pay')).toBe(true);
    expect(rolesForDirection('receive')).toEqual(['accounting', 'sales']);
    expect(rolesForDirection('pay')).toEqual(['accounting', 'purchasing']);
  });
});

describe('journal lines (AC-3)', () => {
  const base: PostingInput = {
    direction: 'receive',
    partnerId: P,
    accountId: 'acc-1100',
    amount: '2500',
    allocations: [
      { invoiceNumber: 'INV-2026-000001', amount: '1000' },
      { invoiceNumber: 'INV-2026-000002', amount: '500' },
    ],
    unallocated: '1000',
    accounts: ACCOUNTS,
  };
  const shape = (l: JournalLineSpec) => [
    l.accountId,
    l.debit?.toString() ?? null,
    l.credit?.toString() ?? null,
    l.partnerId ?? null,
    l.memo ?? null,
  ];

  it('receive: Dr cash (amount) / Cr receivable per allocation / Cr advance received (unallocated)', () => {
    const lines = journalLinesFor(base);
    expect(lines.map(shape)).toEqual([
      ['acc-1100', '2500', null, P, '入金'],
      ['acc-1300', null, '1000', P, '売掛金 INV-2026-000001'],
      ['acc-1300', null, '500', P, '売掛金 INV-2026-000002'],
      ['acc-2400', null, '1000', P, '前受金'],
    ]);
    expect(imbalance(lines).toString()).toBe('0');
  });

  it('pay: Dr payable per allocation / Dr advance paid (unallocated) / Cr cash (amount)', () => {
    const lines = journalLinesFor({
      ...base,
      direction: 'pay',
      accountId: 'acc-1000',
      amount: '6000',
      allocations: [{ invoiceNumber: 'BILL-2026-000001', amount: '5000' }],
      unallocated: '1000',
    });
    expect(lines.map(shape)).toEqual([
      ['acc-2100', '5000', null, P, '買掛金 BILL-2026-000001'],
      ['acc-1900', '1000', null, P, '前払金'],
      ['acc-1000', null, '6000', P, '支払'],
    ]);
    expect(imbalance(lines).toString()).toBe('0');
  });

  it('zero parts are omitted: fully allocated -> no advance line; no allocations -> cash vs advance only; unnumbered invoice memo', () => {
    expect(journalLinesFor({ ...base, amount: '1500', unallocated: '0' }).map(shape)).toEqual([
      ['acc-1100', '1500', null, P, '入金'],
      ['acc-1300', null, '1000', P, '売掛金 INV-2026-000001'],
      ['acc-1300', null, '500', P, '売掛金 INV-2026-000002'],
    ]);
    expect(journalLinesFor({ ...base, allocations: [], unallocated: '2500' }).map(shape)).toEqual([
      ['acc-1100', '2500', null, P, '入金'],
      ['acc-2400', null, '2500', P, '前受金'],
    ]);
    expect(journalLinesFor({ ...base, allocations: [{ invoiceNumber: null, amount: '1500' }] }).map(shape)[1]).toEqual([
      'acc-1300',
      null,
      '1500',
      P,
      MEMO.receivable,
    ]);
  });

  it('entryDescription with and without the number', () => {
    expect(entryDescription('receive', '得意先A', null)).toBe('入金 得意先A');
    expect(entryDescription('receive', '得意先A', 'PAY-2026-000001')).toBe('入金 PAY-2026-000001 得意先A');
    expect(entryDescription('pay', '仕入先S', 'PAY-2026-000002')).toBe('支払 PAY-2026-000002 仕入先S');
  });

  it('property: for any amount and allocations with Σ <= amount, the entry balances and Σ credit/debit on the cash side = amount', () => {
    const money = fc.bigInt({ min: 1n, max: 10_000_000n }).map((n) => Decimal.from(n));
    fc.assert(
      fc.property(
        fc.constantFrom('receive', 'pay'),
        fc.array(money, { minLength: 0, maxLength: 8 }),
        money,
        (direction, parts, extra) => {
          const allocated = Decimal.sum(parts);
          const amount = allocated.plus(extra);
          const result = validateAllocations({
            direction: direction as 'receive' | 'pay',
            partnerId: P,
            amount,
            lines: parts.map((amt, i) => ({
              seq: i + 1,
              invoiceEntity: invoiceEntityFor(direction as 'receive' | 'pay'),
              invoiceId: `inv-${i}`,
              amount: amt,
            })),
            invoices: new Map(
              parts.map((amt, i) => [
                `inv-${i}`,
                invoice({
                  entity: invoiceEntityFor(direction as 'receive' | 'pay'),
                  id: `inv-${i}`,
                  number: `N-${i}`,
                  total: amt,
                }),
              ]),
            ),
          });
          expect(result.issues).toEqual([]);
          expect(result.allocated.plus(result.unallocated).eq(amount)).toBe(true);
          const lines = journalLinesFor({
            direction: direction as 'receive' | 'pay',
            partnerId: P,
            accountId: 'cash',
            amount,
            allocations: parts.map((amt, i) => ({ invoiceNumber: `N-${i}`, amount: amt })),
            unallocated: result.unallocated,
            accounts: ACCOUNTS,
          });
          expect(imbalance(lines).isZero()).toBe(true);
          expect(lines.length).toBeGreaterThanOrEqual(2);
          for (const l of lines) expect((l.debit ?? l.credit ?? Decimal.zero()).gt(0)).toBe(true);
          const cash = lines.filter((l) => l.accountId === 'cash');
          expect(cash).toHaveLength(1);
          expect((direction === 'receive' ? cash[0]?.debit : cash[0]?.credit)?.eq(amount)).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('settings (AC-1)', () => {
  it('defaults are the l10n/jp codes; cash -> 1000, other methods -> 1100; schema rejects empty codes', () => {
    expect(PAYMENT_ACCOUNTS_DEFAULT).toEqual({
      cash: '1000',
      bank: '1100',
      receivable: '1300',
      payable: '2100',
      advanceReceived: '2400',
      advancePaid: '1900',
    });
    expect(defaultAccountCodeFor(PAYMENT_ACCOUNTS_DEFAULT, 'cash')).toBe('1000');
    expect(defaultAccountCodeFor(PAYMENT_ACCOUNTS_DEFAULT, 'bank_transfer')).toBe('1100');
    expect(defaultAccountCodeFor(PAYMENT_ACCOUNTS_DEFAULT, 'other')).toBe('1100');
    expect(paymentAccountsSchema.safeParse(PAYMENT_ACCOUNTS_DEFAULT).success).toBe(true);
    expect(paymentAccountsSchema.safeParse({ ...PAYMENT_ACCOUNTS_DEFAULT, bank: '' }).success).toBe(false);
    expect(paymentAccountsSchema.safeParse({ cash: '1000' }).success).toBe(false);
  });
});
