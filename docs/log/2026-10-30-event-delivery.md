# 作業記録: 2026-10-30 業務イベントの配送 worker（F1）

- セッション: 完成度向上計画 F1（workflow の作業項目、worktree `wip/event-delivery`、基点 `ffc2f42`）／ 担当: agent（実装担当。spec は spec 担当が書き、spec 批評の指摘をこの記録の担当が反映）／ 対象: [docs/specs/event-delivery.md](../specs/event-delivery.md)
- 計測: tokens=null（未計測）, agent_minutes=約190, human_minutes=0, rework_lines=約60（試験の想定違いの修正、型の厳しい API パッケージの typecheck への対応、axe の指摘への対応）, gate_failures=2（gate:light の 1 回目が `typecheck:api`、2 回目が DB の更新試験 2 件で失敗。下の「見つけた問題」）

## 決めたこと（と理由）

- **spec 批評の 18 件を spec に反映して先に commit した**（`fa5e9e1`）。受け入れたものは AC・判断・データ・検証の表に書き、却下した 1 件（送信先を消して同じ id・URL で足し直すと旧鍵が生きる）は理由（管理者が承認した URL から署名付きの通信が別の宛先へ向かない）を spec の「レビュー指摘への対応」に残した。規模の指摘には CLI（AC-3）と 30 日の削除（AC-21）を残すと答えた（小さく、スケジューラ配備と配送行の増加に要る）。
- **ADR は予約番号 ADR-0037 を新規に作った。** 配送行の二段構成、lease の fencing、署名形式、署名鍵の保存と URL への結びつけ、SSRF の許可リスト、worker の system context（CLAUDE.md 規則 2 の正当な例外として範囲を限定）と owner 接続の固定読取、user の actor の許可リストを 1 つの判断として記録した。設定の規約（設定値に秘密を入れない・URL も秘密ではない）は ADR-0027 に §9 として追記した（B4 の §8 が未統合なので番号は統合時に調整）。
- **claim で `next_attempt_at` を lease の期限と同じ値にする。** lease の切れた `sending` 行と `pending` 行を同じ条件 `status in (pending, sending) and next_attempt_at <= 今` と同じ部分索引で取り出せ、worker の tenant の列挙も 1 つの述語で済む。
- **送れない channel は取り出さない（`skipped`）。** 暗号鍵の無い process が Webhook の行を `secret_unreadable` で全部止める事故を防ぐ（批評の major 指摘）。CLI はこのとき終了コード 2。
- **SSRF は許可リストにした。** 名前を 1 度だけ解決し、IPv4 射影は IPv4 に直し、大域ユニキャスト以外（IPv4 の私的・予約・文書・マルチキャスト、IPv6 の `2000::/3` 外と `2001::/23`・`2001:db8::/32`・`2002::/16`・`3fff::/20`）を拒否する。NAT64・6to4・Teredo は埋め込みの IPv4 を見ずに拒否する。接続は Node の `lookup` を差し替えて検査したアドレスへだけ行う（TLS の名前検証はホスト名のまま）。
- **受信箱の観測は本人の Context で書く。** 数える（読取専用）と、記録と `inbox.count_changed` の書込み（読み書き）を本人の Context の別々のトランザクションで行い、system context は claim と所属を失った利用者の監視の削除だけに使う（批評の指摘）。
- **ナビゲーションの `company-admin` は `roles` に `admin` があるかだけで判定した（批評の案 b）。** `GET /meta` には現在の会社での `accessScope` が無い。店舗限定の admin にもメニューは出るが、API が 403 を返し、画面が権限の無いことを説明する（ブラウザ試験で確認）。
- **受信箱の件数は Webhook に送らない（批評の簡単な案）。** schema が `inbox.` の topic を拒み、振り分けでも除外する。
- **時計を 1 つにした。** `insertOutbox` が `created_at` を `ctx.now()` で書く（DB の `now()` に頼らない）。有効化時刻も発行の要求の `ctx.now()`。試験は両側の時刻を注入する。
- **UI キットの `DataTableShell` に `frameFocusable` を足した。** 390px で表の枠が横に動き、行に操作が無いとき（送信待ちタブ）axe の `scrollable-region-focusable`（serious）が出た。行の明細グリッド（`line-grid`）と同じく、操作が無いときだけ枠を `role="region"` の Tab 位置にする。kit の小さな追加で、`docs/conventions/ui.md` に書いた。
- **通知の切替は `components/inbox-notification.tsx` に分けた**（spec は `inbox-page.tsx` の変更と書いていた）。受信箱の画面には部品を置くだけ。`CONVERTED` に足した。
- **`navigation-types.ts` は変えていない**（spec の名指し）。利用条件の型は `navigation-data.ts` の `DedicatedNavigation` にあるのでそこを変えた。

