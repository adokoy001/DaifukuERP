# Spec: kernel-phase15（Phase 1.5 のカーネルポート: ext 定義・after_lines_saved・internal アクション・TableResult・currency）

- 状態: approved ／ モジュール: kernel（＋ apps/api, apps/mcp の露出制御、modules の機械的追従）／ 依存: なし
- ADR: 0003（ext 列）, 0013（ポート）, **0014（本 spec で新設: ext フィールド登録・internal アクション・after_lines_saved）**
- 作成: 2026-09-11 ／ 作成者: orchestrator（claude-fable-5-1）

## 目的
導入テンプレート（pack）がコアを改変せずに項目・帳票・設定を足せるように、Phase 1 の「未実施」に残したカーネルポートを揃える。pack 機構そのものは別 spec（pack.md）。

## 受入基準（EARS）
### A. ext フィールド登録（ADR-0003 の JSONB `ext` に型と UI を与える）
- AC-1 THE SYSTEM SHALL provide `registry.registerExt(entityName, fields: FieldMap, opts?: { source: string })` (kernel `registry.ts` + `dsl/ext.ts`). Fields use the same `f.*` builders as entities. Registering the same key twice for one entity → `ConflictError` with hint naming both sources. Unknown entity → `DependencyError`.
- AC-2 WHEN a row is inserted/updated through the Repository THE SYSTEM SHALL validate `ext` against the registered ext fields: unknown keys are **kept** (ADR-0003 free-form remains for one-off data) but registered keys are validated with the field's zod (required/enum/decimal string/date). Money/quantity ext values are stored as Decimal strings.
- AC-3 WHEN `entityMeta` / `/meta` / OpenAPI / MCP tool input schemas are built THE SYSTEM SHALL include registered ext fields as `ext.<key>` with `FieldMeta` (label, kind, options, required) so the generic web form renders them (web changes are NOT in this spec; only the meta contract: `EntityMeta.extFields: FieldMeta[]`).
- AC-4 WHEN listing with a filter on `ext.<key>` (`where: { 'ext.jan': '490...' }`) THE SYSTEM SHALL translate to a JSONB `->>` comparison (text equality, and `like` for text kinds). `orderBy` on ext keys: not required.
- AC-5 Registered text ext fields with `searchable: true` participate in the generic `search` term (same as entity searchable fields).

### B. after_lines_saved フック
- AC-6 THE SYSTEM SHALL add hook phase `after_lines_saved` fired **once** per `saveLines` call (after all line entities are replaced), with `HookArgs = { entity: <document name>, row: <parent row>, lines: Record<lineEntity, rows[]> }`. Generic create/update call `saveLines` once, so the parent recalculation runs once regardless of line count.
- AC-7 sales and purchase SHALL switch their per-line recalculation hooks to `after_lines_saved` (keep the pure `recalculate` service). Existing tests must still pass; the per-line hooks may remain only if they are no-ops when the parent is being recalculated through `after_lines_saved` (avoid double work; document the choice in the log).

### C. internal アクション
- AC-8 `ActionConfig.internal?: boolean` (default false). WHEN `internal: true` THE SYSTEM SHALL keep the action callable via `runAction` (in-process) but omit it from `/actions/*` routes, REST sugar, OpenAPI, `/meta` actions, and MCP tools. `registry.actions({ includeInternal })` gives apps the filter.
- AC-9 `sales.record_payment` and `purchase.record_payment` SHALL be marked `internal: true`. Their tests call the exported `applyPayment` / `runAction` directly. The API test that lists actions asserts they are absent.

### D. TableResult を kernel へ
- AC-10 **（本体で実施済み、commit "kernel: move TableResult schema…"）** `tableResult`/`column`/`MAX_REPORT_ROWS`/`TableResult` は `@daifuku/kernel` から export 済み。accounting は互換のため再エクスポート。エージェントは触らなくてよい。

### E. currency
- AC-11 `/auth/me` SHALL include `company: { id, name, currency, settings?: never }` for the effective company (from `getCompany`). `kernel/src/settings.ts` exposes `currencyScale(currency)` (JPY→0, default 2) used by apps for formatting hints. `/meta` entity FieldMeta for money kinds SHALL carry `scale` resolved from the company currency.

### F. ext 定義の検証（DSL 時）
- AC-12 `registerExt` SHALL reject field names colliding with system fields or the entity's own fields (ValidationError), and reject kinds that cannot live in JSONB (`ref` is allowed and validated as uuid; `lines` not allowed).

## 関係するファイル
- kernel/src/{registry.ts, dsl/ext.ts (new), db/zod.ts (ext validation), repository/{repository,query}.ts (ext where/search), lines.ts (after_lines_saved), meta.ts (extFields, scale), table-result.ts (new), settings.ts (currencyScale), index.ts}
- kernel/test/{ext.test.ts, ext.db.test.ts, lines-hook.db.test.ts, table-result.test.ts, internal-action.test.ts}
- apps/api/src/{plugins/auth.ts (company in /auth/me), routes/{actions,rest,meta}.ts (internal filter)}, apps/mcp/src/tools.ts (internal filter)
- modules/{sales,purchase}: record_payment internal, hooks → after_lines_saved; modules/{accounting,sales,purchase,payment}: import TableResult from kernel
- docs/adr/0014-ext-fields-internal-actions-lines-hook.md, docs/conventions/reports.md (note: schema now lives in kernel)

## スコープ外
pack 機構（definePack、適用 CLI）、web の ext フォーム描画（web-phase15 spec）、多態参照、worker。

## 検証手順
1. `pnpm gate`（既存テストを弱めない。挙動変更で期待値を変えた箇所はテストコメントに理由）
2. `pnpm dev:api` → `curl -s localhost:3000/auth/me -H "authorization: Bearer <token>"` に `company.currency: "JPY"` が出る；`/openapi.json` に `record_payment` が無い；`/meta` の sales_invoice に `extFields: []`。
3. kernel の db test で `registerExt('partner', { jan: f.text({ searchable: true }) })` → create with ext.jan → list where ext.jan / search が当たる。
