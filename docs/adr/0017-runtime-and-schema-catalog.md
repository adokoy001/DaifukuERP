# ADR-0017: 設定の読込順と永続化スキーマの独立

- 日付: 2026-09-12
- 状態: 採用（共通基盤補強）
- 関連: ADR-0015、foundation-refresh AC-1〜AC-3

## 問題

ESM の静的 import は main 関数より先に評価される。API/MCP が `.env` を main 内で読む構成では、pack 登録が設定より先に走っていた。また、実行時に使う pack を減らすと、その registry から生成した migration が保存済み pack テーブルを削除する。

## 決定

`apps/runtime` を API/MCP/DB CLI 共通の composition root とする。最寄りの `.env` を読み、続いて core の catalog と pack を動的 import する。既に設定されたプロセス環境変数を優先する。未知の pack 名は起動時に拒否する。

実行時は `DAIFUKU_PACKS` の選択を使う。DB schema/generate/migrate は必ずインストール済み全 pack を読み込む。会社への適用範囲は kernel の Context が決める。登録済みの物理テーブルと、会社で有効な機能は別の概念とする。

自動生成時の DROP TABLE/COLUMN/SCHEMA を拒否する。削除が必要な将来の変更は、データ保全・復元方法を伴う個別 migration としてレビューする。既存の外部キー・ポリシーの安全な置換は妨げない。

MCP は接続時だけでなく要求ごとに owner 接続を用いて利用者の有効状態と役割を読み直す。実業務の read/write は従来どおり app 接続＋Context＋Repository を使う。owner 接続を業務データの権限回避に使わない。

## 検証

- 別プロセスで `.env` の pack 選択と環境変数優先を検証する。
- runtime が `none` でも schema catalog に全 pack のテーブルが残ることを検証する。
- 既存 MCP 接続中に役割を変更・アカウントを無効化し、次の要求で反映されることを確認する。
- 旧 migration 7本で作成したデータベースへの追加 migration、再適用、旧不正参照による原子的な失敗を検証する。

## 限界

pack のコード自体を動的にアンインストールする機能、インストール済み pack の複数バージョン併存は対象外。スキーマ削除・データ変換を自動で推測しない。業務バックアップはソース bundle と分離し、DB と添付ストレージを対にして保管する。
