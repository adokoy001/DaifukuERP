# Spec: attachments（証憑・添付。電子帳簿保存法の電子取引データ保存）

- 状態: approved ／ モジュール: modules/attachments ＋ apps/api のアップロード/ダウンロード経路 ／ 依存: partner
- ADR: 0007, 0013（storage ポート） ／ 作成: 2026-09-10 ／ 出典: docs/domain/japan-tax.md#電子帳簿保存法

## 目的
受領・発行した請求書/領収書等のファイルを、電帳法の検索要件（取引年月日・取引金額・取引先、範囲・組合せ検索）と真実性（訂正削除履歴）を満たす形で保存し、任意の伝票にリンクする。

## 受入基準（EARS）
- AC-1 THE SYSTEM SHALL provide entity `attachment` (company-scoped): `storageKey` (text required immutable), `filename` (text required), `contentType` (text required), `size` (int required), `sha256` (text required immutable), `kind` (enum invoice_received/invoice_issued/receipt/contract/bank_statement/other, default other), `txnDate` (date nullable), `amount` (money nullable), `partnerId` (ref partner nullable), `linkedEntity` (text nullable), `linkedId` (uuid nullable), `note` (text), `supersededById` (ref attachment nullable). Permissions: accounting/sales/purchasing read/create/update, viewer read, admin all. **No role has `delete`** (電帳法: evidence is superseded, never deleted).
- AC-2 WHEN `POST /api/attachments/upload` (multipart: file + fields kind/txnDate/amount/partnerId/linkedEntity/linkedId/note) is called THE SYSTEM SHALL store the bytes via `ctx.storage.put`, create the attachment row, and return it. Max 20 MB. Content types: pdf, png, jpeg, csv, xml, txt.
- AC-3 WHEN `GET /api/attachments/:id/download` is called THE SYSTEM SHALL stream the bytes with the original filename (RFC 5987) and content type, after the same permission check as `attachment.get`.
- AC-4 WHEN `attachment.search { txnDateFrom?, txnDateTo?, amountFrom?, amountTo?, partnerId?, kind? }` is called THE SYSTEM SHALL return matching rows (AND of provided criteria) — the 電帳法 検索要件 (date range, amount range, partner, combinations).
- AC-5 WHEN `attachment.supersede { id, newAttachmentId, reason }` is called THE SYSTEM SHALL set `supersededById` on the old row and write an audit entry with the reason; the old file stays retrievable (訂正削除履歴).
- AC-6 WHEN `attachment.link { id, entity, recordId }` is called THE SYSTEM SHALL verify the target entity exists in the registry and the record is visible to the caller, then set linkedEntity/linkedId. `attachment.for_record { entity, recordId }` lists attachments of a record.
- AC-7 Uploading a file whose sha256 already exists for the company SHALL return 409 CONFLICT with the existing attachment id in details (duplicate evidence).
- AC-8 DB tests cover AC-1..7 through the API (fastify inject with multipart) and the actions; a stored file is retrievable after the row is superseded.

## 関係するファイル
modules/attachments/src/{index.ts, module.ts, entities/attachment.ts, actions/{search,supersede,link,for-record}.ts, services/validate.ts}; apps/api/src/routes/attachments.ts（@fastify/multipart はインストール済み）; apps/api/src/modules.ts に追加; test: modules/attachments/test/attachments.db.test.ts, apps/api/test/attachments.db.test.ts。テスト DB: `daifuku_test_attachments`。storage: テストでは `configureStorage(new LocalStorage(tmpdir))`。

## スコープ外
タイムスタンプ局、OCR、JIIMA 認証、ウイルススキャン。

## 検証手順
`pnpm gate`; `pnpm db:generate && pnpm db:reset`; curl -F file=@sample.pdf …/upload → search → download。
