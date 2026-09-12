# 店舗LAN agentの導入・運用

対象は [共通配備仕様](../specs/deployment-edge.md) のLinux agentです。ERPと同じOSで動かす必要はありません。店舗LANからERPのHTTPS/WSSへ到達できることが必要です。agentは受信port、TCPトンネル、任意shell実行の入口を持ちません。

## 配布物と準備

`pnpm --filter @daifuku/edge build` で `apps/edge/dist/edge.mjs` を作成します。実行先ではLinux、Node.js 22以上、util-linuxの `/usr/bin/flock` が必要です。JavaScriptのnode_modulesは不要です。OSで検証済みのNodeの実パスが `/usr/bin/node` と異なる場合はsystemd例を合わせます。

専用の `daifuku-edge` OSユーザーを作り、実行ファイルを管理者だけが変更できる `/opt/daifuku-edge/current/edge.mjs` に配置します。状態はローカルの耐久ディスクへ置きます。NFS等のネットワークFS、使い捨てコンテナ層、複数ホストでの状態ディレクトリ共有は受入対象外です。

```sh
sudo install -d -m 0700 -o daifuku-edge -g daifuku-edge /etc/daifuku-edge /var/lib/daifuku-edge
sudo install -m 0600 -o daifuku-edge -g daifuku-edge config.example.json /etc/daifuku-edge/config.json
```

[設定例](../../apps/edge/config.example.json)のダミーUUIDを管理画面の機器IDへ置き換え、`localDeviceId` と `driver` を一致させます。`apiBaseUrl` はAPIの入口まで（例 `https://erp.example.jp/api`）。末尾へ `/relay/...` をagentが追加します。URLにユーザー名、パスワード、query、fragmentを含められません。

IPP宛先は `printerUri` に固定します。`ipp://` は店舗LAN内の平文HTTP、`ipps://` は証明書検証付きHTTPSです。機器が対応するならIPPSを選びます。ERP用私設CAは最上位 `caFile`、機器用私設CAは各機器の `caFile` に絶対ファイルパスを設定します。HTTPS/WSS/IPPSの証明書検証は解除しません。DNS名と証明書の一致も必要です。

`simulationConfirmed: true` の `simulator` は模擬動作専用です。印刷・釣銭・状態の成功は `simulated_*` / `simulator_online` と表示し、現金移動や実印刷は行いません。実釣銭機の型番・vendor SDKが決まるまでは実機コマンドを実装していません。

## 初回登録と資格情報更新

管理画面でこの店舗のgatewayに対する単回pairing tokenを発行します。agent専用ユーザーだけが読める0600のJSONファイルへ転記します。ファイルの形式は `{"pairingToken":"管理画面に一度だけ表示されたtoken"}`。tokenをコマンド引数やURLへ直接貼り付けません。

```sh
sudo -u daifuku-edge /usr/bin/node /opt/daifuku-edge/current/edge.mjs pair --config /etc/daifuku-edge/config.json --state /var/lib/daifuku-edge --token-file /etc/daifuku-edge/pairing.json
sudo -u daifuku-edge /usr/bin/node /opt/daifuku-edge/current/edge.mjs session --config /etc/daifuku-edge/config.json --state /var/lib/daifuku-edge
```

成功後はpairing用ファイルを削除します。agentは秘密を生成してfsync保存してから登録/更新を送信します。応答が失われても、再起動時に保存済み新秘密のsession認証を試し、サーバーで登録済みなら回復できます。未登録のpairingは有効なtokenで同じpair操作を再実施します。期限切れなら管理者が再発行します。

`credentials.json` はAPI入口とgatewayに結び付きます。別のERP URLへ設定だけを変えて秘密を送信することは拒否します。URL変更/別gateway移設は旧agentを停止して管理側で失効させ、対応jobを確認してから別の状態ディレクトリで再登録します。

手動更新はサービス停止中に同じオプションで `rotate` を実行します。常駐中は有効期限の残り5分未満で更新します。更新応答が失われた場合、新秘密のsession確認後に旧秘密を破棄します。失効/認証拒否時は停止し、systemdは待機後再起動します。旧資格情報を再有効化する動作はありません。

## 常駐・停止・確認

[systemd例](../../apps/edge/deploy/daifuku-edge.service)をOSの構成に合わせて導入し、`systemctl enable --now daifuku-edge` で起動します。ログは本文・金額・秘密を含まないJSONの時刻/状態コードです。管理画面でgatewayの最終応答とjob/機器状態を確認します。

手動の `run` は常駐、`once` は復旧とjob1件の取得・処理、`inspect` はローカル記録のID/attempt/結果コード/IPP番号を表示します。すべて同じwriter lockを使うため、保守CLIはサービスを停止して実行します。OSのflockを保持する専用helperが失われた場合もagentを即時停止します。writer.lockファイルを削除してロックを奪取しません。

停止はSIGTERMで行います。実行中の操作がある場合、結果が判明しないまま強制終了すると次回起動で要確認になります。状態ディレクトリを削除・巻き戻し・別agentへコピーして処理を再実行しないでください。更新時も同じ状態を保持し、一度に1プロセスだけを起動します。

## 印刷と不明結果

