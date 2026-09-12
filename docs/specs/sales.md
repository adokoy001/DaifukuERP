# Spec: sales（売上請求書・適格請求書・売掛金）

- 状態: approved ／ モジュール: modules/sales ／ 依存: partner, product, tax, accounting
- ADR: 0006, 0008, 0010, 0011, 0013 ／ 作成: 2026-09-11 ／ 出典: docs/domain/japan-tax.md（インボイス）

## 目的
見積・受注は後回し（薄く広く）。**売上請求書**を伝票として持ち、適格請求書の記載事項・税率ごとの丸め・支払期日・会計転記・売掛残高を扱う。

## 受入基準（EARS）
- AC-1 THE SYSTEM SHALL provide document `sales_invoice` (naming `{ prefix: 'INV-', period: 'year' }`) with header: `partnerId` (ref partner, required), `date` (date, required, default today), `dueDate` (date; computed on validate from the partner's closing/payment terms via `@daifuku/mod-partner`'s `computeDueDate` when empty), `priceIncludesTax` (bool; default from tax setting), `subtotal`/`taxTotal`/`total` (money, computed), `paidAmount` (money default 0, allowOnSubmit), `balance` (money, computed = total − paidAmount, allowOnSubmit), `status` (enum draft/open/paid/cancelled, default draft, allowOnSubmit), `taxSummary` (json: the tax module's summary rows), `note` (text multiline), `journalEntryId` (ref journal_entry nullable, allowOnSubmit). Lines = `sales_invoice_line`: `invoiceId` (ref, cascade), `seq`, `productId` (ref product nullable), `description` (text required), `quantity` (quantity default 1), `unitPrice` (money required), `taxCategory` (enum, required; defaulted from the product), `amount` (money, computed = quantity × unitPrice, unrounded).
- AC-2 WHEN a sales_invoice is created or updated with lines (before_validate / before_update hooks + a `sales.recalculate` internal function) THE SYSTEM SHALL fill `description/unitPrice/taxCategory` from the product when omitted, compute line amounts, call `taxSummaryFor` from `@daifuku/mod-tax` (date = invoice date) and set subtotal/taxTotal/total/taxSummary; rounding follows the company's `tax.rounding` (税率ごとに1回, 国税庁 Q&A 問57).
- AC-3 WHEN a sales_invoice is submitted THE SYSTEM SHALL require ≥1 line and a partner, recompute totals, set `status='open'`, `balance=total`, and post to accounting via `postFromSource` from `@daifuku/mod-accounting`: Dr 売掛金 (total) / Cr 売上高 (subtotal, per line, with the line's taxCategory/taxRate on the journal line) / Cr 仮受消費税 (taxTotal, one line per rate). Account codes come from setting `sales.accounts` = `{ receivable: '1300', revenue: '4000', taxPayable: '2200' }` (defaults; registered with registerSetting) resolved by `account.code`. If an account code does not exist → INVALID_STATE with hint "seed the chart of accounts (l10n/jp) or set sales.accounts".
- AC-4 WHEN a submitted sales_invoice is cancelled THE SYSTEM SHALL refuse if `paidAmount > 0` (hint: reverse the payment first), otherwise reverse the journal entry via `reverseEntry`, set `status='cancelled'`.
- AC-5 WHEN `sales.render_invoice_html { id }` is called THE SYSTEM SHALL return `{ html }` for the 適格請求書: issuer name + registration number (`T` + 13 digits) from setting `sales.issuer` = `{ name, invoiceRegistrationNo?, postalCode?, address?, phone?, email?, bankInfo? }`, invoice number/date/due date, recipient name, lines, **税率ごとに区分した対価の額（税抜/税込）と適用税率、税率ごとの消費税額**, 軽減税率対象の明示（※印）, total. The layout is obtained via `registry.override('sales.invoice_html', defaultRenderer)` so `l10n/jp` can replace it (ADR-0008). Default renderer: minimal semantic HTML with inline CSS, ja labels.
- AC-6 WHEN `sales.ar_aging { asOf }` is called THE SYSTEM SHALL return a TableResult: per partner, open balance bucketed by days overdue (not due / 1–30 / 31–60 / 61–90 / 90+) using `dueDate`, plus totals — built with the kernel aggregate/list ports.
- AC-7 WHEN `sales.record_payment { invoiceId, amount, date }` (internal function `applyPayment(ctx, …)` exported for the payment module) is called THE SYSTEM SHALL increase `paidAmount`, recompute `balance`, set `status='paid'` when balance is 0, reject over-payment (VALIDATION). This function does NOT post to accounting (the payment module does).
- AC-8 Permissions: `sales` read/create/update/submit/cancel/amend on invoice + lines; `accounting` read/update (payment application touches allowOnSubmit fields); `viewer` read; admin all.
- AC-9 Golden test `test/golden/invoice-posting.json`: an invoice with 3 lines (10%: 1,234 + 567; 8%: 1,333) → subtotal 3,134, tax 10%: 180 (切捨て) and 8%: 106, total 3,420, and the exact journal lines; derivation in the log.
- AC-10 DB tests cover AC-1..9 incl. the cancel-after-payment refusal and that the reversal leaves the trial balance unchanged.

## InvoiceRenderData（`sales.invoice_html` override の契約。l10n/jp は sales を import せず、この形を受け取る）
```ts
export interface InvoiceRenderData {
  issuer: { name: string; invoiceRegistrationNo?: string; postalCode?: string; address?: string; phone?: string; email?: string; bankInfo?: string };
  invoice: { number: string; date: string; dueDate: string | null; note: string | null; priceIncludesTax: boolean };
  recipient: { name: string; postalCode?: string; address?: string };
  lines: Array<{ seq: number; description: string; quantity: string; unitPrice: string; amount: string; taxCategory: string; rate: string }>;
  taxSummary: Array<{ category: string; rate: string; taxable: string; tax: string; gross: string }>;  // rate '0.10' etc.; money as Decimal strings
  totals: { subtotal: string; taxTotal: string; total: string };
  locale: 'ja' | 'en';
}
export type InvoiceHtmlRenderer = (data: InvoiceRenderData) => string;
```
`sales.render_invoice_html` builds this object (issuer from `sales.issuer`, recipient from the partner, money via `Decimal.toString()`), then calls `registry.override('sales.invoice_html', defaultRenderer)(data)`.

## 関係するファイル
modules/sales/src/{index.ts, module.ts, entities/{sales-invoice,sales-invoice-line}.ts, services/{recalculate.ts (pure: line amounts + summary shaping), posting.ts (pure: journal lines from totals), render-html.ts (default template)}, hooks/{recalc.ts, submit.ts, cancel.ts}, actions/{render-invoice-html,ar-aging,record-payment}.ts, settings.ts (sales.accounts, sales.issuer)}, test/{recalculate.test.ts, sales.db.test.ts, golden/invoice-posting.json}. package deps: @daifuku/kernel, @daifuku/mod-partner, @daifuku/mod-product, @daifuku/mod-tax, @daifuku/mod-accounting, zod. テスト DB: `daifuku_test_sales`。テストでは accounts を自前でシード（1300/4000/2200 等）。

## スコープ外
見積・受注・納品書（Phase 3）、合計請求書（Phase 2 の卸売シナリオで検討）、PDF 化（HTML まで）、多通貨。
