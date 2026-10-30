// payment.render_receipt_html / payment.render_payment_notice_html (docs/specs/print-templates.md AC-13, AC-14,
// AC-19〜AC-21, D-7). The payment, its allocation lines, the allocated invoices and the partner are read through the
// caller's Context: sales sees receipts only, purchasing disbursements only (row rules -> NOT_FOUND). An allocated
// invoice the caller cannot see fails the whole render with the repository's NotFound (AC-19: no partial HTML).
// Drafts are refused: a receipt for money not yet recorded must not be handed out.
import {
  defineAction,
  DOCSTATUS,
  label,
  NotFound,
  registry,
  repo,
  StateError,
  type Context,
  type Infer,
} from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import {
  definedProps,
  loadPrintTools,
  statusBanner,
  withStatusBanner,
  type PrintIssuer,
} from '@daifuku/mod-print-layout';
import { PurchaseInvoice } from '@daifuku/mod-purchase';
import { loadIssuer, partnerAddressee, SalesInvoice } from '@daifuku/mod-sales';
import { z } from 'zod';
import { PaymentAllocation } from '../entities/payment-allocation.ts';
import { Payment, type PaymentDirection } from '../entities/payment.ts';
import {
  defaultPaymentNoticeHtml,
  defaultReceiptHtml,
  type PaymentDocumentHtmlRenderer,
  type PaymentDocumentRenderData,
} from '../services/payment-html.ts';

/** Override points (ADR-0008). */
export const RECEIPT_HTML_OVERRIDE = 'payment.receipt_html';
export const PAYMENT_NOTICE_HTML_OVERRIDE = 'payment.payment_notice_html';

type InvoiceFacts = { number: string; date: string; supplierInvoiceNo: string | null };

/** The allocated invoices, read directly in pages of 200 (loadInvoice's snapshot has no date / supplier number). */
async function invoiceFacts(
  ctx: Context,
  direction: PaymentDirection,
  ids: readonly string[],
): Promise<Map<string, InvoiceFacts>> {
  const out = new Map<string, InvoiceFacts>();
  const unique = [...new Set(ids)].sort();
  for (let i = 0; i < unique.length; i += 200) {
    const where = { id: { $in: unique.slice(i, i + 200) } };
    if (direction === 'receive') {
      for (const r of (await repo(ctx, SalesInvoice).list({ where, limit: 200 })).items)
        out.set(r.id, { number: r.number ?? '', date: r.date, supplierInvoiceNo: null });
    } else {
      for (const r of (await repo(ctx, PurchaseInvoice).list({ where, limit: 200 })).items)
        out.set(r.id, { number: r.number ?? '', date: r.date, supplierInvoiceNo: r.supplierInvoiceNo ?? null });
    }
  }
  for (const id of unique)
    if (!out.has(id)) throw new NotFound(direction === 'receive' ? SalesInvoice.name : PurchaseInvoice.name, id);
  return out;
}

async function allocationsOf(ctx: Context, paymentId: string): Promise<Infer<typeof PaymentAllocation>[]> {
  const rows: Infer<typeof PaymentAllocation>[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await repo(ctx, PaymentAllocation).list({
      where: { paymentId },
      orderBy: [{ field: 'seq', dir: 'asc' }],
      limit: 500,
      offset,
    });
    rows.push(...page.items);
    if (page.items.length === 0 || rows.length >= page.total) return rows;
  }
}

const HINT: Record<PaymentDirection, string> = {
  receive: 'This is a receipt (入金); print it with payment.render_receipt_html.',
  pay: 'This is a disbursement (支払); print it with payment.render_payment_notice_html.',
};

