# Daifuku ERP — 大福帳

**業界ごとの仕事を、ひとつの共通基盤から。**

[![CI](https://github.com/adokoy001/DaifukuERP/actions/workflows/ci.yml/badge.svg)](https://github.com/adokoy001/DaifukuERP/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Daifukuは、会計・販売・購買・入出金・在庫・契約・従業員管理を共通基盤に持つ、開発中のERPです。趣味の業務システムづくりを出発点に、業界固有の機能をpackとして追加できる構造を試しています。TypeScript、PostgreSQL、Reactで構成し、UI、REST API、MCPから同じ権限・伝票規則を利用します。

**現在は実験的なソース公開版です。** 国内・円建ての会社/店舗業務を中心に、同一テナント内の管理用連結精算表も扱います。実運用を認定するものではなく、実データを入れる前に導入先で業務適合、復旧、アクセス制御、運用容量を確認してください。

![チェーン運営画面。店舗と数値は検証用の架空データです。](docs/manual/img/operations-desktop-20260912.png)

## できること

| 分野 | 主な機能 |
| --- | --- |
| 共通基盤 | テナント・会社分離、会社/拠点/店舗・本人ごとの権限、監査履歴、楽観ロック、採番、添付 |
| 会計・商取引 | 売上/仕入請求、仕訳、消込、売掛/買掛残高、期間締め、取消・改訂 |
| 商流・受発注 | JPYの物品見積・受発注、分納・分割請求、明細残数、原資料と一体の取消 |
| 銀行連携の準備 | UTF-8明細CSVの事前確認・取込、照合候補と確認消込、振込内容の確認と全銀120バイト/CSV出力 |
| 申告準備 | HOT010 Ver.3.0の一般商工業BS/PL、2026年給与の独自確認資料、原資料の固定・別担当確認・再作成 |
| 在庫・契約 | 入出庫、棚卸、移動平均の在庫評価、契約・請求予定 |
| 店舗運営 | 営業計画/目標、日次報告、未提出管理、店長承認/差戻し、本部確定 |
| BI・レポート | 目標・前期間比較、店舗比較、現金差異、入金残高、根拠伝票へのリンク、再認可してCSV出力 |
| 従業員・本部 | スマホ打刻、勤怠訂正・承認、有給付与/申請/残高、経費・領収書・精算、給与計算と本人明細 |
| 社員・シフト | 社員検索・勤務条件、スマホ勤務希望、ブラウザー内推薦、手修正・固定、欠員説明、下書き・確認公開・改訂 |
| 認証・本人確認 | OIDC SSOの明示紐付け、TOTP/使い捨て回復コード、招待/再設定メール、暗号化outboxとTLS SMTP配送 |
| POS・企業運営 | Square署名Webhookの決済仮勘定転記、JPYの管理用連結精算表、契約と確認売上に基づくFC請求/支払 |
| 給与・勤務制度 | 2026年月額甲欄の税/保険自動算定、本人申告と年末調整、通常/1か月変形/1〜3か月フレックス |
| 店舗機器連携 | 店舗から外向きWSS/HTTPS、拠点限定中継、IPPテキスト印刷、模擬釣銭、結果不明時の実機確認 |
| エッジ端末セットアップ | Windows/Linux/macOS常駐サービス、Node同梱、専用アカウント、計画表示・更新再開・データ保持削除 |
| クラウド・オンプレ | Linux共通配布物、同一オリジンWeb/API、Caddy/systemd構成生成、起動準備確認、設定/データ分離 |
| 導入・更新 | 対象の事前点検、計画表示、バックアップの別DB実復元、移行、資格情報を上書きしない再開 |

業界テンプレートは **15種類** です。小売、不動産賃貸、電器店、農家、飲食店チェーン、卸売、製造、建設、物流、宿泊、診療所、介護、教育、専門サービス、美容を用意しています。会社を分けて適用し、サンプル業務から請求や入金へつなげて試せます。[業種別の範囲と固有項目](docs/domain/industry-catalog.md) を参照してください。診療・介護の制度請求など、各業種の全機能を網羅するものではありません。

従業員向けの「自分の勤怠・申請」と、本部・拠点向けの管理画面を分けています。給与は従来の外部確認控除と、2026年の国内JPY・月額甲欄を対象とする税/保険自動算定を区別します。自動算定も標準報酬決定通知、扶養申告、加入/免除、住民税通知等の確認が必要で、未確認を0円で補いません。年末調整と勤務制度の手順・対象外は [給与と勤務制度の操作](docs/manual/appendix-i-fiscal-and-work-systems.md) を参照してください。

シフト推薦は拠点別の週次計画をブラウザー内で計算します。勤務希望・スキル・時間上限・休暇を確認し、欠員を減らして目標時間への偏りを調整します。外部AIサービスや追加ソルバーは不要です。[シフトの操作ガイド](docs/operations/shift-planning.md) に準備と対応範囲をまとめています。

商流・銀行・申告準備は [付録L](docs/manual/appendix-l-commerce-bank-filing.md) から試せます。銀行ファイルの出力では送金・入出金伝票を作成しません。財務諸表は限定した公式取込形式、給与は公式取込できない確認資料です。実銀行API接続、送金、電子申告・納税は行いません。

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

[クラウド・オンプレ共通配備](docs/operations/deployment.md) で固定依存を含む配布物とCaddy/systemd構成を生成できます。Linuxの単一API構成を対象とし、OS/TLSの導入、監視、バックアップ運用は導入先で確認します。店舗LANの機器接続は [機器の操作](docs/manual/appendix-j-store-devices.md) と [中継の設置](docs/operations/edge-agent.md) を参照してください。ソースをGitHubへ公開しても、アプリや業務DBが自動で公開されることはありません。

AWSで既存システムからリソースを分けて試す場合は、[AWS試用の運用手順](docs/operations/aws-trial.md) と [CloudFormationの入口](deploy/aws/README.md) を参照してください。専用VPC・VM・DB・IAM・保存先と別FQDNを使い、ゲーム等の既存Terraform stateへ追加しない構成です。実際の接続先と秘密は公開リポジトリへ含めません。

ログイン後はメニューの「自分のアカウント」から、本人のパスワード変更と全端末ログアウトを行えます。会社未所属でも利用できます。[基本の本人設定](docs/operations/account-security.md) を参照してください。SSO・MFA・招待/再設定メールを導入する場合は [認証とメールの設定](docs/operations/enterprise-identity.md)、Squareと企業運営は [導入・操作ガイド](docs/manual/appendix-h-enterprise-operations.md) を追加で確認します。外部IdP・Squareの実利用者/実加盟店への接続は未検証です。

## 開発と検証

```bash
pnpm gate                          # 型、lint、依存境界、単体、DB試験、配布回帰、文書リンク
pnpm --filter @daifuku/web test
pnpm --filter @daifuku/web typecheck
pnpm --filter @daifuku/web build
```

ブラウザー試験は [専用の空DBから再現する手順](CONTRIBUTING.md#ブラウザ試験を新規環境で再現する) を使います。業界テンプレートの適用を先行する順序も設定済みです。認証のブラウザー試験は別の空DBと合成IdP/TLS SMTPを使う `pnpm test:identity:e2e` で実行します（[手順](CONTRIBUTING.md#認証ブラウザ試験)）。

DB試験は `TEST_DATABASE_URL_OWNER` / `TEST_DATABASE_URL` の専用DBを初期化します。UIや業務用DBと共用しないでください。導入・復元の実受入は [専用clusterでのセットアップ検証](docs/operations/setup.md#5-セットアップ自身の受入を再現する) を参照してください。CIの実行結果は [Actions](https://github.com/adokoy001/DaifukuERP/actions) で確認できます。

## 構造と文書

```text
apps/                 API・Web・MCP・店舗中継・共通runtime
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
- [企業向け認証・POS・連結・FC](docs/manual/appendix-h-enterprise-operations.md) / [給与・年調・勤務制度](docs/manual/appendix-i-fiscal-and-work-systems.md)
- [商流・銀行・申告準備の操作](docs/manual/appendix-l-commerce-bank-filing.md) / [設計とプログラム構造](docs/architecture/commerce-finance.md)
- [店舗機器の操作](docs/manual/appendix-j-store-devices.md) / [中継エージェント](docs/operations/edge-agent.md) / [クラウド・オンプレ配備](docs/operations/deployment.md)
- [Windows・Linux・macOSのエッジサービス導入](docs/manual/edge-service-setup.md) / [設計・プログラム構造](docs/architecture/edge-services.md)
- [業界テンプレートガイド](docs/manual/appendix-d-industry-templates.md)
- [設計判断](docs/adr/) / [仕様と受入基準](docs/specs/) / [実装規約](docs/conventions/)
- [品質改善計画](docs/quality-roadmap.md) / [本人のアカウント管理](docs/operations/account-security.md)
- [貢献方法](CONTRIBUTING.md) / [セキュリティ報告](SECURITY.md)

## 現在の境界

全業界・全制度を網羅するものではありません。SSOは明示紐付け、MFAは個人単位、Squareは決済/返金の仮勘定転記、連結はJPYの管理用精算表、FCは同一会社の請求/支払という範囲です。POS商品/在庫の自動連携、法定連結開示、多通貨、賞与/乙欄/非居住者給与、行政・銀行への送信、1年変形/裁量勤務、自由SQLの外部BI/定期配信は対象外です。勤務制度は開始前に確認・確定し、日跨ぎ勤務の給与自動計算は引き続き拒否します。

プリンター初版はIPPのテキスト印刷、自動釣銭機はシミュレーターです。実釣銭機、USB/シリアル、ESC/POS、機器と会計の自動連動、HA/マルチリージョンは未対応です。

商流は物品・税抜単価・固定在庫単位の範囲です。入荷時の未請求債務や原価差額配賦、返品専用工程は含みません。銀行CSVは指定形式への整形が必要で、自動確定消込や銀行ごとの実受入は未対応です。申告準備は法人税申告書全体や法定納付税額を作らず、BS/PL以外の財務諸表・給与の公式375/eLTAX形式も含みません。

外部providerの本番受入、負荷容量、運用監視、証憑の適格性は導入先で確認します。合成IdPとTLS SMTP、署名付き合成Square通知による試験を実接続の証明とは扱いません。詳細は [現在地](docs/STATUS.md) と [制限事項](docs/manual/10-limitations.md) にまとめています。

公開初回は点検済みのソース一式から履歴を開始しています。元のローカル開発履歴に含まれた私的なセッション参照は公開していません。

AI支援で開発しています。自動試験とコードレビューを行いますが、実務の業務審査や独立したセキュリティ評価を代替しません。

## ライセンス

[MIT License](LICENSE) — Copyright (c) 2026 adokoy001。第三者依存物はそれぞれのライセンスに従います。[第三者のライセンス・帰属](THIRD_PARTY_NOTICES.md) を参照してください。
