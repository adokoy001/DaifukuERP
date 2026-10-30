# Spec: role-home（役割別ホーム）

- 状態: draft
- モジュール: `apps/web`（ホーム `/`、`apps/web/src/pages/home-page.tsx`） ／ 依存: [inbox](inbox.md)（C3、受信箱カード）、[close-guide](close-guide.md)（C4、`accounting.close_readiness`）、[ui-kit](ui-kit.md)（D1）、[navigation-assist](navigation-assist.md)（D2、保存境界 `lib/assist-storage.ts`）、[reporting-pivot](reporting-pivot.md)（分析データセット）、[restaurant-operations](restaurant-operations.md)（運営ボード）、[employee-shift-planner](employee-shift-planner.md)（シフト）。並行中の [setup-health](setup-health.md)（B3）には依存しない（印を付けた差込口だけ置く）
- ADR: 不要。表示層だけの変更で、新しい action・API・閲覧経路・DSL・kernel port・依存パッケージを足さない。ホームのカードは `/meta` で呼べると分かっている既存の action・REST 読取・分析データセットだけを呼び出し、権限と会社・店舗・拠点の境界は呼び出し先の既存の検査に任せる
- 作成: 2026-10-30 ／ 作成者: agent（C6 の spec 担当セッション、`wip/role-home`）。設計の元は [完成度向上の実装計画](../completion-plan.md) C6。作業記録は実装時に `docs/log/2026-10-30-role-home.md`

## 目的（1段落）

現在のホームは全員に同じ内容（受信箱カード、業務分野のカード、伝票の状況）を出す。経理担当者は売掛・買掛・資金・締めの状況を見るために帳票や締めガイドを順に開き、店長は今日の売上・勤怠・シフト・未提出を運営画面・労務画面・受信箱で別々に確かめ、従業員は業務分野のカードの中から自分の勤怠・申請を探している。`/meta` が示すロールと呼べる action から利用者に合うホームの表示（以下「ビュー」）を選び、その役割で毎日最初に見る数字と次の画面への入口を 1 画面にまとめる。集計は新しく作らず、既に存在し利用者が実行できる action と分析データセットの結果を並べるだけにする。複数の役割を持つ人はビューを切り替えられ、選んだビューは利用者・tenant・会社ごとにブラウザに覚える。

## 用語

- **ビュー**: ホームの表示の種類。`accounting`（経理）、`store`（店舗・拠点）、`employee`（従業員）、`admin`（導入・管理）、`general`（全体 = 現在のホーム）の 5 つ。
- **カード**: ビューの中の 1 区画。1 枚のカードは 1〜2 個の「読取元」（既存の action・REST 読取・分析データセット）を持つ。
- **今日**: 日本時間（`Asia/Tokyo`）の業務日付。ブラウザで `lib/operations.ts` の `businessToday()` により求める（既存の運営画面・シフト画面と同じ。サーバー側の既定は kernel の `todayLocal`、`kernel/src/ids.ts`）。
- **呼べる**: `/meta` の `actions[].name` に含まれる（action）、`/meta` の `entities[]` にあり `ops` が `read` を含む（REST 読取）、`GET /analytics/catalog` の `datasets[].id` に含まれる（分析データセット）。

## 受入基準（EARS）

### ビューの決定と切替

- AC-1 THE SYSTEM SHALL 利用できるビューを、選択中の会社の `/meta`（`roles`・`actions`・`entities`）、画面カタログ（`buildNavigation` の結果）と `/auth/me` の `user.tenantAdmin` だけから下表の条件で決める。ロールの条件と「読取元が 1 つ以上呼べる」条件の両方を満たすビューだけを利用できるものとする。`general` は常に利用できるが、`admin` が利用できるときは一覧に出さない（`admin` は `general` の内容をすべて含むため）。`/meta` と `/auth/me` の読込が終わる前はビューを決めず、カードの読取も始めない（`/auth/me` が失敗した場合は `tenantAdmin` を false とする）。IF `/meta` の読込が失敗した THEN THE SYSTEM SHALL 既存の `MetaError`（再試行つき）を表示し、ビューを決めず、受信箱・カードの読取を行わない。

  | ビュー | ロールの条件（`/meta` の `roles`） | 読取元（1 つ以上呼べること） |
  |---|---|---|
  | `accounting` | `accounting` を含む | `sales.ar_aging`、`purchase.ap_aging`、`accounting.trial_balance`（かつ entity `account` を read できる）、`accounting.close_readiness` |
  | `store` | `chain_manager` または `workforce_manager` を含む | `restaurant_chain.operations_snapshot`、`restaurant_chain.todo`、entity `workforce_attendance` を read できる、`workforce.shift_board`（かつ `workforce_site.list`） |
  | `employee` | `workforce_employee` を含む | 画面カタログに `/me` がある（`workforce.my_portal` を呼べる） |
  | `admin` | `admin` または `settings` を含む（`canEditSettings`）、または `tenantAdmin` が true | なし（カードは画面カタログのリンクだけ） |
  | `general` | なし | なし |

