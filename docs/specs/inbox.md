# Spec: inbox（やること受信箱）

- 状態: implemented
- モジュール: 各 module の `<module>.todo` action（workforce、payment、banking、edge、tax_filing、pack restaurant_chain）、`kernel`（出力の型 `todoResult`）、`apps/web`（ホームと `/inbox`） ／ 依存: [ui-kit](ui-kit.md)
- ADR: 不要。`*.todo` の命名と出力の規約を `docs/conventions/ui.md` に追加する。kernel の追加は出力の型だけ（`tableResult` と同じ種類の共有 schema）で、DSL・port は増やさない
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) C3 ／ 実装: 2026-10-29 agent（`wip/inbox`）

## 目的（1段落）

承認待ちの勤怠訂正・有給・経費は `/workforce` の「確認待ち」、店舗の日次報告は運営画面、照合待ちの銀行明細は銀行画面、と未処理の仕事が画面ごとに分かれている。担当者がログイン直後に「自分が処理すべきもの」を一覧で把握し、該当画面へ移動できるようにする。各 module が自分の権限と境界で件数を数え、画面はそれを集めるだけにする。

## 受入基準（EARS）

- AC-1 THE SYSTEM SHALL 名前が `<module>.todo` の action を受信箱の提供元とし、入力 `{}`、`mutates: false`、出力 `{ items: [{ key, label: Label, count, href, severity: 'info' | 'warn' }] }` とする（`@daifuku/kernel` の `todoInput` / `todoResult` / `todoItems`）。件数は提供元 module の `Repository` の count / list など既存の読取経路を呼び出した利用者の `Context` のまま使って数え、権限・会社・拠点・店舗・本人の境界をそのまま適用する。提供元は状態を変更しない。処理の権限がない項目（処理 action を実行できない、本人の申請で自分では承認できない）は数えない。
- AC-2 THE SYSTEM SHALL 初版の提供元として下表の項目を実装する。件数 0 の項目は返さない。
- AC-3 IF 要求者が提供元 action を実行できない、または pack が未適用 THEN THE SYSTEM SHALL その提供元を受信箱に含めない（`/meta` に現れる実行可能な action だけを呼ぶ）。実行できないロール・拠点限定の文脈で直接呼ばれた場合は `PERMISSION_DENIED` を返す。
- AC-4 WHEN ホームを開いた THE SYSTEM SHALL 実行可能な提供元を並行して呼び、件数の合計と上位の項目（`warn` を先に件数の多い順で最大 5 件）をカードで表示する。WHEN `/inbox` を開いた THE SYSTEM SHALL 全項目を提供元ごとにまとめて表示し、各項目から `href` へ移動できる。
- AC-5 IF ある提供元の呼び出しが失敗した THEN THE SYSTEM SHALL その提供元だけを「取得できませんでした」と表示し、その提供元だけを呼び直す再試行の操作を出し、他の提供元の表示を妨げない。ホームのカードは失敗した業務名と `/inbox` への案内を出す。
- AC-6 THE SYSTEM SHALL `href` をアプリ内の既知の経路に限り、外部 URL や未知の経路は表示しない。`href` は `/` で始まるパスで、問い合わせ文字列を付けてよい。パス部分を画面カタログの `findNavigationEntry` で検査し、hash・`//`・`\`・空白を含むもの、利用者のカタログにない画面は表示しない。
- AC-7 THE SYSTEM SHALL 受信箱の再取得を画面表示時と手動の更新操作（全体の更新、提供元ごとの再試行）に限り、定期的な自動取得・フォーカス時・再接続時の再取得は行わない（通知は [実装計画](../completion-plan.md) F1 で扱う）。
- AC-8 THE SYSTEM SHALL 受信箱を画面検索・分野一覧（分野「その他」）に表示し、提供元が 1 つも実行できない利用者には表示しない（ホームのカードも出さない）。
- AC-9 THE SYSTEM SHALL 画面の文言を日本語と英語で持ち、390px 幅で横スクロールなしに操作できる。

### 初版の提供元と項目（AC-2）

| 提供元 action | 実行できるロール（admin を含む） | key | 数える対象 | 表示する人 | href |
|---|---|---|---|---|---|
| `workforce.todo`（siteAccess） | workforce_employee / manager / hr / payroll | `attendance_review` | 勤怠 `submitted` | `review_attendance` を実行できる人（manager・hr）、本人の記録を除く | `/workforce?period=<最古の月>` |
| | | `correction_review` | 勤怠訂正 `pending` | `review_correction` を実行できる人、本人を除く | 同上 |
| | | `leave_review` | 有給申請 `pending` | `review_leave` を実行できる人、本人を除く | 同上 |
| | | `expense_review` | 経費 `submitted` | `review_expense` を実行できる人、本人を除く | 同上 |
| | | `expense_settlement` | 経費 `approved` | `settle_expense` を実行できる人（payroll）、本人を除く | 同上 |
| | | `payroll_confirmation`（warn） | 給与 下書き（docstatus 0） | `confirm_payroll` を実行できる人（payroll）、本人を除く | `/workforce?tab=payroll&period=<最古の月>` |
| | | `my_returned`（warn） | 本人の勤怠・経費 `returned` | 全員（本人の記録だけ） | `/me` |
| `payment.todo` | accounting / sales / purchasing | `overdue_sales_invoices`（warn） | 確定・未入金の売上請求で支払期日 < 今日（日本時間） | `sales_invoice` を読める人 | `/r/payment.outstanding` |
| | | `overdue_purchase_invoices`（warn） | 確定・未払の仕入請求で支払期日 < 今日 | `purchase_invoice` を読める人 | `/r/payment.outstanding` |
| | | `unallocated_payments` | 確定済み入出金で未消込額 > 0（前受・前払） | 入出金の取消・訂正ができる人（accounting） | `/e/payment?sort=unallocatedAmount:desc` |
| `banking.todo` | accounting（全社の文脈のみ） | `unmatched_statements` | 有効な照合のない銀行明細 | 同左 | `/finance/banking` |
| `restaurant_chain.todo`（storeAccess、pack 適用時のみ） | chain_staff / chain_manager / sales | `missing_reports`（warn） | 直近 7 日（昨日まで）の営業予定日で、提出も確定もされていない日（差戻し中の日を除く） | 全員（担当店舗のみ） | `/operations?from=&to=`（その 7 日） |
| | | `returned_reports`（warn） | 差戻し中の日次報告 | 締めを更新できる人 | `/operations?from=<最古>&to=`（最長 31 日） |
| | | `review_reports` | 店長確認待ち | `restaurant_chain.review` を実行できる人 | 同上 |
| | | `finalize_reports` | 本部確定待ち | 締めを確定できる人（sales） | 同上 |
| `edge.todo`（siteAccess） | edge_manager / edge_operator | `uncertain_jobs`（warn） | 結果不明の機器処理と、実行中のまま期限・リースが切れた処理（状態は変えない） | 同左（担当拠点のみ） | `/operations/devices` |
| `tax_filing.todo` | accounting / workforce_payroll（全社の文脈のみ） | `accounting_review` | 財務諸表の準備資料の下書きで、作成者が自分でないもの | 会計の準備を扱える人 | `/finance/filing` |
| | | `payroll_review` | 給与申告の準備資料の下書きで、作成者が自分でないもの | 給与の準備を扱える人 | `/finance/filing` |

## 関係するファイル・インターフェース（名指し）

- `kernel/src/todo-result.ts`（`todoInput`・`todoItem`・`todoResult`・`todoItems`・`TODO_HREF`）
- `modules/workforce/src/actions/todo.ts`、`modules/payment/src/actions/todo.ts`、`modules/banking/src/todo.ts`（action は `actions.ts`）、`packs/restaurant-chain/src/actions/todo.ts`、`modules/edge-integration/src/todo.ts`（action は `actions.ts`）、`modules/tax-filing/src/todo.ts`（action は `actions.ts`）
- `apps/web/src/api/inbox.ts`、`apps/web/src/lib/inbox.ts`、`apps/web/src/pages/inbox-page.tsx`、`apps/web/src/components/inbox-card.tsx`、`apps/web/src/inbox.css`（いずれも新規）、`apps/web/src/pages/home-page.tsx`、`apps/web/src/router.tsx`（`/inbox`、`/workforce` の `period` / `tab`）、`apps/web/src/lib/navigation.ts`（`isTodoProvider`、条件 `inbox`）、`apps/web/src/lib/navigation-data.ts`、`apps/web/src/lib/workforce.ts`（`parseWorkforceSearch`）、`apps/web/src/pages/workforce-page.tsx`
- `docs/conventions/ui.md`（規約）、`docs/manual/appendix-n-navigation.md`（操作）、`docs/architecture/navigation-workspaces.md`（href の扱い）

## データ・業務ルール（出典）

- 承認・確認の状態は既存の各 module の仕様に従う（[workforce-platform](workforce-platform.md)、[restaurant-operations](restaurant-operations.md)、[bank-integration](bank-integration.md)、[deployment-edge](deployment-edge.md)、[tax-filing-preparation](tax-filing-preparation.md)、[payment](payment.md)）。新しい状態は追加しない。自己承認の禁止（勤怠・申請・経費・給与・申告準備）は各 action の既存の検査をそのまま反映する。

## スコープ外（明記）

- 通知（メール・ブラウザ通知）と既読管理
- 受信箱からの直接承認（各専用画面で操作する）
- 件数の履歴・推移
- サイドバーへの常設リンク（ナビゲーション仕様 AC-1 のサイドバーの構成を変えないため。入口はホームのカードと画面検索）

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`
2. DB: 提供元ごとの件数、本人・拠点・店舗・会社の境界（他拠点の申請を数えない）、権限のないロールで action が拒否されること（AC-1〜AC-3）。`modules/{workforce,payment,banking,edge-integration,tax-filing}/test/todo.db.test.ts`、`packs/restaurant-chain/test/todo.db.test.ts`
3. 単体: 提供元の選択、失敗時の表示、`href` の検査、並行呼び出し（AC-3〜AC-7）。`kernel/test/todo-result.test.ts`、`apps/web/src/lib/inbox.test.ts`、`apps/web/src/api/inbox.test.ts`
4. ブラウザ: 承認待ちの経費を作ってホームの件数と `/inbox` から承認画面へ移動、提供元の 1 つを失敗させた表示と再試行、390px（AC-4〜AC-9）。`apps/web/e2e/inbox.spec.ts`
5. `pnpm gate:full`（統合担当が実行）

