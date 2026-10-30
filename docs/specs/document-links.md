# Spec: document-links（伝票の複製・関連伝票・クイック操作）

- 状態: implemented（2026-10-29）
- モジュール: `kernel`（関連記録の読取、派生 action `<entity>.related`、`FieldMeta.unique`）、`apps/api`（`GET /api/:entity/:id/related`）、`apps/web`（汎用フォーム） ／ 依存: [ui-kit](ui-kit.md)
- ADR: 新規なし。[ADR-0009](../adr/0009-actions-rest-mcp.md) に派生 action `<entity>.related` と `<x>Entity`/`<x>Id` の規約を追記（2026-10-30。既存の読取権限と作成 API の組合せで、新しい書込経路・port はない）。関連の辿り方は [データと処理経路](../architecture/runtime-and-data.md#関連記録の読取) に記す
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) C2。実装時の変更は「未決事項」の末尾
- 記録: [作業記録](../log/2026-10-29-document-links.md)

## 目的（1段落）

毎月ほぼ同じ請求書を作る、請求書から入金を記録する、取消した伝票の訂正版や自動仕訳を確かめる、といった操作で、利用者は一覧と画面を何度も往復している。伝票の画面から、複製・関連する記録の確認・次の伝票の作成を直接行えるようにし、伝票 1 件あたりの手数を減らす。

## 受入基準（EARS）

- AC-1 WHEN 利用者が create 権限のある entity の記録で「複製」を押した THE SYSTEM SHALL 新規作成画面を開き、元の記録の入力可能な値と、読める明細の入力可能な列を初期値として入れる。system 列・`serverOwned`・`readOnly`・`hidden`・timestamp・採番（`number`、`naming: { type: 'field' }` の field）・状態（`docstatus` と serverOwned の状態）・`unique` な field（field の `unique` と 1 列の複合 unique。`FieldMeta.unique` で配信）・訂正元（`amendedFrom`）・schema では unique でないが 1 通の外部書類を指す値（`lib/duplicate.ts` の `NOT_COPIED`。仕入請求書・商流請求の `supplierInvoiceNo`）は持ち越さない。既定値のある date field は今日の日付（日本時間の業務日付。サーバの `default: 'today'` と同じ）、ほかの date field は空欄にする。初期値は作成したセッション（テナント・利用者・会社）でだけ使い、ログアウト後の別の利用者や会社の切替後に「戻る」で開いても入れない。保存するまでは何も作成しない。
- AC-2 WHEN `GET /api/:entity/:id/related`（派生 action `<entity>.related`、`permission: { entity, op: 'read' }`）が呼ばれた THE SYSTEM SHALL この記録を参照する記録（逆参照）と、この記録が参照する記録（順参照）を、entity ごとに最大 50 件（超えたら `more: true`）、番号・表示名・状態・日付・関係（参照先 / 参照元 / 訂正元 / 訂正版）・連結 field（項目ごと）つきで返す。辿るのは `ref` field、同じ entity の `<x>Entity` + `<x>Id` の組、document の明細（明細の参照は親の参照、記録を参照する明細は親 document として返し、自分の明細は返さない。別 document の明細を指す連結はその親 document として返し、記録の明細を指す連結は記録への参照元として返す）、`amendedFrom` の訂正元・訂正先の連鎖（各 50 段まで）。`journalEntryId` による仕訳と、仕訳の `sourceEntity/sourceId` による起票元を含む。
- AC-3 THE SYSTEM SHALL 関連記録の読取に、要求者の read 権限・行の権限・会社・拠点・本人の境界・field の mask を entity ごとに適用し、読めない entity と連結 field を読めない entity は結果に含めない（件数も返さない）。対象の記録自体が読めない場合は PERMISSION_DENIED / NOT_FOUND を返す。
- AC-4 WHEN 記録の画面を開いた THE SYSTEM SHALL 「関連」パネルに AC-2 の結果を entity ごとにまとめて（document の group を先に）表示し、各記録へ移動できる。読込は画面の表示も保存・確定の完了も妨げず、失敗はパネル内に表示して（技術情報は折りたたんで残す）再試行できる。再試行を押したら焦点はパネルの見出しに移る。
- AC-5 THE SYSTEM SHALL 次のクイック操作を確定済みで残高が 0 より大きい記録に表示する: 売上請求書 →「入金を記録」、仕入請求書 →「支払を記録」。押すと入出金の新規画面を、区分・取引先・日付（今日）・金額（未消込残高）・消込明細（その請求書、残高）を初期値として開く。操作は入出金の create 権限がある場合だけ表示する。
- AC-6 THE SYSTEM SHALL クイック操作の対応を `apps/web/src/lib/quick-actions.ts` の宣言で管理し、対象 entity・埋める field・明細 entity が meta に無い会社では表示しない。
- AC-7 WHEN 「複製」またはクイック操作を押した THE SYSTEM SHALL 元の記録を読み直す。IF 読み直しが権限の喪失などで失敗した、または版が表示中から変わっていた THEN THE SYSTEM SHALL 新規画面を開かず理由を表示する（版の変化では最新の内容を読み込む）。
- AC-8 THE SYSTEM SHALL 文言を日本語と英語で持ち、390px 幅で操作できる。

