# 作業記録: 2026-10-30 opening-balances（期首残高の取込、B6）

- セッション: 完成度向上の実装計画 B6 の実装（spec 作成セッションの worktree を引き継ぎ、ブランチ `wip/opening-balances`） ／ 担当: agent ／ 対象: [docs/specs/opening-balances.md](../specs/opening-balances.md)
- 計測: tokens=null, agent_minutes=125, human_minutes=0, rework_lines=70, gate_failures=0

## 決めたこと（と理由）

- **spec 批評の 16 件はすべて取り込んだ**（spec の「spec 批評への対応」節。却下なし）。主なもの: 期中の訂正日で取り消した期首請求書がある取引先は再取込しない（行のエラー `cancelled_in_year`。期中の逆仕訳と新しい期首請求書が両方残り、期首欄が二重になるため）、`$ctx.` で始まるコード・名称のセルは照会せず `invalid_value`（kernel から `isContextToken` も公開）、読めないセル・範囲外の値のコード（`invalid_value`・`non_positive_quantity`・`scale_exceeded`）、在庫の段の有効化はサーバーの `roleAllowsEntry(roles, 'receipt', false)` と同じ規則、ロックの順序（D-14）、伝票単位の失敗は `issues` の `submit_failed`（D-15）、転記科目・既定の倉庫の欠落は要求全体の 409（D-16）、`assertOpenPeriod` は変えず内部の `assertPostingDate` に例外を置く（D-17）、空の支払期日は元請求日から計算（D-18）、AC-4 は「範囲の科目ごとの純額が 0 なら開設可」に緩和（D-19。利用者の判断事項にする案より単純で、誤った最初の年度から戻れる）、小売パックの最初の月次締めは制約として記録（D-20）、期中導入はスコープ外に明記、domain の「どの課税期間にも入らない」を訂正。
- **ADR-0030（新規）**「期首残高は期首日の前日付で、期首残高仮勘定を介して開始仕訳と module 所有の期首伝票に分ける」。統合時に番号が衝突したら振り直す。
- **共通部分は accounting に置き、伝票の作成だけを各 module のコールバックにした**: 売掛金と買掛金の取込はほぼ同じ手順なので、`modules/accounting/src/opening-invoices.ts` の `importOpeningInvoices(ctx, input, spec)` が要求の検査・行の解析・重複の規則・全件か無かの実行を持ち、sales / purchase は `create`（期首請求書の作成と確定）と `checkPostingAccounts` を渡す。accounting は sales / purchase に依存できない（D-11）ため、entity は引数で受け取る。
- **期首残高の年度規則は `opening-year.ts` に分けた**: journal_entry の submit hook（`validate-entry.ts`）から使う関数を、posting の action を import する `opening.ts` に置くと import の循環ができ、module の読込順によっては action 定義の時点で `lineInput` が未初期化になるため。
- **仮勘定へ回した行のメモは、入力の摘要があっても元の科目コードと名称を先に付ける**: ブラウザ試験で、摘要「売掛金合計」を書いた行の仮勘定の明細から元の科目が消え、状況の注意（AC-32）が科目を名指しできないことが分かった（下の「見つけた問題」）。AC-12 の文言を合わせて直した。
- **在庫の取込は明細の作成も `asModule` の中で行う**: 明細の検査（品目の種類・数量・単価）は取込の行の検査で済んでいる（invoices.ts の自動の入出庫と同じ）。5,000 明細を通常の明細 hook に通すと 1 明細ごとに親と品目の照会が走るため。伝票の確定は `asModule` の外（要求者の文脈）で行い、確定時の入庫のロールの検査を二重の防御として残した（批評の指摘）。
- **在庫の取込には品目の読取権限も要る**: 既存の役割表では `inventory` ロールは品目を読めない（`viewer` や営業・購買と組み合わせて使う）。試験の「経理 + 在庫」は `['accounting', 'inventory', 'viewer']` にし、AC-6 の事前の権限検査に `product:read`・`warehouse:read` を入れて 403 で名指しする。
- **MCP の試験は新しいファイルにした**（spec は既存の `apps/mcp/test/mcp.db.test.ts` への追加と書いていた）: 既存の試験は試験用の entity だけを登録しており、業務 module を import するとその前提（ツール一覧の内容）が変わるため。`apps/mcp/test/opening-balances-tools.db.test.ts` で一覧と 2 MB の検査を確かめる。
- **AC-8 の in-process の 2 MB 検査を各取込に足した**（`assertOpeningInputSize`）: HTTP の `inputBytes` だけでは MCP と in-process の呼出しが上限を持たないため（B5 と同じ扱い）。
- 申告準備（Q-7）: `l10n/jp/src/filing/statements.ts` は対応付けの無い科目を飛ばすので、3900 の残高が 0 なら出力は変わらない（レビュー）。残高が 0 でないまま申告準備をすると貸借の差額になる。分類への追加はこの項目では行わない。

