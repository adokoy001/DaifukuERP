// web-phase15 AC-1/AC-2: allocation picker for documents that follow the allocation convention (lib/allocation.ts,
// docs/conventions/ui.md). Shows 配分合計 / 未配分 above the allocation grid and, on 「未消込の請求書から選ぶ」, a panel that
// runs `<module>.outstanding { partnerId, direction }` from the current header values and appends the checked invoices
// as grid rows. Nothing is saved here: the rows go out with the form's normal save (server validates again).
import { useMemo, useState, type KeyboardEvent } from 'react';
import { useCurrencyScale } from '../api/company.tsx';
import { useMeta } from '../api/queries.ts';
import { useActionTable } from '../api/reports.ts';
import type { EntityMeta, FieldMeta, Label, RecordJson } from '../api/types.ts';
import { useLocale } from '../i18n.tsx';
import {
  ALLOCATION,
  allocatedInvoiceIds,
  allocationConventionOf,
  allocationRows,
  allocationSummary,
  defaultAllocationAmount,
  outstandingInput,
  outstandingInvoices,
  pickProblem,
  remainingFor,
  savedOverAllocation,
  type AllocationConvention,
  type OutstandingInvoice,
  type PickProblem,
} from '../lib/allocation.ts';
import type { FormValues } from '../lib/form.ts';
import { decimalMinScale, formatDecimal } from '../lib/format.ts';
import type { GridRow } from '../lib/lines.ts';
import { S } from '../strings.ts';
import { NumberField } from './fields/inputs.tsx';
import { useToast } from './toast.tsx';

/** The document's allocation convention from /meta (undefined for every other entity). */
export function useAllocationConvention(entity: EntityMeta): AllocationConvention | undefined {
  const meta = useMeta();
  return useMemo(
    () => (meta.data ? allocationConventionOf(entity, meta.data.entities, meta.data.actions) : undefined),
    [entity, meta.data],
  );
}

/** AC-2 for the 確定 button: the saved allocations exceed the saved amount -> reason text, else undefined. */
export function useSubmitBlock(entity: EntityMeta, record: RecordJson | undefined): string | undefined {
  const { t } = useLocale();
  const conv = useAllocationConvention(entity);
  return conv && record && (record.docstatus ?? 0) === 0 && savedOverAllocation(conv, record)
    ? t(S.submitBlockedOverAllocated)
    : undefined;
}

const PROBLEM_TEXT: Record<PickProblem, Label> = {
  invalid: S.pickInvalid,
  notPositive: S.pickNotPositive,
  overBalance: S.pickOverBalance,
};

function SummaryBar({
  values,
  rows,
  hasAmount,
  minScale,
}: {
  values: FormValues;
  rows: GridRow[];
  hasAmount: boolean;
  minScale: number;
}) {
  const { t } = useLocale();
  const s = allocationSummary(values[ALLOCATION.amountField], rows);
  const item = (label: Label, value: string | undefined, testid: string, warn = false) => (
    <span data-testid={testid} data-value={value ?? ''} className={warn ? 'font-semibold text-red-700' : ''}>
      <span className="text-neutral-500">{t(label)} </span>
      <span className="font-mono tabular-nums">{value === undefined ? '—' : formatDecimal(value, minScale)}</span>
    </span>
  );
  return (
    <div data-testid="allocation-summary" data-over={s.over} className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {item(S.allocatedTotal, s.allocated, 'allocation-allocated', s.over)}
      {hasAmount ? item(S.unallocated, s.unallocated, 'allocation-unallocated', s.over) : null}
      {s.over ? (
        <span role="alert" className="text-red-700">
          {t(S.overAllocated)}
        </span>
      ) : null}
    </div>
  );
}

interface PanelProps {
  conv: AllocationConvention;
  input: { partnerId: string; direction: string };
  amountField: FieldMeta;
  values: FormValues;
  rows: GridRow[];
  columns: FieldMeta[];
  onAppend: (rows: GridRow[]) => void;
  onClose: () => void;
}

function usePicks(conv: AllocationConvention, values: FormValues, rows: GridRow[]) {
  // invoiceId -> amount; present = checked
  const [picks, setPicks] = useState<Record<string, string>>({});
  const toggle = (inv: OutstandingInvoice) =>
    setPicks((p) => {
      if (p[inv.invoiceId] !== undefined)
        return Object.fromEntries(Object.entries(p).filter(([id]) => id !== inv.invoiceId));
      const remaining = conv.hasAmount
        ? remainingFor(values[ALLOCATION.amountField], rows, Object.values(p))
        : undefined;
      return { ...p, [inv.invoiceId]: defaultAllocationAmount(inv.balance, remaining) };
    });
  const setAmount = (id: string, amount: string) => setPicks((p) => ({ ...p, [id]: amount }));
  return { picks, toggle, setAmount };
}

