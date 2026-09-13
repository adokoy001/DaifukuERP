# AWS 試用環境の運用手順

更新日: 2026-09-13。対応仕様: [aws-trial](../specs/aws-trial.md)。AWS の専用基盤、公開 HTTPS、ログインと合成資料の保存・取得、S3 バックアップの再取得、別 DB への限定復元、サービス/ホスト再起動後の再確認まで実測済みです。別ホストへの完全復旧と将来の timer 発火は未実測です。単一 VM の試用環境であり、本番の可用性・容量を保証しません。

公開文書の `erp.example.jp`、path、DB 名は説明用です。AWS account、実 DNS、resource ID、bucket 名、AMI、接続先、秘密保管先、実際の CLI 引数と証跡は私有 runbook で管理します。[CloudFormation の操作入口](../../deploy/aws/README.md) に私有 parameter file、既存名の拒否、change set と outputs の照合方法を記載しています。

## 1. 変更範囲と事前記録

東京 `ap-northeast-1` に新規 stack `daifuku-trial` を作成し、専用 VPC `10.77.0.0/16`、subnet `10.77.1.0/24`、route、Internet Gateway、Security Group、EC2、暗号化 EBS、Elastic IP と非公開 S3 を管理します。VM は `t3.small`、x86_64、Ubuntu 24.04、30 GiB gp3 です。NAT Gateway・ALB は作りません。

既存ゲームの Terraform state、VPC、VM、SG、配布先、DNS record は変更しません。新規 DNS record は template の `TrialDNS` が作成するため、手作業で同じ record を二重に追加しません。名前が既に存在する場合は種類を問わず停止し、上書き・既存 record の削除を行いません。

実行前に、既存の operator 実行文脈で対象を照合し、私有 runbook へ記録します。これは新たな管理権限の付与を求める手順ではありません。

- AWS の実行 principal・account・region、stack 名、対象となる未使用 DNS 名。
- 作成対象一覧、AMI の発行元・Ubuntu 版・architecture、専用 IAM role の権限。
- 既存ゲームの構成・稼働状態と DNS record の比較用情報。既存 Terraform は plan/apply/import を実行しない。
- レビューした配布 commit、Node/pnpm 版、archive と manifest の SHA256、配布取得先。
- 試用の終了予定、予算、EC2/EBS/Elastic IP/S3/通信等の費用項目。無料枠への該当を仮定しない。
- backup 頻度・保持期限・通知先と、実際の復元確認先。未確定なら自動保全があると扱わない。

CloudFormation の CREATE change set を読み、この版の16資源がすべて Add で、既存資源の変更や取り込みがないことを確認します。作成後は stack 名と outputs を同じ stack の実資源と照合してから SSM target を選びます。公開 repository へ実 account/resource の一覧を貼り付けません。

## 費用と試用期限

2026-09-13 に確認した東京・Linux On-Demand、月730時間、30 GiB gp3、公開 IPv4 1個の試算です。USD、税・為替・割引・無料枠を含めません。

| 項目 | 単価と計算 | 月換算 |
| --- | --- | --- |
| EC2 `t3.small` | USD 0.0272/時 × 730 | USD 19.856 |
| EBS gp3 容量 | USD 0.096/GB-month × 30 | USD 2.88 |
| 公開 IPv4 | USD 0.005/時 × 730 | USD 3.65 |
| 基本分合計 | 上記を合計し小数第2位へ丸める | **約 USD 26.39** |
| EC2 停止後に EBS/EIP を保持 | EBS と公開 IPv4 のみの月換算 | **USD 6.53** |

