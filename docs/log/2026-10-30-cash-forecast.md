# 作業記録: 2026-10-30 資金繰り表と入出金予定（E3）

- セッション: 完成度向上計画 E3（workflow の作業項目、worktree `wip/cash-forecast`、基点 `ffc2f42`）／ 担当: agent（実装担当） ／ 対象: [docs/specs/cash-forecast.md](../specs/cash-forecast.md)
- 計測: tokens=null（未計測）, agent_minutes=約150（spec の指摘対応 約15、backend と試験 約30、画面と試験 約35、計測・回帰・文書 約70。待ち時間を含む）, human_minutes=0, rework_lines=約20（下の「見つけた問題と修正」）, gate_failures=1（gate:quick の unit。負荷による時間切れとポート競合で、本変更と無関係。単独の再実行で成功）

## 決めたこと（と理由）

- **spec critic の 14 件はすべて採用（1 件は一部採用）。** 内容と理由は spec の決定事項 14〜27。主なもの:
  - 契約請求の窓は `from` ではなく今日に結び付けた（今日の月の 12 か月前の月初から）。`intervalMonths` が最大 12 なので、続いている契約は必ず窓の中に請求日を持つ。窓より前に未作成で残った対象月は予定に入れず `meta.contractBacklog { count, subtotal }`（税抜）に数える。税率を解決しないので、古い期間の税率の欠落で全体が失敗しない。対象月は契約の開始月から順に調べ、保存値の `nextPeriod`（請求書の削除で古くなりうる）に頼らない。
  - 給与の二重計上（支払仕訳を支払日以前に記帳した場合）は振る舞いを変えずに明示した（`meta.notices` の `payroll_posted_overlap`、画面の注意、マニュアル）。固定する試験は unit（`cash-plan` の配置規則の性質で、banking の DB 試験は給与を作れないため）。
  - 未消込の入出金（`meta.unallocated`）と資金科目外の入出金（`meta.uncountedPaymentAccounts`）を注意情報として足した。資金科目外は `to` までの全期間を対象にした（期間内だけだと未来の期間でいつも空になるため）。科目ごとに入金と支払を分けた。
  - 記帳済みの入出金は `aggregate` を `entryDate`・`entryId` の keyset で 10,000 未満が返るまで読む（純粋関数 `readKeyset`、差し替えた読取関数で unit 試験）。
  - 計算量の指摘のうち「明細の totals を aggregate で」は採らなかった。明細は並び替えと打ち切りのために対象の伝票を全件読む必要があり、2 つの action が同じ読取関数を使うこと（AC-4）を優先した。代わりに計測した（下の検証）。
- **日別の action も未決済の伝票を `list` で全件読む。** spec の初版は日別を `aggregate`、明細を `list` としていたが、同じ読取関数にすると AC-4（日別と明細の一致）が構造で保たれる。件数の上限は設けず、5,000 件で計測した。
- **`cash-tables.ts` を足した。** 列・`totals`・`meta` の形を純粋関数に分け、`cash-plan.ts` を `Decimal` と `LocalDate` だけに保った。golden 試験は両方を通す。
- **振込予定の行の `dueDate` は請求書の期日。** 置く日（`date`）は振込指定日、`dueDate` 列は請求書の支払期日（golden の C）。予定の項目に `documentDueDate` を持たせた。
- **明細の action は資金科目を読まない。** AC-18（資金科目なしの `INVALID_STATE`）は日別の action だけに適用する（明細は記帳済みの入出金を行にしないため）。spec に明記した。
- **画面の URL の flag は数値の 1。** TanStack Router は文字列 "1" を JSON の引用符付きで URL に書くため（`?drafts=%221%22`）。数値にして `?drafts=1` にした（ブラウザ試験で発見）。
- **`ReportTable` に任意の `columnClass` を足した。** 下書き・予定・記帳済みの列を別の色で示すため（AC-23）。既存の呼出しは変わらない。
- **ADR は作らなかった。** kernel・DSL・port の変更なし。予約された ADR-0036 は使っていない。banking の依存に contract・workforce・tax を足した（`commerce-finance.md` に理由）。

