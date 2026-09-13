# Spec: AWS の独立した試用環境

- 状態: implemented（ローカル gate、AWS 導入・境界・限定復元・再起動・ブラウザ受入済み。CI と将来の timer 発火は未確認）
- 対象: 配備・運用文書、公開 CloudFormation template・境界回帰、私有の配備設定と運用資材
- 依存: [共通配備](deployment-edge.md)、[安全なセットアップ](safe-setup.md)、[企業認証](enterprise-identity.md)
- 作成: 2026-09-13 ／ 作成者: Codex

## 目的

既存ゲームの AWS リソースと管理状態を変更せず、DaifukuERP をインターネットから利用できる専用の試用環境へ導入する。既存の検証済み配布・setup・認証・権限管理を使い、公開 HTTPS、管理者ログイン、保存、再起動、バックアップと復元までを実測する。単一ホストの試用環境であり、本番業務の可用性や容量を保証する構成とはしない。

## 構成

| 項目 | 今回の構成 |
| --- | --- |
| 管理単位 | 新規 CloudFormation stack `daifuku-trial`。既存ゲームの Terraform state を使わない |
| Region | 東京 `ap-northeast-1` |
| ネットワーク | 専用 VPC `10.77.0.0/16`、subnet `10.77.1.0/24`、専用 route・Internet Gateway・Security Group。NAT Gateway・ALB・既存 VPC/SG の再利用なし |
| VM | EC2 `t3.small`、x86_64、Ubuntu 24.04。CPU credit は `standard`、IMDSv2 必須、API による意図しない終了を保護 |
| 永続領域 | 暗号化 EBS、30 GiB、gp3。容量・空き容量の監視を別途設定 |
| 公開入口 | 専用 Elastic IP と新規 DNS record。公開文書の例は `erp.example.jp` |
| 受信 | Caddy の TCP 80/443 のみ。22、API 3000、PostgreSQL 5432 を公開しない |
| ホスト内部 | Node.js 22.23.2、PostgreSQL 16.15 の loopback 接続、Caddy 2.11.4、systemd による API 常駐。hash を固定した配布 commit `69e5846` |
| 管理接続 | SSM Session Manager と専用 instance role。SSH service/socket 停止。API/Caddy の実行主体から metadata へのアクセスを OS 側で拒否 |
| 配布・保全 | 非公開・暗号化・versioning 有効の専用 S3。`releases/` はホストから Get のみ、`backups/` は Put/AbortMultipartUpload のみ。backup の現行/旧版は14日 lifecycle、bucket は Retain |
| 期限・定期保全 | 7日試用の一回限りの systemd 停止期限と、毎日 JST 04:00＋最大5分の遅延で実行する backup timer を設定済み。backup service の手動起動成功を実測。将来の時刻どおりの発火は未確認 |
| 秘密 | 保護された運用ファイル・私有の秘密保管先。公開 repository、CloudFormation/UserData、コマンド引数・出力へ値を書かない |

AMI ID、実 DNS、AWS account、resource ID、bucket 名、操作用 profile、具体的な秘密保管先は私有 runbook にのみ記録する。[公開 template の操作入口](../../deploy/aws/README.md) は infrastructure 16資源を扱う。UserData は含まず、OS hardening、アプリ導入、期限・backup timer は別の運用処理である。

## 受入基準（EARS）

