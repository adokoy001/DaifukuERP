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

## レビュー対応（2026-10-30、修正担当）

レビューの 19 件（major 4・minor 9・nit 6）をコードで確かめ、すべて妥当と判断して直した（却下なし。直し方を変えたものは下に書く）。

- **[major] 取込と前の年度の開設の競合（AC-4、D-14）**: `postOpeningFromSource` は最初の年度を `accounting-periods` のロックなしで読んでいたため、取込の途中に別の利用者が前の年度を開くと、開始仕訳（と期首請求書）が前の年度の期中の仕訳として確定し、製品の操作では取り消せなかった。年度を読む前に `accounting-periods` を取るようにした（`fiscal_year` の作成・期間の締め・仕訳の日付の検査と同じロック。転記は元々このロックを取引の終わりまで持つので、保持時間はほぼ変わらない）。在庫の取込は仕訳を作らないので、入庫を作った後で同じロックを取って AC-2 を確かめ直す `assertOpeningYearLocked` を足した（在庫の直列化のロック → 期間のロックの順で、小売パックの月次締めと同じ順。逆順の経路（請求書の確定 → 自動の入出庫）は既存のもので、PostgreSQL の deadlock 検出に任せる点は変わらない）。
- **[minor] 期首在庫の入庫が AC-4 をすり抜ける**: 純額の検査は仕訳明細だけを見るので、期首在庫の入庫が残ったまま前の年度を開けた。inventory に `fiscal_year` の `before_create` hook（`modules/inventory/src/hooks/opening-year.ts`）を足し、範囲内に確定済みの `sourceEntity = 'fiscal_year'` の入庫があれば 409 `opening_stock_exists`（番号と件数）で拒否する。spec AC-4・D-14・D-19 の説明、ADR-0030 の決定 8、マニュアル 03 の戻し方を直した。
- **[major] 在庫の段が品目を読めない利用者にも有効だった**: サーバーは `product:read`・`warehouse:read` も要求するが、画面は `stock_entry` の操作とロールしか見ていなかった。`sectionBlocked('stock')` に 2 つの read を足し、説明（日英）に「品目を読める役割（閲覧・営業・購買など）」を足した。spec AC-6・AC-38 に明記し、DB 試験の名前を実際の組合せ（経理 + 在庫 + 閲覧、経理 + 購買）に直した。unit 試験の購買の場合は meta に `product`・`warehouse` の read を足した（実際の購買ロールの持つ権限に合わせた修正で、弱体化ではない）。
- **[major] 確認の `Dialog` の最初の焦点が確定する操作にあった**: 2 つの `Dialog` とも「キャンセル」に `data-autofocus` を移し、処理中は無効にした（締めガイドと同じ）。
- **[major] 年度を変えるとキーボードの焦点が失われた**: 状況の照会に `placeholderData: keepPreviousData` を付け、読込中も年度の選択欄だけは表示したまま（値は URL の年度）にし、他は `aria-busy` と読み上げの「読み込み中…」にした（前の年度のデータのまま取り込めないように、状況と段は表示しない）。
- **[minor] 仮勘定の問題がサーバーの英語の文のままだった**: `clearingReasonText`（日英、科目コード、直し方）と設定画面へのリンクを出し、サーバーの文は補足にした。仮勘定を使う開始仕訳・売掛金・買掛金の段は、仮勘定が使えない間は無効にして理由を示す（spec AC-28・AC-38）。
- **[minor] `committed: false` でも「取り込みました」と読み上げた**: 読み上げを結果に合わせた。
- **[minor] 段ごとに同じ名前の操作が並んでいた**: 雛形・事前確認・取り込む・結果の見出し・エラー行の絞り込み・エラー CSV・結果の表に段の名前を付けた（`aria-label`、表示の文字はそのまま）。最初は視覚的に隠した `span` で足したが、Chromium の名前の計算が日本語の括弧の前に空白を入れたため、名前が決まる `aria-label` にした（見える文字を名前の先頭に含むので WCAG 2.5.3 を満たす）。ファイル欄の説明を `aria-describedby` に足し、開始仕訳と在庫のファイル欄にも段の名前を付けた。
- **[minor・nit] 期首請求書に「請求書を表示」と「訂正」が出ていた**: `isOpeningDocument` で印刷ボタンを出さず、取り消した期首請求書では「訂正」の代わりに取り込み直す案内（日英）を出す。
- **[minor] 作成した伝票が黙って 20 件で切れていた**: 件数を出し、21 件以上なら先頭だけであることと一覧へのリンクを出す。
- **[nit] 取消の後も開始仕訳の段に前回の結果が残った**: レビュー案の「段の key に仕訳 id を含める」は、取込の成功直後にも状況の取り直しで id が変わり結果が消えるので採らず、取消の成功時に呼ぶ callback で段を作り直すようにした。
- **[nit] 見出しの階層とランドマーク**: 結果の見出しを開始仕訳・在庫は h3、売掛金・買掛金は h4 にし、結果の枠を `section` から `div` にした。
- **[nit] 文言**: 使っていない `DOC_ROUTE` を消し、年度の選択肢と「一覧を開く」の名前の括弧を表示言語に合わせ（`yearOptionLabel`・`nameSuffix`）、件数・上限の桁区切りを表示言語にした。spec AC-23 の計測値を作業記録どおり「約 98 秒（DB の作成時刻からの下限）」に、マニュアル 06 の余分な空行を消した。
- **[minor・nit] 試験の穴**: 売上の AC-17 に品目付きの下書き、仕入の AC-17 の試験（明細の科目・2 行・課税・品目・日付を 1 規則ずつ、issue の path まで確認）、AC-23 の「残高 0 で期首残高日より後の台帳の行がある」、AC-28 の税の役割、AC-2 の `no_first_period`、汎用の `fiscal_year.create` の `opening_entries_exist`、期中の取消の逆仕訳が訂正日付であること（売上・仕入）を足した。
- 採らなかった任意の案: `assertPostingDate` で「最初でない年度の期首残高日を含む期間」も拒否する案。ロックで競合が起きなくなったので足していない。

