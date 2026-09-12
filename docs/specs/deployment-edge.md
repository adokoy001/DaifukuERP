# クラウド・オンプレ共通配備と店舗LAN機器中継

状態: 実装・ローカル統合受入済み。2026-09-12。基点: 公開main af365a3。branch: feat/deployment-edge。1つの統合仕様・PR・作業記録で管理する。

## 目的と境界

同一の版付き配布物をクラウドVMとオンプレLinuxへ配置し、設定・DB・添付・秘密は別の永続領域へ保存する。店舗LANにはLinux/Node.js22/util-linux上の小さい中継agentを置き、ERPのHTTPS/WSS入口へ外向きに接続する。WebSocketは仕事の存在を知らせる小さな通知のみ、job本体と結果は認可付きHTTPSで取得・報告する。

初版は単一LinuxホストのERP、PostgreSQL16、Caddy、systemdを参照配備とする。WebのAPI接続は同一originの /api に固定して一度ビルドする。コンテナ・HA・クラウド各社のmanaged service・SaaS運用自体は別の受入とする。店舗側の受信portは不要だが、ERP側の入口への経路は必要。非公開NAT内のオンプレERPを別店舗から使う場合は公開HTTPS入口またはVPN等を構成する。

機器型番未指定のため、IPPのテキスト印刷とjob状態照会、状態取得、および明示された模擬釣銭機を初期adapterとする。実釣銭機のvendor protocol、USB/serial専用SDK、会計・支払伝票への自動転記、オフラインPOS販売は対象外。物理装置での受入をシミュレーターの成功と同一視しない。

## 受入基準

- DE1: 同じ配布物が公開DNSのクラウドVMと信頼CA/私設DNSのオンプレ参照構成で動き、接続先の違いだけでWeb再buildを要さない。設定をshellへsourceせず、秘密/添付をreleaseに含めない。起動・停止・更新・復元・readiness・proxy信頼境界を文書化して検証する。Web/agent配布物には固定済み依存のLICENSE/NOTICE全文を同梱し、必要なlicense本文が取得できなければ配布生成を止める。
- DE2: LAN中継は外向きWSS/HTTPSのみでERPへ接続し、短寿命の単回pairingと機器別の高entropy資格情報を使う。資格情報はURL/ログ/監査/汎用CRUDへ露出せず、原子的な発行/rotationと失効を持つ。人のJWTや管理roleを機器へ渡さない。
- DE3: relay専用principalは固定tenant/company/gateway/siteと明示許可のentity/actionに限定する。全HTTPS操作とWS接続中に現在の資格情報・gateway状態を検査し、失効を既存接続へ反映する。人の会社切替、REST/MCP、他拠点・他gatewayの資料は取得できない。
- DE4: jobを作成したとき、会社/拠点/機器の権限、機器能力、期限、入力上限、idempotency keyと同一内容を検査して永続化する。通知前の障害や通知欠落でも再接続と定期HTTPS取得で回復する。WSへjob本文・金額・印刷内容を送らない。
- DE5: claimは排他的なattempt/leaseを発行する。実行開始前の期限切れclaimだけ安全に再取得でき、startは初回にだけ実行許可を返す。開始後の不明結果を再投入しない。同一機器で未確定の物理操作がある間は後続を実行しない。
- DE6: agentは実行前にローカルへjournalを耐久保存し、再起動や応答損失でも同じ物理操作を自動再実行しない。IPP受付と印刷完了を分け、job-idが判明していれば状態照会で回復する。判定不能は要確認とし、担当者が理由・根拠を残して解決する。lease/fencingを物理exactly-onceの保証と呼ばない。
- DE7: ローカル機器の宛先とdriverはLAN内の設定で許可したものだけ。クラウドjobに任意URL、shell、TCP tunnel、raw機器命令を含めない。TLS検証を保ち、payload/応答/queue/disk・同時接続を制限する。設定・journalは所有者限定にし、同じjournalの多重writerを拒否する。
- DE8: 店舗からの状態eventはUUIDと機器の対応を検査してHTTPSで永続化し、再送を重複記録しない。管理画面は接続/最終応答/機器状態/待機・実行・要確認jobを示し、取消と要確認解決は版と理由を検査する。全画面を日本語/英語とスマホ幅で確認する。
- DE9: 既存0012の業務データを保持する追加migration、全gate、Web型/build、実HTTP/WSS/TLSと機器模擬受入、既存ブラウザー、配布/導入試験を行う。README・AI索引・操作/設計・STATUS・work-logを更新してcommit/pushする。

## 状態と通信

jobは queued → claimed → executing → succeeded / failed / uncertain。queuedだけ利用者がcancelできる。未開始claimが失効したときだけqueuedへ戻す。実行中の期限切れ/応答不明はuncertainとして同一機器を止め、再queueボタンを設けない。管理者のresolveは実機確認の理由・根拠・expectedVersionを必要とし、遅着結果が手動確定を上書きしない。再印刷は新しいjobとして明示操作する。

pairing時はagentが秘密を先に生成・保存して送る。pairing応答消失時は保存済み秘密でsession確認し、同じtokenでの別機器登録を許さない。rotationも新秘密を先に保存し、新秘密でcommitを確認してから旧秘密を破棄する。

WSのavailable通知は失われ得るhint。agentは接続直後・通知・定期pollでHTTPS claimを試し、接続はjitter付きbackoff/heartbeatで復旧する。実行開始POSTの応答が失われた場合、再POSTの返答は初回実行許可ではないので物理実行を開始せず要確認とする。

## 検証方針

kernel/業務: tenant/company/site/relay分離、汎用経路拒否、単回pairing/rotation、競合claim、start応答損失、未開始lease回復、実行後不明、遅着結果、期限、二重送信、手動解決、入力上限、旧schema更新。

通信/agent: 実TLS/WSSで通知→HTTPS→模擬機器→結果、通知切断中のpoll回復、資格情報失効、再接続、journal再起動、IPP受付/job状態/応答喪失、不正宛先/secret/ファイル権限/多重起動を検証する。

配備/UI: 同じreleaseと異なるorigin、SPAのdeep link、/api proxyとWS Upgrade、readiness・許可proxy、サービス停止、設定分離、画面の登録/pairing/印刷/状態/要確認と権限を確認する。実装/実測/未検証を作業記録で区別する。

## 検証記録

受入結果・修正・未検証の境界は [作業記録](../log/2026-09-12-deployment-edge.md) に集約する。GitHub公開状況は [main](https://github.com/adokoy001/DaifukuERP/tree/main) と対象commitのActionsを確認する。
