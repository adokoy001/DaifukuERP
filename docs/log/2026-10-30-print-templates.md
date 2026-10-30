# 作業記録: 2026-10-30 帳票の共通化と拡充（C5 print-templates）

- セッション: 完成度向上計画 C5（round 6、wf_60d9defd-7f8、branch `wip/print-templates`、base 8d40672）／ 担当: agent（実装担当。spec は spec 担当が作成し、レビュー指摘をこのセッションで反映）／ 対象: [docs/specs/print-templates.md](../specs/print-templates.md)
- 計測: tokens=null（未計測）, agent_minutes=100, human_minutes=0, rework_lines=60, gate_failures=0

## 決めたこと（と理由）

- **spec レビューの 14 件はすべて受入**（却下なし。spec の D-13 に一覧）。主なもの: 入力ダイアログを日英にするため `print.fields` を足した。print-layout を `defineModule` の無いライブラリにして、module 一覧を完全一致で確かめる既存試験（`scenario.db.test.ts`、`l10n-jp.db.test.ts`）と catalog を変えない。合計請求書の見出しを「当期ご請求額合計（税込）」にし、入金済みを含む旨と「各請求書（適格請求書）の合計です」を注記した。l10n/jp の請求書の日付表記は変えない。注文書・支払通知書には自社の登録番号を出さない。領収書・支払通知書の下書きは INVALID_STATE にした。
- **印刷の対応は action 側の宣言**（`print: { entity, label, idInput?, when?, fields? }`）。ADR-0009 に追記し、新しい ADR 番号（ADR-0033）は使っていない。1 つの entity に複数の帳票があり（入出金の領収書と支払通知書）、pack が既存 entity の帳票を足せ、action が権限と入力 schema を既に持つため。Web に帳票ごとの対応表を置かない。
- **設定 `print_layout.date_style` は利用する module の hooks から冪等に登録**（`ensurePrintLayoutSettings()`。kernel の `ensureCompanyProfileSetting` と同じ形）。その中で先に `company.profile` を登録する。`GET /meta/settings` は登録順に返し、既存の company-admin AC-8 の試験が「会社タブの先頭は会社プロフィール」を確かめているため（試験は変更していない）。
- **支払通知書は `purchase_settlement` ではなく `payment`（direction `pay`）**。計画の entity 名の訂正（spec D-5）。
- **合計請求書の端数**: 各売上請求書が適格請求書で、問57 の端数処理は請求書ごとに済んでいる。合計請求書は保存値を加算して表示するだけで、端数処理の規則は適用しない（Q&A 問67 は根拠にしない）。
- **紙の大きさ**: 明細 20 行が A4 1 枚に収まるように、`printDocument` に印刷用 CSS（文字 11px、セルの余白を詰める）を入れた。画面表示は変わらない。
- **payment のファイル構成**: spec の 4 ファイルではなく `actions/print.ts` と `services/payment-html.ts` の 2 ファイル（領収書と支払通知書は内訳表以外が同じ）。spec D-14 に記録。

## やったこと