- **AC-1 独立性**: WHEN 導入を計画・実行する THE SYSTEM SHALL 新規 stack の対象一覧を照合し、既存ゲームのリソース・Terraform state・DNS record を変更しない。IF 新規 DNS 名または stack 名が既存の管理対象と衝突する THEN THE SYSTEM SHALL 上書き・自動採用をせず停止する。DNS は新しい record だけを追加し、zone の委譲や既存 record を変更しない。
- **AC-2 外部境界**: WHEN AWS 環境を作成する THE SYSTEM SHALL 計画の専用 VPC、暗号化 volume、EC2、EIP を使用し、外部受信を TCP 80/443 に限定する。WHILE API と DB が稼働する THE SYSTEM SHALL それぞれ loopback に bind し、SSH port を開けず SSM から管理できる。
- **AC-3 AWS 権限と秘密**: WHEN ホストへ AWS 権限を付与する THE SYSTEM SHALL 長期 access key を配置せず、SSM と対象 S3 の必要な操作に限定した instance role と IMDSv2 を使う。SSM managed policy に含まれる Parameter Store 読取を明示拒否し、instance は他 S3 と自身の backup の Get を許可しない。API/Caddy の実行主体から metadata へのアクセスも拒否する。WHEN release/backup を S3 に保存する THE SYSTEM SHALL Block Public Access と保存時暗号化を有効にし、公開 ACL/公開 policy を使わない。秘密・初回資格情報を UserData、公開成果物、SSM の command 本文・出力、アクセスログへ保存しない。
- **AC-4 固定配布と導入**: WHEN ERP を導入する THE SYSTEM SHALL レビュー済み commit の同一 architecture 用 bundle を、別途確認した manifest/archive hash と照合してから展開し、ホスト上で依存を再解決しない。既存 setup の plan、対象照合、停止確認、専用空 DB への実復元、migration、初回管理者の契約を維持し、demo 資格情報を使わない。
- **AC-5 認証設定**: WHEN `PUBLIC_WEB_URL` を設定する THE SYSTEM SHALL パスを含まない公開 HTTPS origin と、JWT とは別の32バイト乱数を標準 Base64 にした `IDENTITY_ENCRYPTION_KEY` を同時に設定する。IF URL または鍵が不正・欠落する THEN THE SYSTEM SHALL API 起動を拒否する。秘密は所有者限定の runtime.env で保護し、更新・復元時に既存の鍵を維持する。
- **AC-6 公開経路**: WHEN DNS と Caddy を構成する THE SYSTEM SHALL 信頼できる公開証明書を使い、Web と `/api` を同一 origin で提供する。HTTPS 証明書検証、SPA の深い URL、`/api/health` と `/api/ready`、未認証 API 拒否、ログイン・会社選択・添付の保存と取得を実確認する。CORS wildcard や TLS 検証の無効化で接続失敗を回避しない。
- **AC-7 常駐と保存**: WHEN サービスとホストを再起動する THE SYSTEM SHALL systemd で通常起動を回復し、同じ DB・添付・認証鍵を使う。再起動後に readiness、ログイン、保存済みデータを再確認し、API を root で常駐させない。Node と release は稼働ユーザーが書き換えられない所有・権限にする。
- **AC-8 バックアップと復元**: WHEN 試用データを保全する THE SYSTEM SHALL DB、添付、runtime.env と認証鍵、DB role の復旧情報、配布版の対応を記録する。DB dump だけを完全 backup と呼ばない。WHEN 復旧を確認する THE SYSTEM SHALL 稼働 DB を上書きせず専用の新規 DB に復元し、元の版・必要な RLS/grant・資料件数・添付との対応を確認する。S3 への保存・再取得の照合と実復元は別の検査として記録する。
- **AC-9 更新と撤収**: WHEN 更新または試用終了を計画する THE SYSTEM SHALL 対象 stack・新 DNS record・保全先・データ保持・残る課金資源を私有 runbook で照合する。7日試用の一回限りの停止期限を設定し、CPU credit は `standard` を使う。migration 後に古いコードだけを起動する巻戻しや、既存ゲームを巻き込む削除を行わない。期限停止と stack 削除を区別し、終了手順の記載や timer 設定を期限発火・環境削除の実測としない。
- **AC-10 実測と公開情報**: WHEN 結果を報告する THE SYSTEM SHALL 実行日・配布 commit・検査項目・成功/失敗/未検証・単一ホストの制約を区別し、public log に account ID、実 DNS、resource ID、秘密、個人情報を載せない。料金は無償と仮定せず、使用前の見積と停止後に残る資源を私有 runbook に記録する。

## 関係するファイル・インターフェース

- [AWS 試用の運用手順](../operations/aws-trial.md): 公開版の操作順・確認事項・未検証範囲。
- [共通配備手順](../operations/deployment.md): bundle 検査、setup、認証設定、systemd/Caddy。
- [認証設定](../../apps/api/src/identity/config.ts)、[鍵の形式検査](../../kernel/src/identity/crypto.ts): 公開 origin と32バイト Base64 鍵の実装契約。
- [配布作成](../../scripts/build-release.mjs)、[配布検査](../../scripts/verify-release.mjs)、[配備計画](../../scripts/deploy-plan.mjs)。
- [setup CLI](../../apps/api/src/setup/cli.ts)、[復元確認](../../apps/api/src/setup/backup.ts)、[readiness](../../apps/api/src/deployment/readiness.ts)。
- [CloudFormation の操作入口](../../deploy/aws/README.md)、[template](../../deploy/aws/trial.cloudformation.json)、[境界回帰](../../deploy/aws/trial.test.mjs)。実際の parameter・ホスト構築資材・秘密・AWS 生出力は運用管理者が私有領域に保管する。
- [作業記録](../log/2026-09-13-aws-trial.md): 実測結果、発見した運用上の問題、未検証範囲。

## 検証計画と現在の状態

2026-09-13 の実測を以下に記録する。AWS 操作担当の保存証跡と独立ブラウザ受入の結果を区別し、AWS API の生出力、資格情報、record ID は私有領域に留める。

