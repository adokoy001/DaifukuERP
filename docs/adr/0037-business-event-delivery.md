# ADR-0037: 業務イベントは outbox から配送行を経て送り、Webhook は署名付きで lease の下で送る

- 状態: 採択
- 日付: 2026-10-30
- 関連: [モジュラーモノリスと outbox](0001-modular-monolith.md)、[マルチテナントと RLS](0004-multitenancy-rls.md)、[認可](0007-authorization.md)、[ポートとカスタマイズ層](0013-hexagonal-ports.md)、[識別のチャレンジとメール配送](0022-identity-challenges-and-delivery.md)、[外向き中継の主体と fencing](0023-outbound-relay-principal-and-fencing.md)、[設定の表示属性](0027-setting-presentation.md)（§9 `integration.webhooks`）、[受入基準](../specs/event-delivery.md)

## 背景

伝票の確定・取消、入金の消込、契約請求の生成などは `ctx.emit` で transactional outbox（`kernel/src/events.ts`）に書かれるが、配送する worker も外部の購読者も無く、イベントは溜まるだけだった。外部システムへ確定した伝票を待たずに渡し、受信箱の件数が増えた担当者へ知らせるには、次を決める必要があった。

- 外部への HTTP をどのトランザクションで行うか（遅い受信側が行ロックと接続を握らないように）。
- 複数の API process が同時に動くときに二重に送らない方法と、送信中の process が止まったときの回復。
- 署名の形式と、署名鍵をどこにどう保存するか（会社設定は監査と多くの読取経路に載る）。
- 内部の宛先へ送らせない（SSRF）検査。
- worker の権限（CLAUDE.md 規則 2 は `systemContext()` を移行と seed に限る）と、テナントをまたぐ列挙の扱い。

## 決定

### 1. 二段構成: outbox → 配送行 → 送信

`deliverPending` は内部購読者を実行した同じ savepoint の中で、イベントを配送行（kernel の表 `event_deliveries`、1 イベント × 1 宛先）に振り分ける（`routeEvent`）。外部への通信はしない。送信は別の段（`deliverEventDeliveries`）で、1 行ずつ短いトランザクションで取り出してから、どのトランザクションも持たずに行う。送信先ごとに再試行・停止・再送ができ、1 つの送信先の失敗が他の購読者を巻き戻さない（ADR-0022 の識別メールと同じ形）。

配送行の `id` が配送 ID で、再試行・lease 切れの送り直し・手動再送で変わらない。受信側は `Daifuku-Delivery-Id` で重複を除く。保証は少なくとも 1 回（exactly-once は主張しない）。一意制約 `(tenant_id, event_id, channel, target)` と `on conflict do nothing` で同じ宛先の配送行は 1 つだけになる。

### 2. outbox の再試行と停止

内部購読者の失敗は、`attempts` を 1 増やし、`next_attempt_at` を「今 + min(60 × 2^(attempts−1), 3600) 秒」にし、8 回目で `dead_at` を記録して取り出さない（配送行と同じ間隔）。`last_error` とログには生の例外の文を書かず、`DaifukuError` の code（と文）か `INTERNAL` と SQLSTATE だけを書く（[エラー規約](../conventions/errors.md)）。outbox の `created_at` は `insertOutbox` が書き手の `ctx.now()` で書く（有効化時刻との比較と再試行の予約を 1 つの時計で行うため。DB の既定値には頼らない）。

### 3. 配送行の claim と lease による fencing

`FOR UPDATE SKIP LOCKED` で 1 行を取り出し、`status = sending`、新しい `lease_id`、`lease_until = next_attempt_at = 今 + 60 秒`、`attempts + 1` を書いて確定してから送る。結果は `id` と `lease_id` が一致する行だけに書く（古い lease の結果は捨てる。ADR-0023 の fencing と同じ考え方）。`next_attempt_at` を lease の期限と同じ値にするので、lease の切れた `sending` 行も `pending` 行と同じ条件・同じ部分索引で取り出せる。lease 切れで取り出した行の試行回数が既に 8 なら送らずに `dead`（`lease_expired`）にする。process 間の調停役や advisory lock の所有者は置かない。

送信できない channel（暗号鍵の無い process の Webhook、メール transport の無い process のメール）の行は取り出さず、`skipped` に数える。1 つの設定漏れの process が全 tenant の配送行を停止させないため。

### 4. 署名の形式

