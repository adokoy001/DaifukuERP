# Spec: accounting（勘定科目・会計期間・仕訳・台帳・試算表）

- 状態: approved ／ モジュール: modules/accounting ／ 依存: partner（明細の取引先参照）
- ADR: 0005（append-only 台帳）, 0006, 0010, 0013 ／ 作成: 2026-09-10 ／ 出典: research/02 §4, docs/domain/japan-tax.md

## 目的
複式簿記の台帳を kernel の document/lines/aggregate ポートだけで実装する。転記後の仕訳は不変、訂正は逆仕訳、期間締め、試算表。

## 受入基準（EARS）
- AC-1 THE SYSTEM SHALL provide `account` (company-scoped): `code` (text required unique immutable), `name` (text required), `nameKana`?, `type` (enum asset/liability/equity/revenue/expense, required), `subtype` (text, e.g. 現金預金/売掛金/買掛金/仮受消費税/仮払消費税/売上/仕入/販管費…), `isActive` (bool default true), `taxCategoryDefault` (enum standard/reduced/exempt/non_taxable/out_of_scope, nullable), `partnerRequired` (bool default false; 売掛金/買掛金 は true). Permissions: accounting read/create/update, viewer read, admin all.
- AC-2 THE SYSTEM SHALL provide `fiscal_year` (`code` e.g. 'FY2026', `startDate`, `endDate`, `isClosed` bool default false) and `fiscal_period` (`fiscalYearId` ref, `startDate`, `endDate`, `isClosed`). Action `accounting.open_fiscal_year { startDate }` creates the year and 12 monthly periods (任意開始月). Overlapping years are rejected.
- AC-3 THE SYSTEM SHALL provide document `journal_entry` with naming `{ prefix: 'JE-', period: 'year' }`: `date` (required), `description` (text), `sourceEntity` (text nullable), `sourceId` (uuid nullable), `reversalOf` (ref journal_entry nullable), `totalDebit`/`totalCredit` (money, computed on validate), lines = `journal_line`: `entryId` (ref journal_entry, cascade), `seq` (int), `accountId` (ref account required), `debit` (money default '0'), `credit` (money default '0'), `partnerId` (ref partner nullable), `taxCategory` (enum nullable), `taxRate` (decimal nullable), `memo` (text).
- AC-4 WHEN a journal_entry is submitted THE SYSTEM SHALL (before_submit hook) verify: at least 2 lines; every line has debit XOR credit > 0; Σdebit == Σcredit (Decimal, exact); date falls in an open fiscal_period (else INVALID_STATE with hint "open the period or change the date"); accounts with `partnerRequired` have a partner. On success set totals.
- AC-5 WHILE a journal_entry is submitted THE SYSTEM SHALL refuse any change to its lines (kernel lines freeze) and to header fields except `description` (allowOnSubmit).
- AC-6 WHEN `accounting.reverse_entry { id, date? }` is called on a submitted entry THE SYSTEM SHALL create and submit a new entry with debit/credit swapped, `reversalOf` set, description "逆仕訳: <number>", and emit `journal_entry.reversed`. Cancel of a submitted journal_entry is **not allowed** (before_cancel hook throws with hint "use accounting.reverse_entry"); ADR-0005.
- AC-7 WHEN `accounting.post_from_source { sourceEntity, sourceId, date, description, lines }` is called (internal action used by sales/purchase/payment) THE SYSTEM SHALL create+submit a journal_entry linked to the source, or fail atomically; calling it twice for the same source is rejected (Conflict) unless the previous entry was reversed.
- AC-8 WHEN `accounting.trial_balance { from, to }` is called THE SYSTEM SHALL return a TableResult (docs/conventions/reports.md) with one row per account: code, name, type, openingDebit/openingCredit (before `from`), periodDebit, periodCredit, closingBalance; totals row; only submitted entries; computed with the kernel aggregate port (no raw SQL).
- AC-9 WHEN `accounting.general_ledger { accountId, from, to }` is called THE SYSTEM SHALL return a TableResult of lines in date order with running balance.
- AC-10 WHEN `accounting.close_period { periodId }` is called by `accounting` or `admin` THE SYSTEM SHALL set isClosed and refuse further submits dated in it; `reopen_period` reverses (audit both).
- AC-11 Seeds: no CoA here (l10n/jp seeds the Japanese chart); seed only a `fiscal_year` for the current year (Jan–Dec) if none exists.
- AC-12 Property tests: random balanced entries always submit; random unbalanced always fail; reversal of any submitted entry leaves every account's net (debit−credit) unchanged (aggregate check).

## 関係するファイル
modules/accounting/src/{index.ts, module.ts, entities/{account,fiscal-year,fiscal-period,journal-entry,journal-line}.ts, services/{balance.ts (pure validation), periods.ts (pure)}, hooks/{validate-entry.ts, no-cancel.ts}, actions/{open-fiscal-year,reverse-entry,post-from-source,trial-balance,general-ledger,close-period}.ts, seeds/fiscal-year.ts}, test/{balance.test.ts, accounting.db.test.ts}. テスト DB: `daifuku_test_accounting`。package deps: @daifuku/kernel, @daifuku/mod-partner, zod.

## スコープ外
多通貨（JPY のみ。通貨列は持たない）、部門などの分析軸（ext で代替）、BS/PL の帳票（reports モジュール）、固定資産。

## 検証手順
`pnpm gate`; modules.ts に追加（partner の後）; `pnpm db:generate && pnpm db:reset`; curl で open_fiscal_year → journal_entry.create(lines) → submit → trial_balance。
