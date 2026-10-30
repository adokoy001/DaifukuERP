// Reads modules/expense/test/golden/settlement.json (spec AC-8) for the unit golden (posting.test.ts) and the DB
// golden (settlement.db.test.ts). A case's `receipts` may name another case to reuse its receipts.
import { readFileSync } from 'node:fs';

export type JournalRow = [string, string, string, string | null, string | null, string | null, string | null];
export interface GoldenLine {
  account: string;
  taxCategory: 'standard' | 'reduced' | 'exempt' | 'non_taxable' | 'out_of_scope';
  amount: string;
  invoiceKind: 'qualified' | 'not_qualified' | 'books_only' | 'small_amount' | 'none';
  booksOnlyReason?: string;
}
export interface GoldenReceipt {
  ref: string;
  expenseDate: string;
  amount: string;
  lines: GoldenLine[];
}
export interface GoldenCase {
  id: string;
  kind: 'reimbursement' | 'corporate_card' | 'advance';
  date: string;
  rounding: 'down' | 'up' | 'half_up';
  advance: string | null;
  receipts: GoldenReceipt[];
  expect: {
    lineTax?: [string, string, string][];
    creditRatio?: string[];
    totals: Record<'subtotal' | 'taxTotal' | 'deductibleTax' | 'nonDeductibleTax' | 'total', string>;
    amounts: Record<'advanceAmount' | 'payAmount' | 'refundAmount', string>;
    journal: JournalRow[];
    payment: { direction: 'pay' | 'receive'; amount: string; counter: string } | null;
    paymentJournal: [string, string, string][] | null;
  };
}

interface RawCase extends Omit<GoldenCase, 'receipts'> {
  receipts: GoldenReceipt[] | string;
}

export function goldenCases(): GoldenCase[] {
  const raw = JSON.parse(readFileSync(new URL('./golden/settlement.json', import.meta.url), 'utf8')) as {
    cases: RawCase[];
  };
  const byId = new Map(raw.cases.map((c) => [c.id, c]));
  return raw.cases.map((c) => {
    const receipts = typeof c.receipts === 'string' ? byId.get(c.receipts)?.receipts : c.receipts;
    if (!Array.isArray(receipts)) throw new Error(`golden case ${c.id}: unknown receipts ${String(c.receipts)}`);
    return { ...c, receipts };
  });
}