## やったこと

- kernel: `db/event-tables.ts`（新規。`event_deliveries`・`webhook_secrets`・`inbox_watches`、部分索引、複合 FK、RLS）、`db/system-tables.ts`（outbox の `next_attempt_at`・`dead_at`・部分索引 `outbox_due_idx`）、`event-insert.ts`（`created_at = ctx.now()`）、`events.ts`（期限・停止・安全な `last_error` とログ・振り分け）、`event-delivery.ts`（新規。振り分け、claim と lease、送信と結果、一覧・再送・削除、`WebhookTransport` port、`assertEventAdmin`）、`webhook-signing.ts`・`webhook-secrets.ts`・`integration-settings.ts`・`inbox-watch.ts`（新規）、`health.ts`（`system.outbox` の新しい規則）、`index.ts`
- 移行: `apps/api/drizzle/migrations/0018_event_delivery.sql`（`pnpm db:generate` で生成。同じ round の F2 も 0018 を作っているので統合時に採番し直す）
- runtime: `ensureIntegrationSettings()` を `loadRuntime` で呼ぶ
- api: `events/config.ts`・`events/webhook-transport.ts`・`events/due-tenants.ts`・`events/inbox-watch.ts`・`events/worker.ts`・`events/cli.ts`（新規）、`routes/event-deliveries.ts`（新規）、`server.ts`・`main.ts`（worker の起動と停止）、`package.json`（`events:deliver`）、`.env.example`
- web: `pages/event-deliveries-page.tsx`・`components/inbox-notification.tsx`・`api/event-deliveries.ts`・`api/notifications.ts`・`lib/event-deliveries.ts`（新規）、`router.tsx`・`lib/navigation-data.ts`・`lib/navigation.ts`・`lib/help.ts`・`pages/inbox-page.tsx`・`ui/data-table-shell.tsx`・`ui/token-usage.test.ts`
- 文書: ADR-0037（新規）、ADR-0027 §9、マニュアル 08（「イベント配送と Webhook」、受信側の検証手順の例、導入チェックの表）・付録 N（受信箱の通知）、配備手順（`EVENT_*`）、データと処理経路、UI 規約（`company-admin`、`frameFocusable`）、setup-health spec（AC-6・表・実装時の変更）、inbox spec（AC-7・スコープ外の注記）、spec の状態を implemented

## 既存試験の修正（規則 8）