/** Render data of a submitted (or cancelled) payment of the expected direction. */
export async function buildPaymentDocumentRenderData(
  ctx: Context,
  id: string,
  expected: PaymentDirection,
): Promise<PaymentDocumentRenderData> {
  const p = await repo(ctx, Payment).get(id);
  if (p.direction !== expected)
    throw new StateError(
      `Payment ${p.number ?? p.id} is a ${p.direction === 'receive' ? 'receipt' : 'disbursement'}`,
      HINT[p.direction],
    );
  if (p.docstatus === DOCSTATUS.draft)
    throw new StateError(
      'A draft payment cannot be printed',
      'Submit the payment first: receipts and payment notices are printed for recorded payments only.',
    );
  const allocations = await allocationsOf(ctx, p.id);
  const invoices = await invoiceFacts(
    ctx,
    p.direction,
    allocations.map((a) => a.invoiceId),
  );
  const partner = await repo(ctx, Partner).get(p.partnerId);
  const issuer = definedProps<PrintIssuer>(await loadIssuer(ctx));
  return {
    issuer,
    recipient: partnerAddressee(partner),
    payment: {
      number: p.number ?? '',
      date: p.date,
      amount: p.amount.toString(),
      method: p.method,
      unallocated: p.unallocatedAmount.toString(),
      docstatus: p.docstatus,
      note: p.note ?? null,
    },
    allocations: allocations.map((a) => {
      const inv = invoices.get(a.invoiceId) as InvoiceFacts;
      return {
        invoiceNumber: inv.number,
        invoiceDate: inv.date,
        supplierInvoiceNo: inv.supplierInvoiceNo,
        amount: a.amount.toString(),
      };
    }),
    locale: ctx.locale,
  };
}

const input = z.object({ id: z.uuid() });
const output = z.object({ html: z.string() });

async function render(
  ctx: Context,
  id: string,
  direction: PaymentDirection,
  point: string,
  fallback: PaymentDocumentHtmlRenderer,
): Promise<{ html: string }> {
  const data = await buildPaymentDocumentRenderData(ctx, id, direction);
  const tools = await loadPrintTools(ctx);
  const html = registry.override<PaymentDocumentHtmlRenderer>(point, fallback)(data, tools);
  return {
    html: withStatusBanner(html, data.payment.docstatus === DOCSTATUS.cancelled ? statusBanner('cancelled') : ''),
  };
}

export const renderReceiptHtmlAction = defineAction({
  name: 'payment.render_receipt_html',
  description: label(
    '確定済みの入金を領収書の HTML として描画します（金額・受領方法・消込明細・前受金）。支払と下書きは INVALID_STATE。レイアウトは差し替え点 payment.receipt_html で置き換えられます。',
    'Render a submitted receipt (入金) as an HTML receipt (amount, method, allocations, advance). Disbursements and drafts are refused (INVALID_STATE). The layout is replaceable at override point payment.receipt_html.',
  ),
  input,
  output,
  permission: { entity: Payment.name, op: 'read' },
  tx: 'none',
  mutates: false,
  print: { entity: Payment.name, label: label('領収書を表示', 'View receipt'), when: { direction: 'receive' } },
  handler: (ctx, { id }) => render(ctx, id, 'receive', RECEIPT_HTML_OVERRIDE, defaultReceiptHtml),
});

export const renderPaymentNoticeHtmlAction = defineAction({
  name: 'payment.render_payment_notice_html',
  description: label(
    '確定済みの支払を支払通知書の HTML として描画します（金額・支払方法・仕入請求書ごとの支払額・前払金）。入金と下書きは INVALID_STATE。レイアウトは差し替え点 payment.payment_notice_html で置き換えられます。',
    'Render a submitted disbursement (支払) as an HTML payment notice (amount, method, per purchase invoice, advance). Receipts and drafts are refused (INVALID_STATE). The layout is replaceable at override point payment.payment_notice_html.',
  ),
  input,
  output,
  permission: { entity: Payment.name, op: 'read' },
  tx: 'none',
  mutates: false,
  print: { entity: Payment.name, label: label('支払通知書を表示', 'View payment notice'), when: { direction: 'pay' } },
  handler: (ctx, { id }) => render(ctx, id, 'pay', PAYMENT_NOTICE_HTML_OVERRIDE, defaultPaymentNoticeHtml),
});
