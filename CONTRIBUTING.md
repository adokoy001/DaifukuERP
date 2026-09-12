# Contributing

不具合報告、業務シナリオ、文書改善、コード変更を歓迎します。機密性のある問題は [SECURITY.md](SECURITY.md) の非公開報告を使ってください。

## 変更の進め方

1. [README](README.md) と [設計・開発規約の索引](AGENTS.md) を確認します。業務上の期待値がある変更は、再現する入力と結果を先に整理してください。
2. fork の作業ブランチで変更します。機能や業務契約を変える場合は `docs/specs/` に受入基準を先に記載し、対応する検証と `docs/log/` の作業記録を残します。
3. 小さな Pull Request にまとめ、変更後の動作、理由、実施した検証、未検証の範囲を説明します。検証を省略した場合はその理由を明記します。

仕様・業務説明・ログは日本語、識別子と PR タイトルは英語を基本とします。UI は日本語と英語のラベルを持ちます。既存のテストを通す目的で期待値を弱めたり、テストをスキップしたりしないでください。

金額・数量は `Decimal`、データ定義は kernel DSL を使います。データ操作は `Context` と `Repository`、会計・在庫の操作は既存の業務 action を通します。会社や店舗の分離、確定伝票の不変性、入力できない自動計算項目を保ち、必要な回帰テストを追加してください。日本の制度に基づく仕様は一次資料と確認日を `docs/domain/` に記載します。

## 型・単体・DB・Web の検証

Node.js 22、`package.json` に固定した pnpm、PostgreSQL 16 を利用します。依存は `pnpm install --frozen-lockfile` で導入します。[開発用の初期化](README.md) は専用の開発 DB で行ってください。以下の DB テストはテーブルを作り直すため、`TEST_DATABASE_URL_OWNER` / `TEST_DATABASE_URL` に必ず破棄可能な専用テスト DB を設定します。

```sh
pnpm gate
pnpm --filter @daifuku/web test
pnpm --filter @daifuku/web typecheck
pnpm --filter @daifuku/web build
```

`gate` は型・lint・依存境界・単体（Webを含む）・DBテスト・文書リンクです。Web単体だけを素早く確認する場合は `pnpm --filter @daifuku/web test` を使います。Web固有の型チェックとビルド、ブラウザ試験は別途実行します。

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

このscriptがAPI3109、Web5189、合成IdP3110と一時証明書のTLS SMTPを起動し、`playwright.identity.config.ts` の2シナリオを実行して停止します。使用中portは拒否し、既存DBを初期化しません。合成SMTPは `example.com` / `example.test` 宛だけを受理し、外部へ配送しません。通常のPlaywright設定はこの専用fixtureを分離しており、CIの4番目の独立jobで実行します。認証業務と運用の範囲は [認証・メール運用](docs/operations/enterprise-identity.md) を参照してください。

## マニュアルを更新する

操作の正本は `docs/manual/*.md` です。`pnpm manual:build` は章と付録を列挙し、Python 3の `markdown` packageで単一HTMLへ変換します。Python環境に `markdown` がない場合は隔離した仮想環境へ導入してください。生成HTMLを直接編集せず、Markdown修正後に再生成し、目次と追加章のリンク・スマホ幅を確認します。スクリーンショットは合成データだけを使います。

## 導入セットアップの試験

セットアップの実受入は [専用クラスタでの受入手順](docs/operations/setup.md) の `scripts/setup-test-cluster.mjs` と `pnpm test:setup` を使います。初回導入・既存版からの更新・バックアップ復元・途中失敗からの再開を扱います。生成された env、資格情報、バックアップ、状態ファイルは公開しないでください。

通常の導入コマンドは必ず `pnpm run setup` と記載します。`pnpm setup` は pnpm 自身の別コマンドです。

CI のジョブ、固定した Action の確認元、成果物の範囲は [.github/ci/README.md](.github/ci/README.md) を参照してください。コードと文書への contribution はリポジトリの [MIT License](LICENSE) の条件で提供してください。他者のコードや画像を含める場合は出典と必要なライセンス表示を添えてください。