IPPの必要操作はGet-Printer-Attributes、Print-Job、Get-Job-Attributesです。text/plain対応とcopiesを照合し、文字コードなしtext/plainはUS-ASCIIに限定します。日本語等は `text/plain; charset=utf-8` の明示対応が必要です。ESC等の機器制御文字は拒否します。PDF、画像、ESC/POS、raw TCP、USB/serialは未対応です。

1. job取得後、本文のhashとローカルの機器対応を確認します。
2. start要求前にjob ID/attempt/lease/本文hash/機器設定hash/状態をfsync保存します。本文・表題・金額はjournalへ保存しません。
3. 初回 `startGranted: true` の返答だけで実行します。返答が失われた、再要求でfalseだった、資格やleaseが失効した場合は実行しません。
4. Print-Jobの受付番号を受けたら保存し、Get-Job-Attributesで終了を確認します。受付成功だけを印刷完了とは表示しません。
5. state=9でも `queued-in-device` や完了時の警告/エラーは要確認です。通常の成功も「IPP機器が完了と報告した」結果であり、この配布物で実機印字を検証したとの主張ではありません。

印刷要求送信後の応答喪失では、機器が印刷した可能性があるため自動再送しません。再起動時に受付番号が保存されていれば元の固定宛先へ状態照会し、番号不明・照会失敗は要確認として報告します。宛先設定が変わっていれば別機器の同じ受付番号を照会せず要確認にします。同じ機器の後続物理jobは管理側で停止します。

担当者は実機の出力・履歴を確認し、管理画面から理由と根拠を付けて解決します。必要な再印刷は新しいjobとして明示します。DB lease/fencingとローカルjournalだけでは、機器実行と記録を原子的に確定できないため物理exactly-onceは保証しません。

## 通信・容量の境界

WSSは小さい `jobs_available` 通知だけです。通知受信、接続直後、再接続後にHTTPS取得し、通知が全て失われても約15秒のjitter pollで未処理jobを取得します。結果/状態eventはHTTPSで送り、応答喪失時は同じjob attempt/event UUIDで再送します。

HTTP/IPP応答は131072/262144 bytes、WSS受信は4096 bytes、ローカルJSONは2MB、記録と未送信eventは各1000件まで。完了記録は直近400件を保持して新規記録時に整理し、未確定記録は自動削除しません。容量・権限・journal不正は停止して保守確認します。非冪等な処理の記録を消して容量を空ける運用はしません。

テスト専用に `syntheticLoopbackTest: true` と `DAIFUKU_EDGE_SYNTHETIC_TEST=1` の両方がある場合だけ、ERP接続先のloopback HTTP/WSを許します。TLS検証を無効にする機能はありません。本番設定とsystemdにこの値を入れません。

## 根拠と検証

2026-09-12確認。バイナリ符号化/HTTP転送は [RFC8010](https://www.rfc-editor.org/rfc/rfc8010.html)、媒体のcharsetとjob状態/転送機器の例外は [RFC8011 §§5.1.10,5.3.7](https://www.rfc-editor.org/rfc/rfc8011.html)。秘密のURLへの投入禁止と更新は [RFC9700](https://www.rfc-editor.org/rfc/rfc9700.html)、長寿命WSの認可は [OWASP](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html) を参照します。fsyncには [Node FileHandle.sync](https://nodejs.org/docs/latest-v22.x/api/fs.html#filehandlesync) を用います。

`apps/edge/test` で実TLS HTTPS/WSS、自己署名CAの明示信頼と未知CA拒否、pair/rotation応答喪失、通知遮断中poll、開始許可不明、印刷応答喪失、IPP状態照会復旧、設定変更、秘密の権限、flock多重起動、独立bundle起動とSIGKILL後の再取得を検証します。実釣銭機/実プリンター・顧客CA/ネットワークは未検証で、導入先で別途受入が必要です。

単独配布には `apps/edge/dist/edge.mjs`、`apps/edge/dist/LICENSE`、`apps/edge/dist/THIRD_PARTY_NOTICES.txt` の3ファイルを同梱します。build時にesbuildの実出力への寄与を確認し、同梱npmパッケージのライセンス全文・NOTICEを第三者通知へ集約します。通知が見つからない依存が追加された場合はbuildを停止します。

`apps/edge/test/actual-api.db.test.ts` は、明示した専用テストDBのAPIを子プロセスで起動し、合成CAを信頼するHTTPS/WSSの `/api` proxy経由でagentを接続します。pair/rotation/complete応答損失からの回復、開始許可応答損失時の要確認化と後続停止、状態event後の管理画面DTO、失効によるWSS切断とHTTPS拒否を実APIで検証しています。機器側は明示シミュレーターであり、実プリンターの適合試験とは区別します。テストfixtureは通常起動経路に含めず、loopbackの `daifuku_*test*` という専用DB名と `DAIFUKU_EDGE_TEST_FIXTURE=1` がなければ起動しません。

長期オフラインからの復帰では、7日を超えた状態通知に対するサーバーの `ignored: expired` 応答を受けて当該通知だけをjournalから除き、`device_event_expired` を記録します。旧attemptまたは手動解決済みの結果は、サーバーの `ignored: obsolete_attempt / manually_resolved` と現在状態の応答を確認して当該ローカル記録だけを報告済みにします。古い結果から新しい機器状態eventは作らず、現在のjobも書き換えません。一般的な409や不明な `accepted: false` を一律に捨てる処理はありません。
