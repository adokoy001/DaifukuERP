# Spec: event-delivery（業務イベントの配送 worker）

- 状態: implemented（2026-10-30、[作業記録](../log/2026-10-30-event-delivery.md)）
- モジュール: `kernel`（outbox の再試行と停止、外部購読への振り分け、配送行・署名鍵・受信箱の監視の表、設定 `integration.webhooks`、導入チェック `system.outbox`）、`apps/api`（配送 worker、Webhook の送信 adapter、管理 API、本人の通知設定 API）、`apps/runtime`（設定の登録）、`apps/web`（`/admin/event-deliveries`、`/inbox` の通知切替） ／ 依存: [inbox](inbox.md)（C3 の `<module>.todo`）、[settings-console](settings-console.md)（B1 の表示属性）、[setup-health](setup-health.md)（B3 の `system.outbox`）、[ui-kit](ui-kit.md)（D1）、[enterprise-identity](enterprise-identity.md)（メール transport と暗号鍵）
- ADR: ADR-0037（`docs/adr/0037-business-event-delivery.md` を実装時に新規作成。F1 に予約された番号。配送行の二段構成、署名形式、再試行と停止、署名鍵の保存、worker の system context と owner 接続の例外）。[ADR-0027](../adr/0027-setting-presentation.md) に追記（kernel 設定 `integration.webhooks` と「設定値に秘密を入れない」規約。節番号は B4 の §8 の次で、統合時に調整）。[ADR-0001](../adr/0001-modular-monolith.md) の outbox と [ADR-0022](../adr/0022-identity-challenges-and-delivery.md) のメール配送の考え方を引き継ぐ
- 作成: 2026-10-30 ／ 作成者: agent（spec 担当、ブランチ `wip/event-delivery`）。設計の元は [完成度向上の実装計画](../completion-plan.md) §5 F1

## 目的（1段落）

伝票の確定・取消、入金の消込、契約請求の生成などは `ctx.emit` で transactional outbox（`kernel/src/events.ts`）に業務イベントを書くが、配送する worker も購読者も無く、イベントは溜まるだけである（B3 の導入チェックは件数だけを表示している）。外部システム（会計連携・通知の中継・自社の業務システム）が確定した伝票などを待たずに受け取れるよう、API process で outbox を定期配送し、管理者が登録した送信先へ署名付きの Webhook を、受信箱の件数が増えた担当者へメールを送る。配送に失敗したものは再試行し、上限を超えたら「失敗」として管理画面と導入チェックに出し、管理者が原因を直して再送できるようにする。

## 用語

- **イベント**: outbox の 1 行（`id`、`topic`、`payload`、`company_id`、`created_at`）。topic は `<entity>.submitted` / `<entity>.cancelled`（`kernel/src/document.ts`）、`sales_invoice.payment_applied`、`purchase_invoice.payment_applied`、`contract.invoice_generated`、`journal_entry.reversed`、この spec で足す `inbox.count_changed`。
- **内部購読者**: `registry.subscribe(topic, handler)` で登録された process 内の処理（既存。現在は試験だけが使う）。
- **送信先（endpoint）**: 会社設定 `integration.webhooks` の `endpoints[]` の 1 件。Webhook の宛先 URL と購読する topic を持つ。
- **配送行（delivery）**: 1 つのイベントを 1 つの送信先（Webhook）または 1 人の利用者（メール）へ届ける単位。kernel の表 `event_deliveries` の 1 行。`id` が **配送 ID** で、再試行・手動再送でも変わらない。
- **署名鍵**: 送信先ごとの HMAC 鍵。管理者がサーバーに発行させ、発行時に 1 度だけ表示する。

## 受入基準（EARS）

### worker と outbox

- AC-1 WHEN API process が `EVENT_WORKER_ENABLED=true` で起動した THE SYSTEM SHALL `EVENT_WORKER_INTERVAL_MS`（既定 10000、1000〜3600000 の整数）ごとに配送の 1 巡（tick）を実行する。次の tick は前の tick の完了後に予約し、tick を重ねない。WHEN process が SIGINT / SIGTERM を受けた THE SYSTEM SHALL 新しい tick を始めず、実行中の tick の完了を最大 15 秒待ち、15 秒を過ぎたら送信中の HTTP・SMTP を中断し（`AbortSignal`）、DB 接続を閉じる。中断した配送行は `sending` のまま残り、lease（60 秒）が切れた後に別の worker が同じ配送 ID で取り出し直す（AC-11）。WHILE `EVENT_WORKER_ENABLED` が未設定または `false` THE SYSTEM SHALL worker を起動しない（従来どおり外向きの通信は無く、イベントは溜まる）。IF `EVENT_WORKER_ENABLED`・`EVENT_WORKER_INTERVAL_MS`・`EVENT_INBOX_CHECK_MINUTES`・`EVENT_WEBHOOK_ALLOW_LOOPBACK` の値が不正、または `EVENT_WEBHOOK_ALLOW_LOOPBACK=true` で `NODE_ENV` が `development` / `test` のどちらでもない（許可リスト。未設定の `NODE_ENV` は API と同じく development とみなす） THEN THE SYSTEM SHALL 接続を開く前に起動を拒否し、変数名と条件だけを含む `ApiConfigError` を出す（値は出さない）。WHEN `EVENT_WORKER_ENABLED=true` で認証設定（`IDENTITY_ENCRYPTION_KEY`）が無い THE SYSTEM SHALL 起動は続け、「この process は Webhook を送らない」旨の警告を 1 行ログに出す（AC-11）。
- AC-2 WHEN tick が実行された THE SYSTEM SHALL (1) 期限の来た仕事（未配送で停止していない outbox 行、送信期限の来た配送行、点検期限の来た受信箱の監視）を持つ tenant の id だけを owner 接続の固定の読取（部分索引を使う `SELECT DISTINCT tenant_id`。データの節）で列挙し、(2) tenant ごとに app 接続の `withContext(app, systemParams(tenantId, null))` で `deliverPending` を最大 10 回（1 回 100 件。各回が別の `withContext` トランザクション）、(3) 配送行の送信（AC-11）、(4) 受信箱の監視（AC-16、メール transport があるときだけ）、(5) 保存期間を過ぎた配送行の削除（AC-21）を行う。ある tenant の処理が失敗しても、ログ（tenant id とエラーの分類・SQLSTATE だけ）に残して他の tenant を続ける。1 つのトランザクションで複数の tenant を扱わない。
- AC-3 WHEN 運用者が `pnpm --filter @daifuku/api events:deliver`（配布物では `dist/events/cli.js`）を実行した THE SYSTEM SHALL `EVENT_WORKER_ENABLED` に関わらず tick を 1 回実行し、件数（配送したイベント、送信成功・失敗・停止・取消、設定が無いため取り出さなかった配送行 `skipped`、受信箱の点検数、失敗した tenant 数）だけを標準出力に出して終わる。終了コードは、失敗した tenant があれば 1、無ければ `skipped` が 1 件以上（この process に暗号鍵またはメール transport が無く、期限の来た配送行を送れなかった）のとき 2、それ以外は 0 とする（`mail:deliver` の 1・2 と同じ考え方）。スケジューラで worker を動かす配備のため。宛先・URL・本文・例外の文は出さない。
- AC-4 WHEN 内部購読者がイベントの処理で例外を投げた THE SYSTEM SHALL そのイベントの副作用を取り消し（既存の savepoint）、`attempts` を 1 増やし、`next_attempt_at` を「今 + min(60 × 2^(attempts−1), 3600) 秒」にし、`last_error` には安全な診断（`DaifukuError` なら `code: message`、それ以外は `INTERNAL` と SQLSTATE だけ。生の例外の文は入れない）を書き、`next_attempt_at` までその行を取り出さない。失敗のログ（`outbox delivery failed`）には outbox の id・topic・attempts と同じ安全な診断（`DaifukuError` の code、それ以外は `INTERNAL` と `safeErrorDiagnostics` の SQLSTATE）だけを書き、生の例外の文を書かない。WHEN `attempts` が 8 に達した THE SYSTEM SHALL `dead_at` を記録し、以後取り出さない（手動再送 AC-20 まで）。
- AC-5 WHILE 2 つ以上の worker（別 process を含む）が同じ tenant の `deliverPending` を同時に実行している THE SYSTEM SHALL 各イベントを 1 回だけ処理し（既存の `FOR UPDATE SKIP LOCKED`）、同じイベントと同じ宛先の配送行を 2 つ作らない（`(tenant_id, event_id, channel, target)` の一意制約と `on conflict do nothing`）。

