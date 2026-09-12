# エッジ端末のOS別サービスセットアップ

状態: 初版CLIの実装・5対象の実OSサービス受入完了。2026-09-13。基点: main `4b6cfdb`。branch: `feat/edge-installers`。測定範囲は[作業記録](../log/2026-09-13-edge-installers.md)を参照。

## 目的と対応範囲

Windows、systemd Linux、macOSの端末で店舗中継をログイン不要の常駐サービスとして導入する。共通のNode22/edgeアプリとOS別service managerを版付き配布物に含め、機器設定・接続資格情報・未解決journalを配布物と分ける。初版はWindows x64、Linux x64/arm64、macOS x64/arm64を対象にし、各OSで実測した範囲と生成だけの範囲を明記する。ERPサーバー本体のOS対応や実釣銭機driverは変更しない。

## 受入基準（EARS）

- EI1: セットアップを実行したとき、OS/architecture、配布manifestと期待hash、Node版、対象path、既存所有markerを検査する。既定のplanはファイル・service・accountを変更しない。実行は明示したexecuteによる。
- EI2: 初回導入したとき、Windows SCM、Linux systemd、macOS LaunchDaemonへ登録し、ログイン不要の低権限accountで動かす。Linux/macOSは専用account、Windowsは組込LocalServiceを使う。アプリ/実行ファイルはaccountが書換不能、私有stateは他の一般利用者へ公開しない。Windowsの同一LocalServiceで動く別サービス間の隔離は保証しない。OS防御・firewall・TLS検証を無効にしない。
- EI3: 接続コードがまだないとき、serviceは秘密を出さず登録待ちになる。管理者がファイルで渡した単回codeをサービス本人が消費し、成功確認後にのみ入力ファイルを除去する。引数・URL・通常ログへcodeを含めない。
- EI4: 複数processが同じstateへ入ろうとしたとき、OSが保持する排他で1つだけを許可し、死亡時はOSが解放する。mtimeやタイムアウトだけでlockを奪わない。OS別の秘密ファイル/ACL/リンク検査とjournal置換を持ち、結果不明の物理処理を再実行しない。
- EI5: 更新時は旧serviceを確認・停止し、新しいimmutable releaseへ切り替える。資格情報・設定・未解決journalは保持し、途中失敗の状態と旧版を残す。異なるgatewayへ黙って設定を変えない。未完了の導入は明示したresumeで再開できる。
- EI6: status/start/stop/uninstallは自分のmarkerと実service設定を照合する。削除はサービス登録だけを解除し、資格情報/journal/log/版を保持する。任意の既存serviceや既存accountを横取りせず、無条件の再帰削除を行わない。
- EI7: 配布物は固定した公式Node/必要wrapperとLICENSE全文を含み、外部取得はbuild時に固定hashで確認する。導入時は未確認の最新版を取得しない。コード署名/公証を用意していない配布物を署名済みとは称さない。
- EI8: OS別の実process・排他・秘密保存、初回導入/停止/再起動/更新/削除後のstate保持を合成データの隔離環境で試験する。macOSはCIの実OSで検証し、単なるplist生成だけを実機受入とはしない。全gateと既存edge回帰、文書、公開前scanを行う。

## 境界と運用

店舗から外向きにWSS/HTTPSへ接続する通信契約を維持する。セットアップは本番ERPへ自動登録せず、本人が発行した単回codeを必要とする。端末管理者はサービスとその秘密を管理できる信頼主体である。配布署名、MDM、GUI MSI/PKGの署名付き配信、多数instance/ユーザー切替、データ消去、無人自動更新、実機driver拡張は別途扱う。

## 検証方針

plan無変更、hash改変/リンク/他者所有/既存service拒否、途中失敗再開、Windows ACLと排他、macOS/Linux OS lockとprocess停止、同じstateを使う更新、uninstall後の資格情報/journal保存を実測する。サービス受入はCIの使い捨てrunnerを優先し、開発者の実PCへ未依頼の常駐serviceを残さない。Node/OS/service managerの一次資料と確認日、検証結果を作業記録へ残す。