- AC-2 WHEN 利用者がホームを開き、AC-4 の保存済みの選択が無いか使えない THE SYSTEM SHALL 利用できるビューのうち `accounting` → `store` → `admin` → `employee` → `general` の順で最初のものを表示する。
- AC-3 WHILE 利用できるビューが 2 つ以上ある THE SYSTEM SHALL 受信箱カードの下にビューの切替（UI キットの `Tabs`、名前「ホームの表示」/「Home view」）を AC-2 の順で表示する。`general` は役割のビューに常に添えられるため、役割を 1 つだけ持つ利用者（例: `accounting` だけ）も [その役割, 全体] の 2 つのタブを見る（全体 = 業務分野のカードと「伝票の状況を確認」へ戻る手段）。WHEN 利用者がタブを選んだ THE SYSTEM SHALL そのビューをすぐに表示し、AC-4 のとおり選択を保存する。WHILE 利用できるビューが 1 つだけ（`general` だけ、または `admin` だけ）THE SYSTEM SHALL 切替を表示しない。
- AC-4 THE SYSTEM SHALL ビューの選択を、利用者が切替で選んだときだけ `localStorage` のキー `daifuku.home.v1.[<tenantId>,<userId>,<companyId>]`（`lib/assist-storage.ts` の `assistStorageKey` に種類 `home` を足して作る）へ値 `{ version: 1, items: [<ビュー id>] }` で保存する。既定（AC-2）で表示しただけでは保存しない。WHEN 同じ tenant・利用者・会社でホームを再び開いた（再読込・再ログインを含む）THE SYSTEM SHALL 保存したビューが現在も利用できればそれを表示する。IF 保存した値が現在利用できないビュー・不明な id・壊れた内容 THEN THE SYSTEM SHALL AC-2 の既定を表示し、保存した値を書き換えない。
- AC-5 IF ブラウザ内の保存が使えない（`localStorage` の取得・読込・書込の例外、容量超過）THEN THE SYSTEM SHALL 切替をその画面を開いている間だけ有効にし（記憶しない）、エラーを表示せず、カードの読取・画面の移動など他の操作を妨げない。
- AC-6 WHEN 利用者が会社を切り替えた（または利用者・tenant が変わった）THE SYSTEM SHALL 新しい会社の `/meta` と保存済みの選択でビューを決め直し、前の会社で読んだカードの値を表示しない（読取の query key に tenant・利用者・会社を含め、`gcTime: 0` とする）。

### 権限と境界

- AC-7 THE SYSTEM SHALL 各カードの読取を、AC-1 の「呼べる」と分かっている読取元に限って行う。action は `/meta` の `actions` にあるものだけを `POST /actions/<name>` で、REST は `/meta` で `read` できる entity だけを、分析スナップショットは `GET /analytics/catalog` が返したデータセットだけを、利用者自身のセッションと選択中の会社で呼ぶ。読取元が呼べないカードは表示せず、要求も送らない。範囲を広げる入力（`storeId`、他の利用者・拠点の id）は送らない（拠点の id は `workforce_site.list` が返したものだけを使う）。`/meta/health` など未実装の経路は呼ばない。
- AC-8 THE SYSTEM SHALL カードのすべての値を、既存の action・REST・分析スナップショットが利用者の `Context` で返した結果から計算し、ロール・行の権限・項目の非表示・会社・店舗・拠点・本人の境界を呼び出し先の既存の検査のまま適用する。ホームのために新しい集計 action・API・閲覧経路・`systemContext()` の利用を加えない。WHILE `/auth/me` の `user.accessScope` が `stores` または `sites` THE SYSTEM SHALL 店舗・拠点のカードの見出しに「担当店舗」/「担当拠点」の範囲であることを示す（値の絞り込み自体はサーバーが行う）。

### ビューごとの内容

- AC-9 WHEN `accounting` ビューを表示した THE SYSTEM SHALL 呼べる読取元ごとに次のカードを表示する。金額は API が返した `Decimal` 文字列のまま扱い（加減算は `lib/decimal.ts`、浮動小数に変換しない）、会社の通貨の桁で表示する。
  - 売掛金: `sales.ar_aging {}` の `totals.total`（未入金残高）、期日超過額（`totals.total − totals.notDue`）、うち 90 日超（`totals.over90`）。リンク `/r/sales.ar_aging`。IF `sales.ar_aging` が `INVALID_STATE`（409）を返した THEN THE SYSTEM SHALL 取得失敗ではなく「件数が多いため帳票で確認してください」と帳票へのリンクを示し、「再試行」を出さない（`sales.ar_aging` は確定済み請求書が `MAX_REPORT_ROWS` = 10,000 件を超えると `StateError` で拒否し、この action が出す `INVALID_STATE` はこれだけである。`modules/sales/src/actions/ar-aging.ts`）。
  - 買掛金: `purchase.ap_aging {}` の未払残高（`totals.balance`。売掛金と合計の key 名が異なる）、期日超過額（`totals.balance − totals.notDue`）、うち 90 日超（`totals.over90`）。リンク `/r/purchase.ap_aging`。
  - 現金預金: `GET /api/account?where={"subtype":"現金預金"}&limit=500` で対象科目を（無効な科目も含めて）読み、`accounting.trial_balance {}` の行のうちその `accountId` の `closingBalance`（借方 +）の合計、対象科目数、基準日（`meta.to`）を表示する。試算表は無効な科目も行に含めるため、無効にした科目に残る残高も合計に入る。リンク `/r/accounting.trial_balance`。IF 対象科目が 0 件 THEN THE SYSTEM SHALL 0 円と表示せず「現金預金の科目が見つかりません」と試算表へのリンクを示す。
  - IF 帳票の応答が `meta.truncated = true`（`purchase.ap_aging` は確定済み請求書を日付の古い順に 10,000 件で打ち切る。`accounting.trial_balance` は科目を 10,000 件で打ち切る）THEN THE SYSTEM SHALL その金額を合計として表示せず、「件数が多いため帳票で確認してください」と帳票へのリンクを示す（既存の帳票の挙動をそのまま示すだけで、新しい集計で補わない）。
  - 月次締め: `accounting.close_readiness {}`（期間を指定せず、サーバーの既定期間 = close-guide AC-8 の規則）の期間コードと期間、状態（締め済み／締められます／締めを止める項目 n 件）。リンク `/finance/close?periodId=<期間 id>`。IF 応答が `StateError` で `details.reason = 'no_fiscal_period'` THEN THE SYSTEM SHALL 取得失敗ではなく「会計年度がまだありません」と `/finance/close` へのリンクを示す。
