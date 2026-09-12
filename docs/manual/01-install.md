# 01 導入（技術者向け）

公開版の必要環境とcloneからの手順は [README](../../README.md#手元で試す) を参照してください。Linux/WSL、Node.js 22、pnpm 10.28.0、PostgreSQL 16を基本とします。

## 目的に合う手順を選ぶ

| 目的 | 手順 |
| --- | --- |
| 新しい専用DBでデモを試す | [READMEの開発手順](../../README.md#手元で試す) |
| デモ以外へ導入、既存の導入先を更新する | [安全なセットアップ](../operations/setup.md) |
| 自動試験の専用DBを準備する | [貢献・検証手順](../../CONTRIBUTING.md) |
| 会社や利用者、担当店舗を設定する | [運営・権限・BIガイド](appendix-e-operations-control.md) |

開発手順の `scripts/db-setup.sql` は固定のデモ資格情報を使います。`db:reset` は指定DBを消去してデモを作るため、業務用DBや保存したいデータへ実行しません。通常導入は計画表示を既定とする `pnpm run setup install` / `upgrade` を使い、別DBで実復元を確認します。

## 起動と接続

開発APIは `http://localhost:3000`、画面は `http://localhost:5173` です。別々のターミナルで `pnpm dev:api` と `pnpm dev:web` を起動します。Webからの接続先は `VITE_API_URL` で指定できます。APIの外部待ち受け、JWT、CORS設定は [公開・運用時の設定](../../SECURITY.md) を確認してください。

デモだけで使う初期ログインは `admin@example.com` / `password` です。現在は「利用者と権限」から利用者の作成、パスワード・有効状態、会社・店舗の所属を管理できます。実際の導入では専用の管理者と秘密を生成します。

## 業界テンプレート

READMEの `pnpm demo:industries` は3業界の専用サンプル会社を準備します。「業界テンプレート」から会社を切り替えて試してください。プロセスで読み込むpackと会社へ適用したpackは別に管理され、会社に適用したpackが画面へ反映されます。詳細は [業界テンプレート](appendix-d-industry-templates.md) を参照してください。

## マニュアルを単一HTMLにする

Python 3と `markdown` パッケージを仮想環境などへ用意し、`pnpm manual:build` を実行します。Markdown本文と画像から `docs/manual/daifuku-manual.html` を生成します。元のMarkdownを編集し、HTMLだけを直接修正しないでください。

## 企業機能の追加設定

基本導入後、SSO/MFAとメールは [認証・メール運用](../operations/enterprise-identity.md)、Square・連結/FCは [付録H](appendix-h-enterprise-operations.md)、給与税保険/年調/勤務制度は [付録I](appendix-i-fiscal-and-work-systems.md) を使います。`.env.example` の追加項目はコメント状態です。公開HTTPS URL、暗号鍵、provider設定、メール配送を準備したうえで段階導入してください。ソース導入だけで実サービスとの接続が成立するわけではありません。