## やったこと

- modules/contract: `src/cash-plan.ts`（新規。`plannedContractReceipts`、`contractCashWindowStart`）、`index.ts`
- modules/workforce: `src/payroll-cash.ts`（新規。`payrollCashSchedule`）、`index.ts`
- modules/banking: `src/contract.ts`（入力・`meta`・行の zod、列挙、日付の計算）、`src/cash-plan.ts`・`src/cash-tables.ts`・`src/cash-sources.ts`・`src/cash-forecast.ts`（新規）、`actions.ts`、`module.ts`（依存とメニュー）、`package.json`、`pnpm-lock.yaml`
- apps/web: `pages/cash-forecast-page.tsx`・`components/cash-forecast-chart.tsx`・`api/cash-forecast.ts`・`lib/cash-forecast.ts`・`cash-forecast.css`（新規）、`components/report-table.tsx`（`columnClass`）、`router.tsx`、`lib/navigation-data.ts`、`lib/help.ts`、`ui/token-usage.test.ts`（`CONVERTED`）
- tests: `modules/banking/test/cash-forecast.test.ts`（21 件、golden・property 2 件を含む）、`cash-sources.test.ts`（5 件）、`cash-forecast.db.test.ts`（11 件）、`golden/cash-forecast-basic.json`、`modules/contract/test/cash-plan.db.test.ts`（5 件）、`modules/workforce/test/payroll-cash.db.test.ts`（3 件）、`apps/web/src/lib/cash-forecast.test.ts`（12 件）、`apps/web/e2e/cash-forecast.spec.ts`（4 件）、`help.test.ts` に経路を追加、計測用 `modules/banking/test/cash-forecast-benchmark.ts`
- 文書: spec（指摘への対応、実装時の明確化、implemented）、マニュアル付録 L（節「資金繰り表」と入口の表）、付録 N（分野の一覧）、`architecture/commerce-finance.md`（責任分担・依存・読取の節）、`architecture/program-map.md`

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] unit: banking・contract・workforce 13 ファイル 133 件、Web の `cash-forecast.test.ts`・`help.test.ts`・`token-usage.test.ts`・`navigation.test.ts` 242 件が成功。golden（spec の表）を JSON と照合、fast-check の property 2 件（AC-12 残高の関係、AC-28 `from` からの独立）各 200 回。
- [実測] DB（自分の DB `daifuku_test_e3cf`）: `banking/test/cash-forecast.db.test.ts` 11 件、`contract/test/cash-plan.db.test.ts` 5 件、`workforce/test/payroll-cash.db.test.ts` 3 件、banking の既存 DB 試験を含む banking 5 ファイル 34 件が成功（banking の依存追加で schema に contract・workforce が入っても既存の試験は変わらない）。
- [実測] ブラウザ（作業環境の補助スクリプト `e2e-run.sh <worktree> 20 e2e/cash-forecast.spec.ts --project=chromium --no-deps`、新しい fixture DB、API :3120 / Web :5220）: 4 件成功（1.6 分）。画面検索から開く、既定の期間、要約・警告・グラフの名前、日別の表（動きのない日の切替）、明細（バッジ・リンク）、条件の変更（URL の置換で履歴が増えない、古い結果の通知と CSV の停止、下書き、期日超過）、送信前の検査とフォーカス、簡単入力、admin の CSV（export 経路の応答と保存名）、差し替えた応答で給与の除外・未消込・資金科目外・契約の積み残しの案内、読取失敗の表示と再試行、権限の無い利用者（入口なし、action を呼ばない）、英語、390px で横にはみ出さない、日英 × 1280 / 390px の axe（serious / critical 0 件）。390px の画面は目視でも確認した。
- [実測] 計測（`cash-forecast-benchmark.ts`、未決済の請求書 5,000 件（売上 2,500・仕入 2,500）と月次契約 500 件、90 日間、admin、3 回）: `banking.cash_forecast` 1,480 / 677 / 1,108 ms（中央値 1,108 ms、90 行）、`banking.cash_schedule` 731 / 965 / 1,545 ms（中央値 965 ms、9,590 行、打ち切りなし）。データ作成に 1,053 秒。計測中のロードアベレージは 12〜18（4 CPU を他の作業と共有）なので、専有環境の値ではない。
- [実測] export 経路: DB 試験で `checkActionExport` と repeatable read（`snapshot: true`）の中で実行した結果が通常の実行と同じであることを確認（2 action）。`canExportAction` は accounting で false、admin で true。
- [実測] `pnpm gate:quick`: format・docs・assurance・eslint・boundaries・typecheck（全体・api・web）は成功、unit は 3 件失敗（`kernel/test/password-hash.test.ts` の 5 秒の時間切れ、`apps/api/test/identity-runner.test.ts` の 127.0.0.1:3109 の使用中（他の作業の browser slot 9 と重なる固定ポート））。2 ファイルを単独で再実行して 8 件成功。本変更と無関係。
- [実測] `GATE_DB_SHARDS=1 pnpm gate:light`: 結果は下に追記する。
- [レビュー] すべての読取が呼出者の `Context` の `Repository` を通ること（`systemContext` なし）、modules から drizzle・fastify・node:fs を import しないこと（`lint:boundaries` も成功）、金額が `Decimal` であること（Web は十進文字列のまま、グラフの座標だけ比率を数値にする）。
- [未検証] API の目視（spec の検証手順 7、`pnpm dev:api` に admin のトークンで 2 経路を送る）は行っていない。DB 試験の export 比較とブラウザ試験の CSV 取得で代えた。
- [未検証] `pnpm gate:full`（統合担当が実行）。共有の `a11y.spec.ts` の画面一覧には足していない（画面の試験の中で `judge()` を実行）。