- AC-10 WHEN `store` ビューを表示した THE SYSTEM SHALL 呼べる読取元ごとに次のカードを表示する。
  - 今日の売上: `restaurant_chain.operations_snapshot { from: 今日, to: 今日 }`（`asOf` と `storeId` は送らない）の `overview` から、確定済みの日次報告の売上合計（`grossSales`）、前日（`previousGrossSales`）、目標と達成率（`targetSales`・`achievementPct`、目標が 0 のときは達成率を「—」）、店舗数（営業予定 `expectedOpenDays`・提出済み `submittedDays`・店長確認待ち `reviewPendingDays`）。売上は本部の確定後に反映されることを文で示す。リンク `/operations?from=<今日>&to=<今日>`。
  - 未提出の日次報告: 受信箱（AC-14）と同じ読取結果のうち提供元 `restaurant_chain.todo` の項目 `missing_reports`（直近 7 日・昨日まで）、`returned_reports`、`review_reports` を、返ってきた項目だけ件数つきで示す（リンクは受信箱の検査 inbox AC-6 を通った項目の `href`）。提供元が成功して `missing_reports` が無いときは 0 件と言い切らず「受信箱に未提出の項目はありません（直近7日）」と示す（提供元は 0 件の項目を返さず、7 日分の店舗日数が上限を超えたときも項目を返さない。後者の知らせ方は [inbox](inbox.md) の未決事項）。IF その提供元の項目に受信箱の検査で落ちたもの（`dropped > 0`）がある THEN THE SYSTEM SHALL 受信箱と同じ「開ける画面がない項目が N 件あります」の文言を示す。`/operations` へのリンクは画面カタログにあるときだけ出す。このカードのために `restaurant_chain.todo` を別に呼ばない。提供元が失敗したときは受信箱の失敗表示（`InboxFailure`）を出し、その「再試行」は受信箱と共有の `retry('restaurant_chain.todo')` を呼ぶ（受信箱カードも同時に更新される）。
  - 今日の勤怠: `GET /analytics/catalog` を呼び、`workforce_attendance` が含まれるときだけ `POST /analytics/snapshot { dataset: 'workforce_attendance', from: 今日, to: 今日, state: 'all' }` を呼び、打刻のある従業員数（行数。粒度は従業員・勤務日 1 件）と状態別の人数（勤務中 `working`、休憩中 `break`、退勤済み `closed`、承認待ち `submitted`、承認済み `approved`、差戻し `returned`）を表示する（カタログは状態の項目を読めない利用者にこのデータセットを返さないため、状態の列は常にある。`apps/api/src/analytics/catalog.ts`）。カタログに含まれないときはカードを出さない。リンク `/workforce`（カタログにあるとき）。
  - シフト: `workforce_site.list { limit: 3, where: { active: true }, orderBy: [{ field: 'code', dir: 'asc' }] }` で拠点をコード順に読み、その拠点（最大 3）について `workforce.shift_board { siteId, weekStart: 今日を含む週の月曜 }` を呼び、拠点ごとに今週の計画の状態（公開済み = `published` あり／下書きのみ = `draft` だけ／未作成）と、公開済みの計画の今日の枠数・必要人数（`slots[].required` の合計）・割当人数（今日の枠の `assignments` の従業員数）を表示する。応答の `total` が 3 を超えるときは「ほかの拠点はシフト画面で確認」と示す。リンク `/workforce/shifts`。
  - IF 今日の日付をサーバーが受け付けない（日付の変わり目でブラウザとサーバーの日付がずれた `VALIDATION`）THEN THE SYSTEM SHALL AC-16 の取得失敗として扱い、再試行で読み直せるようにする。
- AC-11 WHEN `employee` ビューを表示した THE SYSTEM SHALL `/me` への主リンク（ビュー内で最初の、最も大きい操作）と、`/me?tab=shifts`・`/me?tab=attendance`・`/me?tab=expenses` へのリンクを表示する。ホームでは勤怠・申請のデータを読まず（`workforce.my_portal` などを呼ばない）、ホームから `/me` への自動転送もしない。ログイン直後の既存の転送（ロールがすべて `workforce_employee` の利用者は `/me` へ。`pages/login-page.tsx`）は変えない（決定事項 17）。
- AC-12 WHEN `admin` ビューを表示した THE SYSTEM SHALL 「導入・管理」カードに画面カタログにある `/settings`、`/admin/users`、`/templates` へのリンクを（カタログに無いものは出さずに）表示し、その下に `general` と同じ内容を表示する。THE SYSTEM SHALL 「導入・管理」カードを導入チェック（B3）とセットアップウィザード（B4）の差込口とする: 画面カタログに `/admin/health` があるときだけ「導入チェックを開く」リンクを、`/setup` があるときだけ「セットアップを開く」リンクを表示する（コードに `B3 (setup-health)`・`B4 (setup-wizard)` の印を付ける）。この項目では `/meta/health`・`/meta/setup-status` を呼ばず、B3・B4 のコードを import しない。B4 の「セットアップを続ける」カード（setup-wizard AC-7）はこの差込口に置く。admin と業務ロールを併せ持ち既定が別のビューになる利用者にもカードを見せる必要があるか（切替の上に出すか）は B4 が決める（決定事項 18）。
- AC-13 WHEN `general` ビューを表示した THE SYSTEM SHALL 現在のホームの内容（業務分野のカード、閉じた「伝票の状況を確認」）を変えずに表示し、「伝票の状況を確認」を開くまで伝票件数の読取を行わない（既存の navigation の試験のとおり。[navigation-workspaces](navigation-workspaces.md) AC-9 はこの `general` と `admin` のビューに適用する。同 spec に追記する）。

### 共通の部品・読取の時機・失敗

