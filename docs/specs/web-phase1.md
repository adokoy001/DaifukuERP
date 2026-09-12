# Spec: apps/web Phase 1 — 明細グリッド、レポート画面、添付、設定

- 状態: approved ／ 依存: docs/specs/web-app.md（実装済み）, kernel meta（`lines`）, docs/conventions/reports.md ／ 作成: 2026-09-10

## 受入基準（EARS）
- AC-1 WHEN an entity's meta has `lines` THE SYSTEM SHALL render, below the header form, one editable grid per line entity: columns from the line entity's meta (`views.list` else all non-hidden fields except the parent ref and `seq`), row add/remove/reorder (seq), inline widgets by kind (ref combobox, decimal right-aligned, enum select), keyboard: Enter adds a row, Tab moves across cells. Save sends `{ patch, lines: { <entity>: rows } }` in one request (kernel replace-all semantics; keep row ids). While the document is submitted/cancelled the grids are read-only.
- AC-2 WHEN a line grid has decimal columns THE SYSTEM SHALL show a footer with column sums computed client-side with a decimal-safe routine (string arithmetic or a tiny decimal helper — no floats) and mark it "参考値" (server is the source of truth).
- AC-3 WHEN `/meta` lists actions whose output schema is the TableResult shape (the API includes `resultKind: 'table'` and `inputSchema` (JSON Schema) for such actions) THE SYSTEM SHALL list them under a "レポート" menu and render `/r/:action` with an input form generated from the JSON Schema (string/date/enum/number/boolean/ref-by-name) and the result as a table with totals; CSV download of the current table (client-side).
- AC-4 WHEN an entity record page is shown THE SYSTEM SHALL show an "添付" panel listing attachments for the record (`attachment.for_record`), with upload (multipart to `/api/attachments/upload` with linkedEntity/linkedId), download links, kind/txnDate/amount/partner fields.
- AC-5 THE SYSTEM SHALL provide `/settings` (admin or `settings` role) listing settings declared by modules: the API exposes `GET /meta/settings` → `[ { key, label, schema (JSON Schema), value } ]` and `PUT /meta/settings/:key`; the page renders a form per key from the JSON Schema.
- AC-6 Playwright e2e: create a journal entry with 2 lines through the UI, submit it, verify the grid is read-only and the trial balance report page shows the account rows.

## API 側の追加（apps/api、同じエージェントが実装）
- `/meta` の actions に `inputSchema` (z.toJSONSchema(input)) と `resultKind: 'table' | 'record' | 'other'`（output schema が TableResult 形なら table）を追加。
- `GET /meta/settings`, `PUT /meta/settings/:key`: モジュールが `registerSetting({ key, label, schema })` で宣言したもの（kernel に `registry.registerSetting/allSettings` を追加してよい。追加したら ADR-0013 の L1 に追記）。
- `POST /actions/:name` はそのまま。

## スコープ外
かんばん・ダッシュボード・印刷レイアウト（l10n/jp が HTML 帳票を返す）。

## 検証手順
`pnpm gate`; `pnpm dev:api` + `pnpm dev:web` で AC-1..5 を目視; `pnpm --filter @daifuku/web e2e`。