## やったこと

- kernel: `decimalCell`・`dateCell`・`isContextToken` を `@daifuku/kernel` から公開（振る舞いは変えない）。
- accounting: 書込権限 `accounting.opening` と `withOpening`、`services/opening.ts`（純粋）、`opening-year.ts`（AC-1〜AC-3）、`opening.ts`（仮勘定・posting の経路・権限・全件か無か・照会・結果の型・2 MB）、`opening-invoices.ts`、`actions/opening-balances.ts`（`accounting.import_opening_balances` / `reverse_opening_balances` / `opening_balance_status`）、`settings.ts`（`accounting.opening_balances`）、`assertPostingDate`、fiscal_year の AC-4。
- sales / purchase: `openingBalance`（serverOwned・immutable）と書込権限 `sales.opening` / `purchase.opening`、取込 action、確定 hook（AC-17 の検査、仮勘定への転記、期首残高の経路、発行時データを作らない、`opening_amend`）、取消 hook（期首残高の経路）、`sales.render_invoice_html` の拒否（AC-20）。
- inventory: `inventory.import_opening_stock`、入出庫伝票の確定で `fiscal_year` の起票元を期首残高日の入庫に限って認める。
- l10n/jp: `3900 期首残高仮勘定`。migration `apps/api/drizzle/migrations/0018_opening_balances.sql`（両請求書の `opening_balance`）。
- web: `/finance/opening`（`pages/opening-balances-page.tsx`、`lib/opening-balances.ts`、`api/opening-balances.ts`）、router、navigation-data、help.ts（03 の「期首残高の取込」）、`CONVERTED`。
- docs: ADR-0030、マニュアル 03（期首残高の取込の節）・06（試算表）・09（MCP）・10（制限）・00・付録 N、program-map、spec の更新と状態 implemented、domain の訂正。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] unit: `modules/accounting/test/opening-balances.test.ts`（11 件: 期首残高日・行の分類・セル・合計）、`apps/web/src/lib/opening-balances.test.ts`（8 件: 見出しの照合・行の組立て・雛形・エラー CSV・理由の日英・段の有効化）。
- [実測] DB: `modules/accounting/test/opening-balances.db.test.ts`（17 件）、`modules/sales/test/opening-receivables.db.test.ts`（16 件）、`modules/purchase/test/opening-payables.db.test.ts`（9 件）、`modules/inventory/test/opening-stock.db.test.ts`（13 件）、`apps/api/test/opening-balances.db.test.ts`（3 件、golden と 413 と会社の分離）、`apps/mcp/test/opening-balances-tools.db.test.ts`（2 件）。同時実行（D-14）は区分ごとに 2 本の接続（別トランザクション）で `Promise.allSettled` し、1 回だけ確定して他方が 409 / `exists` / `stock_exists` になることを確かめた。
- [実測] golden（AC-30）: fixture の 4 つの CSV を REST で取り込み、試算表の期首借方・期首貸方が開始仕訳の CSV の科目ごとの純額と一致、3900 が 0、売掛金年齢表（期首日時点）の取引先ごとの残高と期日区分、買掛金年齢表、在庫評価の数量・金額（round6(数量 × 単価)、例 30 × 1333.333333 = 39999.99999）が一致。
- [実測] ブラウザ: `apps/web/e2e/opening-balances.spec.ts`（1 件、slot 4、`--project=chromium --no-deps`）: 1 回目は失敗（下の「見つけた問題」の仮勘定のメモ）、修正後に通過（13.5 秒）。上限の変更後の最終確認: `opening-balances`・`settings-console`・`navigation`・`close-guide` の 15 件を `--no-deps` で実行して 14 件通過、残る 1 件（`navigation` の店舗従業員、業界の会社が要る試験）は業界の project 付き（`--no-deps` なし）で `navigation.spec.ts` を実行し 8 件すべて通過（2.5 分）。画面検索から開く、貸借不一致で「取り込む」無効、4 ファイルの取込、仮勘定 0、試算表の期首欄（API）、開始仕訳の取消と再取込、axe（日本語 1280px・390px、serious/critical なし）、390px で横はみ出しなし、英語表示。
- [実測] 計測（spec 検証手順 5、この開発コンテナ・Fastify の inject、他のエージェントと共有の 4 CPU）: 2 回測った。(1) 売掛金 1,000 行・在庫 5,000 行・開始仕訳 498 行（負荷平均 9〜11、同時に別の DB 試験も走っていた）: 標準出力の取りこぼしで所要時間を直接は取れず、DB の作成時刻から下限を見積もった — 売掛金 1,000 行の実行は最初と最後の期首請求書の作成時刻の差で約 530 秒、在庫 5,000 行の実行は約 98 秒（事前確認もほぼ同じ）。(2) 売掛金 200 行・在庫 1,000 行・開始仕訳 498 行（負荷平均約 10、ファイルへ記録）: 開始仕訳 事前確認 6.7 秒・実行 5.9 秒、売掛金 200 行 事前確認 28.5 秒・実行 30.5 秒（1 件約 0.15 秒）、在庫 1,000 行 事前確認 18.4 秒・実行 17.9 秒。売掛金の取込中の勧告ロックの最大は 202〜204 件（期首請求書 1 件に 1 つ、`pg_locks` の `advisory`）。サーバーの `max_locks_per_transaction` は 64、`max_connections` 100。→ spec の規則（1,000 行の実行が 60 秒超なら上限を下げる）に従い、売掛金・買掛金を 200 行、在庫を 2,000 行に下げた（開始仕訳は 1,000 行のまま）。spec AC-15・AC-23・Q-5、マニュアル 03、ADR-0030 を直し、上限超過の DB 試験を足した。計測の試験ファイルは一時的なもので、リポジトリには残していない（`apps/api/test/zz-opening-perf.db.test.ts` として実行後に削除）。
- [実測] `pnpm gate:light`（DB `daifuku_test_w13`）: 通過、2,101 秒（format 42 秒、typecheck 30 秒・api 53 秒・web 68 秒、lint 49 秒（既存の警告 5 件、エラーなし）、unit 156 ファイル 1,568 件 168 秒、DB は kernel の公開面の変更で全件に昇格して 137 ファイル 882 件 1,667 秒、deploy 23 秒）。共有の 4 CPU、負荷平均 5〜12。assurance が `PV-FILING-01`（申告準備の根拠）の再確認を求めた: l10n/jp の科目表の変更による。対象の試験 `l10n/jp/test/filing-source-model.db.test.ts` は gate の DB で通過し、3900 は申告の対応付けに無く残高 0 なら出力に入らない（上の Q-7 のレビュー）。
- [レビュー] AC-7 の relay・拠点限定の文脈: 5 つの action は `storeAccess`・`siteAccess`・`relayAccess` を宣言しないので kernel が 403（店舗限定は DB 試験で実測、拠点・relay はレビュー）。AC-22 の受信箱の期日超過・関連伝票: 期首請求書は通常の請求書の列（`status`・`dueDate`）をそのまま持つので既存の集計の対象（レビュー。試験なし）。
- [未検証] Shift_JIS のファイルでの取込（判別は B5 の部品）。実際の MCP クライアントからの取込。小売パックの最初の月次締めの手順（マニュアルの記述のみ）。`pnpm gate:full`（統合担当が実行）。