- `kernel/test/foundation.db.test.ts` の outbox 試験: 失敗直後の 2 回目の `deliverPending` で配送される前提だったが、AC-4 で再試行に間隔ができた。弱めずに、(a) `next_attempt_at` が 30 秒より先に予約されていること、(b) 間隔の前の呼出しでは副作用が起きないこと、(c) `now` を 61 秒進めた呼出しで配送されることを確かめる形に直した。並行 claim の部分と `attempts = 2` の確認はそのまま。
- `apps/api/test/boolean-migration.db.test.ts` と `apps/api/test/ext-index-migration.db.test.ts`: 0016・0017 の更新試験が、全移行の適用前後で public の制約を丸ごと比べていたため、0018 で増えた表（`event_deliveries` など）の制約で失敗した。適用前に存在した relation の制約が変わらないことを確かめるという意図は保ったまま、比較を適用前に存在した relation に限った（後の移行が足す表の制約は「変更」ではなく「新規」）。同じ round の E2・F2 が自分のブランチで入れた変更と同一の差分（F2 の `8374d96` を `git apply`）で、統合時に衝突しない。
- `apps/api/test/setup-health.db.test.ts` の AC-6 outbox 試験: 「`last_error` のある未配送行で `warn`」だったが AC-24 で規則が変わった。再試行を待つ行だけなら `ok`（件数の表示）、`dead_at` の行で `warn` と管理者だけの `href`、settings ロールでは `href` なし、`dead` の配送行で `warn`・送信待ちの配送行は件数だけ、のすべてを確かめる形にした（例外の文を返さない確認は残した）。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] kernel の単体 4 ファイル（`event-retry`・`webhook-signing`・`integration-settings`・`inbox-email`）11 件、DB `kernel/test/event-delivery.db.test.ts` 22 件（AC-4 の 8 回と間隔・安全なログ、AC-5、AC-6 (a)〜(d) と有効化時刻、AC-7、AC-8〜AC-12、lease の取り直しと古い結果の破棄、暗号鍵なしの `skipped`、AC-14 の暗号文、AC-18・AC-22 の合成の非 user の actor、AC-19〜AC-21）、`foundation.db.test.ts` 11 件が通過。
- [実測] API の単体 `event-config.test.ts`・`webhook-transport.test.ts` 16 件（許可リストの各範囲、`::ffff:127.0.0.1`・`::ffff:a00:5`・`64:ff9b::a00:1`・`0.1.2.3`・`198.18.0.1`・`2001::1`・`2002::1` など、フラグありの (b) は送る・なしは `dead`・127.0.0.1 に解決される (a) はフラグありでも `dead`、3xx を追わない、タイムアウト、応答の上限、中断。受信側は試験内の 127.0.0.1 の HTTP サーバー）。
- [実測] DB `apps/api/test/event-delivery.db.test.ts` 13 件（`secret` を含む PUT が 400、鍵が `GET /meta/settings`・設定の履歴・`/admin/webhooks`・一覧・`audit_log`・`outbox`・`event_deliveries`・`companies`・`webhook_secrets` に無い、`no-store`、暗号鍵なしで 409・未知の送信先で 404、2 つの worker を同時に動かして受信 5 件・配送 ID 5 種、署名の検証、500 → 8 回で `dead` → 管理者の再送で同じ配送 ID、不正な tenant id の tenant が `22P02` だけをログに残して他の 2 tenant を続ける、暗号鍵なしで `skipped`・終了コード 2、停止で 300 ms 後に送信を中断し lease 切れ後に同じ ID で送り直す、実在の `workforce.todo` の経費承認待ちで基準 → 増加 → メール（拠点限定の管理者は自分の拠点の 1 件だけ）、同時の 2 tick でイベント 1 つ、失敗する提供元で観測を捨てる、所属を外すと登録が消える、理由ごとの 409、agent の 403、settings ロール・店舗限定の admin・ロールなし・agent が 4 つの管理 route で 403、他社から見えず再送 404、他社の送信先へ送らない）と `setup-health.db.test.ts` 19 件が通過。
- [実測] web の単体 `lib/event-deliveries.test.ts` 5 件と、関連の `navigation`・`help`・`token-usage`・`inbox` の試験が通過（計 239 件）。
- [実測] ブラウザ（slot 21、`e2e-run.sh … --project=chromium --no-deps`）: `e2e/event-delivery.spec.ts` 4 件（fixture スクリプトが本物の kernel の経路で作った `dead` の行と説明、再送の toast と焦点、← で送信待ちタブへ・`?status=` の保持と再読込、送信先カードの鍵の状態、暗号鍵の無いサーバーで発行を押せず理由、worker 無効の案内、390px で横スクロールなし、英語、`judge()` の axe、ロールなしの利用者は項目なし・直接開くと説明、店舗限定の admin は項目ありで説明と API 403、受信箱の切替の 2 つの理由と `page.route` での切替・toast・409 の `toast.error`）。同じ実行で `inbox`・`settings-console`・`setup-health`・`navigation`・`ui-kit` の spec 27 件が通過。`navigation.spec.ts` の「store employee」1 件は業界の飲食店 fixture が要る試験で、`--no-deps` では準備されないため失敗した（この item の変更と無関係。業界 project 付きの実行は未実施）。
- [実測] 手動の通し確認（spec 検証手順 4。scratchpad のスクリプト、使い捨ての DB）: 本物の API process を `EVENT_WORKER_ENABLED=true EVENT_WORKER_INTERVAL_MS=1000 EVENT_WEBHOOK_ALLOW_LOOPBACK=true` と識別設定（`NODE_ENV=test`。loopback の `PUBLIC_WEB_URL` が test でしか通らないため）で起動し、node の loopback 受信側を立て、REST で送信先の登録 → 鍵の発行 → 売上請求書の確定 → 受信側でマニュアルの検証関数がそのまま `verified: true`。受信側を 500 にすると `pending`・次の試行まで約 56 秒、`next_attempt_at` を早めて 8 回目で `dead`、導入チェックが `warn` と href、管理者の再送で同じ配送 ID が届き `delivered`。API の停止（SIGTERM）は終了コード 0。CLI は API を止めた状態で、識別設定なしなら `skipped: 1`・終了コード 2、識別設定ありなら `sent: 1`・0。API のログに署名鍵の文字列は 0 回。（API が動いている間に CLI を走らせた 1 回目は、行を戻した直後に API の worker が先に送ったため期待どおりにならなかった。手順の問題で、API を止めてやり直した。）
- [実測] `GATE_DB_SHARDS=1 pnpm gate:light`: 1 回目は `typecheck:api` で失敗（下記）。2 回目（1055 秒、負荷 3〜9）は format・docs・assurance・typecheck（root・api・web）・lint・unit 169 ファイル 1729 件・deploy が通過、DB は 136 ファイル 918 件のうち 2 件（上の 0016・0017 の更新試験）が失敗。2 件を直してその 2 ファイルだけを再実行し 11 件通過。3 回目の結果は下に追記する。
- [レビュー] 署名鍵がブラウザの保存領域・URL・toast に出ないこと（コンポーネントの state だけに持ち、閉じると消す）はコードを読んで確認した。ブラウザ試験は鍵の発行を通らない（試験の API に暗号鍵が無い）ので、発行ダイアログの表示とコピーは実機で未確認。
- [未検証] 実際の SMTP でのメール送信（偽の transport でだけ確認）、TLS の検証失敗の分類（`tls`）を実際の証明書で起こすこと、IPv6 での接続、Standard Webhooks との互換、本番相当の負荷（多数の tenant・outbox の行）での tick の時間。

