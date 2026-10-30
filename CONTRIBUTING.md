# Contributing

不具合報告、業務シナリオ、文書改善、コード変更を歓迎します。機密性のある問題は [SECURITY.md](SECURITY.md) の非公開報告を使ってください。

## 変更の進め方

1. [README](README.md) と [設計・開発規約の索引](AGENTS.md) を確認します。業務上の期待値がある変更は、再現する入力と結果を先に整理してください。
2. fork の作業ブランチで変更します。機能や業務契約を変える場合は `docs/specs/` に受入基準を先に記載し、対応する検証と `docs/log/` の作業記録を残します。
3. 小さな Pull Request にまとめ、変更後の動作、理由、実施した検証、未検証の範囲を説明します。検証を省略した場合はその理由を明記します。

仕様・業務説明・ログは日本語、識別子と PR タイトルは英語を基本とします。UI は日本語と英語のラベルを持ちます。既存のテストを通す目的で期待値を弱めたり、テストをスキップしたりしないでください。

画面を追加・置き換えるときは `apps/web/src/ui/` の部品（題名、空状態、骨格表示、表の枠、ボタン、ダイアログなど）と `styles.css` の意味トークンを使い、hex の色や Tailwind の生パレット色を直接書かないでください。新しいダイアログは `Dialog` を使います。詳しくは [UI規約](docs/conventions/ui.md) の「UI キットとトークン」を参照してください。

金額・数量は `Decimal`、データ定義は kernel DSL を使います。データ操作は `Context` と `Repository`、会計・在庫の操作は既存の業務 action を通します。会社や店舗の分離、確定伝票の不変性、入力できない自動計算項目を保ち、必要な回帰テストを追加してください。日本の制度に基づく仕様は一次資料と確認日を `docs/domain/` に記載します。

## 検査の段階（quick / light / full）

編集中は変更に関係する検査だけを素早く回し、「完了」の前に全体を回します。選択は実行するファイルを選ぶだけで、テストを skip したり期待値を緩めたりしません。仕様は [3 段階の回帰テスト](docs/specs/test-tiers.md) です。

| 段階 | コマンド | 内容 | 目安 | 使う場面 |
| --- | --- | --- | --- | --- |
| quick | `pnpm gate:quick` | 変更ファイルの Prettier / ESLint、依存境界、typecheck（`apps/api`・`apps/web` の typecheck は、その app か app が依存する package を変えたとき）、関連する unit 試験、文書リンクと台帳 | 1〜2 分（sales の 1 ファイル変更で 71 秒） | 編集ごと、コミット前 |
| light | `pnpm gate:light` | 全体の format・typecheck（API/Web を含む）・lint・unit 全件・配布補助・文書・台帳、関連する DB suite と kernel の常時実行 suite 4 件 | 文書だけの変更で約 2〜4 分、module の 1 ファイル変更で約 7〜10 分（banking 6.8 分、sales 9.8 分）、kernel など DB 全件に広がる変更で約 16 分 | push 前、作業の区切り |
| full | `pnpm gate:full` | `pnpm gate` の全工程、API/Web の typecheck と build、中継 agent build、通常ブラウザ試験、認証ブラウザ試験 | CI 並列で約 15 分、ローカル直列で 25〜40 分 | 「完了」の主張前、PR を ready にする前、main 取込後 |

