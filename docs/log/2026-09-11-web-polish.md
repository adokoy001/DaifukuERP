# 作業記録: 2026-09-11 apps/web 仕上げ（小数の表示桁・請求書の印刷ビュー・ホームのダッシュボード）

- セッション: 実装エージェント（web-polish）／ 担当: agent ／ 対象: オーケストレータ指示の 3 タスク（spec は作成していない: 編集範囲が apps/web と本ログ・metrics に限定されたため。必要なら docs/specs/web-polish.md に本ログの受入条件を写す）
- 計測: tokens=null, agent_minutes=22, human_minutes=0, rework_lines=1, gate_failures=1

## 決めたこと（と理由）
- **小数の表示規則は `lib/format.ts formatDecimal(s, scale, currencyScale)` の 1 箇所**。`numeric(20,6)` が `"100.000000"` で届くので、①フィールドの `scale` を超える桁は出さない（表示上の切り捨て。値は変えない）、②会社通貨の最小単位桁 `currencyScale` は必ず残す、③それより後ろの末尾 0 は落とす、④3 桁区切り。JPY（0 桁）なら `100.000000 → 100`、`1234.500000 → 1,234.5`、USD（2 桁）なら `100.00` / `1,234.50` / `1.2345`。文字列演算のみ（ADR-0010、float 不使用）。
- **会社通貨は取れないので JPY 既定（0 桁）**。`GET /auth/me`（apps/api/src/plugins/auth.ts）は `{ user, companyId, actor, locale }` を返し通貨を含まない。kernel の `companies.currency` は既定 `'JPY'`（kernel/src/db/system-tables.ts）。`api/company.tsx` の `CompanyProvider` が `/auth/me` を 1 回だけ読み、`currency` または `company.currency` が現れたら `lib/currency.ts` の ISO 4217 最小単位表（JPY/KRW=0、USD/EUR 等=2、KWD/BHD=3、未知は 0）で桁を決める。API に通貨を足すときの配線先はこの 1 ファイル。apps/api には触っていない。
- **入力欄は編集中は生の文字列、非フォーカス時は表示形**（`NumberField`、decimal のみ。int は年や連番があるので区切らない）。送る値は常に生の文字列で、`data-raw` 属性に保持。貼り付けた `1,234,567` のカンマは onChange で除去（ja/en とも小数点は `.`）。
- **表示規則の適用先**: 一覧セル（data-table）、フォーム入力（inputs）、明細グリッドのセルとフッター合計（line-grid; int の合計も 3 桁区切りに）、レポート表のセルと totals 行（report-table）、添付一覧の金額（attachments-panel）、監査ログ。**監査ログは変更項目名だけだったので `項目: 変更前 → 変更後` を出すように拡張**（`fieldChanges` / `changeValueText`。create は after のみ、40 文字で切る、ref は短縮 id）。小数を「監査ログに適用」するには値を出す必要があったため。
- **金額と数量の区別は /meta に無い**（どちらも `decimal` + `scale: 6`）ので、通貨桁は decimal 全部に掛かる。JPY では影響なし。2 桁通貨だと数量 `1` が `1.00` になる（税率 `scale: 4` は `min(currencyScale, scale)` で桁を守る）。`FieldMeta` に `money`/`quantity` の区別が入れば分けられる（判断待ちへ）。
- **印刷ビューはデータ駆動**: `lib/print.ts printActionFor(entity, actions)` が `${entity.module}.render_invoice_html` で、かつ `inputSchema.properties.id` を持つ action を探す（今は `sales.render_invoice_html` ↔ `sales_invoice`）。ボタンは document かつ docstatus=1 のときだけ。**タブはクリック内で同期的に `window.open('', '_blank')` してから** action を呼ぶ（非同期後の open はポップアップ扱いで塞がれる）。HTML は Blob URL で表示（`lib/download.ts showHtmlIn`、10 分後に revoke）。`withPrintBar` が `<body>` 直後に「印刷／閉じる」バーを差し込み、`@media print` で隠すので紙面はモジュールのレイアウトのまま。`document.write` は使わない（deprecated）。
- **ホームは /meta + 汎用一覧だけ**: document ごとにカード（下書き／確定／取消の件数、新規（create 権限があるとき）／一覧）、モジュール順、マスタ（非 document）はチップ、`resultKind: 'table'` の action を「レポート」に列挙。件数は `GET /api/<entity>?limit=1&offset=0&where={"docstatus":N}` の `total` だけを読む（指示文の `POST` は REST では `GET /api/:entity` が一覧なので GET）。エンティティ × 3 状態を `useQueries` で並列、キーは `keys.list(entity, params)` なので保存・確定の invalidate で件数も更新される。staleTime 30 秒。グラフ無し。
- 削除した文言 `S.welcome`（プレースホルダのホームでしか使っていなかった）。