## 見つけた問題と修正（発見経路つき）

- `apps/api` の tsc（`exactOptionalPropertyTypes` など root より厳しい）で、e2e fixture の引数の型と試験の `identity: undefined` が通らなかった — 発見: gate:light の `typecheck:api`（実測）、修正: 引数の検証関数と、識別設定の無い tick を直接組み立てる形（docs の commit と同じ版）。
- 受信箱の点検で所属を外した利用者の `loadPrincipal` 自体が `PermissionDenied` を投げ（既定の会社の所属も解決するため）、tenant ごと失敗していた — 発見: API の DB 試験（実測）、修正: `loadPrincipal` も同じ try に入れた（`apps/api/src/events/inbox-watch.ts`）。
- 390px の送信待ちタブで axe の `scrollable-region-focusable` — 発見: ブラウザ試験の `judge()`（実測）、修正: `DataTableShell` の `frameFocusable`。
- 0016・0017 の更新試験が 0018 の新しい表の制約で失敗 — 発見: gate:light の DB（実測）、修正: 適用前に存在した relation に比較を限る（E2・F2 と同一の差分。「既存試験の修正」）。
- 制御されたチェックボックスに Playwright の `check()` が使えない（状態はサーバーの応答で変わる）— 発見: ブラウザ試験、修正: `click()` と状態の待機に変えた（試験の書き方の修正で、確認は弱めていない）。
- 手動確認で、`content-type: application/json` を付けた空の POST は Fastify が 400 を返す — 発見: 手動の通し確認、対処: スクリプトに `{}` を付けた。画面の client は本文が無いとき `content-type` を付けないので影響なし（API の挙動は変えていない）。

## 未実施（減らさない。完了したら「済」を付けて残す）

- `pnpm gate:full`（統合担当が実行）
- 業界 project 付きのブラウザ試験の通し実行（`navigation.spec.ts` の store employee を含む）
- 配送済みの outbox 行の保存期間と削除（spec のスコープ外）
- 共有の `e2e/a11y.spec.ts` の画面一覧への `/admin/event-deliveries` の追加（自分の spec の中で `judge()` を実行した。統合時に判断）
- F2 の `machine` actor を合成の非 user の actor の試験に足すこと（F2 の統合後。kernel 関数は `actor.type === 'user'` の許可リストなので、足せば 403 になる想定）

## 判断待ち（利用者）

- spec の「未決事項」のとおり（worker の既定は無効、再試行 8 回・約 2 時間、暗号鍵の共用、独自の署名形式、保存期間 30 日、受信箱のメールは増えたときだけ、送信先の定義は settings ロールも編集可、個人情報の第三者提供の扱い）。
- CLAUDE.md 規則 2 に「配送 worker」を明記するか（ADR-0037 §7 の提案。統合担当へ）。

## 次のセッションへ

- 移行の番号（0018）は F2 と衝突する。統合時に journal と snapshot を作り直す（`pnpm db:generate`）。
- ADR-0027 の追記は §9 とした（B4 の §8 の次）。統合時に番号を確認する。