- AC-14 THE SYSTEM SHALL すべてのビューで共通のヘッダー（見出し「今日の仕事を、ここから。」、日付、「すべての画面を探す」、`/me` がカタログにあるときの「自分の勤怠・申請」）を表示し、受信箱カード（inbox AC-4/AC-5）をヘッダーの下・切替の上に 1 つだけ表示する。受信箱の読取はホームの中で 1 つにする: `HomePage` が `useInbox()` を 1 回だけ呼び、その結果（`groups`・`summary`・`retry`・`refresh`）を受信箱カード（`InboxCardView` に props で渡す）、店舗ビューの未提出カード、「更新」ボタンへ渡す（`INBOX_QUERY_OPTIONS` は `staleTime: 0` で `refetchOnMount` が既定の true のため、2 つ目の `useInbox()` を後から mount すると全提供元を読み直すから）。ビューを切り替えても受信箱の提供元を呼び直さない。選択中のビューのカードだけを描画して読取り、選ばれていないビューの読取は行わない。
- AC-15 THE SYSTEM SHALL カードの読取を、ビューを表示したときと、ビュー内の「更新」ボタンを押したときに限る。定期的な自動取得、フォーカス時・タブの可視状態の変化（`visibilitychange`）時・再接続時の再取得、自動の再試行は行わない（受信箱 inbox AC-7 と同じ）。「更新」は表示中のビューのカードと受信箱を読み直し、読み直しの間は前の値を残す。WHEN 切替でビューを選んだ THE SYSTEM SHALL 選択が 300 ms 変わらなかったときにそのビューの読取を始める（矢印キーでタブを順に移る間に途中のビューの読取を始めない。最初の表示は待たない）。WHEN 読取が終わる前にビューを離れた THE SYSTEM SHALL その読取を中止する（TanStack Query の `signal` を `request()` に渡す）。
- AC-16 WHILE カードの読取中 THE SYSTEM SHALL カードに骨格（`SkeletonCard`、容器に `aria-busy="true"`）と、その外に `sr-only` の polite な「読み込み中…」を表示する。IF カードの読取が失敗した THEN THE SYSTEM SHALL そのカードだけに「取得できませんでした」、サーバーのメッセージ、閉じた技術情報（コード・HTTP・hint。`ErrorDetails`）と、そのカードだけを読み直す「再試行」を表示し、他のカードの表示を妨げない。失敗を 0 件・0 円として表示しない。失敗は `role="alert"` にしない（複数のカードが同時に失敗しうるため）。WHEN 再試行の読取が終わった THE SYSTEM SHALL そのカードの見出し（`tabIndex=-1`）へフォーカスを移し、結果（「<カード名>: 取得しました／再試行しましたが取得できませんでした」）をホームの `aria-live="polite"` の領域で知らせる（[UI 規約](../conventions/ui.md) の受信箱・関連パネルと同じ）。
- AC-17 IF カードの読取が 403（`PERMISSION_DENIED`。`/meta` を読んだ後に権限が変わった場合など）を返した THEN THE SYSTEM SHALL そのカードに「この情報を表示する権限がありません」と表示し（再試行を出さない）、`/meta` を読み直して AC-1 のビューとカードを決め直す（読取元が呼べなくなったカードは消え、ビューが利用できなくなれば AC-2 の既定へ移る。保存済みの選択は書き換えない）。`/meta` の読み直しはホームを開いている間に 1 回までとし、読み直した `/meta` でもその読取元が呼べる場合（action の中の別 entity の読取が拒否された場合など）は、カードを自動では読み直さず権限なしの表示のままにする（403 と `/meta` の読み直しを繰り返さない）。
- AC-18 THE SYSTEM SHALL 画面の文言を日本語と英語で持ち、390px 幅でページの横スクロールを生じさせない（切替のタブは一覧の内側だけで横に動き、カードは 1 列）。状態（期日超過・締めを止める項目・未提出）を色だけでなく文字で示す。`accounting`・`store`・`employee` の各ビューで axe（WCAG 2.1 A/AA）の serious / critical の違反が 0 件である（`admin` ビューは既存の主要 8 画面の `home` の検査が対象）。
- AC-19 WHILE 選択中のビューに表示できるカードが 1 枚も無い（カードの読取元が `/meta` 以外の条件で使えない場合: 分析カタログに `workforce_attendance` が無い、AC-17 の権限なしで消えた など）THE SYSTEM SHALL UI キットの `EmptyState`（「このビューに表示できる情報がありません」）に、そのビューに関係する画面カタログのリンク（`store` は `/operations`・`/workforce`・`/workforce/shifts`、`accounting` は `/finance/close`・`/reports`。カタログにあるものだけ）と「全体」タブへの案内を表示する。

## 関係するファイル・インターフェース（名指し）

- 新規（Web）:
  - `apps/web/src/lib/role-home.ts`（純粋関数: `availableHomeLayouts(meta, catalog, tenantAdmin)`、`resolveHomeLayout(available, stored)`、`homeLayoutKey`/`parseHomeLayout`（`assist-storage` の上）、カードごとの読取計画 `plannedHomeReads(layout, meta, catalog)`、要約 `agingSummary`・`cashSummary`・`closeSummary`・`attendanceSummary`・`shiftTodaySummary`・`missingReportsSummary`、エラーの分類 `homeReadFailure`、空のビューのリンク `emptyViewLinks`）
  - `apps/web/src/lib/role-home.test.ts`（Web unit）
  - `apps/web/src/api/role-home.ts`（React hook: `useHomeLayout`（保存と切替）、`useHomeRead(source, input, enabled)`（query key に tenant・利用者・会社、`staleTime: 0`、`gcTime: 0`、`retry: false`、`refetchInterval: false`、`refetchOnWindowFocus: false`、`refetchOnReconnect: false`）、`useHomeAnalytics`）
  - `apps/web/src/components/role-home-card.tsx`（カードの枠: 題名・範囲の注記・読込中・失敗・権限なし・リンク）、`apps/web/src/components/role-home-accounting.tsx`、`role-home-store.tsx`、`role-home-employee.tsx`、`role-home-admin.tsx`、`apps/web/src/role-home.css`（色はトークンのみ、分岐点は 480 / 768 / 1024 / 1280）
  - `apps/web/e2e/role-home.spec.ts`（ブラウザ）
- 変更（Web）:
  - `apps/web/src/pages/home-page.tsx`: ヘッダー・受信箱カード・切替・ビューの描画に分け、現在の本文（業務分野のカード、`DocumentStatus`）を `general` / `admin` ビューの部品として残す
  - `apps/web/src/lib/assist-storage.ts`: `AssistKind` に `'home'` を足す（キーの形・失敗の扱いは既存のまま）
  - `apps/web/src/components/inbox-card.tsx`: 表示部分を `InboxCardView({ inbox })` に分け、`InboxCard` は `useInbox()` を呼んで `InboxCardView` を描く薄い包みにする（`/inbox` とホーム以外の利用は変えない）
  - `apps/web/src/ui/token-usage.test.ts`: 新規の部品と `role-home.css` を `CONVERTED` に足す