### 外部購読への振り分け

- AC-6 WHEN イベントが内部購読者を含めて成功し配送済みにされる THE SYSTEM SHALL 同じ savepoint の中で、イベントの会社の設定 `integration.webhooks` の送信先のうち、(a) `enabled`、(b) `topics` のどれかがイベントの topic に一致（完全一致か `<prefix>.*`）、(c) 有効な署名鍵がある（鍵の発行時の URL の SHA-256 が現在の URL の SHA-256 と同じ）、(d) 送信先の有効化時刻（その URL で最初に署名鍵を発行した時刻。同じ URL での再発行では変わらず、URL が変わった後の発行で更新される）がイベントの `created_at` 以前、(e) イベントの topic が `inbox.` で始まらない（受信箱の件数は本人宛てのメールだけで扱い、この item では Webhook に送らない。AC-15 の schema も `inbox.` の topic を拒む）、のすべてを満たす送信先ごとに Webhook の配送行（`status = pending`、`next_attempt_at = 今`、発行時の URL の hash、本文の元になる payload）を作る。時刻は 1 つの時計で比べる: outbox の `created_at` は `insertOutbox` がイベントを書いた Context の `ctx.now()`（DB の既定値 `now()` に頼らない）、有効化時刻は署名鍵を発行した要求の `ctx.now()` とする。イベントの時刻はそれを書いたトランザクションの中での `ctx.now()` であり、確定の前後ではない（有効化の直前に始まり直後に確定したトランザクションのイベントは送らない）。会社を持たないイベント、設定が無い・定義に合わない会社（警告ログ。送信先 0 件として扱う）では作らない。有効化より前のイベント（worker を有効にする前に溜まったものを含む）は新しい送信先へ送らない。同じ URL のまま鍵を再発行しても、それまでに起きた未配送のイベントは引き続き送る。
- AC-7 WHEN topic が `inbox.count_changed` のイベントを配送済みにする AND 会社の `integration.webhooks.inboxEmail` が true AND payload の `total` が `previousTotal` より大きい AND payload の `userId` の利用者がその会社でメール通知を有効にしている（AC-18） THE SYSTEM SHALL その利用者へのメールの配送行を 1 つ作る。配送行には宛先の利用者 id だけを持たせ、メールアドレスを保存しない。件数が減った・同じ場合はメールの配送行を作らない。`inbox.count_changed` は Webhook には送らない（AC-6 (e)。Webhook での受信箱の通知はスコープ外）。

### Webhook の送信

- AC-8 WHEN Webhook の配送行を送信する THE SYSTEM SHALL `POST` で、本文を `JSON.stringify({ deliveryId, eventId, topic, occurredAt, companyId, data })`（`data` はイベントの payload、`occurredAt` はイベントの `created_at` の ISO 文字列）とし、ヘッダー `Content-Type: application/json`、`User-Agent: Daifuku-Webhook/1`、`Daifuku-Delivery-Id`（配送 ID）、`Daifuku-Event-Id`、`Daifuku-Topic`、`Daifuku-Timestamp`（この試行の UNIX 秒）、`Daifuku-Signature: v1=<小文字 16 進>` を付ける。署名は HMAC-SHA256、鍵は表示した署名鍵の文字列（UTF-8）、対象は `<配送 ID>.<Daifuku-Timestamp>.<送った本文のバイト列>`。配送 ID は全試行と手動再送で同じとし、受信側が二重受信を区別できるようにする。本文が 256 KiB を超える配送行は送らずに停止（`payload_too_large`）にする。
- AC-9 WHEN 受信側が 10 秒以内に 2xx を返した THE SYSTEM SHALL 配送行を `delivered`（`delivered_at`、状態コード）にする。IF 10 秒の制限を超えた（`timeout`）、接続・名前解決に失敗した（`network`）、TLS の検証に失敗した（`tls`）、3xx を返した（`redirect`。転送先を追わない）、それ以外の 2xx 以外を返した（`http_status`） THEN THE SYSTEM SHALL 試行を記録し（分類コードと状態コード）、AC-4 と同じ間隔で次の試行を予約する。応答の本文は 64 KiB まで読み捨て、保存もログ出力もしない。
- AC-10 WHEN 8 回目の試行が失敗した THE SYSTEM SHALL 配送行を `dead`（`dead_at`）にし、以後は送信しない。IF 失敗の分類が恒久的（`blocked_destination`、`secret_unreadable`、`payload_too_large`） THEN THE SYSTEM SHALL 試行回数に関わらずすぐ `dead` にする。IF lease 切れで取り出し直した配送行の試行回数が既に 8 回に達している（送信中の process が止まり続けた） THEN THE SYSTEM SHALL 送らずに `dead`（`lease_expired`）にする。
- AC-11 THE SYSTEM SHALL 送信の直前に配送行を 1 件ずつ短いトランザクションで `FOR UPDATE SKIP LOCKED` により取り出し（`status` が `pending` または `sending` で `next_attempt_at <= 今`。取り出しで `next_attempt_at` を `lease_until` と同じ値にするので、lease の切れた `sending` 行も同じ条件で取り出せる）、`status = sending`、新しい `lease_id`、`lease_until = next_attempt_at = 今 + 60 秒`、`attempts + 1` を書いて確定してから、どの DB トランザクションも持たずに送信し、結果は `id` と `lease_id` が一致する行だけに書く。tenant ごとの tick あたりの送信は最大 20 件、同時送信は process あたり 4 件まで（tenant は順に処理する）。WHILE その process に認証設定の暗号鍵（`IDENTITY_ENCRYPTION_KEY`）が無い THE SYSTEM SHALL Webhook の配送行を取り出さない（`pending` のまま残し、送れる process が送る。tick の結果では `skipped` に数える）。`secret_unreadable` は暗号鍵が設定されていて AES-GCM の復号に失敗したときだけに使う。WHILE 2 つ以上の worker が同時に送信している THE SYSTEM SHALL 期限の来た各配送行を 1 回だけ送る。WHEN 送信中の worker が止まり lease が切れた THE SYSTEM SHALL その配送行を取り出し直し、同じ配送 ID で送り直す（少なくとも 1 回の配送。受信側は `Daifuku-Delivery-Id` で重複を除く）。古い lease の worker が後から書く結果は捨てる。
- AC-12 WHEN 取り出した Webhook の配送行の送信先が設定から消えた・無効になった・URL が配送行を作った時と変わった・配送行の topic をもう購読していない THE SYSTEM SHALL 送信せずに `cancelled`（`endpoint_removed` / `endpoint_disabled` / `endpoint_changed` / `topic_unsubscribed`）にする。WHEN 取り出したメールの配送行の宛先の利用者が無効・会社の所属なし・通知を無効にした、または会社の `inboxEmail` が false THE SYSTEM SHALL 送信せずに `cancelled`（`recipient_inactive` / `notification_off`）にする。`cancelled` は失敗として数えない。
- AC-13 THE SYSTEM SHALL 送信先の URL として、(a) 利用者情報（`user:pass@`）・fragment を含まない 500 文字以内の `https:` URL で、ホストが DNS 名（IP アドレスの直書き、`localhost`、`.` を含まない名前、`.local` / `.internal` / `.localhost` で終わる名前を除く）のもの、または (b) 開発と試験のための loopback（ホストが `127.0.0.1`・`localhost`・`[::1]` の `http:` / `https:`）だけを設定に保存できるようにする。THE SYSTEM SHALL 送信時に名前解決したアドレスを、IPv4 射影（`::ffff:a.b.c.d`）は IPv4 に直してから、大域的に到達できるユニキャストだけを許す規則（許可リスト）で検査する。許可しないアドレスは次のとおり: IPv4 の `0.0.0.0/8`、`10.0.0.0/8`、`100.64.0.0/10`、`127.0.0.0/8`、`169.254.0.0/16`、`172.16.0.0/12`、`192.0.0.0/24`、`192.0.2.0/24`、`192.88.99.0/24`、`192.168.0.0/16`、`198.18.0.0/15`、`198.51.100.0/24`、`203.0.113.0/24`、`224.0.0.0/4`、`240.0.0.0/4`（`255.255.255.255` を含む）。IPv6 は `2000::/3` の外のすべて（`::`、`::1`、IPv4 互換 `::/96`、`64:ff9b::/96`（NAT64）、`fc00::/7`、`fe80::/10`、`ff00::/8` を含む）と、`2000::/3` の中の `2001::/23`（Teredo `2001::/32` を含む）、`2001:db8::/32`、`2002::/16`（6to4）、`3fff::/20`。WHEN `EVENT_WEBHOOK_ALLOW_LOOPBACK=true` AND URL が (b) の URL THE SYSTEM SHALL loopback のアドレス（`127.0.0.0/8`、`::1`）にだけ接続を許し、それ以外の範囲は (b) でも許さない。IF 名前解決のどれかのアドレスが許可されない、(a) の DNS 名が loopback に解決された（`EVENT_WEBHOOK_ALLOW_LOOPBACK` に関わらず）、または loopback を許可していない送信 adapter（`EVENT_WEBHOOK_ALLOW_LOOPBACK` が true でない）で (b) の URL を送ろうとした THEN THE SYSTEM SHALL 接続せずに `dead`（`blocked_destination`）にする。接続は検査したアドレスに対して行い、名前解決をやり直さない。