`POST`、本文 `{ deliveryId, eventId, topic, occurredAt, companyId, data }`、ヘッダー `Daifuku-Delivery-Id`・`Daifuku-Event-Id`・`Daifuku-Topic`・`Daifuku-Timestamp`（試行の UNIX 秒）・`Daifuku-Signature: v1=<HMAC-SHA256 の小文字 16 進>`。鍵は表示した署名鍵の文字列（UTF-8）、対象は `<配送 ID>.<タイムスタンプ>.<本文のバイト列>`（`kernel/src/webhook-signing.ts`）。Daifuku 独自の名前で、外部の慣行（Standard Webhooks など）との互換は一次資料を確認できなかったため主張しない。

### 5. 署名鍵は設定の外に暗号化して置き、URL に結びつける

署名鍵はサーバーが 32 バイトの乱数から作り（`whsec_<base64url>`）、発行の応答で 1 度だけ `Cache-Control: no-store` で返す。保存は kernel の表 `webhook_secrets` に AES-256-GCM の暗号文だけ（`IDENTITY_ENCRYPTION_KEY` を共用し、AAD `<tenantId>:<companyId>:<endpointId>:webhook-secret` で用途を分ける。ADR-0022 の「DB の秘密は hash か暗号文」）。会社設定 `integration.webhooks` は `.strict()` で秘密を受け付けない（ADR-0027 §9）。

鍵は発行時の URL の SHA-256 に結びつく。URL を変えると鍵は無効（`reissue_required`）になり、管理者が再発行するまで送らない（settings ロールだけでは署名付きの宛先を差し替えられない）。有効化時刻（その URL で最初に鍵を発行した時刻）より前のイベントは送らない（worker を初めて有効にしたときに溜まったイベントが一斉に流れない）。同じ URL での再発行は有効化時刻を引き継ぐ。発行は管理者が画面で確かめた URL に結びつける: 発行の要求は送信先の URL を持ち、kernel は会社の行をロック（`setSetting` と同じ `FOR UPDATE`）して現在の URL と比べ、違えば 409 で何も変えない（画面を開いた後に settings ロールが URL を差し替えても、その宛先は有効にならない）。

`inbox.` で始まる topic は kernel だけが書く。outbox の行には書いた actor が残らず、振り分けは payload の利用者 id の本人へメールの配送行を作るので、`ctx.emit` はこの topic を拒み（403）、受信箱の監視は本人の Context で outbox へ直接書く。

送信先を消して同じ id・同じ URL で足し直した場合に旧鍵が生きることは許容する（管理者が承認した URL から署名付きの通信が別の宛先へ向くことはない。spec のレビュー対応に記録）。

### 6. 送信先の検査は許可リスト

保存できる URL は、利用者情報・fragment の無い https の DNS 名、または開発・試験用の loopback（`127.0.0.1`・`localhost`・`[::1]`）だけ。送信時は名前を 1 度だけ解決し、IPv4 射影を IPv4 に直してから、大域的に到達できるユニキャストだけを許す（IPv4 の私的・予約・文書・マルチキャスト範囲、IPv6 の `2000::/3` 外と `2001::/23`・`2001:db8::/32`・`2002::/16`・`3fff::/20` を拒否。NAT64・6to4・Teredo は埋め込みの IPv4 を見ずに拒否する）。接続は検査したアドレスへ行い、再解決しない（`apps/api/src/events/webhook-transport.ts`）。loopback の URL は `EVENT_WEBHOOK_ALLOW_LOOPBACK=true`（`NODE_ENV` が development / test のときだけ起動できる）のときだけ、loopback のアドレスにだけ接続する。DNS 名が loopback に解決されたらフラグに関わらず拒否する。転送（3xx）は追わない。

### 7. worker は配送の仕組みに限って system context を使う（規則 2 の正当な例外）

CLAUDE.md 規則 2 と計画 §8 は `systemContext()` を移行と seed に限るが、`systemParams` の注記と `deliverPending` の契約は worker を想定している。この ADR で、**業務イベントの配送 worker を移行・seed と並ぶ `systemParams` の正当な利用者**とし、その範囲を次に限る: `deliverPending`（内部購読者と振り分け）、配送行と受信箱の監視の claim、送信結果の書込み、保存期間（30 日）を過ぎた送信済み・取消の行の削除、所属を失った利用者の監視の削除（削除の 2 つの kernel 関数は system context 以外を拒む）。会社の受信箱のメール通知がオフのときは、claim で監視の期限を進めて基準を消すだけで数えない。業務 entity の読み書きはしない。受信箱の件数と、その観測・`inbox.count_changed` の書込みは本人の Context で行う。

