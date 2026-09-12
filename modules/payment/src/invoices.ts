// The sales/purchase side of an allocation, behind one interface: snapshot reads (through each module's repository,
// so the caller's visibility and NotFound rules apply), open-invoice listing (AC-5) and applyPayment (AC-3/AC-4).
// `applyPayment` needs `update` on the invoice entity in the caller's context (sales / purchasing / accounting).
import { DOCSTATUS, repo, type Context, type Decimal, type Infer, type LocalDate } from '@daifuku/kernel';
import { PurchaseInvoice, applyPayment as applyPurchasePayment } from '@daifuku/mod-purchase';
import { SalesInvoice, applyPayment as applySalesPayment } from '@daifuku/mod-sales';
import type { InvoiceEntity } from './entities/payment-allocation.ts';
import type { InvoiceSnapshot } from './services/allocate.ts';

type SalesRow = Infer<typeof SalesInvoice>;
type PurchaseRow = Infer<typeof PurchaseInvoice>;

function snapshotOf(entity: InvoiceEntity, row: SalesRow | PurchaseRow): InvoiceSnapshot {
  return { entity, id: row.id, number: row.number, partnerId: row.partnerId, docstatus: row.docstatus, status: row.status, total: row.total, paidAmount: row.paidAmount, balance: row.balance, controlAccountId: row.controlAccountId };
}

/** The invoice as the caller may see it, or null when it does not exist or is not visible (no existence leak). */
export async function loadInvoice(ctx: Context, entity: InvoiceEntity, id: string): Promise<InvoiceSnapshot | null> {
  const row = entity === 'sales_invoice' ? await repo(ctx, SalesInvoice).find(id) : await repo(ctx, PurchaseInvoice).find(id);
  return row ? snapshotOf(entity, row) : null;
}

/** Snapshots for a set of ids of one entity, in pages of 200 (repo.list caps a page at 500). */
export async function loadInvoices(ctx: Context, entity: InvoiceEntity, ids: readonly string[], lock = false): Promise<Map<string, InvoiceSnapshot>> {
  const out = new Map<string, InvoiceSnapshot>();
  const unique = [...new Set(ids)].sort();
  if (lock) {
    for (const id of unique) {
      const visible = await loadInvoice(ctx, entity, id);
      if (!visible) continue;
      const row = entity === 'sales_invoice' ? await repo(ctx, SalesInvoice).lock(id) : await repo(ctx, PurchaseInvoice).lock(id);
      out.set(id, snapshotOf(entity, row));
    }
    return out;
  }
  for (let i = 0; i < unique.length; i += 200) {
    const where = { id: { $in: unique.slice(i, i + 200) } };
    const rows: (SalesRow | PurchaseRow)[] = entity === 'sales_invoice' ? (await repo(ctx, SalesInvoice).list({ where, limit: 200 })).items : (await repo(ctx, PurchaseInvoice).list({ where, limit: 200 })).items;
    for (const r of rows) out.set(r.id, snapshotOf(entity, r));
  }
  return out;
}

export interface OpenInvoice extends InvoiceSnapshot {
  date: LocalDate;
  dueDate: LocalDate | null;
}

/** Submitted, open invoices (optionally of one partner), oldest first, up to `max` rows (AC-5). */
export async function listOpenInvoices(ctx: Context, entity: InvoiceEntity, partnerId: string | undefined, max: number): Promise<{ items: OpenInvoice[]; truncated: boolean }> {
  const where = { docstatus: DOCSTATUS.submitted, status: 'open', ...(partnerId ? { partnerId } : {}) };
  const orderBy = [{ field: 'date', dir: 'asc' as const }, { field: 'number', dir: 'asc' as const }];
  const items: OpenInvoice[] = [];
  let offset = 0;
  for (;;) {
    const page = entity === 'sales_invoice' ? await repo(ctx, SalesInvoice).list({ where, orderBy, limit: 500, offset }) : await repo(ctx, PurchaseInvoice).list({ where, orderBy, limit: 500, offset });
    for (const r of page.items as (SalesRow | PurchaseRow)[]) items.push({ ...snapshotOf(entity, r), date: r.date, dueDate: r.dueDate });
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) return { items, truncated: false };
    if (items.length >= max) return { items: items.slice(0, max), truncated: true };
  }
}

export interface ApplyInput {
  entity: InvoiceEntity;
  invoiceId: string;
  /** Positive applies, negative un-applies (payment cancel). */
  amount: Decimal;
  date: LocalDate;
}

/** Moves paidAmount/balance/status of the invoice through the owning module (which emits its own event). */
export async function applyInvoicePayment(ctx: Context, input: ApplyInput): Promise<InvoiceSnapshot> {
  if (input.entity === 'sales_invoice') return snapshotOf(input.entity, await applySalesPayment(ctx, { invoiceId: input.invoiceId, amount: input.amount, date: input.date }));
  return snapshotOf(input.entity, await applyPurchasePayment(ctx, { invoiceId: input.invoiceId, amount: input.amount, date: input.date }));
}