## 見つけた問題と修正（発見経路つき）

- 仮勘定へ回した行に摘要を書くと、仮勘定の明細から元の科目が消え、状況の注意で科目を名指しできなかった — 発見: E2E（ブラウザ試験の 1 回目の失敗）、修正: `clearingMemo(account, memo)` で常に元の科目を先に付ける（AC-12 の文言も更新）。
- spec 批評の指摘（16 件）— 発見: spec 批評（レビュー）、修正: spec の更新コミット `docs(spec): resolve the opening-balances spec critique`。
- 売掛金 1,000 行の実行が 60 秒を大きく超えた（約 530 秒、負荷下）— 発見: 計測（検証手順 5）、修正: 上限を売掛金・買掛金 200 行・在庫 2,000 行に下げた（spec Q-5）。
- 3900 の追加で `l10n/jp/test/l10n-jp.db.test.ts` の区分ごとの件数（equity 3 → 4）が変わった — 発見: DB 試験、修正: データの追加に伴う期待値の更新と 3900 の属性の検査を追加（弱体化ではない）。
- `opening_balance` 列の追加で、移行の試験 2 件が失敗した — 発見: DB 試験。`apps/api/test/industry-templates.db.test.ts` は migration 0007 の古いスキーマに現在の registry の `sales_invoice.create` で下書きを作っていたため、後の migration の列（0018）が無く INSERT が失敗した。古い列だけの SQL で下書きを作るように直した（`legacy-fixture.ts` と同じ方針。確かめる内容「既存の伝票が残る」は同じ）。`apps/api/test/commerce-finance-migration.db.test.ts` は移行前後の `select *` を比べるため、0018 が既存の請求書に足す `opening_balance = false` を期待値に明示した（0017 の `expectedBooleanUserFacts` と同じ扱い。元の列はすべてそのまま比べる）。
- 試験の誤り（自分で直したもの、弱体化ではない）: 仮勘定の残高の符号（借方 + の約束で 300,000 − 200,000 = +100,000）、買掛金年齢表の列名（`balance`）、1,000 行 × 2 セル × 1,000 字では 2 MB に届かなかった入力、ヘッダの `'` は数式の先頭文字の前でだけ外れること。

## 未実施（減らさない。完了したら「済」を付けて残す）

- 小売パックの最初の月次締めで、開始仕訳の在庫科目の期首残高を「前回の締め」とみなす対応（D-20、パック側の作業）。
- 締めガイドに「期首残高仮勘定の残高が 0 でない」の点検（Q-6）、導入チェック（B3）の注意項目、セットアップウィザード（B4）の「期首残高」ステップ（未統合の項目との接点）。
- 申告準備の科目分類への 3900 の追加（Q-7、残高 0 なら不要）。
- domain の【未確認】の一次出典の確認（このセッションも `nta.go.jp`・`laws.e-gov.go.jp` へは接続していない）。

## 判断待ち（利用者）

- spec の Q-1〜Q-8 は既定のまま実装した（Q-1 経理だけの利用者は売掛金・買掛金・在庫を取り込めない、Q-3 3900、Q-4 事業主貸・借はマニュアルで注意、Q-5 は計測で売掛金・買掛金 200 行・在庫 2,000 行に下げた）。

## 次のセッションへ

- 統合担当: ADR 番号 0030、migration 0018、`apps/web/src/router.tsx`・`navigation-data.ts`・`help.ts`・`token-usage.test.ts` の追加の取り込み。