### 署名鍵（書込み専用）

- AC-14 WHEN 会社の管理者が `POST /admin/webhooks/:endpointId/secret` を呼んだ THE SYSTEM SHALL 32 バイトの乱数から署名鍵 `whsec_<base64url>` を作り、`IDENTITY_ENCRYPTION_KEY` による AES-256-GCM の暗号文（AAD は `<tenantId>:<companyId>:<endpointId>:webhook-secret`）、その時点の URL の SHA-256、発行時刻、有効化時刻（AC-6 (d)。既存の鍵と URL の hash が同じなら引き継ぎ、違えば発行時刻。どちらも `ctx.now()`）、発行者を kernel の表 `webhook_secrets` に保存し（同じ送信先の既存の鍵は置き換える）、署名鍵を応答で 1 度だけ `Cache-Control: no-store` 付きで返し、監査（entity `webhook_secret`、op `issue`、送信先 id とホスト名だけ）を書く。THE SYSTEM SHALL 署名鍵を以後どの API（`GET /meta/settings`、`GET /meta/settings/:key/audit`、`GET /admin/webhooks`、配送行の一覧）・ログ・監査・outbox・配送行・会社設定にも出さない。IF そのサーバーに認証設定の暗号鍵が無い THEN THE SYSTEM SHALL 409（`INVALID_STATE`、hint で `IDENTITY_ENCRYPTION_KEY` と `PUBLIC_WEB_URL` の設定を案内）を返す。IF `endpointId` が会社の設定に無い THEN THE SYSTEM SHALL 404 を返す。WHEN 暗号鍵が設定された process で署名鍵の復号に失敗した（暗号鍵の変更など） THE SYSTEM SHALL その配送行を `dead`（`secret_unreadable`）にする（暗号鍵の無い process は取り出さない。AC-11）。
- AC-15 THE SYSTEM SHALL kernel の設定 `integration.webhooks` を B1 の表示属性（`category: 'integration'`、`order`、`endpoints` と `inboxEmail` の日英のラベルと説明、`default: { endpoints: [], inboxEmail: false }`）付きで登録する。B1 の `fields` は最上位の属性にしかラベルを付けられないので、`endpoints` の説明（日英）に送信先 1 件の JSON の形と例を書き、入れ子の属性のラベルはスコープ外とする（B1 の配列の扱いのとおり JSON 入力）。schema は `.strict()` の object `{ endpoints: Endpoint[]（最大 10）, inboxEmail: boolean }`、`Endpoint = { id（^[a-z0-9][a-z0-9_-]{0,39}$、会社内で一意）, label（1〜80 文字）, url（AC-13）, topics（1〜50 件。^[a-z][a-z0-9_]*\.([a-z][a-z0-9_]*|\*)$ で、`inbox.` で始まらない）, enabled（既定 true） }`（`.strict()`）とする。IF 値に未知の key（`secret` など）、重複した送信先 id、11 件以上の送信先、不正な topic・URL、`inbox.` の topic がある THEN THE SYSTEM SHALL 400 `VALIDATION` を返し何も保存しない。設定の変更は既存のとおり admin または settings ロールが行え、監査される。送信先の URL は秘密ではない（settings ロールの利用者に `GET /meta/settings` で見え、設定の監査に残る）。受信側は URL の中の秘密（path や query の token）ではなく `Daifuku-Signature` で送信元を確かめる。この注意を `endpoints` の説明とマニュアルに書き、ADR-0027 の追記で「設定値に秘密を入れない」規約の隣に記録する。WHEN 送信先の URL を変更した THE SYSTEM SHALL その送信先の署名鍵を無効とみなし（AC-6 (c)、AC-12）、管理者が再発行するまで送信しない（settings ロールだけでは署名付きの送信先を差し替えられない）。

### 受信箱の件数の通知（購読の初版）