## 関係するファイル・インターフェース（名指し）

- kernel: `kernel/src/related.ts`（新規。registry から連結を求め、`Repository` の list / find で読む）、`kernel/src/actions/related.ts`（新規。`registerRelatedActions()`、`registerCrudActions()` の末尾で 1 回呼ぶ）、`kernel/src/meta.ts`（`FieldMeta.unique`）、`kernel/src/index.ts`
- api: `apps/api/src/routes/rest.ts`（`GET /api/:entity/:id/related` を `<entity>.related` へ委譲）
- web: `apps/web/src/pages/entity-form-page.tsx`、`apps/web/src/components/related-panel.tsx`（新規）、`apps/web/src/components/record-links.tsx`（新規。複製・クイック操作のボタン、`SeedNotice`、`useDraftSeed`）、`apps/web/src/api/related.ts`（新規）、`apps/web/src/lib/duplicate.ts`（新規）、`apps/web/src/lib/quick-actions.ts`（新規）、`apps/web/src/components/record-form.tsx`（`initial` の受け取り）、`apps/web/src/api/types.ts`（`FieldMeta.unique`）、`apps/web/src/components/docstatus-badge.tsx`（`testId`）
- docs: `docs/manual/00-index.md`、`docs/manual/02-basics.md`、`docs/manual/05-daily.md`、`docs/manual/09-ai.md`、`docs/conventions/ui.md`、`docs/architecture/runtime-and-data.md`、`docs/adr/0009-actions-rest-mcp.md`（追記）

## データ・業務ルール（出典）

- 訂正（`amendedFrom`）と確定済み伝票の不変 — ADR-0006。消込の検証は既存の入出金の規則（[payment](payment.md)）に従う。複製・クイック操作は既存の `<entity>.create` を呼ぶだけで、新しい書込経路を作らない。

## スコープ外（明記）

