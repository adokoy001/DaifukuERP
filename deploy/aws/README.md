# AWS 試用基盤の操作入口

[trial.cloudformation.json](trial.cloudformation.json) は東京向けの専用 VPC・EC2・S3・IAM と新規 DNS record を宣言する16資源の template です。[仕様](../../docs/specs/aws-trial.md) と [運用手順](../../docs/operations/aws-trial.md) を合わせて読みます。

2026-09-13 に AWS の template 検証、16資源すべて Add の change set、`CREATE_COMPLETE`、SSM・HTTPS・実ブラウザ受入を確認しました。S3往復、別DBで131表と権限・添付等を照合し、EC2再起動後の13項目も成功。後続の bucket policy 保持属性2件だけの更新も `UPDATE_COMPLETE` を確認しています。[実測記録](../../docs/log/2026-09-13-aws-trial.md) に範囲と未検証事項を記載しました。実 account、DNS、AMI、resource ID、秘密と AWS 生出力は私有領域だけで管理します。

## Template の範囲

- VPC `10.77.0.0/16`、subnet `10.77.1.0/24`、専用 routing/SG。TCP 80/443 の受信だけを許可し、NAT Gateway・ALB・peering は作りません。
- Ubuntu 24.04 amd64 用の指定 AMI、`t3.small`、CPU credit `standard`、暗号化30 GiB gp3、専用 EIP。IMDSv2 必須、SSH key の設定なし。
- SSM instance role。Parameter Store 読取を明示拒否し、専用 S3 の `releases/*` Get と `backups/*` Put/AbortMultipartUpload だけを追加で許可します。backup の取得権限は instance に与えません。
- 非公開・暗号化・versioning 有効の S3、TLS を使わない S3 操作の拒否、backup prefix の14日 lifecycle。bucket とTLS必須bucket policyは削除・置換時に Retain。
- 既存の公開 Hosted Zone に未使用名の A record を1件だけ作成します。zone の作成・委譲や既存 record の更新を行いません。

UserData はありません。Node/PostgreSQL/Caddy、秘密生成、API/Caddy からの metadata アクセス拒否、SSH service/socket 停止、アプリ導入、7日期限と日次 backup timer はホスト構成として別途実行・確認します。`CREATE_COMPLETE` だけでこれらが設定されたとは扱いません。

## 1. 既存 operator の実行対象を確かめる

既にこの導入で使用する operator の AWS 実行文脈を使います。以下の例は新たな管理権限を付与する手順ではありません。profile、region、対象 account、私有出力先を実行前に照合します。既存ゲームの Terraform state を使う plan/apply/import は行いません。

```bash
trial_profile='operator-profile'
trial_region='ap-northeast-1'
trial_private='/home/operator/private/aws-trial'
trial_stack='daifuku-trial'
trial_change='trial-create-reviewed'
umask 077
aws sts get-caller-identity --profile "$trial_profile" \
  > "$trial_private/caller-identity.json"
```

`trial_private` はあらかじめ用意した所有者限定の私有 directory です。公開 repository の中へ AWS の生出力を保存しません。失敗出力を無条件に無視せず、認可エラー・通信失敗・対象不存在を区別します。

## 2. 私有 parameter と作成前の状態を照合する

保護したエディターで `parameters.json` を私有 directory に作ります。以下は置換必須の例で、実際の AMI ID/zone ID/hostname は公開文書に追記しません。秘密の parameter はありません。

```json
[
  {"ParameterKey":"ImageId","ParameterValue":"REPLACE_WITH_VERIFIED_UBUNTU_AMI"},
  {"ParameterKey":"HostedZoneId","ParameterValue":"REPLACE_WITH_PUBLIC_ZONE_ID"},
  {"ParameterKey":"Hostname","ParameterValue":"erp.example.jp"}
]
```

1. AMI の発行元、Ubuntu 24.04、x86_64 と選択 region を確認します。
2. `describe-stacks` で同名 stack が未作成であることを確認します。既存 stack をこの新規作成手順で更新・採用しません。
3. `get-hosted-zone` で operator 管理の公開 zone であること、hostname がその zone に属することを確認します。
4. `list-resource-record-sets` の全ページを私有保存し、名前を小文字・末尾 dot に関して正規化して、**同じ hostname の既存 record が種類を問わずないこと**を確認します。既存名なら停止します。
5. 比較対象のゲーム構成、稼働状態、DNS を私有保存します。以後、DNS record を手で追加せず template の `TrialDNS` に任せます。