- AC-16 WHILE 会社の `inboxEmail` が true で、利用者がメール通知を有効にしている THE SYSTEM SHALL `EVENT_INBOX_CHECK_MINUTES`（既定 15、5〜1440 の整数）ごとに最大 1 回、その利用者の受信箱の合計件数を、利用者本人の Context（ログイン時と同じ `loadPrincipal` と `resolveCompanyAccess` で解決したロール・会社・`accessScope`・店舗・拠点、actor はその利用者）で、その利用者が実行できる `<module>.todo` の提供元（名前が `^[a-z][a-z0-9_]*\.todo$`、`mutates: false`、`generic` でない action のうち `canRunAction` が真のもの。画面の `isTodoProvider` と同じ条件）をすべて実行して数える。数えるトランザクションは読取専用とし、system context では数えない。合計は提供元が返した項目の件数の和とする（画面が開けない項目として隠すものも含むので、`/inbox` の合計より多いことがある。マニュアルとメールの本文に書く）。WHEN 合計が前回の観測と異なる THE SYSTEM SHALL 観測の記録と `inbox.count_changed` `{ userId, total, previousTotal, items: [{ provider, key, label, count, severity }] }` の outbox への書込みを、利用者本人の Context の別の読み書きトランザクション 1 つで行う（system context では書かない。outbox の行の actor も本人になる）。通知を有効にした後の最初の観測は基準として記録するだけでイベントを書かない。IF 提供元のどれかが失敗した THEN THE SYSTEM SHALL その回の観測を捨てる（イベントなし、記録を変えない）。IF 利用者が無効になった、またはその会社を利用できなくなった THEN THE SYSTEM SHALL イベントを書かずにその利用者の通知の登録を消す（このときだけ system context で消す）。WHILE 2 つ以上の worker が動いている THE SYSTEM SHALL 各利用者を 1 間隔に 1 回だけ数え（点検期限の行を system context の短いトランザクションで `FOR UPDATE SKIP LOCKED` により取り出し次の期限を書く）、記録の更新は行ロックの下で前回値と比べてから行う（同じ合計を 2 回観測してもイベントは 1 つも増えない）。tenant ごとの tick あたりの点検は最大 20 人。
- AC-17 WHEN メールの配送行を送信する THE SYSTEM SHALL 認証用と同じ SMTP transport（`IdentityMailTransport`、`apps/api/src/identity/smtp.ts`）で、送信時点の利用者のメールアドレスへ、件名と本文を日本語・英語の順で 1 通にまとめ（会社名、前回と今回の合計、項目ごとのラベルと件数、件数に受信箱の画面に出ない項目を含むことがある旨、`<PUBLIC_WEB_URL>/inbox` への案内、通知の止め方）、それ以外の業務データを含めず、Message-ID `<配送 ID@daifuku.events>` で送る。IF SMTP が失敗した THEN THE SYSTEM SHALL `mail_failed` として AC-9・AC-10 と同じ再試行と停止にする。WHILE その process にメール transport が無い THE SYSTEM SHALL メールの配送行を取り出さない（送れる process が送る。tick の結果では `skipped` に数える）。
- AC-18 WHEN 利用者が `GET /me/notifications` を呼んだ THE SYSTEM SHALL 現在の会社での `{ inboxEmail: boolean, available: boolean, reason?: 'company_disabled' | 'mail_not_configured' }` を返す。WHEN 利用者が `PUT /me/notifications { inboxEmail }` を呼んだ THE SYSTEM SHALL 本人（actor が `user`）の現在の会社での通知の登録を作る・消す。IF 有効にしようとしたとき会社の `inboxEmail` が false、またはサーバーにメール transport が無い THEN THE SYSTEM SHALL 409（`INVALID_STATE`、理由の hint 付き）を返す。無効にする操作は常に受け付ける。IF actor の種類が `user` でない（agent・relay・system、F2 で足される machine を含む。許可リストで判定する） THEN THE SYSTEM SHALL 403 を返す。kernel の関数 `getInboxNotification` / `setInboxNotification` が同じ検査をする。店舗・拠点限定の所属の利用者も自分の受信箱について登録できる（数える範囲は AC-16 のとおり本人の範囲）。

### 管理 API と再送

- AC-19 WHEN 会社の管理者が `GET /admin/event-deliveries?status=dead|pending|cancelled|delivered&limit=<1〜100、既定 50>&before=<cursor>` を呼んだ THE SYSTEM SHALL その会社の配送行を作成日時の新しい順に返す（`pending` は `sending` を含む）。`dead` には内部購読者で停止した outbox 行を、`pending` には内部購読者で失敗して再試行を待つ outbox 行（`last_error` がある未配送・未停止の行。手動再送した行も含む。まだ一度も処理していない未配送のイベントは含めない）を、種別 `internal` として含める。各行は `{ id, kind: 'webhook' | 'email' | 'internal', target: { endpointId?, endpointLabel?, userName? }, topic, eventId, status, attempts, lastError（分類コードまたは内部の安全な診断）, lastStatus?, createdAt, nextAttemptAt?, deliveredAt?, deadAt?, cancelledAt? }` とし、状態ごとの件数 `counts` と次の cursor を付ける。本文・payload・URL・メールアドレス・署名鍵・応答本文・生の例外の文は返さない。WHEN 会社の管理者が `GET /admin/webhooks` を呼んだ THE SYSTEM SHALL 送信先ごとの `{ id, label, url, topics, enabled, secret: { state: 'none' | 'active' | 'reissue_required', issuedAt?, issuedByName? } }` と、`secretsAvailable`（暗号鍵の有無）、`mailConfigured`、`inboxEmail`、`worker: { enabledHere }`（その API process の設定）を返す。
- AC-20 WHEN 会社の管理者が `POST /admin/event-deliveries/:id/retry` を `dead` の配送行に対して呼んだ THE SYSTEM SHALL その行を `pending`、`attempts = 0`、`next_attempt_at = 今`、`dead_at = null`、`last_error` を残したまま（次の試行で上書き）にし、配送 ID を変えず、監査（entity `event_delivery`、op `retry`）を書き、更新後の行を返す。`dead` の内部イベント（outbox 行）は `dead_at = null`、`attempts = 0`、`next_attempt_at = null` にし、`last_error` を残す（内部購読者と振り分けをやり直す。`last_error` が残るので、Webhook の再送と同じく送信待ちタブに移る）。IF 対象が `dead` でない THEN THE SYSTEM SHALL 409（`INVALID_STATE`）を返す。IF 対象がその会社に無い（他社・他 tenant を含む） THEN THE SYSTEM SHALL 404 を返す。
- AC-21 THE SYSTEM SHALL `delivered` と `cancelled` の配送行を、`delivered_at` / `cancelled_at` から 30 日を過ぎたら worker の tick で削除する（tenant ごとに 1 tick 最大 500 件）。`dead`・`pending`・`sending` と outbox 行は削除しない。

### 権限と境界

- AC-22 THE SYSTEM SHALL `GET /admin/event-deliveries`、`POST /admin/event-deliveries/:id/retry`、`GET /admin/webhooks`、`POST /admin/webhooks/:endpointId/secret` を、actor の種類が `user`（許可リスト）で、会社の admin ロールで所属が全社（`accessScope = 'all'`）の利用者だけに許し、それ以外（settings ロールだけ、店舗・拠点限定の admin、ロールなし、agent（`x-agent-id`）・relay・system、F2 の machine）は 403 とする（鍵が AI の記録に残らないように。F2 の `/admin/*` の経路の除外に頼らない）。kernel の関数（`listEventDeliveries`、`retryEventDelivery`、`webhookEndpoints`、`issueWebhookSecret`）が同じ検査をし、route を経ない呼出しでも同じになる。配送行・署名鍵・受信箱の監視の表は entity にせず、汎用 CRUD・REST・MCP に出さない。
- AC-23 THE SYSTEM SHALL イベントをそのイベントの会社の設定の送信先にだけ、その会社の署名鍵で送り、メールはその会社で通知を有効にした本人にだけ送る。管理 API はその会社の行だけを返し・再送し（他社の id は 404）、他 tenant の行は RLS で見えない。worker は tenant ごとに別のトランザクションで処理し、配送行の読み書きは app 接続（RLS）で行う。owner 接続の利用は、期限の来た tenant の id の列挙（固定の読取）と、受信箱の点検での利用者の権限の再読込（API の認証と同じ `loadPrincipal` / `resolveCompanyAccess`）に限る。

### 導入チェック

- AC-24 THE SYSTEM SHALL B3 の点検 `system.outbox` を次の規則に変える: 会社に停止したイベント（`dead_at` のある outbox 行）または `dead` の配送行があれば `warn`（「配送できなかったイベントが N 件あります」）とし、呼出し元が会社の管理者なら `href: '/admin/event-deliveries?status=dead'` を付ける。それ以外は `ok` とし、未配送のイベントと送信待ちの配送行の件数を表示する（再試行中の行だけでは `warn` にしない）。URL・宛先・例外の文は返さない。

### 画面

