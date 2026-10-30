// sales.render_invoice_html (spec AC-5): builds InvoiceRenderData (issuer from `sales.issuer`, else `company.profile`;
// recipient from the partner; money as Decimal strings) and hands it to registry.override('sales.invoice_html', ...).
import {
  defineAction,
  getCompany,
  label,
  registry,
  repo,
  StateError,
  DOCSTATUS,
  type Context,
  type Infer,
} from '@daifuku/kernel';
import { Partner } from '@daifuku/mod-partner';
import { issuerFromCompanyProfile, statusBanner, withStatusBanner } from '@daifuku/mod-print-layout';
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

/**
 * The issuer block (docs/specs/company-admin.md AC-7): `sales.issuer` when the company set it (the whole block wins);
 * otherwise built from `company.profile` — the legal name (else the company name), registration number, postal code,
 * address, phone and email. A stored `sales.issuer` that fails its schema is ignored like getSetting does.
 */
export function resolveIssuer(company: { name: string; settings: Readonly<Record<string, unknown>> }): {
  issuer: SalesIssuer;
  source: 'sales.issuer' | 'company.profile';
  invalidIssuer: boolean;
} {
  const raw = company.settings[SALES_ISSUER_KEY];
  const stored = raw === undefined ? undefined : salesIssuerSchema.safeParse(raw);
  if (stored?.success) return { issuer: stored.data, source: 'sales.issuer', invalidIssuer: false };
  // print-templates AC-9: the one company.profile -> issuer mapping lives in mod-print-layout.
  const issuer: SalesIssuer = issuerFromCompanyProfile(company);
  return { issuer, source: 'company.profile', invalidIssuer: stored !== undefined };
}

/** The addressee of a printed document from the partner master: name, postal code, prefecture + address lines. */
export function partnerAddressee(partner: {
  name: string;
  postalCode?: string | null;
  prefecture?: string | null;
  address1?: string | null;
  address2?: string | null;
}): InvoiceRenderData['recipient'] {
  const address = [partner.prefecture, partner.address1, partner.address2]
    .filter((s): s is string => typeof s === 'string' && s.length > 0)
    .join(' ');
  return defined<InvoiceRenderData['recipient']>({
    name: partner.name,
    postalCode: partner.postalCode,
    address: address || null,
  });
}

export async function loadIssuer(ctx: Context): Promise<SalesIssuer> {
  const resolved = resolveIssuer(await getCompany(ctx));
  if (resolved.invalidIssuer) ctx.log.warn('invalid company setting, using company.profile', { key: SALES_ISSUER_KEY });
  return resolved.issuer;
}

export async function buildInvoiceRenderData(ctx: Context, id: string): Promise<InvoiceRenderData> {
  const inv = await repo(ctx, SalesInvoice).get(id);
  // docs/specs/opening-balances.md AC-20: an opening invoice is an internal record dated the opening date, not the
  // original transaction date (記載事項②), so it is never rendered as a qualified invoice.
  if (inv.openingBalance)
    throw new StateError(
      `sales_invoice ${inv.number ?? inv.id} is an opening balance record and is not issued`,
      'Print or reissue the original invoice from the previous system; the opening invoice only tracks the open balance.',
      { reason: 'opening_balance', id: inv.id, number: inv.number },
    );
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
  return {
    issuer: defined<InvoiceRenderData['issuer']>(issuer),
    invoice: {
      number: inv.number ?? '',
      date: inv.date,
      dueDate: inv.dueDate,
      note: inv.note,
      priceIncludesTax: inv.priceIncludesTax,
    },
    recipient: partnerAddressee(partner),
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
  // print-templates AC-3: the record page of a submitted sales invoice offers this as 「請求書を表示」.
  print: { entity: SalesInvoice.name, label: label('請求書を表示', 'View invoice') },
  handler: async (ctx, { id }) => {
    const data = await buildInvoiceRenderData(ctx, id);
    const render = registry.override<InvoiceHtmlRenderer>(INVOICE_HTML_OVERRIDE, defaultInvoiceHtml);
    const html = render(data);
    return {
      html: withStatusBanner(html, data.invoice.docstatus === DOCSTATUS.cancelled ? statusBanner('cancelled') : ''),
    };
  },
});