## やったこと
- `apps/web/src/lib/format.ts`: `formatDecimal` の規則変更（`currencyScale` 引数、`-0` 正規化）、`formatValue` の第 4 引数を `{ refLabel, currencyScale }` に、`fieldChanges` / `changeValueText`
- `apps/web/src/lib/currency.ts`（新規）: 最小単位表、`currencyScale`、`currencyOf`（/auth/me の寛容な読み取り）
- `apps/web/src/api/company.tsx`（新規）: `CompanyProvider` / `useCurrencyScale`（`router.tsx` の `AppLayout` に組み込み）
- `components/fields/inputs.tsx`（NumberField）、`data-table.tsx`、`report-table.tsx`、`line-grid.tsx`、`attachments-panel.tsx`、`audit-panel.tsx`（値の before → after）
- `apps/web/src/lib/print.ts`（新規）、`components/print-button.tsx`（新規）、`pages/entity-form-page.tsx`（ヘッダに配置）、`lib/download.ts showHtmlIn`
- `apps/web/src/lib/dashboard.ts`（新規、`countQuery` / `groupByModule`）、`api/dashboard.ts`（新規、`useDocstatusCounts`）、`pages/home-page.tsx`（全面差し替え）
- `strings.ts`: viewInvoice / print / rendering / popupBlocked / printNoHtml / documents / masters / list / countUnavailable / noDocuments
- テスト: `lib/format.test.ts`（規則の書き換え＋追加）、`lib/currency.test.ts`、`lib/print.test.ts`、`lib/dashboard.test.ts`（新規）
- 本ログ、`docs/metrics/features.jsonl`

## 検証（何を・どう確認したか。コードレビューか実測かを明記）
- [実測] `pnpm exec tsc -p apps/web/tsconfig.json --noEmit`: 0 errors。root `node node_modules/tsc7/bin/tsc -p tsconfig.json --noEmit`: 0 errors。
- [実測] `pnpm exec eslint apps/web`: 0 errors / 0 warnings。`depcruise apps`: 違反なし（270 modules）。
- [実測] `pnpm --filter @daifuku/web build`: 成功（291 modules, JS 456.7 kB / gzip 143.6 kB。前回 448 kB）。
- [実測] `pnpm exec vitest run apps/web`: 12 files / 80 tests 通過（既存 64 → 80、+16）。
- [実測・モック] ビルド済み `dist/` を **サーバ無し**で headless Chromium（/opt/pw-browsers chromium-1194）に読ませた: `page.route` で `http://localhost:5173/**` を dist のファイルで、`http://localhost:3000/**` をインプロセスのモック API（`/auth/login`, `/auth/me`, `/meta`, REST 一覧・単票・audit、`/actions/sales.render_invoice_html`, `/actions/sales.ar_aging`）で応答。スクリプト: scratchpad `web-polish-mock/run.mjs`、スクリーンショット `shot-home/list/record/print/report.png`。断言した内容（全部 pass、pageerror 0）:
  - ホーム: document 2 件にカード、`sales_invoice` の件数 3/12/1、`journal_entry` の 1,234/0/7（区切りあり）、新規／一覧リンク、レポート 2 件、マスタのチップ。件数リクエストは 1 ページ読み込みにつき **ちょうど 6 本（2 エンティティ × 3 状態、重複なし）**。en 切替でラベルが変わる。
  - 一覧: `1234567.000000 → 1,234,567`、`123456.700000 → 123,456.7`、`1358023.700000 → 1,358,023.7`、`.000000` が残らない。
  - 確定済み単票: 無効化された合計欄が `1,358,023.7`（`data-raw="1358023.7"`）、明細セル `1,500.5` / `2`、フッター合計 `1,003,001`、監査ログ `税込合計 100 → 1,358,023.7`。
  - 印刷: 「請求書を表示」が出る → クリックで新タブ（`blob:` URL）、`<title>` が「請求書 INV-2026-0001」、本文の h1、バーに「印刷／閉じる」、`POST /actions/sales.render_invoice_html` が 1 回、`emulateMedia('print')` でバー非表示。下書きにはボタン無し。
  - 編集: 非フォーカス `1,234.5` → フォーカスで `1234.5` → `9,876.25` を入力すると生値 `9876.25` → blur で `9,876.25`。数値でない文字はそのまま。
  - レポート: セル `100` / `2,500.25`、totals 行も同形。
  - `/auth/me` が `currency: 'USD'` を返すモックでは `1,234,567.00` / `1,358,023.70` / フッター `1,003,001.00`（配線が生きていることの確認。実 API はまだ返さない）。
