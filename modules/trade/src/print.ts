// Print actions of the trade workflow (docs/specs/print-templates.md AC-10〜AC-12, AC-17, AC-19〜AC-21): 見積書
// (trade_quotation), 注文書 (trade_order, direction purchase) and 納品書 (trade_fulfillment, direction sales). Each reads
// its document, lines, partner and (delivery note) order through the caller's Context — the sales / purchasing row
// rules apply — builds plain render data from stored values and renders it with an overridable layout (ADR-0008).
import {
  defineAction,
  DOCSTATUS,
  label,
  registry,
  repo,
  StateError,
  type Context,
  type EntityDef,
  type Infer,
} from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import {
  definedProps,
  loadPrintTools,
  statusBanner,
  sumDecimals,
  withStatusBanner,
  type PrintIssuer,
} from '@daifuku/mod-print-layout';
import { loadIssuer, partnerAddressee, rateLabel } from '@daifuku/mod-sales';
import { TAX_CATEGORIES, TAX_CATEGORY_LABELS, isTaxCategory } from '@daifuku/mod-tax';
import { z } from 'zod';
import {
  TradeFulfillment,
  TradeFulfillmentLine,
  TradeOrder,
  TradeOrderLine,
  TradeQuotation,
  TradeQuotationLine,
} from './entities.ts';
import { all } from './internal.ts';
import {
  defaultDeliveryNoteHtml,
  defaultOrderHtml,
  defaultQuotationHtml,
  type DeliveryNoteHtmlRenderer,
  type DeliveryNoteRenderData,
  type OrderHtmlRenderer,
  type QuotationHtmlRenderer,
  type TradeEstimateRenderData,
  type TradePrintLine,
} from './print-html.ts';

/** Override points (ADR-0008), one per document. */
export const QUOTATION_HTML_OVERRIDE = 'trade.quotation_html';
export const ORDER_HTML_OVERRIDE = 'trade.order_html';
export const DELIVERY_NOTE_HTML_OVERRIDE = 'trade.delivery_note_html';

type TaxRow = { category: string; rate: string; taxable: string; tax: string; gross: string };
type LineRow = Infer<typeof TradeQuotationLine>;

function taxRows(raw: unknown): TaxRow[] {
  return Array.isArray(raw)
    ? (raw as Record<string, unknown>[]).map((g) => ({
        category: String(g.category),
        rate: String(g.rate),
        taxable: String(g.taxable),
        tax: String(g.tax),
        gross: String(g.gross),
      }))
    : [];
}

function categoryName(category: string, locale: 'ja' | 'en'): string {
  return isTaxCategory(category) ? TAX_CATEGORY_LABELS[category][locale] : category;
}

function printLine(l: LineRow, taxLabel: string): TradePrintLine {
  return {
    seq: l.seq,
    description: l.description,
    quantity: l.quantity.toString(),
    ...(l.uomCode ? { uomCode: l.uomCode } : {}),
    unitPrice: l.unitPrice.toString(),
    amount: l.amount.toString(),
    taxCategory: l.taxCategory,
    taxLabel,
  };
}

async function linesOf(ctx: Context, entity: EntityDef, field: string, id: string): Promise<LineRow[]> {
  return (await all(ctx, entity, {
    where: { [field]: id },
    orderBy: [{ field: 'seq', dir: 'asc' }],
  })) as unknown as LineRow[];
}

async function issuerOf(ctx: Context): Promise<PrintIssuer> {
  return definedProps<PrintIssuer>(await loadIssuer(ctx));
}

/** AC-17: the banner the action puts on the (possibly overridden) layout. */
function bannerFor(docstatus: number): string {
  if (docstatus === DOCSTATUS.draft) return statusBanner('draft');
  if (docstatus === DOCSTATUS.cancelled) return statusBanner('cancelled');
  return '';
}

/** 見積書 / 注文書 render data: the head's stored estimate (subtotal, taxTotal, total, taxSummary) and its lines. */
export async function buildEstimateRenderData(
  ctx: Context,
  kind: 'quotation' | 'order',
  id: string,
): Promise<TradeEstimateRenderData> {
  const head = kind === 'quotation' ? await repo(ctx, TradeQuotation).get(id) : await repo(ctx, TradeOrder).get(id);
  if (kind === 'order' && head.direction !== 'purchase')
    throw new StateError(
      'A purchase order is printed for a purchase-direction trade order only',
      'Sales orders have no printed document (注文請書 is out of scope); print the quotation or the delivery note instead.',
    );
  const lines =
    kind === 'quotation'
      ? await linesOf(ctx, TradeQuotationLine, 'quotationId', head.id)
      : await linesOf(ctx, TradeOrderLine, 'orderId', head.id);
  const partner = await repo(ctx, Partner).get(head.partnerId);
  const issuer = await issuerOf(ctx);
  const summary = taxRows(head.taxSummary);
  const recipient = partnerAddressee(partner);
  return {
    issuer,
    recipient: { ...recipient, name: head.partnerName ?? partner.name },
    document: {
      number: head.number ?? '',
      date: head.date,
      docstatus: head.docstatus,
      validUntil: 'validUntil' in head ? (head.validUntil ?? null) : null,
      requiredDate: 'requiredDate' in head ? (head.requiredDate ?? null) : null,
      note: head.note ?? null,
    },
    lines: lines.map((l) => {
      const rate = summary.find((g) => g.category === l.taxCategory)?.rate ?? '0';
      return printLine(l, rateLabel(l.taxCategory, rate, ctx.locale));
    }),
    taxSummary: summary.map((g) => ({ ...g, label: rateLabel(g.category, g.rate, ctx.locale) })),
    totals: { subtotal: head.subtotal.toString(), taxTotal: head.taxTotal.toString(), total: head.total.toString() },
    locale: ctx.locale,
  };
}

