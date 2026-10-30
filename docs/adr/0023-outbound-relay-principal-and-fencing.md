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

## 追補: 連携・MCP 用の機械用資格情報（2026-10-30、F2）

仕様: [machine-credentials](../specs/machine-credentials.md)。この項目に予約された ADR-0035 は使わず、この ADR の機械の本人性を一般化する。

### 引き継ぐ性質

LAN 中継機と同じく、外部連携（REST）と AI エージェント（`apps/mcp`）にも人の JWT や `onBehalfOf` を使わない専用の機械 principal を与える。kernel の system table `machine_credentials` に、`dfk_` + 32 byte 乱数（base64url 43 文字）の SHA-256 hash だけを保存し、鍵の一部も保存しない。generic CRUD・REST・MCP ツールに出さない。資格情報は tenant・company に固定し、期限（1〜365 日、必須）を持ち、要求ごとに失効・期限・用途・発行者を照合する。秘密は発行の応答だけに含め、URL・監査・要求ログに出さない。Authorization header 専用で、URL の query からは読まず、ブラウザー Origin を拒否し、会社切替 header は鍵の会社と同じ値だけを受け付ける。発行は pairing と同じく、人のテナント管理者のセッションで `lockIdentity` の下の単回 step-up（`consumeStepUp`）を要する。発行の監査には発行したセッションの `sessionVersion` を残す。

### 中継機と違う点

- actor は新しい種別 `machine`（`id` = 資格情報の id）。権限は専用の `relayAccess` ではなく、発行時に選んだ通常のロール（`availableRoles()`、`relay` を除く）で、人と同じ `Repository` / action の検査を通る。`tenantAdmin` は持たず、常に会社全体（`accessScope = all`）。
- 用途（`integration` / `mcp`）で入口を限定する。`integration` は REST だけ、`mcp` は `apps/mcp` だけで受け付ける。
- 有効性を発行者に結び付ける。発行者が無効化・テナント管理者でなくなると `updateManagedUser` の同じ transaction で失効させ（再有効化しても戻らない）、利用のたびに発行者が有効なテナント管理者であることも確かめる。発行者のパスワード変更・全端末ログアウトでは止めない（連携を管理者の個人操作で止めないため。発行に step-up を要するので、盗まれた JWT だけでは鍵を作れない）。
- 人の本人性を前提とする kernel の port（`lockIdentity`・`assertAccessAdmin`・`authorizedCompanies` / `withAuthorizedCompany`・中継機の pairing / 失効 / operator・会社の作成と編集・本人のパスワード変更とセッション失効）は機械の actor を明示的に拒否する（fail closed）。業務の自己承認・作成者確認・本人の申請に使う利用者 id は kernel の `requireHumanUserId(ctx)` に寄せ、機械には 403 `human-actor-required` を返す（system / relay の戻り値は変えない）。鍵で作成・更新した記録の `created_by` / `updated_by` は `null` で、操作者は監査に残る。
- 照合の失敗予算は「照合の前に予約し成功時に返す」方式を使わない。未知の鍵だけを IP ごとに数え（5 分 100 件、照合前は読むだけ）、既知の鍵の拒否は資格情報ごとに数える。有効な鍵の要求は予算に書き込まない。共有 NAT の後ろで 1 つの失効済みの連携が他の健全な鍵を止めないためである。
- 拒否の監査（`use_denied`）は応答と別の transaction で確定し、`last_denied_at` / `last_denied_reason` の条件付き更新で資格情報・理由ごとに 1 時間に 1 件へ間引く。最終使用時刻は 60 秒単位で記録する。失効は `revoked_at IS NULL` の条件付き更新で冪等にし、app role には `DELETE` を与えない（鍵は失効した記録として残す）。

### 帰結

- `IDENTITY_ENCRYPTION_KEY` を設定していない最小構成では step-up が使えず、鍵を発行できない（招待・pairing と同じ。一覧・失効は使える）。
- 人事・給与の判断（休暇の付与・精算・給与制度の承認・証憑の添付など）は鍵では行えない。人事・給与の連携を鍵に開くかは別の判断とする。
- `apps/mcp` は従来どおりデータベースの資格情報（owner 接続を含む）で動く。`mcp` 用の鍵は人のパスワードを置き換えて監査の actor とロールを固定するが、MCP ホストの信頼を不要にはしない。
- 利用者の直接作成・テナント管理者の付与が step-up を要しない点は、この追補の範囲外の既存の判断として残る。