- 読むだけ（変更しない既存の読取元と部品）:
  - `modules/sales/src/actions/ar-aging.ts`（`sales.ar_aging`、出力 `totals.notDue/days1to30/…/over90/total`）、`modules/purchase/src/actions/ap-aging.ts` と `modules/purchase/src/services/aging.ts`（`purchase.ap_aging`、出力 `totals.notDue/…/over90/balance`）、`modules/accounting/src/actions/trial-balance.ts`（`accounting.trial_balance`、行 `accountId`・`closingBalance`、`meta.from/to`）、`modules/accounting/src/entities/account.ts`（`subtype`）、`modules/accounting/src/actions/close-readiness.ts`（`accounting.close_readiness`、`NO_FISCAL_PERIOD`）
  - `packs/restaurant-chain/src/actions/operations.ts`（`restaurant_chain.operations_snapshot`、入力 `packs/restaurant-chain/src/services/operations-contract.ts`）、`packs/restaurant-chain/src/actions/todo.ts`（`restaurant_chain.todo`）
  - `apps/api/src/analytics/catalog.ts`・`routes.ts`・`snapshot.ts`（`GET /analytics/catalog`、`POST /analytics/snapshot`、データセット `workforce_attendance`）
  - `modules/workforce/src/actions/shift-portals.ts`・`shift-contract.ts`（`workforce.shift_board`、`shiftPlanSummary`）、generic action `workforce_site.list`
  - `apps/web/src/api/inbox.ts`・`components/inbox-card.tsx`・`lib/inbox.ts`（受信箱の query と項目の検査を共有）、`apps/web/src/api/navigation.ts`（`useNavigation`、`tenantAdmin`）、`apps/web/src/api/settings.ts`（`canEditSettings`）、`apps/web/src/api/company.tsx`（`useMe`、`accessScope`）、`apps/web/src/lib/operations.ts`（`businessToday`）、`apps/web/src/lib/shift.ts`（`shiftMonday`）、`apps/web/src/lib/decimal.ts`、`apps/web/src/lib/format.ts`、`apps/web/src/components/error-details.tsx`、`apps/web/src/ui/`（`Tabs`・`TabPanel`・`Card`・`Badge`・`Button`・`SkeletonCard`・`EmptyState`）
- 変更しない: `apps/web/src/router.tsx`（ホームは `/` のまま。ビューを URL に持たない）、`apps/web/src/lib/navigation-data.ts`（画面カタログの追加なし）、kernel・modules・packs・apps/api・apps/mcp
- docs: `docs/manual/02-basics.md`（ホームの段落とビューの説明、ログイン直後の転送。画面写真は試験の出力を作業記録に添付）、`docs/conventions/ui.md`（「役割別ホーム」の節: カードは `/meta` で呼べる既存の読取元だけを呼ぶ、新しい集計を作らない、読取の時機。受信箱の節の「ホームで取得するのは受信箱の件数だけ」を役割別ビューの読取を含む記述に改める）、`docs/architecture/navigation-workspaces.md`（ホームのビューと画面カタログの関係を 1 段落）、`docs/specs/navigation-workspaces.md`（AC-9 を `general`・`admin` ビューに適用する旨の追記）、`docs/specs/ui-refresh.md`（ホームの受入条件が `general` ビューで保たれる旨の追記）

## データ・業務ルール（出典）

- 新しい制度値・会計基準の解釈・業務ルールは加えない。表示する値はすべて既存の action の結果であり、その規則は各仕様に従う: 年齢表の区分と残高 — [sales](sales.md)・[purchase](purchase.md)（AR/AP aging）、試算表の残高の符号 — [accounting](accounting.md)、締めの点検と既定期間 — [close-guide](close-guide.md) AC-1〜AC-8、日次報告の確定・未提出の数え方 — [restaurant-operations](restaurant-operations.md) と [inbox](inbox.md) の表、勤怠の状態 — [workforce-platform](workforce-platform.md)、シフト計画の状態 — [employee-shift-planner](employee-shift-planner.md)。
- 「現金預金」の科目: 会社の勘定科目の `subtype` が `現金預金` のもの。これは l10n/jp の既定の勘定科目表（`l10n/jp/src/seeds/chart-of-accounts.ts`、1000 現金・1100 普通預金）の小区分名で、[accounting](accounting.md) AC-1 の `subtype` の例にもある既存のデータである。財務諸表上の「現金及び預金」との対応や、中小会計要領の区分との一致は確認していない（**unverified**。表示用の科目の選び方であり、制度値として扱わない）。会社が科目を追加・変更した場合は、その会社の `subtype` に従う。
- 「今日」は日本時間の業務日付（業務日付は時刻を持たない LocalDate — [日付の規約](../conventions/money-and-dates.md)。`Asia/Tokyo` の既定はサーバーが kernel の `todayLocal`（`kernel/src/ids.ts`）、ブラウザが `apps/web/src/lib/operations.ts` の `businessToday` で、既存の運営画面・シフト画面と同じ）。

## 決定事項（計画が選択を残した点）