function PickRow({
  inv,
  amount,
  added,
  amountField,
  minScale,
  onToggle,
  onAmount,
}: {
  inv: OutstandingInvoice;
  amount: string | undefined;
  added: boolean;
  amountField: FieldMeta;
  minScale: number;
  onToggle: () => void;
  onAmount: (v: string) => void;
}) {
  const { t } = useLocale();
  const problem = amount === undefined ? undefined : pickProblem(amount, inv.balance);
  const name = inv.number || inv.invoiceId;
  return (
    <tr
      data-testid="outstanding-row"
      data-number={inv.number}
      data-invoice-id={inv.invoiceId}
      className="border-t border-neutral-100"
    >
      <td className="px-2 py-1">
        <input
          type="checkbox"
          className="h-4 w-4 accent-sky-700"
          aria-label={`${t(S.select)} ${name}`}
          checked={amount !== undefined}
          disabled={added}
          onChange={onToggle}
        />
      </td>
      <td className="px-2 py-1 font-mono whitespace-nowrap">
        {name}
        {added ? <span className="ml-2 font-sans text-[11px] text-neutral-500">{t(S.alreadyAllocated)}</span> : null}
      </td>
      <td className="px-2 py-1 font-mono whitespace-nowrap">{inv.date}</td>
      <td className="px-2 py-1 font-mono whitespace-nowrap">{inv.dueDate}</td>
      <td className="num px-2 py-1 whitespace-nowrap">{formatDecimal(inv.balance, minScale)}</td>
      <td className="w-40 px-2 py-1">
        {amount !== undefined ? (
          <NumberField
            id={`pick-${inv.invoiceId}`}
            field={amountField}
            value={amount}
            onChange={(v) => onAmount(typeof v === 'string' ? v : '')}
            disabled={false}
            invalid={problem !== undefined}
            ariaLabel={`${t(S.allocationAmount)} ${name}`}
          />
        ) : null}
        {problem ? (
          <span role="alert" className="block text-[11px] text-red-700">
            {t(PROBLEM_TEXT[problem])}
          </span>
        ) : null}
      </td>
    </tr>
  );
}

function OutstandingPanel({ conv, input, amountField, values, rows, columns, onAppend, onClose }: PanelProps) {
  const { t } = useLocale();
  const toast = useToast();
  const currencyScale = useCurrencyScale();
  const minScale = decimalMinScale(amountField, currencyScale);
  const query = useActionTable(conv.action, input);
  const invoices = useMemo(() => (query.data ? outstandingInvoices(query.data) : []), [query.data]);
  const added = allocatedInvoiceIds(rows);
  const { picks, toggle, setAmount } = usePicks(conv, values, rows);
  const chosen = invoices.flatMap((invoice) =>
    picks[invoice.invoiceId] !== undefined ? [{ invoice, amount: picks[invoice.invoiceId] ?? '' }] : [],
  );
  const valid = chosen.length > 0 && chosen.every((c) => pickProblem(c.amount, c.invoice.balance) === undefined);
  const confirm = () => {
    onAppend(allocationRows(chosen, columns));
    toast.success(t(S.allocationsAdded));
    onClose();
  };
  // Enter inside the panel must not submit the surrounding record form.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && (e.target as HTMLElement).tagName === 'INPUT')
      e.preventDefault();
  };
  const th = 'px-2 py-1 font-medium whitespace-nowrap';
  return (
    <div
      role="region"
      aria-label={t(S.outstandingInvoices)}
      data-testid="outstanding-panel"
      onKeyDown={onKeyDown}
      className="mt-2 rounded border border-sky-200 bg-sky-50/40"
    >
      <div className="flex items-center gap-2 border-b border-sky-200 px-2 py-1">
        <h3 className="text-xs font-semibold">{query.data ? t(query.data.title) : t(S.outstandingInvoices)}</h3>
        {query.isFetching ? <span className="text-[11px] text-neutral-500">{t(S.loading)}</span> : null}
        <button type="button" className="btn btn-primary ml-auto px-2 py-0.5" disabled={!valid} onClick={confirm}>
          {t(S.addSelected)}
        </button>
        <button type="button" className="btn px-2 py-0.5" onClick={onClose}>
          {t(S.close)}
        </button>
      </div>
      {query.isError ? <div className="px-2 py-2 text-xs text-red-700">{query.error.message}</div> : null}
      {query.data && invoices.length === 0 ? (
        <div className="px-2 py-2 text-xs text-neutral-500">{t(S.outstandingEmpty)}</div>
      ) : null}
      {invoices.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-600">
              <tr>
                <th className="w-8" />
                <th className={th}>{t(S.number)}</th>
                <th className={th}>{t(S.date)}</th>
                <th className={th}>{t(S.dueDate)}</th>
                <th className={`${th} text-right`}>{t(S.balance)}</th>
                <th className={th}>{t(S.allocationAmount)}</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <PickRow
                  key={inv.invoiceId}
                  inv={inv}
                  amount={picks[inv.invoiceId]}
                  added={added.has(inv.invoiceId)}
                  amountField={amountField}
                  minScale={minScale}
                  onToggle={() => toggle(inv)}
                  onAmount={(v) => setAmount(inv.invoiceId, v)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export interface AllocationPickerProps {
  conv: AllocationConvention;
  /** Grid columns of the allocation line entity. */
  columns: FieldMeta[];
  /** Current header values (partnerId, direction, amount). */
  values: FormValues;
  rows: GridRow[];
  onAppend: (rows: GridRow[]) => void;
  readOnly: boolean;
}

export function AllocationPicker({ conv, columns, values, rows, onAppend, readOnly }: AllocationPickerProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const input = outstandingInput(values);
  const currencyScale = useCurrencyScale();
  const amountField = columns.find((c) => c.name === ALLOCATION.lineAmountField);
  const minScale = decimalMinScale(amountField, currencyScale);
  return (
    <div data-testid="allocation-picker" className="border-b border-neutral-200 px-3 py-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <SummaryBar values={values} rows={rows} hasAmount={conv.hasAmount} minScale={minScale} />
        {!readOnly ? (
          <span className="ml-auto flex items-center gap-2">
            {!input ? <span className="text-[11px] text-neutral-500">{t(S.pickOutstandingNeedsHeader)}</span> : null}
            <button
              type="button"
              className="btn px-2 py-0.5"
              disabled={!input || !amountField}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {t(S.pickOutstanding)}
            </button>
          </span>
        ) : null}
      </div>
      {open && input && amountField && !readOnly ? (
        <OutstandingPanel
          conv={conv}
          input={input}
          amountField={amountField}
          values={values}
          rows={rows}
          columns={columns}
          onAppend={onAppend}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
