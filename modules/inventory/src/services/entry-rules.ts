// Pure rules of a stock entry (docs/specs/inventory.md AC-2/AC-3/AC-9): line direction by type/sign, the submit-time
// checks of the header and its lines, and which roles may operate an entry of a given type. No DB here.
import { Decimal, isDecimal } from '@daifuku/kernel';
import type { LineSign } from '../entities/stock-entry-line.ts';
import type { StockEntryType } from '../entities/stock-entry.ts';
import { fitsScale } from './moving-average.ts';

export type ProductKind = 'goods' | 'service';

export interface Issue {
  path: string;
  message: string;
}

export interface EntryHead {
  type: StockEntryType;
  warehouseId: string | null;
  toWarehouseId: string | null;
}

export interface EntryLineInput {
  seq: number;
  productId: string;
  quantity: Decimal;
  sign: LineSign | null;
  unitCost: Decimal | null;
}

/** in = receipt or adjustment in, out = issue or adjustment out, transfer = out of `warehouseId` into `toWarehouseId`. */
export type LineDirection = 'in' | 'out' | 'transfer';

export function lineDirection(type: StockEntryType, sign: LineSign | null): LineDirection | null {
  if (type === 'receipt') return 'in';
  if (type === 'issue') return 'out';
  if (type === 'transfer') return 'transfer';
  return sign;
}

/** Inbound lines carry their own unit cost; outbound and transfer lines are costed at the moving average at submit. */
export function needsUnitCost(type: StockEntryType, sign: LineSign | null): boolean {
  return lineDirection(type, sign) === 'in';
}

export const ROLE_HINT = 'inventory operates every stock entry; purchasing only receipts; sales only through sales invoices (auto issue).';

/**
 * AC-9: admin and inventory operate every type; purchasing receipts. Other roles (sales) reach stock entries only through
 * this module's own hooks (`moduleWrite`: the auto receipt/issue of an invoice, the adjustment of a stock count).
 */
export function roleAllowsEntry(roles: readonly string[], type: StockEntryType, moduleWrite: boolean): boolean {
  if (moduleWrite || roles.includes('admin') || roles.includes('inventory')) return true;
  return type === 'receipt' && roles.includes('purchasing');
}

export function headIssues(head: EntryHead): Issue[] {
  const issues: Issue[] = [];
  if (!head.warehouseId) issues.push({ path: 'warehouseId', message: 'required' });
  if (head.type === 'transfer') {
    if (!head.toWarehouseId) issues.push({ path: 'toWarehouseId', message: 'required for a transfer' });
    else if (head.toWarehouseId === head.warehouseId) issues.push({ path: 'toWarehouseId', message: 'must differ from warehouseId' });
  } else if (head.toWarehouseId) {
    issues.push({ path: 'toWarehouseId', message: 'only a transfer has a destination warehouse' });
  }
  return issues;
}

/** One line against its header and product kind (undefined kind = product not found or not visible). */
export function lineIssues(type: StockEntryType, line: EntryLineInput, kind: ProductKind | undefined, prefix = `lines.${line.seq}`): Issue[] {
  const at = (field: string) => (prefix ? `${prefix}.${field}` : field);
  const issues: Issue[] = [];
  if (kind === undefined) issues.push({ path: at('productId'), message: `product ${line.productId} does not exist or is not visible` });
  else if (kind !== 'goods') issues.push({ path: at('productId'), message: 'a service product has no stock; use a goods product' });
  if (!line.quantity.gt(0)) issues.push({ path: at('quantity'), message: 'must be > 0' });
  else if (!fitsScale(line.quantity)) issues.push({ path: at('quantity'), message: 'at most 6 decimal places' });
  if (type === 'adjustment' && line.sign === null) issues.push({ path: at('sign'), message: 'required for an adjustment (in or out)' });
  if (type !== 'adjustment' && line.sign !== null) issues.push({ path: at('sign'), message: 'only adjustment lines have a sign' });
  if (needsUnitCost(type, line.sign)) {
    if (line.unitCost === null) issues.push({ path: at('unitCost'), message: 'required for an inbound line' });
    else if (line.unitCost.lt(0)) issues.push({ path: at('unitCost'), message: 'must be >= 0' });
    else if (!fitsScale(line.unitCost)) issues.push({ path: at('unitCost'), message: 'at most 6 decimal places' });
  }
  return issues;
}

/** Submit-time validation of a whole entry (AC-2): header, ≥ 1 line, every line. */
export function entryIssues(head: EntryHead, lines: readonly EntryLineInput[], kinds: ReadonlyMap<string, ProductKind>): Issue[] {
  const issues = headIssues(head);
  if (lines.length === 0) issues.push({ path: 'lines', message: 'at least 1 line is required' });
  for (const line of lines) issues.push(...lineIssues(head.type, line, kinds.get(line.productId)));
  return issues;
}

/** Raw hook values may be a Decimal, a decimal string or garbage (left for zod to report). */
export function tryDecimal(v: unknown): Decimal | null {
  if (isDecimal(v)) return v;
  if (typeof v === 'string' && Decimal.isDecimalString(v)) return Decimal.from(v);
  if (typeof v === 'number' && Number.isInteger(v)) return Decimal.from(v);
  return null;
}
