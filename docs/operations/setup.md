# WSL/Linux の安全な導入と更新

更新日: 2026-09-13。対応仕様: [安全なセットアップ](../specs/safe-setup.md)。この手順は、事前作成した専用 PostgreSQL に導入するためのものです。`pnpm run setup` は既定で計画を表示し、OS・DB・role の作成や削除、既存設定の上書き、サーバーの起動を行いません。`run` を省略すると pnpm 本体の環境設定コマンドになるため、必ず付けてください。

## 1. 導入先を準備する

WSL の Linux ファイルシステム内に、レビューした配布版を配置します。Node.js 22 以上、package.json 指定の pnpm、PostgreSQL 16 以上と同じ major 版の `pg_dump` / `pg_restore` が必要です。依存は配布版の lockfile に従い `pnpm install --frozen-lockfile` で導入してください。セットアップ自身は package や OS をインストールしません。

PostgreSQL 管理者が **新しい専用 DB** と、次の role を事前作成します。既存 role がある環境では、それを再作成したり password を変更したりせず、別の専用 cluster を用意するか管理者と権限を確認してください。

```sql
-- psql の管理者セッションで、未使用の名前と接続先を確認して実施。
CREATE ROLE daifuku_owner LOGIN NOCREATEDB NOCREATEROLE BYPASSRLS;
CREATE ROLE daifuku_app LOGIN NOCREATEDB NOCREATEROLE NOBYPASSRLS;
\password daifuku_owner
\password daifuku_app
CREATE DATABASE daifuku_production OWNER daifuku_owner;
CREATE DATABASE daifuku_restore_20260912_01 OWNER daifuku_owner;
```

`\password` の入力は画面・SQL 履歴に password を残さない方法です。異なるランダムな秘密を用意し、16文字以上・英大文字/小文字/数字/記号のうち3種類以上にします。`daifuku_app` には owner・管理 role・PostgreSQL 組込 role の継承や public schema の CREATE を付けません。owner は DB 所有者かつ BYPASSRLS で、superuser は拒否されます。owner に CREATEDB を付ける必要はありません。

`.env.example` と `scripts/db-setup.sql` は従来の開発用です。その demo password と初回ユーザー `admin@example.com` はこのセットアップで拒否します。既存の開発 DB を本番へ自動転用する機能もありません。

運用ディレクトリは自分が所有する0700、秘密ファイルは0600にし、symlink を使わない絶対パスで指定します。例の `/home/operator/daifuku-ops` は実際の Linux ユーザーのパスへ置き換えてください。Windows 側のドライブは権限の扱いが異なるため使いません。保護されたエディターで `/home/operator/daifuku-source.env` を新規作成します。

空ファイルを安全に用意する例は `(umask 077; set -o noclobber; : > /home/operator/daifuku-source.env)` です。既存ファイルがある場合は拒否します。その後エディターで内容を入力します。運用ディレクトリは実行時に CLI が0700で作成します。

```dotenv
DATABASE_URL_OWNER=postgres://daifuku_owner:<URLエンコードした秘密>@127.0.0.1:5432/daifuku_production
DATABASE_URL=postgres://daifuku_app:<別のURLエンコードした秘密>@127.0.0.1:5432/daifuku_production
RESTORE_CHECK_URL=postgres://daifuku_owner:<ownerの秘密>@127.0.0.1:5432/daifuku_restore_20260912_01
```

秘密を shell の引数やコマンド履歴へ貼り付けません。URL 中の `@` / `#` / `%` などは URL エンコードが必要です。追加 URL option は `sslmode` のみ対応します。既定は localhost 限定です。遠隔 DB は `--allow-remote` と `sslmode=verify-full` が必要で、Node と PostgreSQL client の両方で信頼する証明書を別途構成します。今回の実受入は localhost の WSL PostgreSQL 16 で行っています。

## 2. 計画を読み、初回導入する

リポジトリのルートから実行します。秘密は出力せず、対象ホスト・DB・owner・PostgreSQL版・対象識別子、移行一覧、バックアップ保存先、復元先と空状態、他の接続数を表示します。計画中は state ディレクトリも作成しません。