EC2/gp3 の単価は [AWS 東京 Linux 料金データ](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/Asia%20Pacific%20%28Tokyo%29/Linux/index.json) と [AWS EBS 料金データ](https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ebs.json)（EBS データの公開日2026-09-10）、公開 IPv4 は [VPC 料金](https://aws.amazon.com/vpc/pricing/) に基づきます。再利用時は [EC2](https://aws.amazon.com/ec2/pricing/on-demand/)・[EBS](https://aws.amazon.com/ebs/pricing/) の現行料金を再確認してください。

[S3 の容量・リクエスト](https://aws.amazon.com/s3/pricing/)、通信、DNS query、必要に応じた snapshot/監視等は別途です。基本分を請求総額や上限とは扱いません。CPU credit は [standard mode](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-performance-instances-standard-mode.html) とし、Unlimited の余剰 credit 追加課金を避けます。credit 枯渇時の性能低下は許容する試用構成です。

ホストには7日試用の一回限りの systemd 停止期限を設定済みです。実際の期限は私有 runbook に保管し、期限発火はまだ実測していません。期限は EC2 の停止を意図し、stack/S3/volume の自動削除ではありません。停止後の残課金と再開の扱いを別途確認します。

## 2. AWS とホストの境界を確認する

SG の受信は Caddy の TCP 80/443 に限り、SSH 22、API 3000、PostgreSQL 5432 は公開しません。管理には [SSM Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html) を使います。SSM Agent、instance role、AWS endpoint への外向き到達性を確認し、管理接続が確立しない状態で公開アプリ導入へ進めないでください。

IMDSv2 を必須とし、instance role は SSM と対象 S3 の必要な操作に限定します。SSM managed policy に含まれる Parameter Store 読取を明示拒否し、他 S3 も許可しません。instance は自身の `releases/` の Get、`backups/` の Put/AbortMultipartUpload が可能で、backup の Get は不可です。API/Caddy の実行主体から metadata endpoint への通信も OS 側で拒否します。EC2 内へ AWS の長期 access key を置きません。

S3 は Block Public Access、BucketOwnerEnforced、SSE-S3 暗号化、versioning を有効にし、非 TLS のアクセスを拒否します。`backups/` の現行 object と旧版にはそれぞれ14日の lifecycle があり、bucket 自体は stack 削除時にも Retain します。公開 download URL や公開 ACL は使いません。versioning は誤上書きへの備えであり、改竄不能な保管の保証ではありません。

OS を初期構成し、以下を検査します。

- 今回の実測版は PostgreSQL 16.15 と同じ major の `pg_dump`/`pg_restore`、Node.js 22.23.2、Caddy 2.11.4。systemd、SSM Agent も確認する。
- PostgreSQL の listener と接続規則が localhost に限られ、外部へ開かれていないこと。
- API 用の非 root 専用ユーザー、所有者限定の state0700/env0600、root 管理の Node/release、SSH service/socket の停止。
- volume 暗号化、必要な空き容量、ホスト時刻、OS セキュリティ更新の運用。
- UserData、shell 履歴、SSM command 本文・標準出力、cloud-init log に DB password/JWT/認証鍵を含めないこと。

秘密はホスト内の安全な生成処理または保護された秘密管理経路で扱います。SSM を使うこと自体が command 本文や出力の秘密保護を保証するわけではありません。[AWS は UserData に長期の秘密を保存しないよう明記しています](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-metadata.html)。

## 3. 検証済み配布と専用 DB を導入する

[共通配備手順](deployment.md) の bundle 検査・展開を行い、ホスト上では依存を再解決しません。今回は commit `69e5846` の hash を固定した bundle を配置しました。配布版の完全な commit と artifact hash は私有 runbook に保存します。Node と release は専用サービスユーザーから書換不可とし、DB、添付、秘密設定を release ディレクトリに入れません。

PostgreSQL 管理者が専用の owner/app role、稼働 DB、別の未使用 restore 確認 DB を用意します。role 条件、URL、秘密ファイル、`setup install` の plan → 対象照合 → 明示 execute は [安全なセットアップ](setup.md) に従います。demo の管理者や password を使いません。

setup は DB と role を自動作成・削除しません。稼働 writer がある場合は停止し、dump と専用 DB への復元確認が成功してから migration/初回管理者を作ります。失敗時は state/backup を保持して原因を確認し、既存 DB を reset してやり直さないでください。

`setup-source.env`、生成後の `runtime.env`、初回管理者の資格情報は私有ファイルだけで扱います。初回管理者への資格情報の受渡しも公開ログや repository を経由しません。

## 4. 認証と同一 origin を設定する

setup が保存した `runtime.env` の DB URL と JWT を保持したうえで、[共通配備の設定](deployment.md#2-db-と私有設定を用意する)に従って設定します。

| 設定 | 試用環境での意味 |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` / `PORT` | `127.0.0.1` / `3000` |
| `TRUSTED_PROXY_CIDRS` | この構成では `127.0.0.1/32` の Caddy のみ |
| `DAIFUKU_STORAGE_DIR` | サービスユーザー所有の専用 evidence directory |
| `PUBLIC_WEB_URL` | 公開 HTTPS origin（例 `https://erp.example.jp`）。`/api` や path/query を付けない |
| `IDENTITY_ENCRYPTION_KEY` | JWT と別の暗号学的乱数32バイトを標準 Base64 にした秘密。URL と同時に必須 |

`PUBLIC_WEB_URL` だけを設定すると API は認証 config 不正として起動を拒否します。暗号鍵は MFA 等の暗号化データに使われるため、更新や復元のたびに生成し直しません。DB と対応する鍵を保護して保全します。SMTP/OIDC を使う場合は追加設定と実受入が必要です。未設定のメール送信や SSO を利用可能としないでください。[認証運用](enterprise-identity.md)

Web は既存 build の `/api` を使います。秘密を `VITE_*` へ入れず、Caddy の `handle_path /api/*` で API に中継します。別 proxy を追加して `TRUSTED_PROXY_CIDRS` を広げる構成は今回の計画外です。

## 5. DNS、TLS、常駐サービスを受け入れる

所有する zone の新規 record だけを専用 EIP に向け、既存 record の非変更と名前解決を確認します。[共通配備](deployment.md) の cloud profile を生成・レビューし、`systemd-analyze verify` と `caddy validate` を通してから管理者が配置します。

公開 FQDN と Caddy の [Automatic HTTPS の条件](https://caddyserver.com/docs/automatic-https)を照合し、証明書の名前・chain・期限と HTTP→HTTPS を外部から確認します。疎通を優先して `--insecure` 等で検証を外さないでください。Caddy access log、外部監視、SSM の診断出力に token や callback query を保存しません。

AWS 上で実行する受入を以下へ記録します。実 DNS、利用者名、token を公開の記録に含めません。

| 検査 | 期待結果 | 状態 |
| --- | --- | --- |
| AWS-TRIAL-AC-1: 変更対象 | 新 stack と新 DNS record だけ | PASS。初期16資源全 Add/CREATE_COMPLETE。後続は ArtifactsPolicy の保持属性2件だけを置換なしで更新し UPDATE_COMPLETE、取得 template 一致。既存ゲーム VPC/EC2/RDS/CloudFront/Lambda の比較 summary 一致。既存 DNS 11 record 完全一致＋新 A のみ、ゲームトップ hash 同一・health200 |
| AWS-TRIAL-AC-2: 管理・受信 | SSM、80/443、API/DB loopback、IMDSv2・暗号化 | PASS。SSM online、SSH service/socket 停止、API/Caddy から metadata 拒否 |
| AWS-TRIAL-AC-3: IAM/S3 | Parameter/他 S3/backup Get 拒否、release Get/backup Put 許可 | IAM simulator PASS。S3 非公開・暗号化・versioning 設定を実確認 |
| AWS-TRIAL-AC-4: 導入 | hash 照合、setup、migration、初回管理者 | 固定 bundle `69e5846` の導入 PASS。運用データを含む限定復元は AC-8 に記録 |
| AWS-TRIAL-AC-5: 認証 config | 正しい origin/key で起動。秘密を出力しない | PASS。実 API 起動と UI ログイン |
| AWS-TRIAL-AC-6: 公開経路 | HTTPS、SPA、health/ready200、未認証拒否 | PASS。証明書検証を維持し未認証 API は401 |
| AWS-TRIAL-AC-6: 操作 | UI ログイン・会社・取引先、正規 API で添付往復 | 15項目 PASS。合成取引先と添付各1件、hash/size 一致、390px の9画面で横はみ出し・pageerror・HTTP5xx なし |
| AWS-TRIAL-AC-7: 再起動 | service と EC2 再起動後に自動起動・ログイン・保存内容を確認 | PASS。API/Caddy 停止・開始、EC2 新 boot ID、API/Caddy/PostgreSQL 自動起動、HTTPS 回復を確認。新規ログイン・保存済み取引先/添付 hash・スマホ9画面など13項目 PASS |
| AWS-TRIAL-AC-8: 保全 | S3 保存/再取得一致、専用 DB の実復元、添付・設定との対応 | 限定範囲 PASS。202,565 bytes の S3 再取得 SHA256 一致、新規 DB の131 table 件数と owner/ACL/RLS policy、設定/添付/TLS ファイルの hash・所有権、元 DB 不変を確認。backup service 手動起動も成功 |

`/api/health` は process の生存、`/api/ready` は DB/schema/storage の確認です。200 だけで全業務や backup の正常性を判断しません。単一 VM 上に API と DB を配置するため、ホスト障害や保守では試用を停止します。

検証時のホストは約2 GiB、使用量は約633 MiB、available は約1,272 MiB、API の観測メモリは303,927,296 bytes、root disk の空きは約23 GB でした。一時点の少量データでの観測であり、負荷試験や同時利用人数の保証ではありません。

ブラウザ受入の証跡・再確認用 metadata は私有保存し、資格情報や token を stdout、trace、スクリーンショットに含めていません。業界テンプレートは自動適用せず、core seed と合成資料を使っています。表示上の既知課題として、シフト画面の hero に低コントラストの文字を確認しています。初回15項目・再起動後13項目の機能 PASS と区別します。

## 6. バックアップ・更新・障害時の復元

DB custom-format dump、添付 evidence、runtime.env と認証鍵、role の復旧情報、対応 release/manifest を一組の復旧資料として管理します。DB dump に添付・OS・role・秘密設定は含まれません。backup の S3 key と hash、保存日時、取得・復元確認結果を私有 runbook に記録します。

S3 へ保存できたことと、復元可能であることを分けて検査します。instance 自身には backup の Get 権限がないため、既存 operator の正当な実行文脈で対象 backup を取得し、保護された経路で復元確認先へ渡します。復元のために instance role を全 bucket 読取へ広げません。稼働 DB を上書きせず、同じ PostgreSQL major の新しい専用 DB へ [setup の復元手順](setup.md#4-復元した-db-で回復を確認する)に従って復元します。資料件数・移行履歴・RLS/grant・添付との対応を確認し、復旧用接続先へ明示的に切り替えます。秘密の鍵を失った場合に新しい鍵だけを生成して復旧完了としません。

今回の実測では、202,565 bytes の backup を S3 へ保存し、operator が再取得した bytes の SHA256 一致を確認しました。同一ホスト上の新規 DB へ復元して131 table の件数・owner/ACL/RLS policy を照合し、runtime.env、evidence、TLS ファイルの hash・所有権と元 DB の不変を確認しました。稼働先の切替はしていません。`roles.sql` は復旧資料として保存しただけで再実行しておらず、全 row の値比較と別ホストへの完全復旧も未実測です。

更新は新 release で計画し、writer を停止して backup/restore 確認後に migration を行います。migration 後の DB に古い実行コードだけを戻す巻戻しは行いません。失敗時は旧資料を残して状態を確認し、元の版と新規 DB を使う復旧へ進みます。

日次 backup は毎日 JST 04:00、最大5分のランダム遅延で systemd timer に設定済みです。同じ handler の手動実行に加え、backup service の手動起動で `Result=success`、`ExecMainStatus=0` と完了記録を確認しました。終了後も API/Caddy/PostgreSQL と日次・期限停止の2 timer は active でした。時刻どおりの将来発火と長期継続は未実測で、backup 失敗のメール通知は未設定です。S3 の14日 lifecycle、手動実行成功、日次取得の継続は別の確認として扱います。

## 7. 試用の停止と終了

通常の service 停止、EC2 の停止、stack の削除を区別します。停止しても volume、Elastic IP、S3 等が残るため、費用と保持対象を確認します。削除前に backup の取得・復元、必要な秘密と利用者データの受渡し、保持期限を確認します。

終了時は私有 runbook の作成対象一覧と実資源を再照合し、この試用で作成した新 DNS record と専用 stack だけを対象とします。既存ゲームの Terraform に destroy を実行せず、共有 zone や未知の資源を削除しません。EC2 の termination protection は有効で、root volume は終了時に削除されます。撤収時は保全確認後、当該 instance の保護状態と必要な解除を照合します。S3 bucket は Retain のため、stack 削除後も所有・保全期限・残課金を管理します。**期限発火と終了操作は未実施です。**

## 根拠と検証の更新

2026-09-13 に repository の [認証 config](../../apps/api/src/identity/config.ts)、[鍵検査](../../kernel/src/identity/crypto.ts)、共通配備・setup とリンク先公式資料を読み合わせ、上表の AWS/ブラウザ実測を記録しました。[template の5境界回帰](../../deploy/aws/trial.test.mjs) は `pnpm test:deploy` に含まれます。ローカル gate は unit819件、DB639件、deploy13件、文書91件/参照858件、assurance13件 PASS。API/Web 型検査と Web/edge build も PASS し、CI は実行前です。

[作業記録](../log/2026-09-13-aws-trial.md) に運用時の修正と確認範囲を記録しています。失敗通知先の設定、将来の timer 発火、別ホストでの復旧等は、実際の結果を得てから仕様・運用手順・作業記録を更新します。