- [レビュー] `apps/api/src/plugins/auth.ts` の `/auth/me`（通貨なし）、`apps/api/src/routes/rest.ts`（一覧は `GET /api/:entity`、`where` は JSON、`limit` 1〜500）、`kernel/src/repository/query.ts`（`docstatus` は `entity.columns` に居るので where 可）、`modules/sales/src/actions/render-invoice-html.ts`（input `{ id: uuid }`、output `{ html }`、permission read）、`apps/api/src/routes/meta.ts`（`inputSchema` は module action のみ、`resultKind`）を読んで前提を確認。
- [レビュー] 既存 e2e（`e2e/smoke.spec.ts`, `e2e/phase1.spec.ts`）のセレクタ・文言は変えていない。phase1 の `fill('100')` はフォーカス中の生値入力になり、フッター `toContainText('100')` は `100` で成立（モックで同経路を確認）。
- [未検証] 実 API（`pnpm dev:api`）＋実 DB での動作、`pnpm --filter @daifuku/web e2e`（smoke + phase1）。サーバ起動禁止のため未実行 → オーケストレータ。
- [未検証] 実ブラウザでの印刷ダイアログ（headless では `window.print()` を呼んでいない。バーの表示／非表示までを確認）。

## 見つけた問題と修正（発見経路つき）
- `formatDecimal('-0.000000', 6, 2)` が `-0.00` になる — 発見: 実測（vitest、自分のテスト）。修正: 負のゼロの正規化を `-0.00` 形にも広げた（1 行）。
- モック検証で件数リクエストが 12 本に見えた — 発見: 実測。原因はスクリプト側（ログイン後の `/` 着地と `page.goto('/')` の 2 回読み込み）で、コードの問題ではない。networkidle 後の差分で数え直して 6 本。

## 未実施（減らさない。完了したら「済」を付けて残す）
- 実 API での `/auth/me` に通貨を足す（`currency` か `company.currency`。web 側は両方読む）。足すまで全社 JPY 扱い。
- `FieldMeta` に money / quantity の区別が無く、2 桁通貨では数量にも通貨桁が掛かる。
- 監査ログの ref 値は短縮 id（表示名の解決は未実装。行ごとの追加クエリを避けた）。
- ホームの件数は docstatus 別のみ（期間・担当者などの絞り込み無し）。一覧ページは URL で docstatus を絞れないので件数はリンクにしていない。
- 単票ヘッダで displayField の無い document は `titleOf` が number にフォールバックし、番号バッジと重複表示になる（既存挙動、スクリーンショットで確認。今回は範囲外）。
- 印刷ビューを開いたタブは 10 分後に Blob URL を revoke するので、それ以降の再読み込みは空白になる（アプリ側で再度「請求書を表示」）。
- 前回ログ（2026-09-10-web-phase1）の「server.ts の CORS に `PUT` が無い」は未解決のまま（本タスクでも apps/api は編集不可）。

## 判断待ち（利用者）
- 通貨の出所: `/auth/me` に `company: { id, code, name, currency }` を足すか、`/meta` に会社情報を持たせるか。
- `f.money` と `f.quantity` を /meta 上で区別する（`FieldMeta.role: 'money' | 'quantity'` 等）か、数量にも通貨桁で良しとするか。
- 印刷ボタンの文言は指示どおり「請求書を表示」固定。action 名から一般化（`render_*_html` → 「帳票を表示」）するか。

## 次のセッションへ
- `pnpm db:reset && pnpm dev:api` + `pnpm dev:web` → `pnpm --filter @daifuku/web e2e`。売上請求書を 1 件確定して「請求書を表示」→ 実ブラウザで印刷ダイアログまで確認。
- モックスクリプトは scratchpad `web-polish-mock/run.mjs`（`node run.mjs`、dist をビルド済みであること）。
