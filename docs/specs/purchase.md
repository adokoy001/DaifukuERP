# Spec: purchase（仕入・経費の請求書、買掛金、仕入税額控除と経過措置）

- 状態: approved ／ モジュール: modules/purchase ／ 依存: partner, product, tax, accounting
- ADR: 0006, 0008, 0010, 0011, 0013 ／ 作成: 2026-09-11 ／ 出典: docs/domain/japan-tax.md（インボイス 経過措置、仕入税額控除）

## 目的
仕入先・経費の請求書（受領した適格請求書／免税事業者からの請求）を伝票として持ち、買掛金と仮払消費税を転記する。免税事業者からの仕入れは**経過措置の控除率**（日付で 80→70→50→30→0%）を適用する。

## 受入基準（EARS）
- AC-1 THE SYSTEM SHALL provide document `purchase_invoice` (naming `{ prefix: 'BILL-', period: 'year' }`) with header: `partnerId` (ref partner required), `date` (date required default today), `supplierInvoiceNo` (text), `dueDate` (date; computed from the partner's terms when empty), `priceIncludesTax` (bool default true — 受領請求書は税込が多い), `subtotal`/`taxTotal`/`deductibleTax`/`nonDeductibleTax`/`total` (money computed), `paidAmount` (money default 0, allowOnSubmit), `balance` (money computed, allowOnSubmit), `status` (enum draft/open/paid/cancelled, allowOnSubmit), `supplierTaxStatus` (enum registered/exempt; copied from the partner at validate), `creditRatio` (decimal; 1 for registered suppliers, else the 経過措置 ratio for the date), `taxSummary` (json), `note`, `journalEntryId` (ref journal_entry nullable, allowOnSubmit). Lines = `purchase_invoice_line`: `invoiceId` (ref cascade), `seq`, `productId` (ref product nullable), `accountId` (ref account nullable — for expenses; when both empty → VALIDATION), `description` (required), `quantity` (default 1), `unitPrice` (required), `taxCategory` (required; default from product or the account's `taxCategoryDefault`), `amount` (computed).
- AC-2 WHEN validated THE SYSTEM SHALL compute line amounts and the tax summary (`taxSummaryFor`), then `deductibleTax = round(taxTotal × creditRatio)` per rate group (丸めは税率ごと、切捨て既定) and `nonDeductibleTax = taxTotal − deductibleTax`. `creditRatio` comes from `registry.override('purchase.exempt_supplier_credit_ratio', defaultRatio)` where the default returns Decimal 1 for registered suppliers and **Decimal 0 for exempt suppliers** (no transitional relief unless a country pack provides it — l10n/jp overrides with 0.8/0.7/0.5/0.3 by date).
- AC-3 WHEN submitted THE SYSTEM SHALL post via `postFromSource`: Dr expense/purchase accounts (line amounts; product lines use setting `purchase.accounts.purchases` default '5000', expense lines use their `accountId`), Dr 仮払消費税 ('1500') for `deductibleTax` (one line per rate), Dr the same expense/purchase account for `nonDeductibleTax` (控除不可分は費用に含める; one line, memo "控除対象外消費税"), Cr 買掛金 ('2100') for `total`. Set `status='open'`, `balance=total`.
- AC-4 WHEN cancelled THE SYSTEM SHALL refuse if `paidAmount > 0`, else reverse the entry and set `status='cancelled'`.
- AC-5 `purchase.ap_aging { asOf }` → TableResult like sales.ar_aging. `purchase.record_payment` / exported `applyPayment(ctx, …)` like sales (no posting).
- AC-6 Permissions: `purchasing` read/create/update/submit/cancel/amend; `accounting` read/update; `viewer` read; admin all.
- AC-7 Golden `test/golden/exempt-supplier.json`: a 税込 11,000 (10%) bill from an exempt supplier dated 2026-10-15 with a country-pack-style ratio 0.7 registered in the test via `registry.registerOverride` → taxable 10,000, tax 1,000, deductible 700, non-deductible 300; journal: Dr 5000 10,300 / Dr 1500 700 / Cr 2100 11,000. And the same bill dated 2026-09-15 with ratio 0.8 → 800/200. Derivation in the log.
- AC-8 DB tests cover AC-1..7 incl. account-line bills (経費) and the default ratio 0 behaviour without an override.

## 関係するファイル
modules/purchase/src/{index.ts, module.ts, entities/{purchase-invoice,purchase-invoice-line}.ts, services/{recalculate.ts, posting.ts}, hooks/{recalc.ts, submit.ts, cancel.ts}, actions/{ap-aging,record-payment}.ts, settings.ts (purchase.accounts = { purchases: '5000', payable: '2100', taxReceivable: '1500' })}, test/{recalculate.test.ts, purchase.db.test.ts, golden/exempt-supplier.json}. deps: kernel, mod-partner, mod-product, mod-tax, mod-accounting, zod. テスト DB: `daifuku_test_purchase`。

## スコープ外
発注・入荷・三点照合（Phase 3）、源泉徴収（Phase 2 の士業シナリオで検討）、1億円上限の判定（メモに残す）。