1. **ビューの集合と条件**: 計画の 4 種（経理・店長・従業員・管理）に、現在のホームを `general` として加えた。条件はロール名だけでなく「読取元が 1 つ以上呼べる」ことも求める。理由: pack 未適用の会社の `chain_manager` のように、ロールはあっても表示できるものが無いビューを出さないため。所属の範囲（`accessScope`・`storeIds`・`siteIds`）でビューを変えず、範囲の注記（AC-8）だけに使う。値の絞り込みはサーバーが既に行うため。
2. **既定の順序** `accounting` → `store` → `admin` → `employee` → `general`: 毎日の業務の数字を先に出す。`admin` は導入時の入口で、`employee` は他の役割を持つ人には狭すぎるため後ろに置いた。
3. **`admin` ビュー = 「導入・管理」カード + 現在のホーム**: admin は全権限を持つため業務分野の入口が要る。また既存の試験（admin でホームの見出し・業務分野のカード・伝票の状況・主要 8 画面の axe `home`）をそのまま保つ。admin だけの利用者には `general` を別に並べない（内容が重複するため）。admin に `accounting` などの業務ビューを自動では出さない（ロールの付与で決める。未決事項 2）。
4. **B3（導入チェック）の差込口**: カタログに `/admin/health` があるときだけリンクを出す。カタログの項目は B3 が `navigation-data.ts` に足すため、B3 の統合後に追加のコード変更なくリンクが現れる。要約（`/meta/health` の件数）の表示は B3 統合後の別変更とし、ここでは呼ばない。
5. **従業員は自動転送しない**: ホーム（ロゴ・サイドバーの「ホーム」）に戻れなくなること、戻る操作が転送で繰り返されること、他の役割を持つ人の切替を妨げることを避けるため、主リンクにした。
6. **資金 = 現金預金の科目の帳簿残高**: 銀行明細（`bank_statement` データセット）は入出金の量で残高ではなく、`payment.accounts` 設定は settings ロールでしか読めないため、試算表の期末残高と科目の `subtype` を組み合わせた。科目の判定をデータの印にする案は未決事項 3。
7. **締めのカードはサーバーの既定期間**: 計画の「今月の締め状況」は、実務では前月を当月に締めるため、締めガイドと同じ既定（終了済みの最も古い未締め期間、無ければ今日を含む期間）を使う。期間の一覧を読む要求を増やさない。
8. **今日の売上は運営ボードと同じ定義**（確定済みの日次報告だけ）: 新しい集計を作らないため。日中は 0 になりやすいので、前日の値と店舗の提出状況を同じ応答から並べ、本部の確定後に反映されることを文で示す。
9. **勤怠は分析データセット、シフトは shift_board**: 計画の「既存の分析データセットを使う」に従い、今日の 1 日分だけを読む `workforce_attendance` を使う（`workforce.management_portal` は 1 か月分の勤怠・申請・給与を返し重い）。シフトは分析データセットに無いため既存の `workforce.shift_board` を最大 3 拠点まで呼ぶ。
10. **未提出は受信箱の結果を共有**: `restaurant_chain.todo` を 2 回呼ばない。受信箱カードはビューの外に 1 つだけ置き、切替で受信箱を読み直さない（受信箱の試験の呼出回数も変わらない）。仕組みは決定事項 19（`HomePage` の 1 回の `useInbox()` を props で配る）。
11. **読取の時機は受信箱に合わせる**（表示時と手動更新のみ）: ホームを開いたままにしても集計 action を繰り返し呼ばないため。
12. **保存は `assist-storage.ts` を使う**: D2 と同じ利用者・tenant・会社の境界と失敗の扱い。保存するのはビューの id だけで個人情報を含まないため、ログアウト時の消去は不要。ビューを URL の search に持たない（`router.tsx` を変えず、保存との優先関係を作らない）。
13. **a11y**: 主要 8 画面の行列（admin のセッション）は変えず、`role-home.spec.ts` の中で `a11y-policy.ts` の `WCAG_TAGS`・`judge` を使って 3 ビューを検査する（例外ファイルの運用を増やさないため）。
14. **受信箱の分野**: inbox の未決事項（C6 で入口を見直すか）は、分野「その他」のまま変えない。役割別ホームでは受信箱カードを全ビューの上部に置くため、入口は十分と判断した。
15. **ADR は作らない**: kernel・DSL・API に変更が無く、既存の規約（受信箱・UI キット・保存境界）の範囲に収まるため。
16. **全体ビューは役割のビューに常に添える**（spec 批評 6 への対応）: 役割を 1 つだけ持つ利用者にも [役割, 全体] の切替を出す。全体を「予備」にして切替を出さない案は、経理・店長だけの利用者から「伝票の状況を確認」（ホームにしか無い）を奪うため採らなかった。計画の「複数の役割を持つ人は切り替えられる」は満たし、役割 1 つの人は役割のビューと従来のホームを切り替えられる。
17. **ログイン直後の転送は変えない**（spec 批評 5）: ロールがすべて `workforce_employee` の利用者はログイン後に `/me` へ移る既存の挙動（`login-page.tsx`）を残す。純粋な従業員は通常 `/me` から始まり、ホーム（ロゴ・サイドバー）に戻ったときに `employee` ビューを見る。AC-11 の「自動転送しない」はホームを開いたときの話である。ブラウザ試験は `page.goto('/')` でホームを開く。
18. **B3・B4 の差込口は admin ビューの「導入・管理」カード**（spec 批評 9）: B4 の「セットアップを続ける」もここに置く。admin と業務ロールを併せ持つ利用者は既定が業務ビューになるため、B4 がカードを切替の上へ出すかは B4 の統合時に決める（統合メモに記載）。
19. **受信箱の読取はホームで 1 つ**（spec 批評 1）: `useInbox()` の 2 つ目の observer は `refetchOnMount` の既定で読み直すため、`HomePage` で 1 回だけ呼び、結果を props で配る。`refetchOnMount: false` を各所に付ける案は、受信箱の既存の読取規則（表示時に読む）を observer ごとに変えることになるため採らなかった。
20. **打切り・件数超過は合計として出さない**（spec 批評 2）: `meta.truncated` と `sales.ar_aging` の `INVALID_STATE` を「帳票で確認」に変える。件数の多い会社でホームのカードを常に失敗させない。その規模でのホームの見せ方は未決事項 7。
21. **途中のビューの読取は 300 ms 待ってから始め、離れたら中止**（spec 批評 7）: UI キットの `Tabs` は自動で選択するため、矢印キーで移るたびにビューが mount される。読取の開始を選択の確定まで遅らせ、それでも始まった読取は `signal` で中止する。最初の表示は待たない。
22. **空のビューは EmptyState**（spec 批評 8）: ビューの利用可否は `/meta` だけで決める（AC-1）ため、分析カタログや 403 でカードが無くなることがある。ビューを一覧から消す案は、表示中に切替のタブが消えて焦点を失うため採らず、関係する画面への案内を出す。
23. **現金預金は無効な科目も含める**（spec 批評 nit）: 試算表は無効な科目も行に含めるため、無効にした科目の残高を落とさない。
24. **既存の spec・規約との関係**（spec 批評 4）: navigation-workspaces AC-9（業務分野を主な入口とする）と ui-refresh のホームの受入条件は `general`・`admin` ビューに適用し、役割のビューでは役割の数字を主な入口とする。両 spec に追記し、UI 規約の「ホームで取得するのは受信箱の件数だけ」を改める。