- 目安の時間は 4 CPU を他の作業と共有する一時 container での計測です（CI では未計測）。light は module を 1 ファイル変えるだけでも、全 module を読む `apps/api` の DB suite が約 20 件選ばれるため 6 分を超えます（[仕様](docs/specs/db-test-startup.md) の未決事項）。committed migration から schema を作る migration/setup の 10 suite は、schema の宣言（`defineEntity(` など）や `apps/api` を変えていなければ実行せず full に回し、報告の `deferred` と hint に出します（この後回しは利用者の承認待ちの判断です。`GATE_DEFER_SCHEMA_SUITES=0` で常に実行します）。
- 基準点は `origin/main` との merge-base です。無ければ `origin/HEAD`、ローカルの `main`、upstream との merge-base、最後に `HEAD~1` を使い、そのときは `WARNING: the base fell back ...` と表示します。枝分かれ元が違う場合は `--base <ref>` か `GATE_BASE` で指定してください。未コミット・未追跡のファイルも対象です。
- `kernel/`、migration、`package.json` / lockfile、tsconfig・lint・CI・ブラウザ試験の設定、削除したソースなどを含む変更は「フル回帰が必要」と表示されます。そのうち DB 試験に影響しうるもの（kernel、migration、依存、tsconfig、DB の setupFile など）では light が DB を全件に広げます。どちらの場合も完了前には `pnpm gate:full` が必要です。
- DB を使う light / full は、下の DB テストと同じく破棄可能な専用 DB を `TEST_DATABASE_URL_OWNER` / `TEST_DATABASE_URL` に明示してください。ループバックの同じ DB（名前は `daifuku_test`、`daifuku_ci_test`、`daifuku_test_<suffix>`）と、別の owner / `daifuku_app` role が必要です。未設定や条件外のときは既定の `daifuku_test` を使わずに止まります（別名の破棄可能な DB を使う場合だけ `GATE_ALLOW_DB_URL=1`）。
- full のブラウザ試験は、下の「ブラウザ試験を新規環境で再現する」の環境変数とサーバー、「認証ブラウザ試験」用の空 DB（`GATE_IDENTITY_DATABASE_URL_OWNER` / `GATE_IDENTITY_DATABASE_URL` に設定すると、gate が認証工程にだけ `TEST_DATABASE_URL_*` として渡します）を使います。準備がなければ何も実行せずに案内を出して止まります。
- `pnpm gate:full --provision` は、ループバックの PostgreSQL（`TEST_DATABASE_URL_OWNER` の role に CREATEDB が必要）に一意な名前の新しい空 DB を作り、fixture 準備、compiled API と Web の空きポートでの起動、Playwright、停止までを行います。止めるのは自分が起動したプロセスだけで、作った DB は削除しません（報告に名前が出るので、不要になったら自分で `dropdb` してください）。
- `--without-browser` はブラウザ 2 種を省いた部分実行で、報告に `partial: true` が付きます。`--` の後ろは Playwright に渡します（例: `pnpm gate:full --provision -- --grep @smoke`。これも部分実行の扱いです）。
- `--dry-run` は変更ファイル・昇格判定・実行予定の工程と選ばれた試験ファイルを表示するだけです。既定は最初の失敗で止まり、`--keep-going` で全工程を実行します。
- Ctrl-C、SIGTERM（`pnpm gate:*` の外側の pnpm に送った場合を含む）、端末の切断で止めると、実行中の工程を子孫プロセスごと止め、残りを実行せずに `interrupted` として報告します。
- 結果は標準出力の表と `.runtime/gate/<UTC時刻>-<段階>.json` に残ります。
- `pnpm e2e:smoke` は試験名に `@smoke` を付けた代表的なブラウザ試験だけを、起動済みのサーバーに対して実行します。Playwright は依存 project を絞らないため、3 業界の `industry` project も先に実行されます。`pnpm gate:light --with-smoke`（`--provision` 併用可）で light の最後にも実行できます。

## 型・単体・DB・Web の検証

Node.js 22、`package.json` に固定した pnpm、PostgreSQL 16 を利用します。依存は `pnpm install --frozen-lockfile` で導入します。[開発用の初期化](README.md) は専用の開発 DB で行ってください。以下の DB テストはその DB を作り直すため、`TEST_DATABASE_URL_OWNER` / `TEST_DATABASE_URL` に必ず破棄可能な専用テスト DB を設定します。DB テストは registry から作った schema を `<試験DB名>_tpl_<16桁>` という名前のテンプレート DB（同じサーバー、owner role の所有、接続不可）に保存し、suite ごとに試験 DB を `DROP DATABASE` / `CREATE DATABASE ... TEMPLATE` で作り直します（[DB suite 起動の短縮](docs/specs/db-test-startup.md)）。テンプレートは、試験専用の owner role が CREATEDB を持ち試験 DB を所有するとき（`scripts/db-setup.sql` と CI の構成）に使われます。既存の role に試験のために CREATEDB を足す必要はなく、無ければ従来どおり DB の中で schema を作り直します。ほかの条件は、2 つの URL が query なしで同じ DB を指すこと、試験 DB 名が `test` を `_` 区切りの 1 語として含むこと（`daifuku_test_w3` は可、`daifuku_latest` は不可）、保守用 DB `postgres`（`TEST_DATABASE_MAINTENANCE_DB` で変更）に接続できること、試験 DB が DB 単位の grant・設定・コメントや、public / drizzle 以外の schema・拡張・既定権限（`ALTER DEFAULT PRIVILEGES`）を持たないことです。条件を満たさない場合や `TEST_DATABASE_TEMPLATE=off` のときは従来どおり DB の中で作り直し、理由を suite ごとに標準エラーへ出します（off では出ません）。試験 DB に psql などをつないだままにすると、その間はテンプレートを使いません。テンプレートは試験 DB ごとに最大 80 件（`TEST_DATABASE_TEMPLATE_LIMIT` で変更）を残し、最終利用が古いものから消します。全 DB suite の 1 回の実行で約 59 件・約 0.7 GB、上限まで溜まると最大約 1.7 GB（1 件 8〜21 MB）を使います。`pnpm test:db:templates` で一覧し、`pnpm test:db:templates -- --drop` で設定中の試験 DB の自分のテンプレートだけを消せます（試験 DB 自身や他の DB には触れません）。