- kernel: `ActionConfig.print`（型 `ActionPrintBinding` / `ActionPrintField`）、`defineAction` の定義時検査（命名 `<module>.render_<document>_html`・`tx: 'none'`・`mutates`・`internal`・`idInput`・`fields`）、`appMeta` の `actions[].print`（`printBindingMeta`）。
- 新 package `@daifuku/mod-print-layout`（`modules/print-layout`、依存は kernel と zod）: `escapeHtml`・`formatMoney`・`formatRate`・`sumDecimals`・`formatDocumentDate`、発行者・宛先・明細表（`overflow-x:auto` の枠）・税率別内訳・合計・備考・状態の帯、`printDocument`・`withStatusBanner`、`issuerFromCompanyProfile`、設定と `print_layout.era_date` の差し替え点、`loadPrintTools`。
- sales: 既定請求書 `defaultInvoiceHtml` を共通部品で組み立て直し（出力の期待と export は不変）、`resolveIssuer` の代替経路を `issuerFromCompanyProfile` に、`sales.render_invoice_html` に `print` 宣言、新 action `sales.render_statement_html { partnerId, closingDate? }`（差し替え点 `sales.statement_html`）。
- trade: `trade.render_quotation_html`・`trade.render_order_html`（発注だけ）・`trade.render_delivery_note_html`（出荷だけ、税率 % なし）。payment: `payment.render_receipt_html`・`payment.render_payment_notice_html`。workforce: `workforce.render_payslip_html`（`siteAccess: true`、下書き拒否、発行者は `company.profile`、登録番号なし）。l10n/jp: `print_layout.era_date` に `toWareki` を登録。
- Web: `lib/print.ts` を宣言による発見に置き換え（`printActionsFor`・`extraInputSchema`・`printFieldPresentation`・`printInputOf`。接尾辞 `PRINT_ACTION_SUFFIX` による発見は廃止）、`components/print-button.tsx`（複数ボタン、入力ダイアログ、`data-print-action`）、`/me`・`/workforce` の給与パネルに「給与明細を表示」。新しい画面・ルートは無い（help.ts・CONVERTED の追加なし）。
- docs: ADR-0009 追記、`docs/conventions/ui.md`（印刷ビューの行と「帳票（印刷ビュー）」の節）、マニュアル 05（帳票を印刷する）・03（帳票の日付表記）・10（制約）・付録 F（給与明細の印刷）・付録 L（見積書・注文書・納品書）、`docs/architecture/program-map.md`、`docs/specs/sales.md`。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] 単体: `kernel/test/action-print.test.ts`（9）、`modules/print-layout/test/layout.test.ts`（18）、golden と内容の試験 `modules/trade/test/print-html.test.ts`（9、`golden/quotation.html`・`purchase-order.html`・`delivery-note.html`）、`modules/payment/test/print-html.test.ts`（8、`golden/receipt.html`・`payment-notice.html`）、`modules/sales/test/statement-html.test.ts`（10、`golden/statement.html`。2026 年の全日 × 締め日 1〜31 で「期間＝`closingDateOf` の集合」を総当たり）、`modules/workforce/test/payslip-html.test.ts`（6、`golden/payslip.html`）、`l10n/jp/test/print-dates.test.ts`（3）、`apps/api/test/print-bindings.test.ts`（2、runtime の全 `print` 宣言）、`apps/web/src/lib/print.test.ts`（11。接尾辞の試験を宣言の試験に置き換えた。理由: 発見の仕組みそのものを宣言に変えたため。`htmlOf`・`withPrintBar` の試験は変更なし）。既存の `modules/sales/test/recalculate.test.ts`・`issuer.test.ts`・`l10n/jp/test/services.test.ts`（`golden/invoice.html`）・`apps/runtime/test/setting-labels.test.ts` は変更なしで通過。
- [実測] DB（`daifuku_test_c5pt`）: `modules/trade/test/print.db.test.ts`（8）、`modules/payment/test/print.db.test.ts`（9。試験の中だけで `payment`・`payment_allocation` の read を与えたロールで、取引先・請求書を読めないと PERMISSION_DENIED がそのまま返ることを含む）、`modules/sales/test/statement.db.test.ts`（10。別会社の請求書は会社単位の複合外部キーで取引先を指せないことも確認）、`modules/workforce/test/payslip-print.db.test.ts`（6）、`apps/api/test/print-meta.db.test.ts`（6、HTTP の `/meta` と 403/404/409/400）。既存の `sales.db`・`scenario.db`・`company-admin.db`・`l10n-jp.db`・`meta.db`・`settings-console.db`・`setup-health.db` は変更なしで通過（company-admin AC-8 は最初に失敗し、設定の登録順の修正で通過。下記）。
- [実測] `GATE_DB_SHARDS=1 pnpm gate:light`（`daifuku_test_c5pt`）通過: format・docs・assurance・typecheck（全体・api・web）・lint・unit 170 ファイル 1,763 件（104.5 秒）・deploy（21.1 秒）・DB 139 ファイル 922 件（1,430 秒。kernel を変更したため DB 全件に昇格）、全体 23.8 分（11:44〜12:08、load 7〜15）。payslip の列名の修正（b1fe70e）は unit の実行前に入れ、golden も同時に更新した。
- [実測] ブラウザ（slot 58、chromium、`--no-deps`）: `apps/web/e2e/print-templates.spec.ts` 3 件（見積書・領収書・支払通知書のボタンと新しいタブ、入金と支払でボタンが入れ替わる、受注と下書きにボタンが出ない／合計請求書のダイアログ、締め日でない日の 400 と欄の下の説明、月末締めの帳票、390px の記録画面・ダイアログ・帳票の横スクロールなし、日本語 390px と英語 1280px でダイアログを開いた axe（`judge()`、失敗 0）、英語のラベル・補助文・「View」／`/me` の給与明細）と既存の `company-admin.spec.ts` 4 件（請求書の印刷を含む）、7/7 通過（1.5 分、load 9〜11）。最終の状態で再実行: print-templates・company-admin・workforce 10/10（4.0 分）、記録画面のヘッダを使う trade・payment・document-links・a11y 45/45（5.3 分、load 15）。後者の 1 回目は fixture の作成が出力なしで失敗し（`tsx src/db/e2e-fixture.ts` が exit 1、詳細の出力なし）、そのまま再実行して通った。製品の変更とは無関係な一時的な失敗と判断したが、原因は確かめていない。
- [実測] A4 の枚数（検証手順 5 を目視でなく測定に置き換え）: 各 golden と、明細 20 行の見積書・納品書・合計請求書（請求書 20 件）・領収書（消込 20 件）、給与明細を Chromium の PDF 出力（`preferCSSPageSize`、`@page A4 12mm`）で数え、すべて 1 枚。印刷用 CSS を入れる前は 20 行の 4 種と給与明細が 2 枚だった。20 行の見積書の PDF を画像で確認し、明細・内訳・合計・備考が 1 枚に並ぶことを目視した。印刷バーが紙に出ないことは `@media print{.daifuku-print-bar{display:none}}`（既存）と `withPrintBar` の既存試験による（レビュー）。
- [レビュー] 帳票の action は要求者の `Context` で `repo()` から読むだけで、`systemContext()` や権限を外す経路を使っていない（各 `build*RenderData` を読み直した）。金額は保存値の文字列を桁区切りするだけで、加算は合計請求書と納品書の `sumDecimals` だけ。
- [未検証] `pnpm gate:full`（統合担当が実行）。ブラウザ試験の全件。Chrome の印刷プレビュー画面そのもの（PDF 出力で代替）。manager・hr が自分の給与明細を開く場合（本人と同じ行の権限で、個別の試験は無い）。MCP ツールとしての呼出し（既存の仕組みで tool になることは `mcp.db.test.ts` の全 action 一致で間接的に確認されるが、帳票 tool を個別には呼んでいない）。