- AC-25 WHEN 会社の管理者が `/admin/event-deliveries` を開いた THE SYSTEM SHALL UI キットの部品で、(a) その API process の worker が無効なら案内（`EVENT_WORKER_ENABLED`）、(b) 送信先のカード（ラベル、URL、topic、有効・無効、署名鍵の状態「未発行／発行済み（発行日・発行者）／URL が変わったため再発行が必要」、`/settings?tab=integration` への案内）と、署名鍵の「発行」「再発行」（kit `Dialog` で確認し、再発行は旧鍵で検証できなくなることを書く。暗号鍵が無いサーバーでは押せず理由を表示）、(c) 発行した署名鍵を 1 度だけ表示するダイアログ（コピー操作、「閉じると再表示できません」の注意。鍵をブラウザの保存領域・URL・ログに残さない）、(d) 配送行の一覧を kit `Tabs`（失敗／送信待ち／取消／送信済み、選択を `?status=` に保持、既定は失敗）と `DataTableShell`（状態の `Badge`、種別、送信先または宛先、topic、作成日時、試行回数、最終エラーの説明、次の試行）で表示し、失敗の行に「再送」を出す。再送に成功したら toast と一覧の再取得、失敗したら `toast.error`。各タブの 0 件は `EmptyState`、読込失敗は `MetaError` とする。
- AC-26 WHEN 受信箱（`/inbox`）を開いた THE SYSTEM SHALL 「件数が増えたらメールで知らせる」のチェックボックスを表示し、AC-18 で切り替える（成功で toast、409 は `toast.error`）。利用できないときは無効にして理由（「会社でメール通知が有効になっていません」「メール送信が設定されていません」）を `aria-describedby` で結ぶ。
- AC-27 THE SYSTEM SHALL `/admin/event-deliveries` を「設定・管理」分野に会社の管理者だけに表示し（ナビゲーションの条件 `company-admin`。画面の側には現在の会社での `accessScope` が届かないので、ナビゲーションでは `roles` に `admin` があることだけで判定する。店舗・拠点限定の admin にはメニューが出るが、開くと AC-22 の 403 に基づき権限が無いことを説明する）、直接開いた権限の無い利用者には権限が無いことを説明する。状態は色と文字の両方で示す。画面の文言は日本語と英語を持ち、390px 幅で横スクロールなしに操作でき（表は枠の内側だけが横に動く）、axe の検査（A2 の `judge()`）で serious 以上の違反が無い。

## 判断と理由（計画が選択を残した点）

1. **二段構成（outbox → 配送行 → 送信）。** 送信先への HTTP を `deliverPending` のトランザクションの中で行うと、遅い受信側が行ロックと接続を握り、1 つの送信先の失敗が同じイベントの他の購読者まで巻き戻す。outbox の処理では配送行を挿入するだけにし、通信は lease を取った後にトランザクションの外で行う（ADR-0022 の識別メールと同じ形）。送信先ごとに再試行・停止・再送ができる。
2. **複数 process での安全性。** outbox は既存の `FOR UPDATE SKIP LOCKED`、配送行は「1 件ずつ claim → lease id で fencing」（ADR-0022・ADR-0023 の考え方）、受信箱の監視は点検期限の claim と行ロック下の比較。process 間の調停役や advisory lock の所有者は置かない。exactly-once は保証せず、配送 ID による受信側の重複除去を前提にする。
3. **署名鍵は設定の外に、暗号化して置く。** 会社設定は `companies.settings` の JSON で、`setSetting` が変更前後の値を監査に書き、`GET /meta/settings/:key/audit` がそれを返し、pack の適用や多くの読取が会社行の設定を丸ごと読む。設定値に秘密を入れて伏字にする方式は、これらの経路をすべて塞ぐ必要があり漏れやすい。署名鍵は書込み専用の表 `webhook_secrets` に AES-256-GCM で保存し（ADR-0022 の「DB の秘密は hash か暗号文」の先例）、設定の schema は `.strict()` で秘密を受け付けない。鍵はサーバーが生成して 1 度だけ表示する（弱い鍵を入れさせない。計画 F2 の API キーの「発行時に一度だけ表示」と同じ流儀）。
4. **暗号鍵は `IDENTITY_ENCRYPTION_KEY` を共用する。** 新しい環境変数を足すと、更新・復元で守る鍵が 2 つになる（[配備手順](../operations/deployment.md)）。同じ process が両方を持つので分けても防御は増えない。AAD に用途を入れて区別する。メールの transport と `PUBLIC_WEB_URL` も認証設定に付随するので、連携は「認証設定があるサーバー」で使う機能とする。
5. **送信先の有効化は管理者の署名鍵発行で行い、URL に結びつける。** 送信先の定義は会社設定なので settings ロールも編集できるが、URL を変えると鍵が無効になり、管理者が再発行するまで送らない。その URL での有効化より前のイベントは送らない（初めて worker を有効にしたときに溜まった過去のイベントが新しい送信先へ一斉に流れず、URL を差し替えた先へ古いイベントが流れない）。同じ URL での定期的な鍵の再発行では有効化時刻を引き継ぎ、再試行中・未配送のイベントを落とさない。
6. **署名の形式は Daifuku 独自の名前で、この spec に全て書く。** 外部の慣行（Standard Webhooks など）との互換はこのセッションで一次資料を確認できなかったため主張しない（未決事項）。署名対象に配送 ID と時刻を含め、ヘッダーの差し替えと再送攻撃を受信側が検出できるようにする。
7. **worker は既定で無効、間隔は環境変数。** 起動・更新しただけで外向きの通信が始まらない（識別メールの「API を起動しただけでは送らない」と同じ）。どの process で動かすかを運用者が選べ、試験とブラウザ試験の環境は決定的なまま。スケジューラで動かす配備のために 1 回実行の CLI を持つ。
8. **worker の system context は配送の仕組みに限る。** CLAUDE.md 規則 2 と計画 §8 は `systemContext()` を migration・seed に限っているが、`deliverPending` の契約（「worker から system context で呼ぶ」）と `systemParams` の注記（migration・seed・worker 用）は worker を想定している。この item では system context を `deliverPending`（内部購読者と振り分け）、配送行と受信箱の監視の取り出し（claim）、送信結果の書込み、保存期間の削除、所属を失った利用者の監視の削除だけに使い、業務の読み書きはしない。受信箱の件数を数えることと、その観測と `inbox.count_changed` の書込みは本人の Context で行う（system context で数えると本人が見られない件数が通知に出るため）。ADR-0037 で配送 worker を migration・seed と並ぶ `systemParams` の正当な利用者として明記し、CLAUDE.md 規則 2 の 1 行の明確化（「migrations/seeds and the event delivery worker」）は統合担当への提案に留める（この item では CLAUDE.md を変えない）。
9. **owner 接続の例外。** tenant の列挙は RLS の外の情報なので owner 接続で tenant id だけを返す固定の読取を使い、それ以外の読み書きは app 接続の tenant context で行う（ADR-0027 §7 の `appliedMigrationsReader` と同じ扱い。ADR-0037 に記録）。
10. **outbox にも再試行間隔と停止を足す。** worker が 10 秒ごとに回ると、失敗し続ける内部購読者が毎回再実行されログを埋める。配送行と同じ間隔（1, 2, 4, 8, 16, 32, 60 分、8 回で停止）にする。`last_error` は生の例外の文（SQL と束縛値を含みうる）をやめ、[エラー規約](../conventions/errors.md)の安全な診断にする。
11. **受信箱の通知は本人の登録制、メールは増えたときだけ。** 管理者が利用者 id を設定に並べる方式は id を知る必要があり、本人の同意も無い。会社のスイッチ（`inboxEmail`）を管理者が、登録を本人が `/inbox` で行う。処理して件数が減るたびにメールが来ないよう、メールは増えたときだけにする（Webhook には増減とも送る）。最初の観測は基準だけにする（登録した直後に「N 件あります」が来ない）。
12. **管理画面は会社の管理者だけ。** 署名鍵の発行と再送は会社の外へデータを送る判断なので admin に限る。settings ロールは導入チェックの件数で状態を知る。
13. **画面と API の形。** 配送行・署名鍵は認証テーブルと同じく基盤の表で、entity にしない（汎用 CRUD・MCP に出さない）。route は `company-admin` と同じく kernel 関数を呼ぶ手書きの route にする（規則 1 の「entity の route を手書きしない」には当たらない）。送信先の編集は初版では設定画面の JSON 入力（B1 の配列の扱い）とし、専用の編集フォームは作らない。

## データ（kernel の表、新しい移行 1 本。番号は統合時の次番号）

