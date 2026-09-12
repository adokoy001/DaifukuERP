// Contract of the `sales.invoice_html` override, copied from docs/specs/sales.md#InvoiceRenderData.
// l10n/jp must not import modules/sales (spec l10n-jp.md AC-4), so the shape lives here and is validated at runtime with zod;
// the orchestrator reconciles this copy against `InvoiceRenderData` exported by @daifuku/mod-sales.
import { Decimal, isLocalDate } from '@daifuku/kernel';
import { z } from 'zod';

/** Override point exposed by modules/sales (docs/specs/sales.md AC-5). */
export const INVOICE_HTML_OVERRIDE = 'sales.invoice_html';

export interface InvoiceRenderData {
  issuer: { name: string; invoiceRegistrationNo?: string; postalCode?: string; address?: string; phone?: string; email?: string; bankInfo?: string };
  invoice: { docstatus?: number; number: string; date: string; dueDate: string | null; note: string | null; priceIncludesTax: boolean };
  recipient: { name: string; postalCode?: string; address?: string };
  lines: Array<{ uomCode?: string; seq: number; description: string; quantity: string; unitPrice: string; amount: string; taxCategory: string; rate: string }>;
  /** rate '0.10' etc.; money as Decimal strings */
  taxSummary: Array<{ category: string; rate: string; taxable: string; tax: string; gross: string }>;
  totals: { subtotal: string; taxTotal: string; total: string };
  locale: 'ja' | 'en';
}
export type InvoiceHtmlRenderer = (data: InvoiceRenderData) => string;

const money = z.string().refine((s) => Decimal.isDecimalString(s), { message: 'must be a decimal string' });
const localDate = z.string().refine((s) => isLocalDate(s), { message: 'must be YYYY-MM-DD' });
const text = z.string();

export const invoiceRenderDataSchema = z.object({
  issuer: z.object({
    name: text,
    invoiceRegistrationNo: text.optional(),
    postalCode: text.optional(),
    address: text.optional(),
    phone: text.optional(),
    email: text.optional(),
    bankInfo: text.optional(),
  }),
  invoice: z.object({
    docstatus: z.number().int().optional(),
    number: text,
    date: localDate,
    dueDate: localDate.nullable(),
    note: text.nullable(),
    priceIncludesTax: z.boolean(),
  }),
  recipient: z.object({ name: text, postalCode: text.optional(), address: text.optional() }),
  lines: z.array(
    z.object({ uomCode: text.optional(), seq: z.number().int(), description: text, quantity: money, unitPrice: money, amount: money, taxCategory: text, rate: money }),
  ),
  taxSummary: z.array(z.object({ category: text, rate: money, taxable: money, tax: money, gross: money })),
  totals: z.object({ subtotal: money, taxTotal: money, total: money }),
  locale: z.enum(['ja', 'en']),
});

/** What the renderer works with after validation (optional keys may be `undefined`; the interface above keeps the spec's exact shape). */
export type ParsedInvoiceRenderData = z.output<typeof invoiceRenderDataSchema>;