/** 納品書 render data: the shipment's stored lines; per-category totals are additions of the stored amounts (AC-7). */
export async function buildDeliveryNoteRenderData(ctx: Context, id: string): Promise<DeliveryNoteRenderData> {
  const head = await repo(ctx, TradeFulfillment).get(id);
  if (head.direction !== 'sales')
    throw new StateError(
      'A delivery note is printed for a shipment (direction sales) only',
      'Receipts of goods (入荷) have no printed document in this version.',
    );
  const lines = await linesOf(ctx, TradeFulfillmentLine, 'fulfillmentId', head.id);
  const order = await repo(ctx, TradeOrder).get(head.orderId);
  const partner = await repo(ctx, Partner).get(head.partnerId);
  const issuer = await issuerOf(ctx);
  const categories = [...new Set(lines.map((l) => l.taxCategory as string))].sort(
    (a, b) => TAX_CATEGORIES.indexOf(a as never) - TAX_CATEGORIES.indexOf(b as never),
  );
  const recipient = partnerAddressee(partner);
  return {
    issuer,
    recipient: { ...recipient, name: head.partnerName ?? partner.name },
    document: {
      number: head.number ?? '',
      date: head.date,
      docstatus: head.docstatus,
      orderNumber: order.number ?? null,
      note: head.note ?? null,
    },
    lines: lines.map((l) => printLine(l, categoryName(l.taxCategory, ctx.locale))),
    categoryTotals: categories.map((category) => ({
      category,
      label: categoryName(category, ctx.locale),
      amount: sumDecimals(lines.filter((l) => l.taxCategory === category).map((l) => l.amount.toString())),
    })),
    total: sumDecimals(lines.map((l) => l.amount.toString())),
    locale: ctx.locale,
  };
}

const output = z.object({ html: z.string() });
const input = z.object({ id: z.uuid() });

export const renderQuotationHtmlAction = defineAction({
  name: 'trade.render_quotation_html',
  description: label(
    '見積書を HTML として描画します（保存済みの見込額・税率別内訳。下書きは帯付き）。レイアウトは差し替え点 trade.quotation_html で置き換えられます。',
    'Render a quotation as HTML (stored estimate and per-rate breakdown; drafts carry a banner). The layout is replaceable at override point trade.quotation_html.',
  ),
  input,
  output,
  permission: { entity: TradeQuotation.name, op: 'read' },
  tx: 'none',
  mutates: false,
  print: { entity: TradeQuotation.name, label: label('見積書を表示', 'View quotation') },
  handler: async (ctx, { id }) => {
    const data = await buildEstimateRenderData(ctx, 'quotation', id);
    const tools = await loadPrintTools(ctx);
    const render = registry.override<QuotationHtmlRenderer>(QUOTATION_HTML_OVERRIDE, defaultQuotationHtml);
    return { html: withStatusBanner(render(data, tools), bannerFor(data.document.docstatus)) };
  },
});

export const renderOrderHtmlAction = defineAction({
  name: 'trade.render_order_html',
  description: label(
    '発注（direction purchase）の受発注書を注文書の HTML として描画します。受注は対象外（INVALID_STATE）。レイアウトは差し替え点 trade.order_html で置き換えられます。',
    'Render a purchase-direction trade order as a purchase order (HTML). Sales orders are refused (INVALID_STATE). The layout is replaceable at override point trade.order_html.',
  ),
  input,
  output,
  permission: { entity: TradeOrder.name, op: 'read' },
  tx: 'none',
  mutates: false,
  print: {
    entity: TradeOrder.name,
    label: label('注文書を表示', 'View purchase order'),
    when: { direction: 'purchase' },
  },
  handler: async (ctx, { id }) => {
    const data = await buildEstimateRenderData(ctx, 'order', id);
    const tools = await loadPrintTools(ctx);
    const render = registry.override<OrderHtmlRenderer>(ORDER_HTML_OVERRIDE, defaultOrderHtml);
    return { html: withStatusBanner(render(data, tools), bannerFor(data.document.docstatus)) };
  },
});

export const renderDeliveryNoteHtmlAction = defineAction({
  name: 'trade.render_delivery_note_html',
  description: label(
    '出荷（direction sales）を納品書の HTML として描画します（税区分ごとの税抜合計。消費税額は請求書に記載）。入荷は対象外（INVALID_STATE）。レイアウトは差し替え点 trade.delivery_note_html で置き換えられます。',
    'Render a shipment (direction sales) as a delivery note (HTML; net totals by tax category, tax stated on the invoice). Goods receipts are refused (INVALID_STATE). The layout is replaceable at override point trade.delivery_note_html.',
  ),
  input,
  output,
  permission: { entity: TradeFulfillment.name, op: 'read' },
  tx: 'none',
  mutates: false,
  print: {
    entity: TradeFulfillment.name,
    label: label('納品書を表示', 'View delivery note'),
    when: { direction: 'sales' },
  },
  handler: async (ctx, { id }) => {
    const data = await buildDeliveryNoteRenderData(ctx, id);
    const tools = await loadPrintTools(ctx);
    const render = registry.override<DeliveryNoteHtmlRenderer>(DELIVERY_NOTE_HTML_OVERRIDE, defaultDeliveryNoteHtml);
    return { html: withStatusBanner(render(data, tools), bannerFor(data.document.docstatus)) };
  },
});

export const tradePrintActions = [renderQuotationHtmlAction, renderOrderHtmlAction, renderDeliveryNoteHtmlAction];
