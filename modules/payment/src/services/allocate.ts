// Pure allocation rules (spec AC-2, AC-6): direction <-> invoice entity, role <-> direction, and the checks every
// allocation must pass against a snapshot of its invoice. No DB here; hooks load the snapshots and call these.
import { Decimal, DOCSTATUS, isDecimal, type DecimalInput, type Docstatus } from '@daifuku/kernel';
import type { InvoiceEntity } from '../entities/payment-allocation.ts';
import type { PaymentDirection } from '../entities/payment.ts';

/** What the payment module needs to know about a sales/purchase invoice (both modules expose these fields). */
export interface InvoiceSnapshot {
  entity: InvoiceEntity;
  id: string;
  number: string | null;
  partnerId: string;
  docstatus: Docstatus;
  status: string;
  total: Decimal;
  paidAmount: Decimal;
  balance: Decimal;
  controlAccountId?: string | null;
}

export interface AllocationLine {
  seq: number;
  invoiceEntity: InvoiceEntity;
  invoiceId: string;
  amount: Decimal;
}

export interface AllocationIssue {
  path: string;
  message: string;
}

export interface AllocationInput {
  direction: PaymentDirection;
  partnerId: string;
  amount: Decimal;
  lines: readonly AllocationLine[];
  /** Snapshots by invoice id; an allocation whose invoice is missing here is reported as not found. */
  invoices: ReadonlyMap<string, InvoiceSnapshot>;
}

export interface AllocationResult {
  issues: AllocationIssue[];
  allocated: Decimal;
  unallocated: Decimal;
}

export function invoiceEntityFor(direction: PaymentDirection): InvoiceEntity {
  return direction === 'receive' ? 'sales_invoice' : 'purchase_invoice';
}

export function directionOf(invoiceEntity: InvoiceEntity): PaymentDirection {
  return invoiceEntity === 'sales_invoice' ? 'receive' : 'pay';
}

/** AC-6: admin and accounting handle both directions; sales handles receipts, purchasing disbursements. */
export function roleAllowsDirection(roles: readonly string[], direction: PaymentDirection): boolean {
  if (roles.includes('admin') || roles.includes('accounting')) return true;
  return roles.includes(direction === 'receive' ? 'sales' : 'purchasing');
}

/** Roles that may operate on a direction, for error hints. */
export function rolesForDirection(direction: PaymentDirection): readonly string[] {
  return ['accounting', direction === 'receive' ? 'sales' : 'purchasing'];
}

/** An invoice takes allocations only while submitted and open (drafts, paid and cancelled ones do not). */
export function isOpenInvoice(inv: Pick<InvoiceSnapshot, 'docstatus' | 'status'>): boolean {
  return inv.docstatus === DOCSTATUS.submitted && inv.status === 'open';
}

export function allocatedOf(lines: readonly { amount: DecimalInput }[]): Decimal {
  return Decimal.sum(lines.map((l) => Decimal.from(l.amount)));
}

export function unallocatedOf(amount: DecimalInput, allocated: DecimalInput): Decimal {
  return Decimal.from(amount).minus(allocated);
}

/** Raw hook input may be a Decimal, a decimal string or garbage; garbage is left for the zod schema to report. */
export function tryDecimal(v: unknown): Decimal | null {
  if (isDecimal(v)) return v;
  if (typeof v === 'string' && Decimal.isDecimalString(v)) return Decimal.from(v);
  if (typeof v === 'number' && Number.isInteger(v)) return Decimal.from(v);
  return null;
}

/**
 * Checks one line against the payment header and its invoice — the rules that do not depend on the other lines.
 * Issue paths are `<prefix>.<field>` (`lines.<seq>.amount` by default; pass '' for a bare field path).
 */
export function lineIssues(
  line: AllocationLine,
  head: Pick<AllocationInput, 'direction' | 'partnerId' | 'amount'>,
  inv: InvoiceSnapshot | null,
  prefix = `lines.${line.seq}`,
): AllocationIssue[] {
  const at = (field: string) => (prefix ? `${prefix}.${field}` : field);
  const issues: AllocationIssue[] = [];
  if (!line.amount.gt(0)) issues.push({ path: at('amount'), message: 'must be > 0' });
  const expected = invoiceEntityFor(head.direction);
  if (line.invoiceEntity !== expected) {
    issues.push({ path: at('invoiceEntity'), message: `must be ${expected} for direction ${head.direction}` });
    return issues;
  }
  if (!inv) {
    issues.push({
      path: at('invoiceId'),
      message: `${line.invoiceEntity} ${line.invoiceId} does not exist or is not visible`,
    });
    return issues;
  }
  const ref = inv.number ?? inv.id;
  if (!isOpenInvoice(inv))
    issues.push({
      path: at('invoiceId'),
      message: `${line.invoiceEntity} ${ref} is not open (docstatus ${inv.docstatus}, status ${inv.status})`,
    });
  if (inv.partnerId !== head.partnerId)
    issues.push({ path: at('invoiceId'), message: `${line.invoiceEntity} ${ref} belongs to another partner` });
  if (line.amount.gt(inv.balance))
    issues.push({ path: at('amount'), message: `must be <= the invoice balance ${inv.balance.toString()}` });
  if (line.amount.gt(head.amount))
    issues.push({ path: at('amount'), message: `must be <= the payment amount ${head.amount.toString()}` });
  return issues;
}

/**
 * Full validation of a payment's allocations (AC-2): every line, one allocation per invoice, Σ per invoice <= its
 * balance, Σ <= amount; plus the computed allocated / unallocated amounts.
 */
export function validateAllocations(input: AllocationInput): AllocationResult {
  const issues: AllocationIssue[] = [];
  if (!input.amount.gt(0)) issues.push({ path: 'amount', message: 'must be > 0' });
  const seen = new Set<string>();
  for (const line of input.lines) {
    const inv = input.invoices.get(line.invoiceId) ?? null;
    issues.push(...lineIssues(line, input, inv && inv.entity === line.invoiceEntity ? inv : null));
    const key = `${line.invoiceEntity}:${line.invoiceId}`;
    if (seen.has(key))
      issues.push({
        path: `lines.${line.seq}.invoiceId`,
        message: `${line.invoiceEntity} ${inv?.number ?? line.invoiceId} is allocated twice; merge the lines`,
      });
    seen.add(key);
  }
  const allocated = allocatedOf(input.lines);
  const unallocated = unallocatedOf(input.amount, allocated);
  if (unallocated.isNegative())
    issues.push({
      path: 'lines',
      message: `allocations ${allocated.toString()} exceed the payment amount ${input.amount.toString()}`,
    });
  return { issues, allocated, unallocated };
}