## 未決事項（利用者の判断待ち）

- 件数が多い会社での集計負荷（初版は count のみ。計測して必要なら上限付きにする）。restaurant_chain の未提出は運営画面と同じ営業日ボード（店舗数 × 7 日）を作って数えるため、店舗数が多い会社では計測が必要。
- 受信箱の分野: 業務横断の画面に合う分野が無いため「その他」に置いた。役割別ホーム（C6）で入口を見直す場合はここを変える。

### 実装時に計画から変えたこと（2026-10-29）

- 出力の型を各 module に複製せず、kernel に `todoResult`（`tableResult` と同じ種類の共有 schema）を置いた。kernel の DSL・port は増やしていないため ADR は作らない。
- 計画の provider 一覧にあった sales（期限超過の請求）は `payment.todo` の `overdue_sales_invoices` に含めた（入金・消込の画面が payment にあるため）。仕入側の `overdue_purchase_invoices` を追加した。
- workforce に勤怠の確認待ち（`attendance_review`、「確認待ち」タブと同じ対象）、経費の精算待ち（`expense_settlement`）、本人の差戻し（`my_returned`）を加えた。給与の「確認待ち」は下書き給与（docstatus 0）を指す。
- restaurant_chain の「未提出」を、直近 7 日（昨日まで）の営業予定日に限った。当日分は営業中のため数えない。差戻し中の日は `returned_reports` で数え、二重に数えない。
- `href` に問い合わせ文字列を許した（`/workforce?period=` で最古の申請の月を、`/operations?from=&to=` で期間を開く）。検査はパス部分に対して行う。そのため `/workforce` の route に `period`（YYYY-MM）と `tab` の search を追加した。
- payment の閲覧専用ロール（viewer）は提供元を実行できない（処理しないため）。未配分の入出金は取消・訂正ができる accounting だけに出す。
- 受信箱は 1 つの query に `Promise.allSettled` の結果を入れ、提供元ごとの再試行はその提供元の結果だけを差し替える。