```sh
pnpm gate
pnpm --filter @daifuku/web test
pnpm --filter @daifuku/api typecheck
pnpm --filter @daifuku/web typecheck
pnpm --filter @daifuku/web build
pnpm --filter @daifuku/edge build
```

`gate` は型・lint・依存境界・単体（Webを含む）・DBテスト・配布補助テスト・文書リンクです。Web単体だけを素早く確認する場合は `pnpm --filter @daifuku/web test` を使います。Web固有の型チェックとビルド、ブラウザ試験は別途実行します。

## ブラウザ試験を新規環境で再現する

以下はローカル検証用の合成データの手順です。本番・既存の業務 DB に使わないでください。アプリ用 `daifuku_app` と別の migration owner が作成済みであることが前提です。owner はこの検証 DB の所有者で、migration 用の `BYPASSRLS`、app は `NOBYPASSRLS` が必要です。既存 role の権限を変更せず、必要なら独立した PostgreSQL を用意してください。

1. DB 管理者が新規空 DB `daifuku_e2e_test` を作り、migration owner を所有者にします。再実行時は新しい名前 `daifuku_e2e_test_run2` などを使います。すでに存在する DB を削除・リセットする手順はありません。
2. 下の環境変数を自分のローカル検証用接続に置き換え、リポジトリのルートで設定します。示す `owner` / `app` / デモ用 JWT は公開された検証用の値です。実際のパスワードを Issue やログに貼り付けないでください。

```sh
export DATABASE_URL_OWNER='postgres://daifuku_owner:owner@127.0.0.1:5432/daifuku_e2e_test'
export DATABASE_URL='postgres://daifuku_app:app@127.0.0.1:5432/daifuku_e2e_test'
export JWT_SECRET='synthetic-local-e2e-only-not-for-deployment'
export DAIFUKU_PACKS=all
export TZ=Asia/Tokyo
export HOST=127.0.0.1 PORT=3000
export VITE_API_URL=http://localhost:3000
export E2E_API_URL=http://localhost:3000
export E2E_BASE_URL=http://localhost:5173
export CORS_ORIGINS=http://localhost:5173
export E2E_INVOICE_DATE="$(TZ=Asia/Tokyo date +%F)"
export E2E_PREPARE=1
export DAIFUKU_STORAGE_DIR="$PWD/.data/e2e-evidence"
pnpm --filter @daifuku/web exec playwright install chromium
pnpm --filter @daifuku/api exec tsx src/db/e2e-fixture.ts
```

Linux で Chromium の共有ライブラリが不足する場合は、Playwright の `install --with-deps chromium` が OS パッケージを追加する点を確認してから専用環境で利用してください。

準備 CLI は明示したループバック接続と許可された DB 名、owner/app の役割、空 DB を確認し、migration と合成データを作成します。既存 DB は拒否します。標準会社と 3 業界の会社だけを準備し、業界テンプレートは適用しません。会計年度は現在年と指定日の年・翌年を用意するため、年末の訂正日も検証できます。`E2E_INVOICE_DATE` を変更する場合は準備とテストで同じ値を使います。

3. 同じ環境変数を設定した別々のターミナルでサーバを起動します。既存サーバと競合する場合は両方のポートと URL をそろえて変更します。

```sh
# ターミナル A
pnpm --filter @daifuku/api start
# ターミナル B
pnpm --filter @daifuku/web exec vite --host 127.0.0.1 --port 5173 --strictPort
```

4. 同じ環境のターミナルで実行します。

```sh
pnpm --filter @daifuku/web exec playwright test --reporter=list,html
```

Playwright の `industry` project が画面から 3 業界を導入して業務を検証し、依存する `chromium` project が通常業務・権限・従業員ポータルを検証します。1 worker で共有 fixture を順に扱います。途中から調査する場合も通常は依存 project を実行してください。`--no-deps` は導入済みの専用 fixture を調査するときだけ使います。fixture 準備を再実行する場合は必ず新しい空 DB が必要です。

`workforce.spec.ts` は標準会社内に固有の合成利用者・拠点・賃金条件を API で作り、従業員登録、有給付与、実時間の打刻・訂正、承認、領収書添付、経費精算、給与公開を画面から操作します。勤怠の打刻はサーバーの日本時間の当日です。給与は未終了月を確定できないため、前月の承認済み有給1日と時給条件を使い、12,000円の手計算結果と照合します。当月打刻を前月給与に混ぜません。この試験の日付は実時計から求め、請求書用の `E2E_INVOICE_DATE` は使いません。375px・390px の画面幅、入力破棄確認、通信失敗後の再送、別人・別拠点の読取拒否、所属失効後の表示も確認します。専用 fixture 準備後に従業員試験だけを調査する場合は、次を実行できます。

