// Pure: the document fields a settlement line needs before submit (spec AC-5, AC-6, D21). A taxable line (standard /
// reduced) names its payee and the document kept: a qualified invoice needs the registration number (T + 13 digits),
// books-only needs its reason. Zero-rate categories need none of them (the hooks clear them on save).
import { isZeroRateCategory, type TaxCategory } from '@daifuku/mod-tax';

export interface InvoiceIssue {
  path: string;
  message: string;
}

export interface InvoiceFields {
  taxCategory?: unknown;
  invoiceKind?: unknown;
  invoiceRegistrationNo?: unknown;
  booksOnlyReason?: unknown;
  payeeName?: unknown;
}

const blank = (v: unknown) => typeof v !== 'string' || v.trim() === '';

export function invoiceIssues(line: InvoiceFields, path: string): InvoiceIssue[] {
  if (isZeroRateCategory(String(line.taxCategory) as TaxCategory)) return [];
  const issues: InvoiceIssue[] = [];
  if (blank(line.invoiceKind)) issues.push({ path: `${path}.invoiceKind`, message: 'required for a taxable line' });
  if (line.invoiceKind === 'qualified' && blank(line.invoiceRegistrationNo))
    issues.push({ path: `${path}.invoiceRegistrationNo`, message: 'required for a qualified invoice (T + 13 digits)' });
  if (line.invoiceKind === 'books_only' && blank(line.booksOnlyReason))
    issues.push({ path: `${path}.booksOnlyReason`, message: 'required for books-only' });
  if (blank(line.payeeName))
    issues.push({ path: `${path}.payeeName`, message: 'required for a taxable line (the books name the payee)' });
  return issues;
}
