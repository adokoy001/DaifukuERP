# Spec: tax-period-summary（消費税集計表）

- 状態: approved ／ モジュール: modules/accounting（アクション名 `accounting.tax_period_summary`）／ 依存: なし（journal_line の税区分から集計）
- ADR: 0005, 0013 ／ 作成: 2026-09-11 ／ 作成者: orchestrator
- 名前の変更: Phase 1 ログでは `tax.period_summary` としていたが、日本の会計実務（弥生・freee 等の「消費税集計表」）どおり**仕訳の税区分から集計する**ため accounting に置く。tax モジュールは accounting に依存できない（依存方向）。

## 目的
消費税申告の下ごしらえ。期間内の仕訳明細を「売上/仕入 × 税区分 × 税率」で集計し、税抜額・税額を一覧にする。実製品比較（Phase 2）と個人事業の台本の「消費税の集計」項目を満たす。

## 受入基準（EARS）
- AC-1 THE SYSTEM SHALL add field `taxRole` (enum `none | output_tax | input_tax`, default `none`, label 消費税の役割) to entity `account`. l10n/jp seeds set `2200 仮受消費税 → output_tax`, `1500 仮払消費税 → input_tax`（l10n/jp の seed ファイルを 2 行変更してよい。migration 0004 を生成）.
- AC-2 WHEN `accounting.tax_period_summary { from, to }` (dates inclusive; permission: accounting/viewer/admin read on journal_entry; `tx: 'none'`) is called THE SYSTEM SHALL return a TableResult titled 消費税集計表 with rows per `(side, taxCategory, taxRate)` where side = 売上 (credit lines on revenue-type accounts, debit reversals subtract) or 仕入 (debit lines on expense/asset-type accounts, credit reversals subtract), and columns: side, taxCategory (label), taxRate ('0.10'), taxableAmount (Σ 税抜額 of those lines), taxAmount (Σ of lines on accounts with `taxRole` output_tax/input_tax **whose journal line carries the same taxCategory/taxRate**), count. Only submitted journal entries. Cancelled/reversed pairs net to zero.
- AC-3 THE SYSTEM SHALL append totals: `output_tax_total`, `input_tax_total`, `net_tax_due = output − input` (Decimal strings, 円は scale 0 だが文字列のまま).
- AC-4 IF the tax lines (仮受/仮払) have no taxCategory/taxRate THE SYSTEM SHALL still count their amounts under a row `(side, 'unclassified', '')` so nothing is silently dropped.
- AC-5 The posting done by sales/purchase/payment SHALL be checked to carry `taxCategory`/`taxRate` on the 仮受消費税・仮払消費税 lines (sales/purchase の posting service を確認し、無ければ 1 行ずつ付ける。purchase の控除対象外消費税は費用側に乗るので集計に含まれない＝正しい).
- AC-6 DB test: the 個人事業 台本の 10 月分（`docs/domain/scenario-kojin.md` §消費税の集計）を最小再現（売上 3 件・仕入 4 件）して、売上税額 23,900 / 仕入控除税額 5,900 / 差引 18,000、非課税家賃 80,000 が `non_taxable` 行に税額 0 で出ること、軽減 8% 行が分かれること。
- AC-7 `apps/api/test/scenario.db.test.ts` に 1 ステップ追加: 期末に `accounting.tax_period_summary` を呼び AC-6 と同じ数値を確認（scenario test は本体が管理するので、**追加するステップのコードを最終報告に貼る**。scenario.db.test.ts は編集しない）。

## 関係するファイル
- modules/accounting/src/{entities/account.ts (taxRole), actions/tax-period-summary.ts, module.ts}, test/tax-period-summary.db.test.ts
- l10n/jp/src/seed/accounts.ts（2 行）
- apps/api/drizzle/migrations/0004_account_tax_role（`pnpm db:schema && pnpm db:generate`）
- docs/domain/japan-tax.md に「消費税集計表は仕訳の税区分から作る」根拠（国税庁 消費税の申告書の作成手順の一次出典 URL と確認日）を追記

## スコープ外
簡易課税・2 割特例の計算、申告書様式、課税売上割合、1 億円上限。

## 検証手順
1. `pnpm gate`
2. `pnpm dev:api` 起動後、台本テストを通した DB で `POST /actions/accounting.tax_period_summary {from:'2026-10-01',to:'2026-10-31'}` → 表を確認し、レポート画面 `/r/accounting.tax_period_summary` で表示（web は汎用レポート画面なので追加実装不要のはず。表示されなければ理由を報告）。
