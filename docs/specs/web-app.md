# Spec: apps/web（汎用UI）

- 状態: approved ／ ADR: 0002 ／ 作成: 2026-09-10

## 目的
エンティティ定義（`GET /meta`）だけから一覧・フォーム・伝票操作を描画する汎用 UI。機能追加時の UI 工数をゼロに近づける（利用者の実績で最も工数を食う部分）。

## 受入基準（EARS）
- AC-1 WHEN the app loads without a token THE SYSTEM SHALL show a login page; after login it stores the token (localStorage) and loads `/meta`.
- AC-2 THE SYSTEM SHALL render a sidebar menu from `meta.modules[].menus` plus every readable entity under a "All entities" group, with a ja/en toggle that switches all labels (`Label.ja/en`).
- AC-3 WHEN navigating to `/e/:entity` THE SYSTEM SHALL show a paged table (columns = `views.list`), a search box (debounced, uses `search`), sortable column headers (orderBy), page size 50, total count, and a "New" button when `ops` includes `create`.
- AC-4 WHEN navigating to `/e/:entity/new` or `/e/:entity/:id` THE SYSTEM SHALL render a form from `fields` grouped by `views.form` ('auto' → all non-hidden fields), with widgets by kind: text (multiline → textarea), int/decimal (text input, decimal as string, right-aligned), bool (checkbox), date (date input), timestamp (readonly), enum (select with valueLabels), ref (searchable select loading `/api/<ref>?search=`, showing `refDisplayField`), json (textarea JSON). Required fields marked. Immutable fields disabled on edit. Server VALIDATION errors are shown next to the field named in `details.issues[].path`.
- AC-5 WHEN the entity is a document THE SYSTEM SHALL show docstatus badge (下書き/確定/取消) and buttons Submit / Cancel / Amend according to `ops` and current docstatus; after submit, fields not in `allowOnSubmit` are disabled.
- AC-6 WHEN viewing a record THE SYSTEM SHALL show an "Audit" panel listing `/api/:entity/:id/audit` entries (op, actor, at, changed fields).
- AC-7 WHEN saving an edit THE SYSTEM SHALL send `expectedVersion` and, on CONFLICT, show a reload prompt.
- AC-8 THE SYSTEM SHALL handle 401 by returning to login, and show `error.hint` in a toast for other errors.
- AC-9 A Playwright smoke test logs in, creates a partner, finds it in the list, edits it, and checks the audit panel shows 2 entries.

## 技術
React 19, Vite, TanStack Router + Query + Table, Tailwind CSS v4, hand-written minimal components (no external UI kit download needed), `VITE_API_URL` (default http://localhost:3000). No `any`. Files ≤ 400 lines.

## スコープ外
- かんばん/カレンダー、専用画面、ダッシュボード（Phase 1 以降）

## 検証手順
`pnpm gate`; `pnpm dev:api` + `pnpm dev:web`; ブラウザで AC-1..8; `pnpm --filter @daifuku/web e2e`.
