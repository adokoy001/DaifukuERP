# Spec: tax（消費税コード・税率×期間・税計算サービス）

- 状態: approved ／ モジュール: modules/tax ／ 依存: なし（kernel のみ。product の taxCategory と同じ enum を共有するが import はしない）
- ADR: 0010, 0011, 0013 ／ 作成: 2026-09-10 ／ 出典: docs/domain/japan-tax.md

## 目的
日本の消費税を「税区分（カテゴリ）→ 日付で有効な税率」で解決し、明細ごとの税額と伝票単位の税額集計（丸めは税率ごとに1回）を純粋関数で計算する。2027-04 の飲食料品 1% 案のような率追加が**データの追加だけ**で済むことを担保する。

## 受入基準（EARS）
- AC-1 THE SYSTEM SHALL provide entity `tax_rate` (company-scoped): `category` (enum standard/reduced/exempt/non_taxable/out_of_scope, required), `rate` (decimal, e.g. '0.10', required, min '0'), `validFrom` (date, required), `validTo` (date, nullable), `label` (text, required, e.g. '標準10%'), `code` (text, required, unique, immutable; e.g. 'STD10', 'RED8', 'EXEMPT', 'NONTAX', 'OOS'). Overlapping periods for the same category are rejected on create/update (before_validate hook) with a VALIDATION error naming the conflicting code.
- AC-2 WHEN `resolveRate(rates, category, date)` (pure function) is called THE SYSTEM SHALL return the rate whose period contains the date; `exempt/non_taxable/out_of_scope` resolve to rate 0 with the category preserved; no match → error with hint "add a tax_rate row for <category> covering <date>".
- AC-3 WHEN `computeLineTax({ amount, category, rate, priceIncludesTax })` is called THE SYSTEM SHALL return `{ taxable, tax, gross }` as Decimal **without rounding** (rounding happens at the summary step).
- AC-4 WHEN `summarizeTax(lines, { roundingMode, scale })` is called THE SYSTEM SHALL group lines by (category, rate), sum taxable amounts, compute tax **once per group** and round it once (四捨五入/切捨て/切上げ), returning `[{ category, rate, taxable, tax }]` plus totals — this is the 適格請求書 rule「1適格請求書につき税率ごとに1回」(国税庁 Q&A 問57).
- AC-5 THE SYSTEM SHALL expose company settings `tax.rounding` = `{ mode: 'half_up'|'down'|'up' (default 'down'), unit: 'invoice'|'delivery_note' (default 'invoice') }` and `tax.price_includes_tax` (bool, default false; setting keys are snake_case per kernel registerSetting) via kernel `getSetting/setSetting` with zod schemas exported from the module, and an action `tax.get_settings` / `tax.set_settings`.
- AC-6 WHEN `tax.resolve` action is called with `{ category, date }` THE SYSTEM SHALL return `{ code, rate, label }` using the company's tax_rate rows.
- AC-7 WHEN `tax.summarize` action is called with `{ date, priceIncludesTax?, lines: [{ amount, category }] }` THE SYSTEM SHALL return the AC-4 summary using the company's rates and rounding settings (this is what sales/purchase documents call on validate/submit).
- AC-8 Seeds (idempotent, per company): STD10 standard 0.10 from 2019-10-01; RED8 reduced 0.08 from 2019-10-01; EXEMPT/NONTAX/OOS rate 0 from 2019-10-01. Also `tax_rate` rows for the pre-2019 8% standard (2014-04-01〜2019-09-30) so historical dates resolve.
- AC-9 Property tests (fast-check): for random line sets, `sum(group.taxable) == sum(lines.amount)` (tax-exclusive mode); rounding never changes the sign; adding a new rate row `RED1` reduced 0.01 valid from 2027-04-01 makes `resolveRate(reduced, '2027-04-01')` return 0.01 and `'2027-03-31'` return 0.08 with no code change (golden test).
- AC-10 Golden test: `test/golden/invoice-rounding.json` with 3 invoices (mixed 10%/8%, 端数 cases) whose expected tax per rate is computed by hand from 国税庁 Q&A 問57 examples; assert exact strings.

## 関係するファイル
modules/tax/src/{index.ts, module.ts, entities/tax-rate.ts, services/compute.ts (pure), services/settings.ts (zod schemas + keys), actions/{resolve,summarize,settings}.ts, seeds/rates.ts, hooks/no-overlap.ts}, test/{compute.test.ts, tax.db.test.ts, golden/invoice-rounding.json}. テスト DB: `daifuku_test_tax`。

## スコープ外
仕入税額控除の用途区分（Phase 3 の申告集計）、経過措置（purchase 側で扱う）、外部税エンジン。

## 検証手順
`pnpm gate`; apps/api の modules.ts に追加; `pnpm db:generate && pnpm db:reset`; `curl POST /actions/tax.summarize`.