- `outbox` に列を追加: `next_attempt_at timestamptz null`（null は即時）、`dead_at timestamptz null`。取り出し条件は `published_at is null and dead_at is null and (next_attempt_at is null or next_attempt_at <= 今)`。部分索引 `outbox_due_idx (tenant_id, next_attempt_at) where published_at is null and dead_at is null` を足す（配送済みの行が増えても期限の来た tenant の列挙が未配送の行だけを読む。配送済みの outbox 行の削除はスコープ外のため）。`created_at` は `insertOutbox` が `ctx.now()` で書く（AC-6 の時計）。
- `event_deliveries`（RLS tenant）: `id uuid pk`（配送 ID）、`tenant_id`、`company_id`（not null）、`event_id`（outbox の id）、`topic`、`channel`（`webhook` | `email`）、`target`（送信先 id または利用者 id）、`target_url_hash`（webhook のみ）、`payload jsonb`、`event_created_at`、`status`（`pending` | `sending` | `delivered` | `dead` | `cancelled`）、`attempts`、`next_attempt_at`、`lease_id`、`lease_until`、`last_error`（分類コード）、`last_status`、`created_at`、`delivered_at`、`dead_at`、`cancelled_at`。一意 `(tenant_id, event_id, channel, target)`、部分索引 `event_deliveries_due_idx (tenant_id, next_attempt_at) where status in ('pending','sending')` と索引 `(tenant_id, company_id, status, created_at desc)`。
- `webhook_secrets`（RLS tenant）: `(tenant_id, company_id, endpoint_id)` pk、`secret_cipher`、`url_hash`、`issued_at`、`activated_at`（AC-6 (d)）、`issued_by`。
- `inbox_watches`（RLS tenant）: `(tenant_id, company_id, user_id)` pk（行がある = 本人がメール通知を登録）、`last_total int null`、`observed_at`、`next_check_at`、`created_at`。利用者への複合 FK。索引 `inbox_watches_due_idx (next_check_at, tenant_id)`。
- 期限の来た tenant の列挙（AC-2 (1)）は owner 接続の固定の読取で、上の 3 つの索引の条件（`outbox`: `published_at is null and dead_at is null and (next_attempt_at is null or next_attempt_at <= 今)`、`event_deliveries`: `status in ('pending','sending') and next_attempt_at <= 今`、`inbox_watches`: `next_check_at <= 今`）による `SELECT DISTINCT tenant_id` の和集合とする。
- 分類コード（画面は日英の説明に変換）: 失敗 `timeout`、`network`、`tls`、`redirect`、`http_status`、`blocked_destination`、`secret_unreadable`、`payload_too_large`、`lease_expired`、`mail_failed`、内部 `subscriber_failed`（安全な診断付き）。取消 `endpoint_removed`、`endpoint_disabled`、`endpoint_changed`、`topic_unsubscribed`、`recipient_inactive`、`notification_off`。

## 関係するファイル・インターフェース（名指し）

- kernel（既存の変更）: `kernel/src/events.ts`（`deliverPending`: 期限・停止・安全な `last_error`・振り分け）、`kernel/src/db/system-tables.ts`（`outbox` の列）、`kernel/src/health.ts`（`OUTBOX_CHECK` の規則と B3 の注記「F1 まで worker が無い」の削除）、`kernel/src/index.ts`（export）、`kernel/src/identity/crypto.ts`（`seal` / `unseal` を共用。変更しない）
- kernel（新規）: `kernel/src/db/event-tables.ts`（`event_deliveries`・`webhook_secrets`・`inbox_watches` と `registry.registerSystemTable`）、`kernel/src/integration-settings.ts`（`INTEGRATION_WEBHOOKS_KEY`、schema、`ensureIntegrationSettings()`、`topicMatches`、URL の検査）、`kernel/src/webhook-signing.ts`（`signWebhook`・`webhookHeaders`・`verifyWebhookSignature`）、`kernel/src/event-delivery.ts`（振り分け、`deliverEventDeliveries(app, tenantId, deps)`、`listEventDeliveries`、`retryEventDelivery`、`purgeEventDeliveries`、port `WebhookTransport`、メールは既存の `IdentityMailTransport`）、`kernel/src/webhook-secrets.ts`（`issueWebhookSecret`、`webhookEndpoints`）、`kernel/src/inbox-watch.ts`（`summarizeInbox(ctx)`、`claimInboxWatches`、`recordInboxObservation`、`getInboxNotification` / `setInboxNotification`、`inboxEmailMessage`）
- runtime: `apps/runtime/src/index.ts`（`loadRuntime` が `ensureIntegrationSettings()` を呼ぶ。`company.profile` と同じ）
- api（新規）: `apps/api/src/events/config.ts`（`readEventWorkerConfig(env)`）、`apps/api/src/events/worker.ts`（`startEventWorker` / `runEventTick`）、`apps/api/src/events/due-tenants.ts`（owner の固定読取）、`apps/api/src/events/inbox-watch.ts`（本人の Context の解決）、`apps/api/src/events/webhook-transport.ts`（`node:https` / `node:http`、検査済みアドレスへの接続、10 秒、転送を追わない、本文 64 KiB）、`apps/api/src/events/cli.ts`（`events:deliver`）、`apps/api/src/routes/event-deliveries.ts`（管理 API と `/me/notifications`）
- api（既存の変更）: `apps/api/src/main.ts`（worker の起動と停止、メール transport と識別設定の共有）、`apps/api/src/server.ts`（route の登録、`ServerOptions` に worker の状態）、`apps/api/package.json`（`events:deliver`）、`.env.example`（`EVENT_*`）
- web（新規）: `apps/web/src/pages/event-deliveries-page.tsx`、`apps/web/src/api/event-deliveries.ts`、`apps/web/src/api/notifications.ts`、`apps/web/src/lib/event-deliveries.ts`（状態・分類コードの日英、タブの解釈、署名鍵の状態の文）
- web（既存の変更）: `apps/web/src/router.tsx`（`/admin/event-deliveries` と `status` の `validateSearch`）、`apps/web/src/lib/navigation-data.ts`・`navigation.ts`・`navigation-types.ts`（条件 `company-admin`）、`apps/web/src/lib/help.ts`（章）、`apps/web/src/pages/inbox-page.tsx`（通知の切替）、`apps/web/src/ui/token-usage.test.ts`（`CONVERTED` に新画面）
- docs: ADR-0037（`docs/adr/0037-business-event-delivery.md`、新規）、[ADR-0027](../adr/0027-setting-presentation.md)（追記）、[setup-health](setup-health.md)（AC-6 と表の `system.outbox`、「実装時の確認と変更」の outbox の項）、[inbox](inbox.md)（AC-7 とスコープ外の「通知は F1」への注記）、[マニュアル 08](../manual/08-admin.md)（イベント配送・Webhook の受信側の検証手順の例）、[付録 N](../manual/appendix-n-navigation.md)（受信箱の通知）、[配備手順](../operations/deployment.md)（環境変数）、[データと処理経路](../architecture/runtime-and-data.md)（「未実装の外部 worker」の記述）、[UI 規約](../conventions/ui.md)（管理画面の条件 `company-admin`）

## データ・業務ルール（出典）

- 日本の制度値・業務規則の追加は無い（税率・帳簿・給与の値を使わない）。送る内容は既存イベントの payload（id・番号・金額・日付・状態）と受信箱の件数・ラベルだけである。
- 送信先へ業務データを送ることが個人情報の第三者提供に当たるかの判断は、送信先を登録する管理者の責任として扱い、マニュアルに注意を書く。現在の payload は取引先名・氏名・住所を含まないが、法的な評価は **未検証**（`docs/domain/` に一次資料は無い）。将来 payload に個人情報を足す場合は、その item で一次資料（個人情報保護委員会）を `docs/domain/` に置いてから判断する。
- SSRF の対策と Webhook の署名の慣行について外部の設計資料を参照しようとしたが、このセッションのネットワーク制限で到達できなかった（OWASP・Standard Webhooks のサイト）。本 spec の規則（AC-8、AC-13）は外部資料への準拠を主張せず、この文書だけで完結する規則として定める。`docs/domain/` には追加しない。