| 検査 ID | 対応 | 方法 | 現在 |
| --- | --- | --- | --- |
| AWS-TRIAL-AC-1 | AC-1 | AWS template 検証、change set、作成後と既存対象の比較 | PASS。初期16資源すべて Add、CREATE_COMPLETE。後続は ArtifactsPolicy の保持属性2件だけ、Replacement=False で UPDATE_COMPLETE、取得 template 一致。既存 VPC/EC2/RDS/CloudFront/Lambda の比較 summary 一致、既存 DNS 11 record 完全一致＋新 A のみ。ゲームトップの byte hash 一致、health200 |
| AWS-TRIAL-AC-2 | AC-2/3 | SG・volume・metadata・IAM/S3 設定、SSM とホスト listener | PASS。SSM online、80/443、DB/API loopback、SSH service/socket 停止、IMDSv2、API/Caddy から metadata 拒否。IAM simulator で Parameter 読取・他 S3・自身 backup Get 拒否、release Get/backup Put 許可。S3 非公開・暗号化 |
| AWS-TRIAL-AC-4 | AC-4 | bundle 検査と setup/migration/初回管理者 | 固定 bundle `69e5846` の導入 PASS。運用データを含む backup/限定復元は AC-8 に記録 |
| AWS-TRIAL-AC-5 | AC-5 | 非公開 env で API 起動と UI ログイン | PASS。origin/key の同時設定を実装と照合。負の config は既存回帰の範囲であり、この実環境に不正設定を投入してはいない |
| AWS-TRIAL-AC-6 | AC-6 | 外部 HTTPS とブラウザ操作15項目 | PASS。health/ready200、未認証401、ログイン・会社選択、UI 取引先作成、合成添付の保存/取得 hash・size 一致。390px の9画面で横はみ出し・pageerror・HTTP5xx なし |
| AWS-TRIAL-AC-7 | AC-7 | service 再起動と EC2 再起動後に起動・保存状態を再確認 | PASS。API/Caddy の停止・開始、EC2 の新 boot ID と API/Caddy/PostgreSQL の自動起動を確認。HTTPS 回復後、新規ログイン・保存済み取引先・添付 hash・390px の9画面を含む13項目 PASS |
| AWS-TRIAL-AC-8 | AC-8 | 私有 S3 への backup 保存/再取得の hash 照合、別 DB への復元、資料・設定の対応確認 | 限定範囲 PASS。202,565 bytes の backup を S3 保存し operator 再取得 SHA256 一致。新規復元 DB の131 table 件数・owner/ACL/RLS policy、runtime.env/evidence/TLS ファイルの hash・所有権一致、元 DB 不変を確認。backup service 手動起動も成功 |
| AWS-TRIAL-AC-9 | AC-9/10 | 期限・費用と撤収手順 | 7日期限の一回停止と日次 backup timer を設定済み。手動 backup service は Result=success、ExecMainStatus=0。価格試算・停止/削除の区別を運用手順に記録。予定時刻の発火・撤収は未実施 |

公開 template の5境界回帰は `pnpm test:deploy` に含む。参照/parameter の独立性、受信・network、暗号化/IMDS/CPU credit、SSM/S3 権限、S3 保全条件を検査し、実 AWS の到達性の検査とは区別する。文書は `pnpm docs:check` と `git diff --check`、完了を主張する際は既存規約の `pnpm gate` の結果も記録する。

2026-09-13 のローカル gate は unit819件、DB639件、deploy13件、文書91件/参照858件、assurance13件 PASS。API/Web の型検査、Web/edge build も PASS。CI はこれから実行する。公開アプリの配布版 `69e5846` は運用検証中も変更していない。

復元は同一ホスト内の新規 DB に限り、全 row の値比較と別ホストへの完全復旧は未実測。`roles.sql` は保存のみで再実行していない。日次 timer の将来発火・長期継続、7日期限の自動停止も未実測で、backup 失敗のメール通知は未設定。手動 service 成功をこれらの保証に置き換えない。

ブラウザ受入は core seed だけの専用 DB と合成資料を使用し、業界テンプレートを自動適用していない。初回15項目と再起動後13項目が PASS。シフト画面の hero は淡色背景に白い文字が残り、低コントラストの視覚課題を確認した。機能検査の PASS は全画面・全操作の視覚品質保証ではない。

## スコープ外

- 本番業務データの移入、ゲーム環境の整理・更新・停止、既存 Terraform への resource import。
- RDS、Multi-AZ、load balancer、autoscaling、HA、無停止更新、性能・同時接続数の保証。
- 実メール/SSO provider、銀行・税務への送信、実店舗機器の接続。未設定の機能を設定済みと表示・報告しない。
- 無人の全自動運用や秘密 rotation、backup からの自動切替・自動削除。
- 撤収操作の実行。試用終了時に保持対象を照合したうえで別途行う。

## 根拠と未決事項

2026-09-13 に以下の公式資料と上記 repository の実装を確認した。再導入時は AWS 資源の状態・可用性・料金を再照合する。

- [AWS Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html): 受信管理 port を開けない管理経路。
- [EC2 metadata/user data](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-metadata.html): UserData に長期の秘密を格納しない。
- [S3 Block Public Access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html): bucket/object の公開を制限する。
- [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https): 公開 DNS・到達性と証明書発行/更新の条件。

月730時間の基本料金は約 USD 26.39、EC2 停止後に EBS/EIP を保持した場合は月換算 USD 6.53 と S3 等が残る。算定条件・公式料金へのリンクは [運用手順](../operations/aws-trial.md#費用と試用期限) に記録する。日次 backup は設定・手動 service 成功まで確認し、実際の停止日時と保全証跡は私有 runbook で管理する。失敗通知先の設定と長期運用の観測は残っている。
