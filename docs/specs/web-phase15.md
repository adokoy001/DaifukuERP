# Spec: web-phase15（入出金の消込 UI・ext フィールドの描画・通貨桁）

- 状態: approved ／ アプリ: apps/web（＋ apps/web/e2e）／ 依存: payment.outstanding、kernel-phase15 の meta 契約（extFields、scale、/auth/me company）
- ADR: 0009（汎用 UI）, 0013 ／ 作成: 2026-09-11 ／ 作成者: orchestrator

## 目的
Phase 1 で UI が無かった「入出金の消込」を汎用 UI の延長で作る。あわせて kernel-phase15 が出す meta（ext フィールド、通貨桁）を描画する。

## 受入基準（EARS）
- AC-1 WHILE editing a draft `payment` (entity-form-page for a document whose meta has a line entity with a field `invoiceId` of kind `uuid`/text and `invoiceEntity` enum) WHEN the user clicks 「未消込の請求書から選ぶ」 THE SYSTEM SHALL open a panel calling `payment.outstanding { partnerId, direction }` (from the form's current values) and list open invoices (number, date, dueDate, balance) with a checkbox and an editable amount (default = min(balance, remaining unallocated)); confirming appends rows to the `payment_allocation` line grid (invoiceEntity, invoiceId, amount). Implement as a generic component `allocation-picker.tsx` driven by a small declarative hint in meta if available, otherwise a convention: line entity name ends with `_allocation` and the document has `partnerId`+`direction` (document the convention in docs/conventions/reports.md or a new docs/conventions/ui.md).
- AC-2 WHEN the payment form has allocations THE SYSTEM SHALL show 配分合計 / 未配分 (Decimal arithmetic via lib/decimal.ts) and refuse submit client-side when 配分合計 > 金額 (server still validates).
- AC-3 WHEN `/meta` entity has `extFields` THE SYSTEM SHALL render them in the form under a 「追加項目」 section (same field components, values read/written at `row.ext[key]`) and, when a list view includes `ext.<key>`, show the column.
- AC-4 WHEN `/auth/me` returns `company.currency` THE SYSTEM SHALL use it for money formatting (JPY → 0 decimals) instead of any hard-coded default; FieldMeta `scale` from meta wins when present.
- AC-5 Playwright `e2e/payment.spec.ts`: through the real UI, create a sales invoice for a seeded partner with one line (via API for speed is acceptable for setup — use the API for the invoice, the UI for the payment), then create a receive payment for that partner, pick the invoice from the outstanding panel, submit, and verify the invoice shows status paid / balance 0 (read via API) and the payment shows docstatus submitted. Requires the dev API/web to be running (same convention as phase1.spec.ts; the orchestrator starts them).
- AC-6 Unit tests for the allocation math and for ext-field form mapping (`lib/*.test.ts`).

## 関係するファイル
- apps/web/src/components/allocation-picker.tsx, pages/entity-form-page.tsx（差し込み点のみ）, lib/{allocation.ts, ext.ts, currency.ts}, components/fields/*（ext 描画）
- apps/web/e2e/payment.spec.ts
- docs/conventions/ui.md（新設: 汎用 UI が meta から推論する規約の一覧: `_allocation`、`resultKind`、`extFields`）

## スコープ外
銀行明細取込、部分消込の一括提案、複数通貨。

## 検証手順
1. `pnpm --filter @daifuku/web test`（unit）、`pnpm typecheck`、`pnpm lint`
2. `pnpm dev:api` / `pnpm dev:web` を起動して `pnpm --filter @daifuku/web e2e`（または `npx playwright test e2e/payment.spec.ts`）。スクリーンショットを `docs/log/img/` に保存（消込パネルと確定後の請求書）。

## 追記（2026-09-11、本体）
- AC-7 レポート画面: TableResult の `totals` のうち列 key に一致しないもの（例: `accounting.tax_period_summary` の `output_tax_total` / `input_tax_total` / `net_tax_due`）は、表の下に「合計」のキー・値リストとして表示する（キーはそのまま、値は Decimal 整形）。CSV 出力にも末尾に含める。
- AC-8 金額の表示桁: 通貨の桁（JPY=0）を**最小**桁とし、値に有効な小数があれば最大 6 桁まで表示する（例: JPY で `150` → `150`、`33.3` → `33.3`、`1234.500000` → `1,234.5`）。入力フィールドも同じ規則。kernel エージェントが `formatDecimal('1234.500000', 0, 0)` が `"1,234"` になる（切捨て表示）ことを見つけたため。