## スコープ外（明記）

- topic の一覧の登録（`registry` に topic を宣言させる仕組み）と payload の版管理。初版の topic はマニュアルに列挙する
- 署名鍵の重複期間（新旧 2 つの署名を並べる回転）、受信側の証明書の指定（mTLS、独自 CA）
- 任意の業務イベントのメール通知、まとめ送り（digest）、ブラウザ通知、Slack / Teams など各サービス固有の形式
- 識別メール（招待・再設定）の配送を worker に載せること（従来どおり `mail:deliver` の CLI）
- 配送済みの outbox 行の保存期間と削除（配送行は AC-21 で 30 日）
- 会社を持たないイベントの外部配送、受信（inbound）の Webhook、送信先ごとの流量制限・回路遮断
- MCP からの管理操作（署名鍵が AI の記録に残るため。再送も初版は画面と REST だけ）
- 設定画面での送信先の専用フォーム（初版は JSON 入力）と、入れ子の属性（送信先の各項目）の日英ラベル
- 受信箱の件数の変化を Webhook で送ること（`inbox.*` の topic は Webhook に送らず、schema でも拒む。本人宛てのメールだけ。会社の中継先へ件数を送る要望が出たら、本人の同意の表示と会社のスイッチを設けて別 item で扱う）

## 検証手順（E2E、実行して記録する）

| AC | 単体 | DB | ブラウザ |
|---|---|---|---|
| AC-1 | `apps/api/test/event-config.test.ts`（既定・範囲・development / test 以外での loopback の拒否・値を出さない） | `apps/api/test/event-delivery.db.test.ts`（停止時に実行中の tick を待つ、上限を過ぎた送信の中断と lease 切れ後の取り直し） | — |
| AC-2、AC-3 | — | `apps/api/test/event-delivery.db.test.ts`（2 tenant、1 tenant の失敗で他を続ける、tick の結果が件数だけ、終了コードの規則） | — |
| AC-4、AC-5 | `kernel/test/event-retry.test.ts`（間隔表） | `kernel/test/event-delivery.db.test.ts`（`Error('secret-ish text')` の文が `last_error` にも記録したログにも無い）、`kernel/test/foundation.db.test.ts`（既存の outbox 試験を時刻を進める形に直す。下記） | — |
| AC-6、AC-7 | `kernel/test/integration-settings.test.ts`（`topicMatches`） | `kernel/test/event-delivery.db.test.ts`（条件 (a)〜(e) の各否定、有効化前のイベント（両側の時刻を `now` の注入で決める）、同じ URL の再発行で有効化時刻を引き継ぐこと・URL を変えた後の発行で更新されること、会社なし、定義に合わない設定、一意制約、減少・同数でメールなし） | — |
| AC-8 | `kernel/test/webhook-signing.test.ts`（固定の鍵・時刻・本文の期待値、検証関数、1 バイト違いで不一致） | `apps/api/test/event-delivery.db.test.ts`（試験内のローカル HTTP 受信側が受けたヘッダーと署名を検証、再試行と手動再送で配送 ID が同じ） | — |
| AC-9、AC-10 | `apps/api/test/webhook-transport.test.ts`（タイムアウト・3xx を追わない・本文の上限・中断） | `apps/api/test/event-delivery.db.test.ts`（500 → 再試行の間隔 → 8 回目で `dead`、恒久的な分類で即 `dead`。時刻は `now` の注入で進める） | — |
| AC-11 | — | `kernel/test/event-delivery.db.test.ts`（偽の transport で 2 つの送信を同時に走らせ各配送行 1 回、lease 切れの取り直し、試行 8 回に達した行の lease 切れで `lease_expired`、古い lease の結果を捨てる、暗号鍵の無い worker は Webhook の行を取り出さず `pending` のまま `skipped` に数える）、`apps/api/test/event-delivery.db.test.ts`（2 つの worker の tick を同時に実行して受信側の受信が 1 回） | — |
| AC-12 | — | `kernel/test/event-delivery.db.test.ts`（各取消の分類、`topic_unsubscribed` を含む） | — |
| AC-13 | `kernel/test/integration-settings.test.ts`（保存できる URL）、`apps/api/test/webhook-transport.test.ts`（名前解決を注入して各範囲を拒否: `::ffff:127.0.0.1`、`::ffff:a00:5`、`64:ff9b::a00:1`、`0.1.2.3`、`198.18.0.1`、`2001::1`、`2002::1` など。フラグありの (b) の URL は送る、フラグなしの (b) は `dead`、フラグありでも 127.0.0.1 に解決される (a) の DNS 名は `dead`） | — | — |
| AC-14、AC-15 | `kernel/test/integration-settings.test.ts`（strict・重複・件数・`inbox.` の topic） | `apps/api/test/event-delivery.db.test.ts`（発行後に `GET /meta/settings`・設定の履歴・`/admin/webhooks`・配送行一覧・`audit_log`・`outbox`・`event_deliveries`・`companies.settings` に鍵の文字列が無い、表は暗号文、`no-store`、暗号鍵なしで 409、未知の送信先で 404、`secret` を含む PUT が 400、URL 変更で送らない） | — |
| AC-16 | — | `apps/api/test/event-delivery.db.test.ts`（実在の提供元 `workforce.todo` の経費承認待ちで件数を作る、基準の観測、増加でイベント、提供元の失敗で記録なし、所属を外すと登録が消える、拠点限定の利用者は自分の範囲だけ、2 つの tick を同時に実行してもイベント 1 つ） | — |
| AC-17 | `kernel/test/inbox-email.test.ts`（日英の件名・本文、余計な業務データが無い、Message-ID） | `apps/api/test/event-delivery.db.test.ts`（偽のメール transport が受けた宛先と本文、SMTP 失敗の再試行） | — |
| AC-18 | — | `apps/api/test/event-delivery.db.test.ts`（理由ごとの 409、無効化は常に可、agent は 403）、`kernel/test/event-delivery.db.test.ts`（合成の system・relay の actor で kernel 関数が 403） | `apps/web/e2e/event-delivery.spec.ts`（`page.route` で `GET` / `PUT /me/notifications` を差し替え、利用できる状態の切替・toast・409 の `toast.error`） |
| AC-19〜AC-21 | — | `kernel/test/event-delivery.db.test.ts`、`apps/api/test/event-delivery.db.test.ts`（一覧の項目に本文・URL・鍵が無い、cursor、内部の停止行の再送、`dead` 以外は 409、削除は 30 日を過ぎた確定行だけ） | `apps/web/e2e/event-delivery.spec.ts` |
| AC-22、AC-23 | — | `apps/api/test/event-delivery.db.test.ts`（settings ロール・店舗限定の admin・ロールなしで 403、agent の 403、他社の id で 404、他社の送信先へ送らない、2 tenant で混ざらない）、`kernel/test/event-delivery.db.test.ts`（kernel 関数を直接呼んでも同じ検査。合成の非 user の actor） | `apps/web/e2e/event-delivery.spec.ts`（権限の無い利用者） |
| AC-24 | — | `apps/api/test/setup-health.db.test.ts`（既存の AC-6 の outbox 試験を新しい規則に直す。下記。停止した outbox 行・`dead` の配送行で `warn`、再試行中だけなら `ok`、href は管理者だけ） | — |
| AC-25〜AC-27 | `apps/web/src/lib/event-deliveries.test.ts`（状態・分類の日英、`?status=` の解釈、鍵の状態の文） | — | `apps/web/e2e/event-delivery.spec.ts` |

