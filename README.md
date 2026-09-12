# Daifuku ERP — 大福帳

**業界ごとの仕事を、ひとつの共通基盤から。**

[![CI](https://github.com/adokoy001/DaifukuERP/actions/workflows/ci.yml/badge.svg)](https://github.com/adokoy001/DaifukuERP/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Daifukuは、会計・販売・購買・入出金・在庫・契約・従業員管理を共通基盤に持つ、開発中のERPです。趣味の業務システムづくりを出発点に、業界固有の機能をpackとして追加できる構造を試しています。TypeScript、PostgreSQL、Reactで構成し、UI、REST API、MCPから同じ権限・伝票規則を利用します。

**現在は実験的なソース公開版です。** 国内・円建て・1法人内の店舗業務を中心に検証しています。実運用を認定するものではなく、実データを入れる前に導入先で業務適合、復旧、アクセス制御、運用容量を確認してください。

![チェーン運営画面。店舗と数値は検証用の架空データです。](docs/manual/img/operations-desktop-20260912.png)

## できること

| 分野 | 主な機能 |
| --- | --- |
| 共通基盤 | テナント・会社分離、会社/拠点/店舗・本人ごとの権限、監査履歴、楽観ロック、採番、添付 |
| 会計・商取引 | 売上/仕入請求、仕訳、消込、売掛/買掛残高、期間締め、取消・改訂 |
| 在庫・契約 | 入出庫、棚卸、移動平均の在庫評価、契約・請求予定 |
| 店舗運営 | 営業計画/目標、日次報告、未提出管理、店長承認/差戻し、本部確定 |
| BI・レポート | 目標・前期間比較、店舗比較、現金差異、入金残高、根拠伝票へのリンク、再認可してCSV出力 |
| 従業員・本部 | スマホ打刻、勤怠訂正・承認、有給付与/申請/残高、経費・領収書・精算、給与計算と本人明細 |
| 導入・更新 | 対象の事前点検、計画表示、バックアップの別DB実復元、移行、資格情報を上書きしない再開 |

業界テンプレートは **15種類** です。小売、不動産賃貸、電器店、農家、飲食店チェーン、卸売、製造、建設、物流、宿泊、診療所、介護、教育、専門サービス、美容を用意しています。会社を分けて適用し、サンプル業務から請求や入金へつなげて試せます。[業種別の範囲と固有項目](docs/domain/industry-catalog.md) を参照してください。診療・介護の制度請求など、各業種の全機能を網羅するものではありません。

従業員向けの「自分の勤怠・申請」と、本部・拠点管理者向けの「労務の承認・給与」を分けています。給与の自動計算は国内JPY・通常の労働時間制を対象とし、税・社会保険など8区分の控除額と根拠は外部で確認した値を入力します。暦日をまたぐ勤務の給与自動計算は未対応で、理由を表示して停止します。

## 手元で試す

Linux / WSL、Node.js 22、pnpm **10.28.0**、PostgreSQL **16**を使います。WindowsではWSL内のLinuxディレクトリにcloneしてください。PostgreSQLの管理者接続と、未使用の開発専用clusterが必要です。

```bash
git clone https://github.com/adokoy001/DaifukuERP.git
cd DaifukuERP
pnpm install --frozen-lockfile
```

次のSQLは固定のデモ用roleと `daifuku_dev` / `daifuku_test` を作ります。**新しい開発専用PostgreSQLにだけ実行**してください。同名roleやDBがある場合は止めて接続先を見直し、既存DBを削除して続行しないでください。

```bash
psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -f scripts/db-setup.sql
cp .env.example .env
```

`.env` の4つの接続URLが、いま作成した開発専用DBを指すことを確認します。PostgreSQLを5432以外のportで使う場合はURLも合わせます。次の `db:reset` は指定DBを消去してデモを作る開発用コマンドです。

```bash
pnpm db:reset
pnpm demo:industries
```

2つのターミナルで起動します。

```bash
pnpm dev:api   # http://localhost:3000
pnpm dev:web   # http://localhost:5173
```

画面で `admin@example.com` / `password` を使ってデモにログインします。「業界テンプレート」から会社を選んで利用してください。これは公開済みの練習用資格情報です。共有環境・インターネット向けサービスには使用しません。

## デモ以外へ導入する

[安全な導入・更新手順](docs/operations/setup.md) を使ってください。開発用SQLや `db:reset` は使いません。

```bash
pnpm run setup --help
```

`pnpm run setup install` / `upgrade` は既定で計画のみを表示します。実行には対象の明示、保守時間、別の空DBでの復元確認が必要です。接続秘密・初回管理者パスワード・DB dump・添付本体はGit管理外に置きます。`pnpm setup` はpnpm本体の別コマンドなので、`run` を省略しないでください。

Web配布、TLS、常駐化、ログ保全、監視、バックアップ運用は導入先で構成します。ソースをGitHubへ公開しても、アプリや業務DBが自動で公開されることはありません。

ログイン後はメニューの「自分のアカウント」から、本人のパスワード変更と全端末ログアウトを行えます。会社未所属でも利用できます。[アカウントの操作と復旧範囲](docs/operations/account-security.md) を参照してください。

## 開発と検証

```bash
pnpm gate                          # 型、lint、依存境界、単体、DB試験、文書リンク
pnpm --filter @daifuku/web test
pnpm --filter @daifuku/web typecheck
pnpm --filter @daifuku/web build
```

ブラウザー試験は [専用の空DBから再現する手順](CONTRIBUTING.md#ブラウザ試験を新規環境で再現する) を使います。業界テンプレートの適用を先行する順序も設定済みです。

DB試験は `TEST_DATABASE_URL_OWNER` / `TEST_DATABASE_URL` の専用DBを初期化します。UIや業務用DBと共用しないでください。導入・復元の実受入は [専用clusterでのセットアップ検証](docs/operations/setup.md#5-セットアップ自身の受入を再現する) を参照してください。CIの実行結果は [Actions](https://github.com/adokoy001/DaifukuERP/actions) で確認できます。

## 構造と文書

```text
apps/                 API・Web・MCP・共通runtime
  ↓
packs/                業界ごとの追加機能
  ↓
modules/  +  l10n/    共通業務・国内ローカライズ
  ↓
kernel/               DSL・Repository・権限・伝票・監査
```

金額/数量はDecimalで計算し、確定伝票は直接編集せず取消・改訂します。業務の読み書きはContextとRepositoryを通し、packからDBへ直接アクセスしません。

- [AI・開発者の入口](AI_INDEX.md) / [アーキテクチャ](docs/architecture/README.md) / [プログラム地図](docs/architecture/program-map.md)
- [従業員・労務ガイド](docs/manual/appendix-f-workforce.md) / [15業界の操作ガイド](docs/manual/appendix-g-industry-catalog.md)
- [操作マニュアル](docs/manual/00-index.md) / [最新の運営・権限・BIガイド](docs/manual/appendix-e-operations-control.md)
- [業界テンプレートガイド](docs/manual/appendix-d-industry-templates.md)
- [設計判断](docs/adr/) / [仕様と受入基準](docs/specs/) / [実装規約](docs/conventions/)
- [品質改善計画](docs/quality-roadmap.md) / [本人のアカウント管理](docs/operations/account-security.md)
- [貢献方法](CONTRIBUTING.md) / [セキュリティ報告](SECURITY.md)

## 現在の境界

全業界・全制度への対応、SSO/MFA、招待メール/メールによるパスワード再設定、POS自動連携、連結会計・FC精算、給与の税保険料自動算定・年末調整、変形/フレックス等の勤務制度、多通貨、外部BIへの自由SQLや定期配信は含みません。材料消費/廃棄の評価額は会計上の利益ではありません。過去の資料から復元できない事実を、現在値で埋めない方針です。

公開初回は点検済みのソース一式から履歴を開始しています。元のローカル開発履歴に含まれた私的なセッション参照は公開していません。

AI支援で開発しています。自動試験とコードレビューを行いますが、実務の業務審査や独立したセキュリティ評価を代替しません。

## ライセンス

[MIT License](LICENSE) — Copyright (c) 2026 adokoy001。第三者依存物はそれぞれのライセンスに従います。[第三者のライセンス・帰属](THIRD_PARTY_NOTICES.md) を参照してください。