- 見積 → 受注などの商流の変換（既存の trade 画面で対応済み）
- 複数記録の一括複製、定期的な自動複製
- 関連記録の図示
- 2 段先の記録（請求書 → 仕訳 → 逆仕訳）。仕訳の関連で辿る
- ext field の ref を辿ること

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`（kernel を変更するため DB 全件へ昇格）
2. DB: `kernel/test/related.db.test.ts`（逆参照・順参照・`<x>Entity`/`<x>Id`・明細の親への置換・訂正の連鎖・50 件上限・項目ごとの連結 field（ヘッダ 2 項目と明細）・別 document の明細を指す明細（両方向、明細を読めない役割）、読めない entity / mask された連結 field の除外、行の権限、別会社、派生 action の権限）、`apps/api/test/related.db.test.ts`（実 module の売上請求書・入金・仕訳・訂正、確定した仕入請求書の統制勘定と明細の勘定科目の連結 field、REST の 403 / 404 / 400、利用者が書ける `<x>Entity`/`<x>Id` の組の一覧）（AC-2、AC-3）
3. 単体: `apps/web/src/lib/duplicate.test.ts`（持ち越さない field、先方請求書番号、日本時間の今日、seed の検査、別セッションの seed を使わない、seed からの保存内容）、`apps/web/src/lib/quick-actions.test.ts`（表示条件、初期値）（AC-1、AC-5、AC-6、AC-7）
4. ブラウザ: `apps/web/e2e/document-links.spec.ts` — 月初日付の確定済み請求書の複製 → 今日の日付の新しい下書き、「入金を記録」→ 保存 → 確定で請求書が消し込まれる、関連パネルに入金と仕訳が出る（document の group が先）、版の変化と読み直し失敗で開かない、閲覧だけの利用者には複製・クイック操作が出ない、関連の失敗の技術情報と再試行後の焦点、390px と英語（AC-1〜AC-8）
5. `pnpm gate:full`（統合担当が実行）

## 未決事項（利用者の判断待ち）

- 複製時に日付を今日へ置き換えるか — 実装では「既定値が今日の date field（請求日・日付）は今日、ほかの date field（支払期日など）は空欄」とした。支払期日は保存時に取引先の条件から再計算されるため、古い期日を持ち越すより安全と判断した。元の日付はフォーム上のお知らせに表示する。利用者の確認待ち。
- 複製で持ち越さない「1 通の外部書類を指す値」を Web の宣言（`NOT_COPIED`、初版は `supplierInvoiceNo` の 2 件）で持つか、DSL の field 宣言に昇格するか — 昇格は DSL 拡張なので ADR が要る。宣言が増えるなら昇格を検討する。

### 実装時に変えた点（計画の草案から）

- 草案は「registry の `ref` から」だけだったが、入金の消込明細（`payment_allocation.invoiceEntity/invoiceId`）と仕訳の起票元（`journal_entry.sourceEntity/sourceId`）は `ref` ではなく uuid のため、同じ entity の `<x>Entity` + `<x>Id` の組も辿るようにした（DSL 拡張なしの命名規約。既存の 6 entity が同じ形）。
- 記録を参照しているのが明細（`payment_allocation` など）なら、明細ではなく親 document（入出金）を返す。自分自身の明細は関連に含めない。
- 逆仕訳は仕訳の `reversalOf` で仕訳を指し、請求書を直接指さない（`sourceEntity` が空）ため、請求書の関連には出ない。仕訳の関連で辿る。
- 複製で持ち越さない `unique` を Web が判定できるよう、`FieldMeta.unique` を追加した（field の `unique`、1 列の複合 unique、採番 field）。
- クイック操作は「確定済み」に加えて「残高 > 0」を条件にした（入金済みの請求書には出さない）。日付（今日）も初期値に入れる。
- AC-7 を「押したときに読み直し、失敗または版の変化で開かない」と具体化した。

### レビュー指摘で変えた点（2026-10-30）

- 連結 field（`via`）を entity ごとではなく項目ごとに持つ（確定した仕入請求書で明細の費用科目が「統制勘定」と表示された）。
- 別 document の明細を指す明細（`trade_fulfillment_line.orderLineId`、`trade_billing_line.fulfillmentLineId`）を、明細の行ではなく親 document として返す。逆向き（受注の関連に出荷）も辿る。
- `<x>Entity`/`<x>Id` の組は serverOwned か書込時の検査を必須とし、利用者が書ける組の一覧を API の DB テストで固定した。
- 関連の query key を記録の key から分けた（保存・確定の完了が関連の読込を待っていた）。
- 初期値（seed）をセッション（テナント・利用者・会社）に結びつけた。
- 複製の「今日」をブラウザの時間帯ではなく日本時間（`businessToday`）にした。
- 仕入請求書の先方請求書番号を持ち越さない（`NOT_COPIED`）。
- 関連パネルの失敗に技術情報を折りたたんで残し、再試行で見出しへ焦点を移し、読込・失敗を常設の live region で知らせる。