```bash
pnpm run setup install \
  --env /home/operator/daifuku-source.env \
  --state-dir /home/operator/daifuku-ops \
  --tenant-name '運営組織' --company-code MAIN --company-name '株式会社サンプル' \
  --admin-email '担当者の実際のメールアドレス' --admin-name '初回管理者' \
  --generate-admin-password
```

計画の `target.id`、DB 名とホスト、復元先を照合します。全 API / MCP / worker・外部書込元を停止し、同じコマンドへ次の3項目を追加して実行します。

```text
--execute --confirm-target <計画のtarget.id> --maintenance-confirmed
```

他の接続がある場合は、idle 接続でも停止します。セットアップは利用者の接続を強制切断しません。外部プロセスの自動再起動も運用側で停止してください。DB advisory lock はセットアップ同士の並行実行を防ぎますが、任意の外部ライターを停止するものではありません。

最初に DB を dump し、指定した空 DB へ実際に restore します。同一 snapshot の全表件数と移行履歴を照合してから、移行、初回管理者・会社 membership の作成、core module の初期値を入れます。業界テンプレートや sample は自動適用しません。

保存される主なファイルは次のとおりです。

| ファイル | 用途 |
|---|---|
| `runtime.env` | localhost の production API 設定と JWT 秘密（初回未指定なら暗号学的生成）。新規作成のみ |
| `initial-admin-password.txt` | `--generate-admin-password` で生成した管理者 password。端末には表示しない |
| `setup-state.json` | 対象識別子、初回 identity、完了段階、seed 済み module、backup への参照 |
| `backups/*.dump` | PostgreSQL custom format。0600 |
| `backups/*.dump.verified.json` | 実復元の日時・対象・SHA256・表件数・移行履歴 |
| `evidence/` | 起動後に保存される添付ファイルの指定先 |

password は保護されたエディターや password manager で扱ってください。独自 password を使う場合は `--generate-admin-password` を外し、`--admin-password-file /absolute/private-file` を指定します。両方を省略すると非表示の対話入力です。非対話環境で入力元がない場合は停止します。

既存 `runtime.env` の必須設定が不足している場合も停止し、JWT を生成し直して埋めません。改行なしの秘密について Node の env 読み取りと同じ値になる表現を確認して保存します。

ソースからは先に `pnpm build:api` を実行します。API の起動例です。既存 shell に同名環境変数がある場合は先に除去し、保存済み設定を選択してください。

```bash
node --env-file=/home/operator/daifuku-ops/runtime.env \
  .runtime/api/apps/api/dist/main.js
```

`runtime.env` は Node の env ファイルとして読みます。`source runtime.env` は使いません。既定は `127.0.0.1:3000` です。Web 配布、常駐化、TLS reverse proxy、外部公開は別途構成し、管理者ログインと会社選択を確認してから運用を開始します。production の CORS は既定で同一originのみです。別originのWebを使う場合は、保護した設定に `CORS_ORIGINS=https://erp.example.invalid` のように実際のWebのoriginを明示します。ワイルドカード、URLのpath、query、資格情報は指定できません。

## 3. 更新と失敗後の再開

更新前に、現行ソースの版、`runtime.env`、添付 `evidence/`、DB role の定義と password 保管先を、アクセス制限された別媒体へ保存します。**この CLI の dump は DB のみ**です。添付本体、OS、DB role、秘密ファイルを含む完全な災害復旧 backup の代替にはなりません。

API 等を止め、レビューした新しい配布版へ切り替えます。migration SQL の既存ファイルを書き換えず、既存の `JWT_SECRET` と同じ接続情報を持つ新しい0600入力 env を作ります。`RESTORE_CHECK_URL` は今回用に管理者が新規作成した空 DB に変更します。入力 env 自体は CLI が上書きしません。