### spec 批評への対応（2026-10-30、実装担当）

| # | 指摘 | 対応 |
|---|---|---|
| 1 | 受信箱の 2 つ目の observer が読み直す | 採用。AC-14・決定事項 19（`useInbox()` は `HomePage` の 1 回、`InboxCardView` に props）。unit でソースの検査と、未提出カードが要求を出さないこと |
| 2 | 打切り・件数超過を合計として出す | 採用。AC-9（`meta.truncated`、`ar_aging` の `INVALID_STATE` は再試行なしで帳票へ）、未決事項 7 |
| 3 | 未提出の項目が無い = 0 件ではない | 採用。AC-10 の文言、`dropped` の表示、`/operations` はカタログにあるときだけ |
| 4 | 既存 spec・規約との矛盾 | 採用。決定事項 24、navigation-workspaces AC-9・ui-refresh・UI 規約の改訂を docs に追加 |
| 5 | ログイン直後の転送 | 採用。決定事項 17（変えない）、試験は `page.goto('/')` |
| 6 | 役割 1 つでも切替が出る | 採用（案 a）。AC-3・決定事項 16 |
| 7 | 自動選択のタブで途中のビューが読む | 採用。AC-15（300 ms 待ち・`signal` で中止）、決定事項 21 |
| 8 | カードの無いビュー | 採用。AC-19、AC-1（`/meta` 失敗は `MetaError`） |
| 9 | B4 の差込口 | 採用。AC-12・決定事項 18 |
| 10 | 性能の計測が無い | 採用。検証手順 5（fixture での計測）、未決事項 7 |
| 11 | 現金預金の `isActive` | 採用。AC-9、決定事項 23 |
| 12 | 拠点の並び順 | 採用。AC-10（`orderBy code`、`limit: 3`、`total`） |
| 13 | 再試行のフォーカス・通知 | 採用。AC-16 |
| 14 | 出典・到達しない分岐・語 | 採用。用語と出典を `todayLocal`・`businessToday` に、状態の列なしの分岐を削除、「タブの可視状態の変化」 |
| 15 | 禁止要求の検査範囲 | 採用。AC-7 のブラウザ検査に `/api/<entity>` と `/analytics/snapshot` |

## スコープ外（明記）

- 新しい集計 action・API・分析データセット・DSL の拡張（必要になったら別項目とし、ADR は 0030 以降）
- カードの並べ替え・非表示・追加など利用者による配置の変更、端末間・サーバー側でのビューの共有
- `sales`・`purchasing`・`inventory`・`viewer`・`workforce_hr`・`workforce_payroll`・`chain_staff`・`edge_*` 向けのビュー（これらは `general`、該当ロールがあれば他のビュー）
- 導入チェック（B3）の要約の表示（差込口のみ）、会社管理（B2）の画面
- retail pack の日次売上（店長ロールが無いため）
- 通知・自動更新・件数の推移
- `/me` への自動転送、ビューを URL で指定すること
- サイドバー・画面カタログ・業務分野の変更

## 検証手順（E2E、実行して記録する）

受入基準と試験の対応（テスト名に `AC-n` を含める）:

| AC | unit（`apps/web/src/lib/role-home.test.ts`） | DB | ブラウザ（`apps/web/e2e/role-home.spec.ts`） |
|---|---|---|---|
| AC-1 | ロール × 呼べる読取元 × カタログ × tenantAdmin の組合せでの利用可能なビュー（pack 未適用の chain_manager、admin で general を出さない、viewer は general のみ） | — | 各利用者の既定ビュー、`/meta` の失敗で `MetaError` |
| AC-2 | 優先順と既定 | — | 経理・店長・従業員・admin の既定 |
| AC-3 | 切替に出す一覧と順序、1 つのとき出さない、役割 1 つの利用者は [役割, 全体] | — | 経理だけの利用者で [経理, 全体]、複数ロールの利用者でタブ切替、← → |
| AC-4 | キーの形（tenant・利用者・会社）、選択時のみ書込、使えない値・壊れた値は既定で上書きしない | — | 切替 → 再読込で保持、`localStorage` のキー |
| AC-5 | 取得・読込・書込の例外と容量超過で切替が動き例外を出さない | — | — |
| AC-6 | query key に tenant・利用者・会社を含む | — | 2 社に所属する利用者で会社を切り替え、前の会社の選択と値が出ない |
| AC-7 | `plannedHomeReads` が `/meta` に無い action・read できない entity・catalog に無いデータセットを計画しない | — | 経理・店長（飲食・拠点）・従業員で、ネットワーク記録に 403 が 0 件、呼ばれた `/actions/<name>` がすべてその利用者の `/meta` にある、`/api/<entity>` の GET はすべて `/meta` で read できる entity、`/analytics/snapshot` のデータセットはすべてカタログの応答にある、`/meta/health` を呼ばない |
| AC-8 | 範囲の注記の判定 | 既存の境界試験で担保（本項目では追加しない）: `packs/restaurant-chain/test/operations.db.test.ts`（店舗限定）、`packs/restaurant-chain/test/todo.db.test.ts`、`apps/api/test/analytics.db.test.ts`（拠点・本人・会社の範囲）、`modules/workforce/test/shift-workflow.db.test.ts`、`apps/api/test/close-readiness.db.test.ts`、`modules/sales/test/sales.db.test.ts` | 新しい店舗だけを担当する店長で売上・店舗数が 0、「担当店舗」の注記 |
| AC-9 | 期日超過額・現金預金の合計（`Decimal` 文字列、無効な科目を含む）、科目 0 件、締めの状態、`no_fiscal_period`、`meta.truncated` の AP・試算表、`ar_aging` の `INVALID_STATE` | — | 経理の利用者で 4 枚のカードの値が同じ利用者の API 応答と一致、リンク先 |
| AC-10 | 勤怠の状態別人数、今日のシフト要約（公開済み・下書き・未作成）、`total > 3` の注記、未提出の要約（成功・項目なし・落ちた項目・失敗・呼べない） | — | 飲食の店長（industry の依存あり）で売上と未提出、拠点の店長で勤怠（今日打刻した従業員）とシフト、`restaurant_chain.todo` の呼出が 1 回 |
| AC-11 | 主リンクと補助リンク | — | 従業員で `page.goto('/')` してから主リンクで `/me`、ホームで `workforce.my_portal` を呼ばない |
| AC-12 | カタログからのリンク選択、`/admin/health`・`/setup` の有無 | — | admin で「導入・管理」カード、`/meta/health` の要求なし |
| AC-13 | — | — | 既存の `e2e/navigation.spec.ts`（ホームの件数要求なし・伝票の状況）、`e2e/inbox.spec.ts` AC-3/AC-8（viewer）がそのまま通る |
| AC-14 | `useInbox()` を呼ぶのは `home-page.tsx` の 1 か所だけで役割別の部品は呼ばない（ソースの検査）、未提出カードは渡された受信箱の結果だけで描画し要求を出さない | — | 切替の前後で `*.todo` の呼出回数が変わらない、共通ヘッダー、既存の `e2e/access-recovery.spec.ts` の見出し |
| AC-15 | `useHomeRead` の query 設定（自動取得なし）、切替後の待ち時間の定数 | — | focus・visibilitychange・online の後に要求が増えない、「更新」で読み直す、矢印キーで途中のビューを素早く通り過ぎたとき途中のビューの読取が送られない |
| AC-16 | 失敗の分類と表示内容 | — | 1 つの読取元を 500 にしたときそのカードだけ失敗表示と再試行、他のカードは表示、再試行後にカードの見出しへフォーカスと polite の通知 |
| AC-17 | 403 の分類、`/meta` の読み直しが 1 回までであること | — | 1 つの読取元を 403 にしたとき権限なしの表示と `/meta` の再取得が 1 回、403 の要求が繰り返されない |
| AC-18 | 文言の日英の対 | — | 390px で横スクロールなし、英語表示、3 ビューの axe（ja 390px / en 1280px） |
| AC-19 | 空のビューのリンク選択（カタログにあるものだけ） | — | （単体のみ。分析カタログから勤怠を外す利用者の組み立てが重いため） |

手順:

1. `pnpm gate:quick`（編集中）、`pnpm gate:light`（コミット前。サーバー側の変更が無いため DB は関連 suite のみ）
2. unit: `apps/web/src/lib/role-home.test.ts`（上表）。既存の `apps/web/src/lib/navigation-assist.test.ts`（保存境界）と `apps/web/src/ui/token-usage.test.ts`（`CONVERTED`）が通ること
3. ブラウザ: `apps/web/e2e/role-home.spec.ts` を実行する。飲食の店長の試験は industry project（飲食チェーンサンプルへの pack 適用）に依存するため `--no-deps` を付けずに実行する。既存の `inbox.spec.ts`・`navigation.spec.ts`・`access-recovery.spec.ts`・`a11y.spec.ts`・`smoke.spec.ts` も通ること（ホームを使う既存の試験）
4. 画面写真（経理・店長・従業員・admin、390px）を作業記録に添付し、マニュアル 02 の記述と照合する
5. 計測: 試験用の fixture で、経理ビューと店舗ビューの各読取の応答時間（ブラウザの Resource Timing）を記録し、作業記録に「計測」として書く。件数の多いデータでの計測は fixture に無いため行わない（未検証として記録）
6. `pnpm gate:full`（統合担当が実行）

## 未決事項（利用者の判断待ち）

1. `chain_staff`（店舗スタッフ）に `store` ビューを出すか。**推奨既定: 出さない**（計画は店長向け。スタッフは `workforce_employee` があれば `employee`、無ければ `general`）。
2. admin だけを持つ利用者（小規模事業の代表者など）に `accounting` ビューも出すか。**推奨既定: 出さない**。経理を担当するなら `accounting` ロールを併せて付与する（ロールが仕事を表し、admin は権限の上位集合であるため）。
3. 現金預金の科目の判定を `subtype` の文字列から、科目のデータ上の印（例: `account` の区分コードや「資金」の印）に変えるか。**推奨既定: 初版は `subtype = '現金預金'`**。他国の勘定科目表を入れる段階で DSL の拡張（ADR 0030 以降）として検討する。
4. 今日の売上に未確定（提出済み・店長確認済み）の日次報告を含めるか。**推奨既定: 含めない**（運営ボードと同じ定義を保つ。含めるには新しい集計が要りスコープ外）。
5. シフトのカードで読む拠点数の上限（3）。**推奨既定: 3**。多拠点の店長はシフト画面で拠点を選ぶ。
6. 人事（`workforce_hr`）・給与（`workforce_payroll`）・販売（`sales`）向けのビュー。**推奨既定: 今回は作らない**（受信箱と `general` で足りるかを利用状況で判断する）。
7. 件数の多い会社でのホームの読取（spec 批評 2・10）: 経理ビューは表示のたびに年齢表 2 本・試算表・締めの点検を読み直す（`gcTime: 0`）。確定済み請求書が 1 万件を超える会社では年齢表が打ち切り・拒否され、カードは「帳票で確認」になる。ホームで結果を短時間キャッシュする、要約だけを返す読取を足す、などは別項目（新しい集計を作るなら ADR 0030 以降）。**推奨既定: 今回は既存の読取のまま、応答時間を計測して記録する**。
