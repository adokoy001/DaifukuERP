# 2026-09-13 エッジサービスのOS別セットアップ

仕様: [edge-installers](../specs/edge-installers.md)。branch: `feat/edge-installers`。

## 実装と判断

- Windows SCM/LocalService、Linux systemd/専用ユーザー、macOS LaunchDaemon/専用ユーザーを共通setup契約に接続。
- 同梱Node 22.23.2、固定WinSW.NET461 2.12.0と全文ライセンス/NOTICE、5種類のCPU/OS配布物を生成。インストール時の動的ダウンロードを廃止。
- 固定WinSW内のlog4netは[一次資料による適用範囲レビュー](../domain/edge-service-security.md)を実施。修正版とは称さず、現行構成から問題のXMLログlayoutへの呼出がないことを確認。
- 計画表示、管理者境界、実サービス/アカウント所有の照合、版別immutableコード、状態分離、排他、durable intentと明示再開、保持を伴う登録解除。
- Windows ACL/原子的書込、macOS拡張ACLとzsh flock、Linux flock。クラッシュ時も時間経過でロックを奪わない。
- 未登録サービス待機、保護inboxの登録処理、応答消失からの回復、失効後の再発行受付、OSのPIDと照合する状態表示。
- 一般業務・DBスキーマ・画面は変更しない。実機driverは従来のIPPと明示シミュレーターの範囲。

## 測定記録

実装commit `3b46f0cf5588f057e1416a61c58cc475c574bf75`、CIがcheckoutしたPR統合commit `1254c0acbefb865cf2af69cb826141bd3e01107b` のファイルtreeは一致します。[実サービスCI](https://github.com/adokoy001/DaifukuERP/actions/runs/34706663114)の5jobすべてが成功しました。

| 実行環境 | 実サービス | 導入・停止/開始・更新・登録解除 |
|---|---|---|
| Windows Server 2025 x64 | SCM / LocalService | [成功](https://github.com/adokoy001/DaifukuERP/actions/runs/34706663114/job/103587832084) |
| Ubuntu 24.04 x64 | systemd / daifuku-edge | [成功](https://github.com/adokoy001/DaifukuERP/actions/runs/34706663114/job/103587832240) |
| Ubuntu 24.04 arm64 | systemd / daifuku-edge | [成功](https://github.com/adokoy001/DaifukuERP/actions/runs/34706663114/job/103587832203) |
| macOS 15 Intel | LaunchDaemon / _daifukuedge | [成功](https://github.com/adokoy001/DaifukuERP/actions/runs/34706663114/job/103587832292) |
| macOS 15 Apple Silicon | LaunchDaemon / _daifukuedge | [成功](https://github.com/adokoy001/DaifukuERP/actions/runs/34706663114/job/103587832218) |

macOSは本人側のDirectory Service検査完了、UID/EUID=400、GID/EGID=nobody、正本と実プロセスのgroup集合一致をinstall/start/updateで実測しました。Intelは`[nobody,12,61,100]`、ARMは`[nobody,12,61,701,100]`で、標準の非管理所属を保ちながら明示追加・管理権限の検査を通しています。

最終実装の[全体CI](https://github.com/adokoy001/DaifukuERP/actions/runs/34706663254)は4jobすべて成功しました。全gateは型・Lint/依存境界、単体756件（98ファイル）、DB589件（97ファイル）、配備8件、文書リンク73文書622対象。API/Webの型検査、edge/Web build、通常ブラウザー47件、認証ブラウザー3件、隔離クラスタでの導入/更新/復元/失敗再開も成功しています。受入結果を追記した文書はリンク検査とマニュアル生成を再確認し、実装と試験コードは変更していません。
Windows実プロセスでACL・Unicode原子的置換・別プロセス排他・同時writer拒否、SCM境界の模擬試験を実行しました。同梱Windows Node 22.23.2の起動も確認しています。開発者PCへ常駐サービスは登録していません。
初回5 OS CIで、macOSのOS標準temp aliasとzsh競合戻り値、GitHub Linux imageの`/opt`全ユーザー書込権限、Windows PowerShell環境の差異を検出しました。製品のリンク/所有権検査は維持し、実OSで同じ受入条件を再検証しました。
第2回ではWindows SCM/LocalServiceの全lifecycleが成功。第3回ではLinux x64/arm64も成功しました。systemdの単一path字段と引数リストの引用規則を分け、実パーサーの通常/空白入りpath回帰を追加しています。Windowsの日本語配布説明書はUTF-8を明示して読みます。
macOSはnative属性名の差を解消した後、`InitGroups=false`でも実getgroupsにeveryone/localaccountsおよび端末固有のnested groupが残ることを実測しました。補助groupを空にするために独自root launcherを増やさず、Apple標準の非root起動を維持します。所有/非ログイン/UID/primaryに加え、専用アカウントへの明示追加所属・管理権限を拒否し、管理者側で検証した所属と実サービスのUID/GID/groupを照合する構成です。

## 配布物

[初版プレビュー](https://github.com/adokoy001/DaifukuERP/releases/tag/edge-v0.1.0-preview.1)は、上記CIで更新先として試験した`ci-b-1254c0acbefb865cf2af69cb826141bd3e01107b`の5アーカイブをそのまま使用します。CIから回収後、アーカイブhash・manifest hash・全内容・entry一覧・POSIX実行権限を再検査しました。各アーカイブと2種類のSHAファイル、OS別job/sourceを含む`provenance.json`を配布します。ソースtagは実際にビルドしたcommitを保持し、受入結果を追記した最新文書はmainに置きます。

## 境界と未実施

署名MSI/PKG、notarization、MDM、自動更新、全OS版の適合、実プリンター/釣銭機、導入先CA・本番ネットワークは対象外です。
native CIは未登録サービスの実PID・heartbeat、手動停止/開始、同一コードの版ID切替、設定・未登録credentials・空journalのbyte保持を検証します。実サービス経由のERPペアリング、OS再起動後の自動起動、未送信結果を含む実店舗状態の更新は未検証です。ペアリング/失効/応答消失回復は別のTLS合成単体・API/DB試験で扱い、OSサービス経由の実測と混同しません。
初回導入記録の原子的公開より前に停止した一時ファイルは自動で採用せず、管理者確認を要求します。pending記録後の対応範囲は同一版で明示再開できます。
アンインストール後の専用アカウント・保存データ・旧版の容量/廃棄は管理者の運用範囲です。