## 見つけた問題と修正（発見経路つき）

- 給与の未登録件数の試験が「`to` の月」の範囲を誤って期待していた（試験の誤り。実装は spec どおり） — 発見: DB 試験、修正: 試験の期待値を spec に合わせ、範囲外の確認を足した。
- URL の flag が `?drafts=%221%22` になった — 発見: ブラウザ試験、修正: flag を数値の 1 にした。
- 入力欄の `<label>` の中にエラー文を置いたため、エラー表示中に入力欄の名前が変わった — 発見: ブラウザ試験（`getByLabel('終了日')` が見つからない）、修正: エラー文を `<label>` の外へ出し `aria-describedby` で結んだ。
- `prettier --write modules/banking` が `package.json` と `tsconfig.json` の 1 行 JSON を整形した — 発見: `git status`、修正: 作業ツリーの変更を戻した（コミットには入っていない）。

## 未実施（減らさない。完了したら「済」を付けて残す）

- 共有の `a11y.spec.ts` の画面一覧への追加（統合担当の判断）。
- 未消込の入出金と後で充てる請求書の突き合わせによる重複の自動除去（spec のスコープ外）。
- 給与の支払仕訳と給与の結び付け（workforce から仕訳を作る仕組みができたら）。

## 判断待ち（利用者）

- spec の未決事項のとおり（期日超過の既定、資金科目の範囲、CSV を出せる利用者、読取の一貫性、支払日の無い確定給与、給与の合算、給与の二重計上）。

## 次のセッションへ

- 統合時: `router.tsx`、`navigation-data.ts`、`help.ts`、`token-usage.test.ts` の `CONVERTED` は同じ round の他の項目と衝突しうる（追記だけ）。banking の依存追加で lockfile が変わる。
- 予定の種類を足すとき（E2 定期仕訳、E5 経費精算、E1 固定資産）は `CASH_SOURCES` と `SOURCE_READS` に足し、`cash-sources.ts` に読取を、`cash-plan.ts` は変えずに済む。