```sh
pnpm --filter @daifuku/web exec playwright test e2e/workforce.spec.ts --project=chromium --no-deps
```

スクリーンショットと失敗時 trace は `apps/web/test-results/`、HTML レポートは `apps/web/playwright-report/` に出ます。追加の入金画面スクリーンショットは `E2E_SCREENSHOTS=1` で取得できます。外部の `review/` ディレクトリは不要です。サーバと DB は検証後に自分が起動・作成した対象だけを停止してください。

## 認証ブラウザ試験

通常のブラウザー試験と別に、SSO/MFA・招待・再設定を検証するfixtureを用意しています。OpenSSLとlockfileに対応するPlaywright Chromiumが必要です。DB管理者が新しい空DB `daifuku_e2e_test_enterprise`（再試験は `_run2` 等のsuffix）をmigration owner所有で作成し、loopbackの `TEST_DATABASE_URL_OWNER` / `TEST_DATABASE_URL` を設定します。ownerの所有権/BYPASSRLS、別appロールの `daifuku_app` / NOBYPASSRLSを検査し、非空DB・production・接続先overrideを拒否します。

```sh
# These variables must name the NEW empty identity fixture DB, not the normal DB-test database.
export TEST_DATABASE_URL_OWNER='postgres://daifuku_owner:owner@127.0.0.1:5432/daifuku_e2e_test_enterprise'
export TEST_DATABASE_URL='postgres://daifuku_app:app@127.0.0.1:5432/daifuku_e2e_test_enterprise'
export E2E_IDENTITY_PREPARE=1
pnpm --filter @daifuku/web exec playwright install chromium
pnpm test:identity:e2e
```

このscriptがAPI3109、Web5189、合成IdP3110と一時証明書のTLS SMTPを起動し、`playwright.identity.config.ts` の3シナリオを実行して停止します。使用中portは拒否し、既存DBを初期化しません。合成SMTPは `example.com` / `example.test` 宛だけを受理し、外部へ配送しません。通常のPlaywright設定はこの専用fixtureを分離しており、CIの4番目の独立jobで実行します。認証業務と運用の範囲は [認証・メール運用](docs/operations/enterprise-identity.md) を参照してください。

## マニュアルを更新する

操作の正本は `docs/manual/*.md` です。`pnpm manual:build` は章と付録を列挙し、Python 3の `markdown` packageで単一HTMLへ変換します。Python環境に `markdown` がない場合は隔離した仮想環境へ導入してください。生成HTMLを直接編集せず、Markdown修正後に再生成し、目次と追加章のリンク・スマホ幅を確認します。スクリーンショットは合成データだけを使います。

## 導入セットアップの試験

セットアップの実受入は [専用クラスタでの受入手順](docs/operations/setup.md) の `scripts/setup-test-cluster.mjs` と `pnpm test:setup` を使います。初回導入・既存版からの更新・バックアップ復元・途中失敗からの再開を扱います。生成された env、資格情報、バックアップ、状態ファイルは公開しないでください。

通常の導入コマンドは必ず `pnpm run setup` と記載します。`pnpm setup` は pnpm 自身の別コマンドです。

CI のジョブ、固定した Action の確認元、成果物の範囲は [.github/ci/README.md](.github/ci/README.md) を参照してください。コードと文書への contribution はリポジトリの [MIT License](LICENSE) の条件で提供してください。他者のコードや画像を含める場合は出典と必要なライセンス表示を添えてください。

## 店舗機器と共通配布の検証

`apps/edge/test` の単体試験はローカルjournal、資格情報、IPPの受付と完了、不明結果の回復、通信再送を扱います。実API・TLS/WSS・DBを使う中継試験も `pnpm gate` のDB projectに含まれます。Linuxではutil-linuxの `/usr/bin/flock` が必要です。模擬機器の成功は実プリンター・釣銭機での受入成功を示しません。

`apps/web/e2e/edge.spec.ts` は店舗単位の登録・依頼・取消、失われた応答の同一依頼再送、15秒ごとの権限再取得、390pxと日英表示を確認します。認証専用試験にはMFAによるpairing発行と機器資格情報の失効を含めています。

`pnpm test:deploy` はmanifest改変、設定境界、クラウド/オンプレの計画、配置権限を検査します。配布物の作成・検証・実TLS proxy受入は [共通配備](docs/operations/deployment.md)、中継の設置は [中継agent](docs/operations/edge-agent.md) を参照してください。正式配布物は検証済みのclean commitから作成します。