同一作業中の別 operator による DNS 変更もあり得ます。change set 実行直前に新規名の未使用を再確認し、競合した場合に UPSERT や既存 record の削除で進めません。

## 3. 検証して CREATE change set を読む

repository のルートで次を実行します。`CAPABILITY_IAM` はこの template が IAM resource を作ることを認識した指定であり、operator に権限を追加する操作ではありません。

```bash
aws cloudformation validate-template --profile "$trial_profile" --region "$trial_region" \
  --template-body file://deploy/aws/trial.cloudformation.json \
  > "$trial_private/template-validation.json"
aws cloudformation create-change-set --profile "$trial_profile" --region "$trial_region" \
  --stack-name "$trial_stack" --change-set-name "$trial_change" --change-set-type CREATE \
  --template-body file://deploy/aws/trial.cloudformation.json \
  --parameters "file://$trial_private/parameters.json" --capabilities CAPABILITY_IAM \
  > "$trial_private/change-set-created.json"
aws cloudformation wait change-set-create-complete --profile "$trial_profile" --region "$trial_region" \
  --stack-name "$trial_stack" --change-set-name "$trial_change"
aws cloudformation describe-change-set --profile "$trial_profile" --region "$trial_region" \
  --stack-name "$trial_stack" --change-set-name "$trial_change" \
  > "$trial_private/change-set-review.json"
```

記録した stack/change set の一致、status、template/parameter の一致を確認します。資源はこの版では16件で、すべて `ResourceChange.Action = Add` である必要があります。Modify/Remove/Import や想定外の資源がある場合は実行せず原因を確認します。無人の deploy/upsert でこの確認を飛ばしません。

## 4. 実行後の outputs を実資源と照合する

確認した同じ change set を実行し、完了を待ちます。

```bash
aws cloudformation execute-change-set --profile "$trial_profile" --region "$trial_region" \
  --stack-name "$trial_stack" --change-set-name "$trial_change"
aws cloudformation wait stack-create-complete --profile "$trial_profile" --region "$trial_region" \
  --stack-name "$trial_stack"
aws cloudformation describe-stacks --profile "$trial_profile" --region "$trial_region" \
  --stack-name "$trial_stack" > "$trial_private/stack-after.json"
aws cloudformation list-stack-resources --profile "$trial_profile" --region "$trial_region" \
  --stack-name "$trial_stack" > "$trial_private/resources-after.json"
```

`InstanceId`/`VpcId`/`ArtifactsBucket` は同じ stack の `Server`/`Network`/`Artifacts` に一致すること、`PublicIp` は専用 EIP の割当先に一致すること、`Url` は parameter の hostname を HTTPS にした値であることを確認します。コピー元の別環境 ID や古い出力を SSM target に使いません。

照合した instance が SSM online になった後、既存 operator の Session Manager 接続で [ホスト構成とアプリ導入](../../docs/operations/aws-trial.md#2-aws-とホストの境界を確認する) を行います。SSM 接続に失敗しても SG に22を追加して進めません。公開証明書、origin/key、同梱 bundle、setup、readiness とブラウザの実操作までを確認します。

DNS は新 A 以外の全 record が保存した状態と一致すること、比較対象ゲームの構成・health・トップページの byte hash が維持されることを確認します。これらは比較対象の証跡であり、AWS account 全体の完全な非変更証明ではありません。

## 停止・削除と回帰

API service 停止、OS/EC2 停止、stack 削除は別です。EC2 は instance 内からの shutdown を `stop` として扱います。7日期限 timer はホスト側の設定で、stack や S3 の自動削除を行いません。停止後も EBS/EIP/S3 等の課金が残ります。

この template は EC2 の API termination protection を有効にし、root volume は終了時削除、S3 bucket とTLS必須bucket policyは Retain です。将来の撤収では backup/復元と保持対象を確認した後に当該 instance の保護状態を照合し、必要な解除・削除をその環境だけに対して行います。保持 bucket・policy・version、DNS と残課金も確認します。ここでは削除を実行していません。

```bash
node --test deploy/aws/trial.test.mjs
pnpm test:deploy
pnpm docs:check
```

5境界回帰は template の参照/parameter、network、暗号化/metadata/credit、IAM、S3 条件を検査します。AWS の現在状態やホスト上の制御は実受入で別に確認します。仕様・template・回帰を変更した場合は、私有 parameter と対象差分も再レビューします。CREATE と IAM capability の指定は [AWS CLI の公式説明](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/create-change-set.html) に対応します。