### レビュー対応の検証

- [実測] 足した試験が直した不具合を捕まえることを、直す前の状態に一時的に戻して確かめた（変異の試験）: ロックを外すと開始仕訳の 2 本の接続の試験が失敗（`committed: true` で仕訳が残る）、`assertOpeningYearLocked` を外すと在庫の 2 本の接続の試験が失敗、inventory の hook の登録を外すと `opening_stock_exists` の試験が失敗、レビューの変異 M4・M5・M5p・M10b・M15 はそれぞれ仕入の AC-17・売上と仕入の AC-17・在庫の AC-23・会計の AC-28 の試験で失敗。`placeholderData` を外すとブラウザ試験の年度の焦点の確認が失敗。すべて元に戻して通過を確認した。
- [実測] DB: 4 つの期首残高の試験ファイル（会計 19 件・売上 16 件・仕入 10 件・在庫 16 件）を DB `daifuku_test_b6fx` で通過。
- [実測] ブラウザ: `apps/web/e2e/opening-balances.spec.ts`（slot 61、`--project=chromium --no-deps`）通過（18.0 秒）。年度の選択欄の矢印キー（後の年度を API で 1 つ開く）、2 つの `Dialog` の最初の焦点、段の名前付きの操作と結果の見出しの名前、取消の後に前回の結果が消えること、期首売上請求書の画面に印刷ボタンが無いことを足した。
- [レビュー] 読み上げの文（`committed: false`）、作成した伝票が 21 件以上のときの表示、取り消した期首請求書の「訂正」の代わりの案内は試験で通っていない（コードの確認だけ）。
- [実測] `pnpm gate:light`（DB `daifuku_test_b6fx`、レビュー対応のコードを含む作業ツリー）: 通過、1,662 秒（format 37 秒、typecheck 19 秒・api 17 秒・web 25 秒、lint 32 秒、unit 156 ファイル 1,573 件 85 秒、DB は全件に昇格して 137 ファイル 888 件 1,419 秒、deploy 28 秒）。共有の 4 CPU、負荷平均 3〜11。この後に変えたのは文書（作業記録・マニュアル 03・ADR-0030）だけで、`pnpm docs:check` と `pnpm format:check` をやり直して通過。`pnpm gate:full` は統合担当が実行する（未実行）。

## 未実施（減らさない。完了したら「済」を付けて残す）

- 小売パックの最初の月次締めで、開始仕訳の在庫科目の期首残高を「前回の締め」とみなす対応（D-20、パック側の作業）。
- 締めガイドに「期首残高仮勘定の残高が 0 でない」の点検（Q-6）、導入チェック（B3）の注意項目、セットアップウィザード（B4）の「期首残高」ステップ（未統合の項目との接点）。
- 申告準備の科目分類への 3900 の追加（Q-7、残高 0 なら不要）。
- domain の【未確認】の一次出典の確認（このセッションも `nta.go.jp`・`laws.e-gov.go.jp` へは接続していない）。

## 判断待ち（利用者）

- spec の Q-1〜Q-8 は既定のまま実装した（Q-1 経理だけの利用者は売掛金・買掛金・在庫を取り込めない、Q-3 3900、Q-4 事業主貸・借はマニュアルで注意、Q-5 は計測で売掛金・買掛金 200 行・在庫 2,000 行に下げた）。

## 次のセッションへ

- 統合担当: ADR 番号 0030、migration 0018、`apps/web/src/router.tsx`・`navigation-data.ts`・`help.ts`・`token-usage.test.ts` の追加の取り込み。
