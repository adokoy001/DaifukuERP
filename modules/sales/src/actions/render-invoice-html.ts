// sales.render_invoice_html (spec AC-5): builds InvoiceRenderData (issuer from `sales.issuer`, recipient from the
// partner, money as Decimal strings) and hands it to registry.override('sales.invoice_html', defaultInvoiceHtml).
import {
  defineAction,
  getCompany,
  getSetting,
  label,
  registry,
  repo,
  StateError,
  DOCSTATUS,
  type Context,
  type Infer,
} from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { z } from 'zod';
import { SalesInvoice } from '../entities/sales-invoice.ts';
import { loadInvoiceLines } from '../recalculate.ts';
import { rateOfCategory } from '../services/recalculate.ts';
import { defaultInvoiceHtml, type InvoiceHtmlRenderer, type InvoiceRenderData } from '../services/render-html.ts';
import { SALES_ISSUER_KEY, salesIssuerSchema, type SalesIssuer } from '../settings.ts';

/** Override point for the HTML layout (ADR-0008). */
export const INVOICE_HTML_OVERRIDE = 'sales.invoice_html';

/** Drops undefined/null keys so optional properties are absent, not undefined (exactOptionalPropertyTypes). */
function defined<T>(o: object): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as T;
}

/** The issuer block: `sales.issuer`, or just the company name when the setting is not set. */
export async function loadIssuer(ctx: Context): Promise<SalesIssuer> {
  const company = await getCompany(ctx);
  return getSetting(ctx, SALES_ISSUER_KEY, salesIssuerSchema, { name: company.name });
}

export async function buildInvoiceRenderData(ctx: Context, id: string): Promise<InvoiceRenderData> {
  const inv = await repo(ctx, SalesInvoice).get(id);
  if (inv.docstatus !== DOCSTATUS.draft) {
    if (!inv.issuedSnapshot)
      throw new StateError(
        'Issued invoice snapshot is unavailable',
        'This invoice predates snapshot support; restore its original issued document before reprinting.',
      );
    return {
      ...inv.issuedSnapshot,
      invoice: { ...inv.issuedSnapshot.invoice, docstatus: inv.docstatus },
      locale: ctx.locale,
    };
  }
  return buildLiveInvoiceRenderData(ctx, inv);
}

/** Used for draft preview and once, in the posting transaction, to capture the issued facts. */
export async function buildLiveInvoiceRenderData(
  ctx: Context,
  inv: Infer<typeof SalesInvoice>,
): Promise<InvoiceRenderData> {
  const lines = await loadInvoiceLines(ctx, inv.id);
  const partner = await repo(ctx, Partner).get(inv.partnerId);
  const issuer = await loadIssuer(ctx);
  const taxSummary = inv.taxSummary ?? [];
  const address = [partner.prefecture, partner.address1, partner.address2]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(' ');
  return {
    issuer: defined<InvoiceRenderData['issuer']>(issuer),
    invoice: {
      number: inv.number ?? '',
      date: inv.date,
      dueDate: inv.dueDate,
      note: inv.note,
      priceIncludesTax: inv.priceIncludesTax,
    },
    recipient: defined<InvoiceRenderData['recipient']>({
      name: partner.name,
      postalCode: partner.postalCode,
      address: address || null,
    }),
    lines: lines.map((l) => ({
      seq: l.seq,
      ...(l.uomCode ? { uomCode: l.uomCode } : {}),
      description: l.description,
      quantity: l.quantity.toString(),
      unitPrice: l.unitPrice.toString(),
      amount: l.amount.toString(),
      taxCategory: l.taxCategory,
      rate: rateOfCategory(taxSummary, l.taxCategory),
    })),
    taxSummary: taxSummary.map((g) => ({
      category: g.category,
      rate: g.rate,
      taxable: g.taxable,
      tax: g.tax,
      gross: g.gross,
    })),
    totals: { subtotal: inv.subtotal.toString(), taxTotal: inv.taxTotal.toString(), total: inv.total.toString() },
    locale: ctx.locale,
  };
}

export const renderInvoiceHtmlAction = defineAction({
  name: 'sales.render_invoice_html',
  description: label(
    '売上請求書を適格請求書の HTML として描画します（発行者・登録番号、税率ごとの対価の額と消費税額、軽減税率対象の※印）。レイアウトは差し替え点 sales.invoice_html で置き換えられます。',
    'Render a sales invoice as qualified-invoice HTML (issuer + registration number, per-rate amounts and tax, reduced-rate marker). The layout is replaceable at override point sales.invoice_html.',
  ),
  input: z.object({ id: z.uuid() }),
  output: z.object({ html: z.string() }),
  permission: { entity: SalesInvoice.name, op: 'read' },
  tx: 'none',
  mutates: false,
  handler: async (ctx, { id }) => {
    const data = await buildInvoiceRenderData(ctx, id);
    const render = registry.override<InvoiceHtmlRenderer>(INVOICE_HTML_OVERRIDE, defaultInvoiceHtml);
    const html = render(data);
    const banner =
      data.invoice.docstatus === DOCSTATUS.cancelled
        ? '<p role="status" style="border:2px solid #b91c1c;padding:12px;color:#b91c1c;font-weight:bold">取消済み / CANCELLED</p>'
        : '';
    return {
      html: banner
        ? /<body[^>]*>/i.test(html)
          ? html.replace(/<body([^>]*)>/i, `<body$1>${banner}`)
          : banner + html
        : html,
    };
  },
});
