// Allocation picker logic (web-phase15 AC-1/AC-2): which document takes allocations, the outstanding TableResult ->
// pickable invoices, default amounts, 配分合計 / 未配分, and picks -> line-grid rows. /meta carries no declarative hint, so
// the UI infers it by convention (docs/conventions/ui.md). All arithmetic is decimal-string (lib/decimal.ts). Pure;
// allocation.test.ts.
import type { ActionMeta, EntityMeta, FieldMeta, RecordJson, TableResult } from '../api/types.ts';
import {
  compareDecimalStrings,
  isDecimalString,
  minDecimalString,
  subtractDecimalStrings,
  sumDecimalStrings,
} from './decimal.ts';
import type { FormValue, FormValues } from './form.ts';
import { newRow, type GridRow } from './lines.ts';

/** The convention's field names (docs/conventions/ui.md「消込」). */
export const ALLOCATION = {
  lineSuffix: '_allocation',
  partnerField: 'partnerId',
  directionField: 'direction',
  amountField: 'amount',
  invoiceIdField: 'invoiceId',
  invoiceEntityField: 'invoiceEntity',
  lineAmountField: 'amount',
  actionSuffix: '.outstanding',
} as const;

export interface AllocationConvention {
  /** Line entity whose grid receives the picked invoices. */
  lineEntity: string;
  /** Report action listing open invoices (`<module>.outstanding`), called with `{ partnerId, direction }`. */
  action: string;
  /** Values the invoice-entity cell may take (the line field's enum). */
  invoiceEntities: readonly string[];
  /** Whether the header has a decimal `amount` (caps the defaults and the 未配分 figure). */
  hasAmount: boolean;
}

function hasField(entity: EntityMeta | undefined, name: string, kinds: readonly string[]): boolean {
  return (entity?.fields ?? []).some((f) => f.name === name && kinds.includes(f.kind));
}

function outstandingAction(entity: EntityMeta, actions: readonly ActionMeta[]): ActionMeta | undefined {
  const names = [entity.module, entity.name].flatMap((n) => (n ? [`${n}${ALLOCATION.actionSuffix}`] : []));
  return names
    .flatMap((n) => actions.filter((a) => a.name === n && a.resultKind === 'table'))
    .find((a) => {
      const props = a.inputSchema?.properties;
      return !props || (ALLOCATION.partnerField in props && ALLOCATION.directionField in props);
    });
}

/**
 * The allocation convention of a document, or undefined: a line entity named `*_allocation` with `invoiceId`
 * (uuid/text/ref), `invoiceEntity` (enum) and a decimal `amount`; a header with `partnerId` (ref) and `direction` (enum);
 * and a table action `<module>.outstanding` (or `<entity>.outstanding`) the caller may run.
 */
export function allocationConventionOf(
  entity: EntityMeta,
  entities: readonly EntityMeta[],
  actions: readonly ActionMeta[],
): AllocationConvention | undefined {
  if (entity.kind !== 'document') return undefined;
  if (!hasField(entity, ALLOCATION.partnerField, ['ref']) || !hasField(entity, ALLOCATION.directionField, ['enum']))
    return undefined;
  const action = outstandingAction(entity, actions);
  if (!action) return undefined;
  for (const spec of entity.lines ?? []) {
    if (!spec.entity.endsWith(ALLOCATION.lineSuffix)) continue;
    const line = entities.find((e) => e.name === spec.entity);
    const kindField = line?.fields.find((f) => f.name === ALLOCATION.invoiceEntityField && f.kind === 'enum');
    if (
      !line ||
      !kindField ||
      !hasField(line, ALLOCATION.invoiceIdField, ['uuid', 'text', 'ref']) ||
      !hasField(line, ALLOCATION.lineAmountField, ['decimal'])
    )
      continue;
    return {
      lineEntity: line.name,
      action: action.name,
      invoiceEntities: kindField.values ?? [],
      hasAmount: hasField(entity, ALLOCATION.amountField, ['decimal']),
    };
  }
  return undefined;
}

/** Input of the outstanding action from the header values; undefined until both are entered. */
export function outstandingInput(values: FormValues): { partnerId: string; direction: string } | undefined {
  const partnerId = values[ALLOCATION.partnerField];
  const direction = values[ALLOCATION.directionField];
  if (typeof partnerId !== 'string' || typeof direction !== 'string' || partnerId === '' || direction === '')
    return undefined;
  return { partnerId, direction };
}

export interface OutstandingInvoice {
  invoiceId: string;
  invoiceEntity: string;
  number: string;
  date: string;
  dueDate: string;
  balance: string;
}