テナントをまたぐ処理は 1 つだけ: 期限の来た仕事のある tenant id の列挙を owner 接続の固定の読取（`apps/api/src/events/due-tenants.ts`、部分索引 `outbox_due_idx`・`event_deliveries_due_idx`・`inbox_watches_due_idx`・`event_deliveries_purge_idx`（保存期間を過ぎた送信済み・取消の行。他に仕事の無い tenant も削除する）による `SELECT DISTINCT tenant_id` の和集合）で行う（ADR-0027 §7 の `appliedMigrationsReader` と同じ扱い）。受信箱の点検での利用者の権限の再読込は、API の認証と同じ `loadPrincipal` / `resolveCompanyAccess`（owner 接続）を使う。それ以外の読み書きは app 接続の tenant ごとのトランザクション（RLS）で行い、1 つのトランザクションで複数の tenant を扱わない。

CLAUDE.md 規則 2 の 1 行の明確化（「`systemContext()` is for migrations/seeds and the event delivery worker」）は統合担当への提案に留める。

### 8. worker の起動と停止

`EVENT_WORKER_ENABLED=true` の API process だけが worker を動かす（既定は無効。起動しただけで外向きの通信は始まらない）。tick は前の tick の完了後に `EVENT_WORKER_INTERVAL_MS`（既定 10 秒）後に予約し、重ねない。停止時は新しい tick を始めず、実行中の tick を最大 15 秒待ってから送信中の HTTP を中断する（行は `sending` のまま残り、lease 切れ後に同じ配送 ID で送り直される）。スケジューラで動かす配備のため 1 回実行の CLI（`events:deliver`）を持つ（終了コード: tenant の失敗 1、設定不足で送れない行 2、それ以外 0）。CLI は API と同じ runtime を読み込んでから tick を実行する（内部購読者と受信箱の提供元が同じに登録されていないと、イベントが購読者を経ずに配送済みになり、受信箱が 0 件と数えられる）。Webhook の 10 秒の制限と停止の中断は名前解決にもかかる（DNS 名は c-ares で引き、libuv の threadpool を使わず、中断で問い合わせを取り消す）。

### 9. 管理と本人の API は user の actor だけ

`/admin/event-deliveries`・`/admin/webhooks`（鍵の発行を含む）は、actor の種類が `user`（許可リスト）で、会社の admin ロールかつ所属が全社の利用者だけ。agent（`x-agent-id`）・relay・system・F2 の machine は 403（鍵が AI の記録に残らないように、F2 の `/admin/*` の除外に頼らない）。`/me/notifications` も `user` だけ。kernel の関数が同じ検査をする（route を経ない呼出しも同じ）。配送行・署名鍵・受信箱の監視の表は entity にせず、汎用 CRUD・REST・MCP に出さない（認証テーブルと同じ扱い。手書きの route は kernel 関数を呼ぶだけ）。

## 却下した案

- **`deliverPending` の中で HTTP を送る**: 遅い受信側が outbox の行ロックと接続を握り、1 つの送信先の失敗が同じイベントの内部購読者まで巻き戻す。
- **署名鍵を会社設定に入れて GET で伏字にする**: `setSetting` の監査（変更前後の値）、`GET /meta/settings/:key/audit`、pack の適用など、会社行の設定を丸ごと読む経路をすべて塞ぐ必要があり漏れやすい。
- **署名鍵の専用の暗号鍵（新しい環境変数）**: 更新・復元で守る鍵が 2 つになる。同じ process が両方を持つので防御は増えない。
- **拒否リストによる SSRF 検査**: IPv4 射影・NAT64・6to4・Teredo のような埋め込み形式を取りこぼす（spec 批評の指摘）。
- **advisory lock で worker を 1 つに絞る**: 所有者の死活監視と引継ぎが要る。行単位の claim と lease で十分。
- **Webhook にも受信箱の件数を送る**: 利用者のメール通知の同意が会社の中継先への送信まで含むことになる。この item ではメールだけにした（spec のスコープ外）。

## 帰結

+ 確定した伝票などを外部システムへ署名付きで渡せ、失敗は管理画面と導入チェック（`system.outbox` の `warn`）に出て、管理者が原因を直して再送できる。
+ 複数の API process で worker を動かしても二重送信しない（行の claim と lease）。停止した process の送信は lease 切れで別の process が引き継ぐ。
− 少なくとも 1 回の配送なので、受信側は配送 ID で重複を除く必要がある（マニュアルに検証の手順を書いた）。
− Webhook の送信には認証設定の暗号鍵が要る（識別機能と同じサーバー設定）。暗号鍵を変えると既存の署名鍵は復号できず、配送行は `secret_unreadable` で停止する（再発行して再送）。
− 配送済みの outbox 行の削除はまだ無い（配送行は 30 日で削除）。部分索引で worker の列挙は未配送の行だけを読む。
− 新しい移行 1 本（`event_deliveries`・`webhook_secrets`・`inbox_watches` と outbox の 2 列・部分索引）。
