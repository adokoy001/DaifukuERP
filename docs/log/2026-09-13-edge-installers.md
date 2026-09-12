# 2026-09-13 エッジサービスのOS別セットアップ

仕様: [edge-installers](../specs/edge-installers.md)。branch: `feat/edge-installers`。

## 実装と判断

- Windows SCM/LocalService、Linux systemd/専用ユーザー、macOS LaunchDaemon/専用ユーザーを共通setup契約に接続。
- 同梱Node 22.23.2、固定WinSW.NET461 2.12.0と全文ライセンス/NOTICE、5種類のCPU/OS配布物を生成。インストール時の動的ダウンロードを廃止。
- 計画表示、管理者境界、実サービス/アカウント所有の照合、版別immutableコード、状態分離、排他、durable intentと明示再開、保持を伴う登録解除。
- Windows ACL/原子的書込、macOS拡張ACLとzsh flock、Linux flock。クラッシュ時も時間経過でロックを奪わない。
- 未登録サービス待機、保護inboxの登録処理、応答消失からの回復、失効後の再発行受付、OSのPIDと照合する状態表示。
- 一般業務・DBスキーマ・画面は変更しない。実機driverは従来のIPPと明示シミュレーターの範囲。

## 測定記録（更新中）

ローカル全gate（型・Lint/依存境界、単体693件、DB589件、配備8件、文書リンク72文書607対象）が成功しました。追加の入力秘密保護、状態/PID鮮度、CI fixture境界は個別回帰で確認し、最終CIでも全体を再実行します。
Windows実プロセスでACL・Unicode原子的置換・別プロセス排他・同時writer拒否、SCM境界の模擬試験を実行しました。同梱Windows Node 22.23.2の起動も確認しています。開発者PCへ常駐サービスは登録していません。
初回5 OS CIで、macOSのOS標準temp aliasとzsh競合戻り値、GitHub Linux imageの`/opt`全ユーザー書込権限、Windows PowerShell環境の差異を検出しました。製品のリンク/所有権検査は維持し、実OSで同じ受入条件を再検証します。最終結果は本節へ追記します。

## 境界と未実施

署名MSI/PKG、notarization、MDM、自動更新、全OS版の適合、実プリンター/釣銭機、導入先CA・本番ネットワークは対象外です。
初回導入記録の原子的公開より前に停止した一時ファイルは自動で採用せず、管理者確認を要求します。pending記録後の対応範囲は同一版で明示再開できます。
アンインストール後の専用アカウント・保存データ・旧版の容量/廃棄は管理者の運用範囲です。