function text(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

/** The invoice entity of the result: `meta.invoiceEntity`, else the `invoiceId` column's `ref`. */
function resultInvoiceEntity(result: TableResult): string {
  const fromMeta = result.meta?.invoiceEntity;
  if (typeof fromMeta === 'string' && fromMeta) return fromMeta;
  return result.columns.find((c) => c.key === ALLOCATION.invoiceIdField)?.ref ?? '';
}

/** TableResult rows -> pickable invoices. Rows without an id or a decimal balance are skipped. */
export function outstandingInvoices(result: TableResult): OutstandingInvoice[] {
  const invoiceEntity = resultInvoiceEntity(result);
  return result.rows.flatMap((row) => {
    const invoiceId = text(row[ALLOCATION.invoiceIdField]);
    const balance = text(row.balance);
    if (!invoiceId || !isDecimalString(balance)) return [];
    return [
      {
        invoiceId,
        invoiceEntity: text(row.invoiceEntity) || invoiceEntity,
        number: text(row.number),
        date: text(row.date),
        dueDate: text(row.dueDate),
        balance,
      },
    ];
  });
}

function cell(v: FormValue | undefined): string {
  return typeof v === 'string' ? v : '';
}

/** Σ of the grid's allocation amounts (invalid cells ignored). */
export function allocatedTotal(rows: readonly GridRow[]): string {
  return sumDecimalStrings(rows.map((r) => cell(r.values[ALLOCATION.lineAmountField])));
}

export interface AllocationSummary {
  /** 配分合計 */
  allocated: string;
  /** 未配分 = 金額 − 配分合計; undefined while the header amount is not a decimal. */
  unallocated: string | undefined;
  /** 配分合計 > 金額 (AC-2: submit is refused client-side). */
  over: boolean;
}

export function allocationSummary(amount: FormValue | undefined, rows: readonly GridRow[]): AllocationSummary {
  const allocated = allocatedTotal(rows);
  const unallocated = subtractDecimalStrings(cell(amount), allocated);
  return { allocated, unallocated, over: unallocated !== undefined && compareDecimalStrings(unallocated, '0') === -1 };
}

/** Invoice ids already allocated in the grid (the server accepts one allocation per invoice). */
export function allocatedInvoiceIds(rows: readonly GridRow[]): Set<string> {
  return new Set(rows.map((r) => cell(r.values[ALLOCATION.invoiceIdField])).filter((id) => id !== ''));
}

/** Default amount of a newly checked invoice: min(balance, remaining), never below 0; the balance when nothing caps it. */
export function defaultAllocationAmount(balance: string, remaining: string | undefined): string {
  if (remaining === undefined) return balance;
  const capped = minDecimalString(balance, remaining) ?? balance;
  return compareDecimalStrings(capped, '0') === -1 ? '0' : capped;
}

/** Remaining unallocated amount before a new pick: amount − grid Σ − Σ of the other picks; undefined without an amount. */
export function remainingFor(
  amount: FormValue | undefined,
  rows: readonly GridRow[],
  otherPicks: readonly string[],
): string | undefined {
  return subtractDecimalStrings(cell(amount), sumDecimalStrings([allocatedTotal(rows), ...otherPicks]));
}

export type PickProblem = 'invalid' | 'notPositive' | 'overBalance';

/** A pick's amount must be a decimal > 0 and at most the invoice balance (the server checks the same, AC-2). */
export function pickProblem(amount: string, balance: string): PickProblem | undefined {
  const sign = compareDecimalStrings(amount.trim(), '0');
  if (sign === undefined) return 'invalid';
  if (sign <= 0) return 'notPositive';
  return compareDecimalStrings(amount.trim(), balance) === 1 ? 'overBalance' : undefined;
}

/** Picks -> new grid rows with invoiceEntity / invoiceId / amount set (other cells blank, as "行を追加" makes them). */
export function allocationRows(
  picks: readonly { invoice: OutstandingInvoice; amount: string }[],
  columns: readonly FieldMeta[],
): GridRow[] {
  return picks.map(({ invoice, amount }) => {
    const row = newRow(columns);
    const values = {
      ...row.values,
      [ALLOCATION.invoiceEntityField]: invoice.invoiceEntity,
      [ALLOCATION.invoiceIdField]: invoice.invoiceId,
      [ALLOCATION.lineAmountField]: amount.trim(),
    };
    return { ...row, values };
  });
}

/** AC-2 for a saved document (the 確定 button): Σ of its allocation lines > its amount. */
export function savedOverAllocation(conv: AllocationConvention, record: RecordJson): boolean {
  const amount = record[ALLOCATION.amountField];
  if (!conv.hasAmount || typeof amount !== 'string') return false;
  const lines = record.lines?.[conv.lineEntity] ?? [];
  const total = sumDecimalStrings(lines.map((l) => text(l[ALLOCATION.lineAmountField])));
  return compareDecimalStrings(total, amount) === 1;
}
