# ADR-0023: 外向き LAN 中継機の専用本人性と実行権

- 状態: 採用（全体受入の実行結果は feature log を参照）
- 日付: 2026-09-12
- 仕様: [deployment-edge](../specs/deployment-edge.md)
- 一次資料: [機器連携の根拠](../domain/edge-relay-security.md)

## 判断

LAN 中継機は人の JWT や `onBehalfOf` を使わず、`actor.type = relay` と専用の opaque credential を持つ。kernel の `relay_credentials` / `relay_pairings` は本人確認インフラであり、業務 DSL の Gateway / Device / Job / DeviceEvent とは分ける。秘密は SHA-256 hash のみ保存し、認証テーブルを generic CRUD に登録しない。credential は tenant・company・gateway・site に固定し、90日で期限切れとなる。世代と有効性を毎回照合する。

人の `edge_manager` と `edge_operator` は拠点一覧だけを読める。`workforce_site` に明示的な read 権限を追加し、従業員・給与のロールを付与しない。機器ロール `relay` は人の権限割当候補から除外する。店舗機器機能の部分管理は `accessScope=sites` を使う。旧 `stores` スコープは今回対応せず拒否する。

kernel EntityConfig の `relayAccess` は操作 allowlist と gateway 列を宣言する。既存の admin / sharedRead / role union より先に確認し、Repository の tenant/company 条件へ gateway 一致を AND する。書込先も同じ gateway に制限する。ActionConfig の `relayAccess` は既定 false で、通常の authenticated action に入れない。行ルールの `$ctx.actorId` は監査と同じ機器識別子を表す。業務 module の書込 capability は所有フィールドを指定するだけで、この認可境界を解除しない。

## 登録・失効・回復

管理者は最新の会社所属・拠点範囲・Gateway.version と単回 step-up を検証して10分の pairing token を発行する。消費時も発行者の有効性、sessionVersion、会社所属をロック下で再確認する。gateway lock 内で pairing 消費と credential 発行を同一 transaction にする。再発行時は古い未消費 token を失効する。

本人性の再確認は会社所属行 → user 行の順でロックする。会社所属削除が defaultCompanyId を更新する順序と合わせ、所属行待ちの間に user 行を保持しない。PostgreSQL の実際の待機を観測する回帰試験でこの順序を確認する。

agent は pairing / rotation の前に新しい秘密をローカルへ同期保存する。応答喪失後はその秘密で `/relay/session` を確認できる。旧 credential は rotation と同時に無効となる。両方の秘密を失った場合は再 pairing が必要であり、旧秘密を無期限に併用しない。秘密を URL、監査、通常ログへ出さない。

HTTPS は Authorization header 専用で、人の JWT・会社変更 header・ブラウザ Origin を受け入れない。WSS は通知のみで、機器からデータフレームを受けたら閉じる。5秒ごとに DB の credential・Gateway を再検証し、失効・停止を既存接続にも反映する。通知は DB の未完了 Job から再生成でき、API の複数 process 間で通知の所有者を必要としない。切断中の通知を保存したことにはせず、agent の接続直後/再接続/15秒 polling が正本を取得する。

## 物理操作の状態と排他

gateway advisory lock を先に取得して claim/start/heartbeat/complete/manual resolve を直列化する。site 設定変更は site lock → gateway lock の順。拠点停止は有効 Gateway が残る間拒否し、Gateway の siteId、Device の gateway/local ID/driver は作成後変更しない。presence は credential に保存し、Gateway 設定 version を増やさない。

未開始 claim の lease は90秒。期限後にだけ再 claim でき、新しい attempt と lease hash が古い実行権を無効にする。startGranted=true は最初の成功1回だけであり、再 POST に true を再送しない。開始済みの期限切れは uncertain に進み、同じ Device の後続を止める。管理画面も期限切れ executing をロック下で uncertain にするため、完全オフラインでも確認できる。

agent が開始要求前に保存した journal だけ残った場合、同じ最新 attempt の claimed/queued/expired から uncertain を報告できる。開始の記録がない succeeded/failed 報告は拒否する。既知 IPP job の遅着結果は同じ attempt の executing/uncertain に受け入れ、manual resolve 後は accepted=false で上書きを防ぐ。解決後に必要な処理は新しい Job として依頼する。DB fencing は物理機器の実行を巻き戻さず、physical exactly-once を保証しない。

古い attempt の結果は `ignored=obsolete_attempt`、手動解決後は `ignored=manually_resolved` を返す。agent はこの明示応答で古い journal の送信を終了できる。7日超の状態観測は所属機器・形式を確認後 `ignored=expired` とする。単なる409を成功扱いせず、長期オフラインから復帰しても古い観測の再送だけで処理が永久に止まらないようにする。

## 上限と確認

Job は gateway ごと未完了500件、Device ごと100件。payload は16,000文字・5部まで。cash.dispense は simulator のみ。HTTP は gateway ごと600件/分、rotation 6件/時、WSS 接続開始20件/分、同時3接続/gateway・500接続/process。通知フレームは1KiBまで、圧縮は無効。ボードの履歴は件数上限と truncated を返す。

業務 DB 試験と実 HTTP/WebSocket 試験で並行 claim、単回 start、fencing、失効、失われた応答の回復、権限変更、手動解決、非機密出力を確認する。TLS proxy と実 agent の全往復、全 gate、導入受入の結果は別途 feature log に記録する。実機プリンターと現金払出機は未検証である。

通知の送信待ちは4 KiBを上限にし、ping前と非同期DB確認後の送信直前に再検査する。遅い受信側は切断して資源を保護し、仕事の正本はHTTPSの定期取得で回復する。