## 見つけた問題と修正（発見経路つき）

- `print_layout.date_style`（会社タブ）が `company.profile` より先に登録され、`GET /meta/settings` の会社タブの先頭が変わった — 発見: 実測（既存 `company-admin.db.test.ts` AC-8 の失敗）、修正: `ensurePrintLayoutSettings()` が先に `ensureCompanyProfileSetting()` を呼ぶ（f4d491a）。試験は変更していない。
- 20 行の帳票と給与明細が A4 2 枚になった — 発見: 実測（PDF の枚数）、修正: 印刷用 CSS（7d83ec0）。
- 試験側の誤り（製品の不具合ではない）: 金額の否定の確認が単価の文字列と重なった、`\d+%` が inline style の `width:100%` に当たった、エラー本体が `{ error: {...} }` で包まれていた — 発見: 実測（初回の試験失敗）、修正: 試験の確認を正した（いずれも新規の試験で、既存の試験は変えていない）。
- prettier をディレクトリ指定で実行し、既存の golden HTML・JSON・tsconfig を整形してしまった — 発見: `git status`、修正: それらを元に戻し、新規 golden を再生成した（コミット前）。

## 未実施（減らさない。完了したら「済」を付けて残す）

- 領収書の収入印紙欄・印紙税の注記、給与明細の法定記載事項の文言（国税庁などの一次資料を確認できていない。spec の未決事項 1・2）。
- 売上請求書の日付表記を `print_layout.date_style` に従わせるか（未決事項 9）。
- 合計請求書の前回繰越・入金額、発行履歴（未決事項 4）。

## 判断待ち（利用者）

- spec の未決事項 1〜9（領収書の記載事項と印紙税、給与明細の記載事項、日付表記の既定値、合計請求書の繰越、発行時データ、締め日変更時の過去期間、500 件の上限、金額なし納品書、請求書の日付表記）。

## 次のセッションへ

- 統合担当: `docs/STATUS.md`・`PLAN.md`・`docs/completion-plan.md`（C5 を完了へ）・`AI_INDEX.md`（帳票の読む順に spec と `modules/print-layout`）の更新、`pnpm gate:full`。ADR は新規なし（ADR-0009 に追記。ADR-0033 は未使用）。
- 督促状（計画 E3 の `sales.render_reminder_html`）は同じ規約で `print: { entity: 'sales_invoice', ... }` を宣言すれば記録画面に出る。