最新の移行内容と適用前の条件は [基盤のboolean移行](#基盤のboolean移行) を確認してください。先行する `0015_payroll_rule_versions.sql` は給与制度の導入確認を保持する表を追加し、旧制度行・給与・年調・申告準備資料を再計算しません。更新後は給与本部で制度の出典と適用期間を確認し、会社ごとに導入記録を追加できます。既存の2026制度は内容一致を検査してそのまま利用できます。[給与構造](../architecture/payroll-automation.md) と [操作](../manual/appendix-i-fiscal-and-work-systems.md) を参照してください。

先行する `0014_commerce_finance.sql` は商流・銀行・申告準備の19表を追加します。既存の伝票を新しい商流や銀行照合へ自動変換しません。更新後はロール、元の残高・伝票、新しい画面の初期設定を確認します。[構造と操作の入口](../architecture/commerce-finance.md)。

```bash
pnpm run setup upgrade \
  --env /home/operator/daifuku-upgrade-20260912.env \
  --state-dir /home/operator/daifuku-ops
```

計画を確認し、初回と同じ3項目で実行を明示します。既存設定のある更新では JWT を生成し直さず、core seed も実行しません。適用済み SQL の hash、journal の順番・時刻、表・列・型・NULL 制約が既知の snapshot と異なる場合や、DB が配布版より新しい場合は停止します。独自 index / trigger / function / policy の完全な意味比較は行っていないため、独自 DDL がある環境は移行レビューを別途行ってください。

途中失敗した場合は対象を reset せず、表示された安全なコードと `setup-state.json` の段階を確認します。backup と復元 DB を残したまま原因を修正し、新しい空の復元 DB を指定して同じ state-dir と初回 identity で再実行します。admin 作成直後に中断しても元のユーザーと password を再利用します。別 password を入力しても既存 password は変更されません。完了済みの同じ版は no-op です。

| 停止理由 | 対応 |
|---|---|
| `DATABASE_BUSY` / `SETUP_BUSY` | 利用元や別セットアップを確認して停止。強制切断せず再計画 |
| `RESTORE_REQUIRED` / `RESTORE_NOT_EMPTY` | 今回用の空 DB を管理者が作成。既存復元 DB は保全 |
| `PG_TOOL_VERSION` / `PG_TOOL_FAILED` | client major、空き容量、接続、復元先を確認。生ログは CLI が出さない |
| `MIGRATION_HISTORY` / `SCHEMA_DRIFT` | 配布版・適用履歴・独自 DDL を調査。履歴だけを書き換えて進めない |
| `STATE_TARGET` / `IDENTITY_CHANGED` | 正しい対象・初回指定・state-dir を選択。state の別 DB 流用は禁止 |
| `STATE_MODE` | 未完了の `install` は `install`、`upgrade` は `upgrade` で再開。初回管理者作成を飛ばして更新へ進めない |
| `RUNTIME_CONFIG_CHANGED` / `RUNTIME_CONFIG_MISSING` / `RUNTIME_CONFIG_INVALID` | 保管済みの実設定を確認・復元。JWT を再生成して上書きしない |

### 基盤のboolean移行

[`0017_system_boolean_flags.sql`](../../apps/api/drizzle/migrations/0017_system_boolean_flags.sql) は、利用者の有効・テナント管理者・MFA有効、拡張項目の必須、リレー資格情報の有効という5列を整数の0/1からPostgreSQL booleanへ変更します。外部APIの真偽値や業務Entityのboolean項目はそのままです。既存行がある前提で、テーブルをロックして全行が0/1であることを検査し、想定外の値は変換せず失敗させます。既定値とリレーの有効資格情報の一意性を保持し、業務レコードやパスワードを作り直しません。仕様は [一貫性調整](../specs/source-consistency.md) を参照してください。

旧版のSQLと新しいboolean列は互換ではありません。API・メールworker・MCP等のDB利用元を停止し、現行版と秘密・添付・DBのbackupを保全して別DBへの復元を確認した後、新版のsetupで更新し、同じ新版のAPI等を起動します。旧版と新版を同時に動かすrolling updateは行いません。先行する `0016_ext_equality_indexes.sql` のJAN生成列・索引追加も含め、テーブルの大きさに応じた保守時間と空き容量を用意します。

更新後は管理者・一般利用者のログイン、会社と権限の分離、MFA、失効済み資格情報の拒否を確認します。不正な既存値が原因なら元の値と監査記録を調べ、migration履歴の書換えや全行の一括true化で回避しません。旧版へ戻す場合は旧版と検証済み旧DBを組み合わせ、更新後の変更を失う範囲を確認して別DBへ復元します。新形式のパスワードハッシュに関する互換条件も [認証運用](enterprise-identity.md#パスワードハッシュの強度と更新) に従います。

## 4. 復元した DB で回復を確認する

`.verified.json` がある dump は、移行前に別 DB で復元と全表件数・履歴照合を通過したものです。dump 自体の SHA256 を保存してあり、保管後の破損検出にも使えます。全業務レコードの内容を個別に照合した証明ではありません。運用開始前に重要な残高・伝票・添付の回復試験も行ってください。

障害時は元 DB を上書きせず、管理者が新規作成した回復先へ、元の版のソース・runtime 設定・添付 backup とセットで復元します。`pg_restore --no-owner --no-privileges --exit-on-error` を利用し、接続秘密は0600の `PGPASSFILE` で渡します。復元 DB 名・host・owner を照合し、`--clean` は使用しません。対象引数に password 付き URL を渡さないでください。

この restore 方式では app の grant をコピーしません。元の配布版がこのセットアップに対応する場合、`pnpm run setup upgrade` を回復先に対して行うと migration runner の RLS/grant 再設定が適用されます。この際も、元の state-dir は流用せず、回復先用の新しい state-dir、既存 JWT を含む回復先入力 env、さらに別の空の復元確認 DB を指定します。セットアップ導入前の0008版へ戻す場合は、その版の復旧手順で RLS/grant を確認・再設定してください。最新ソースの setup を使うと最新schemaへ移行するため、旧版への巻戻しにはなりません。

ログイン・会社/RLS 分離・伝票・残高・添付を確認した後に、明示的にサービス接続先を切り替えます。CLI は自動切替・backupからの自動巻戻し・DB 削除を行いません。失敗した個々のDBトランザクションはrollbackされ、既に完了した段階はcheckpointから再開します。

## 5. セットアップ自身の受入を再現する

通常の `pnpm gate` とは別に、強い role を持つ新規の専用 cluster を使います。`scripts/setup-test-cluster.mjs` は未使用 port と未作成のディレクトリだけを受け付け、既存 cluster/DB/role を変更しません。PostgreSQL 本体は事前に用意します。

```bash
node scripts/setup-test-cluster.mjs \
  --directory /home/operator/setup-acceptance-001 \
  --bin /usr/lib/postgresql/16/bin --port 55443
SETUP_TEST_ENV_FILE=/home/operator/setup-acceptance-001/test.env pnpm test:setup
```

同じ major の `pg_dump` / `pg_restore` を PATH に置いてください。検証対象は初回、読取専用計画、稼働接続拒否、no-op、資格情報を変えた再開、実データあり0008から現行migrationへの更新、schema drift 拒否、移行失敗 rollback と再開、非空復元先拒否を含みます。実施済みの結果は [STATUS](../STATUS.md) を参照してください。既存の `TEST_DATABASE_URL` へ fallback しません。再度行う際は別の新規ディレクトリと未使用 port を使います。検証後の cluster は `pg_ctl -D <この試験のdirectory>/data -m fast -w stop` で停止できます。ファイル・DB は検査用に残り、自動消去しません。

## 参照した一次資料

2026-09-12確認: DB単位のbackupとcustom formatは [PostgreSQL 16 pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html)、owner/privilegeを指定した復元は [pg_restore](https://www.postgresql.org/docs/16/app-pgrestore.html)、秘密ファイルの0600とescapeは [Password File](https://www.postgresql.org/docs/16/libpq-pgpass.html)、非表示のpassword変更は [psql](https://www.postgresql.org/docs/16/app-psql.html) に基づきます。セットアップの追加制約と運用手順はこのリポジトリの契約です。