1. 編集中は `pnpm gate:quick`。commit 前に `TEST_DATABASE_URL_*` を設定して `GATE_DB_SHARDS=1 pnpm gate:light`（kernel の変更なので DB 全件に昇格する）。
2. 既存試験の修正（規則 8 に従い作業記録に書く）: `kernel/test/foundation.db.test.ts` の outbox 試験は、失敗直後の 2 回目の `deliverPending` で配送される前提だった。AC-4 で再試行に間隔ができるため、(a) 間隔の前の呼出しでは取り出さないことを新たに確かめ、(b) `now` を間隔の後に進めた呼出しで配送されることを確かめる形に直す（弱めない）。`apps/api/test/setup-health.db.test.ts` の AC-6 は「`last_error` のある未配送行で `warn`」だったが、AC-24 で「停止した行で `warn`」に規則が変わるため、停止行と `dead` の配送行で `warn`、再試行中の行で `ok` の両方を確かめる形に直す。
3. ブラウザ: `apps/web/e2e/event-delivery.spec.ts` は、既存の `fiscal-helpers.ts` と同じく `tsx` で fixture スクリプト `apps/api/test/event-delivery-e2e-fixture.ts` を実行し、合成の会社を作り、その中で送信先の設定・試験用の暗号鍵による署名鍵の発行・イベントの発生・fixture のプロセス内のローカル HTTP 受信側（常に 500）への kernel の送信を時刻を進めて 8 回行い、`dead` の配送行を本物の経路で作る（ブラウザ試験の API は worker 無効のまま）。画面で: 失敗タブの行と最終エラーの説明、再送で送信待ちタブへ移ること（toast、焦点）、送信先カードの鍵の状態、暗号鍵の無いサーバーでは発行を押せず理由が出ること、`?status=` の保持とタブのキーボード操作、英語表示、390px、`judge()` による axe、権限の無い利用者。`/inbox` では会社のスイッチが無効のときと、有効でメールが未設定のときの、無効なチェックボックスと理由（AC-26）、`page.route` で `GET` / `PUT /me/notifications` を差し替えた利用できる状態での切替（toast）と 409 の `toast.error`。権限の無い利用者には、ロールなしの利用者（メニューが無く、直接開くと説明）と店舗限定の admin（メニューは出るが、開くと説明。AC-27）を含める。`/tmp/claude-0/-home-user-DaifukuERP/8a7541e3-ab40-5f9c-ac08-5679d2bd0af8/scratchpad/tools/e2e-run.sh <worktree> <19〜30 の slot> e2e/event-delivery.spec.ts e2e/inbox.spec.ts e2e/settings-console.spec.ts e2e/setup-health.spec.ts --project=chromium --no-deps`。
4. 手動の通し確認（作業記録に結果を書く）: 開発用 DB で `EVENT_WORKER_ENABLED=true EVENT_WORKER_INTERVAL_MS=1000 EVENT_WEBHOOK_ALLOW_LOOPBACK=true` と識別設定で API を起動し、`node -e` の loopback 受信側を立て、設定画面で送信先を登録 → 管理画面で鍵を発行 → 売上請求書を確定 → 受信側でヘッダーと署名をマニュアルの検証手順で確かめる。受信側を 500 にして再試行の間隔と `dead`、再送を確かめる。
5. 試験 DB の後始末: 作業の最後に `pnpm test:db:templates -- --drop`（自分の `TEST_DATABASE_URL_*`）。
6. `pnpm gate:full`（統合担当が実行）。

## レビュー指摘への対応（spec 批評、2026-10-30）

実装担当が spec 批評の指摘を次のとおり扱った（受け入れたものは上の AC・判断・データ・検証の表に反映済み）。

- 受入: AC-13 の loopback の矛盾（(b) の URL はフラグありで loopback にだけ接続、(a) の DNS 名が loopback に解決されたらフラグに関わらず停止。フラグは development / test の許可リスト。AC-1・AC-13）。
- 受入: 暗号鍵の無い process が Webhook の行を `secret_unreadable` で停止させる問題（取り出さず `skipped`。CLI の終了コード 2。AC-1・AC-3・AC-11・AC-14）。
- 受入: SSRF の拒否リストの不足（大域ユニキャストだけの許可リストに反転し、IPv4 射影の正規化と NAT64・6to4・Teredo・文書用の範囲の拒否を全列挙。AC-13）。
- 受入: 失敗ログの生の例外の文（AC-4）。
- 受入: 非 user の actor を拒否リストで扱っていた点（許可リスト `actor.type === 'user'`。AC-18・AC-22。F2 の machine は統合時に試験の合成 actor へ足すフック）。
- 受入（案 b）: ナビゲーションの条件 `company-admin` は `roles` に `admin` があることだけで判定し、店舗・拠点限定の admin には画面の 403 の説明で応える（AC-27）。`GET /meta` に `accessScope` を足す案は、この item の範囲を超える API の形の変更なので採らない。
- 受入（簡単な案）: 受信箱の件数を Webhook に送らない（AC-6 (e)・AC-7・AC-15、スコープ外に明記）。
- 受入: 時計の統一（`insertOutbox` が `created_at` を `ctx.now()` で書く。AC-6）。
- 受入: URL は秘密ではないことの明記（AC-15、ADR-0027 追記、マニュアル）。query を拒む案は採らない（query を必要とする受信側があり、path の token は拒めないので効果が限られる）。
- 受入: 索引（データの節）。
- 受入: system context の範囲（判断 8、AC-16）。
- 却下: 送信先を消して同じ id・同じ URL で足し直すと旧鍵が生きる点（nit）。有効化は管理者が承認した URL の hash に結びついており、同じ URL に戻しても署名付きの通信が新しい宛先へ向くことはない（判断 5 が守るのは URL の差し替え）。受信側が検証に使う鍵も同じものである。違う URL や違う id は従来どおり再発行が要る（AC-15）。孤立した行は暗号文だけで、どの API にも出ない。
- 受入: 内部イベントの再送後に一覧から消える点（送信待ちの条件を `last_error` のある行にし、再送は `last_error` を残す。AC-19・AC-20）。
- 受入: 入れ子の属性のラベル（AC-15 の文言とスコープ外）。
- 受入: メールの件数と `/inbox` の合計の差（AC-16・AC-17 とマニュアルに既知の差として書く）。
- 受入: 運用の細部（停止時の中断と lease 切れ後の取り直し、CLI の終了コード、`deliverPending` の各回が別トランザクション、同時送信は process あたり 4 件、購読をやめた topic の行は `topic_unsubscribed` で取消。AC-1〜AC-3・AC-11・AC-12）。
- 受入: 通知の切替のブラウザ試験（`page.route` の差し替え。検証の表）。
- 受入しない（規模の指摘）: CLI（AC-3）と 30 日の削除（AC-21）は小さく、スケジューラ配備と配送行の増加に必要なので、この item に残す。

## 未決事項（利用者の判断待ち。括弧内は初版の既定）

- worker の既定（無効。配備の `runtime.env` の雛形で有効にするかは運用者の判断で、この item では変えない）。
- 再試行の回数と間隔（8 回、1〜60 分の倍々で計約 2 時間。週末の停止などそれより長い障害は管理画面の再送で回復する）。
- 署名鍵の暗号化に `IDENTITY_ENCRYPTION_KEY` を共用すること（共用。分ける場合は新しい環境変数と鍵の更新手順が要る）。
- 外部の慣行（Standard Webhooks のヘッダー名と署名形式）との互換（独自の名前のまま。一次資料を確認できたら、互換のヘッダーを追加するかを別 item で判断）。
- 配送行の保存期間（送信済み・取消は 30 日、失敗は削除しない）。
- 受信箱のメールを増えたときだけにすること（増えたときだけ。減少も知らせたい要望があれば利用者の設定にする）。
- 送信先の定義を settings ロールも編集できること（できる。有効化＝署名鍵の発行は admin だけ）。
- payload に個人情報を含むイベントを将来足す場合の第三者提供の扱い（未検証。その item で一次資料を置いて判断）。
