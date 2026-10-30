# テスト規約

| 種別 | どこ | 何を | 実行 |
|---|---|---|---|
| unit | `test/*.test.ts` | 純粋関数（services/）、DSL の導出結果 | `pnpm test`（数秒） |
| property | 同上（fast-check） | 丸め・集計・状態遷移の不変条件 | 同上 |
| golden | `test/golden/*.json` | 仕訳・帳票・在庫評価・税計算の決定論的出力。差分は `pnpm test -- -u` で更新し、**更新理由を作業記録に書く** | 同上 |
| db | `test/*.db.test.ts` | Repository・RLS・採番・docstatus・監査。`freshDb()` が suite ごとに専用試験 DB を registry の schema で作り直す（schema テンプレートからの複製、下記） | `pnpm test:db` |
| web unit | `apps/web/src/**/*.test.ts` | 画面の純粋関数と、React 部品の描画結果（role・aria・順序）。DOM ライブラリは足さず `react-dom/server` の `renderToStaticMarkup` と `createElement` を使う（vitest の include は `.test.ts`）。例: `src/ui/ui-kit.test.ts` | `pnpm --filter @daifuku/web test` |
| e2e | `apps/web/e2e/*.spec.ts`（Playwright） | 画面経由の主要シナリオ。role-based locator、`waitForTimeout` 禁止、データは API fixture でシード | `pnpm e2e` |
| mutation | Decimal・貸借検査の全ソース（StrykerJS 10.0.0） | 故意の変更を検出するか。全件Killedを要求 | `pnpm verify:mutation`、別CI |
| finite model | `verification/edge/`（TLA+/TLC） | 有限範囲の安全性、到達性、実装との共有trace | `pnpm verify:edge:model`、別CI |

生成検査はseedと失敗時pathを記録する。成功/拒否/再送の到達を固定prefixで保証し、その後の生成tailも実行する。期待した業務エラーと内部例外を区別する。参照解の独立性、空集合だけで通る条件、未対応の入力範囲を[検証台帳](../verification/invariants.md)と[検証設計](../architecture/practical-verification.md)へ記載する。

## 共通の規則

- テスト名に受入基準 ID（`AC-3`）を含める。
- テストの削除・skip・`expect` の骨抜きは禁止（lint）。誤ったテストは直し、作業記録に書く。
- 実装エージェントとは別コンテキストのレビュアがテストの「意味」を審査する（カバレッジではなく）。

## DB 試験の schema テンプレート

- `freshDb()` は schema を作る全文（`dropAll`・registry の DDL・RLS/grant）のハッシュを鍵に、`<試験DB名>_tpl_<16桁>` のテンプレート DB を作り、以後の suite では試験 DB を `CREATE DATABASE ... TEMPLATE` で作り直す（[db-test-startup](../specs/db-test-startup.md)）。entity・DSL・RLS の文が変われば鍵が変わり、新しいテンプレートを作る。古いものは試験 DB ごとに 80 件（`TEST_DATABASE_TEMPLATE_LIMIT`）を超えた分から消える（全 suite の 1 回で約 59 件・約 0.7 GB、上限まで溜まると 1 件 8〜21 MB で最大約 1.7 GB）。`pnpm test:db:templates` で一覧、`pnpm test:db:templates -- --drop` で試験 DB の自分のテンプレートだけを消す。
- 使う条件: 2 つの URL が query なしで同じサーバー・同じ DB を指す、試験 DB 名が `test` を `_` 区切りの 1 語として含む小文字の識別子（`daifuku_test_w3`・`daifuku_ci_test`。`daifuku_latest` は不可）、保守用 DB（`postgres`、`TEST_DATABASE_MAINTENANCE_DB`）に接続できる、owner role が CREATEDB を持ち試験 DB を所有する、DB 単位の grant・設定・コメント・接続上限が無い、試験 DB が public / drizzle 以外の schema・plpgsql 以外の拡張・既定権限（`ALTER DEFAULT PRIVILEGES`）・event trigger・publication・large object などを持たない（作り直しでは残り、DB の再作成では消えるため）。満たさなければ従来どおり DB の中で schema を作り直し、理由を標準エラーに出す（suite ごとに 1 回。`TEST_DATABASE_TEMPLATE=off` で常に従来の作り直しになり、通知も出ない）。
- 試験 DB に psql や GUI などこの harness 以外のクライアントがつないでいると、テンプレートを使わずにすぐ従来の作り直しに戻る（postgres.js の接続は前の suite のものとみなして最大 15 秒待つ）。失敗した試験を調べるときは調べ終えたら切断する。
- 試験は schema の作り方に依存しない。テンプレートの DB に接続しない（`ALLOW_CONNECTIONS false`）。DB 試験から試験 DB 以外の DB を作る・消す処理を足さない（例外: harness 自身の試験 `kernel/test/test-template.db.test.ts` は、テンプレート経路を確かめるために試験 DB と `<試験DB名>_tpl_` で始まる名前の DB だけを作って消す）。
- テンプレートの作り方（`applySchemaBuild`、作る場所、印の形式）を変えたときは `kernel/src/test-database.ts` の `TEMPLATE_FORMAT` を上げる。鍵は schema を作る文からしか作らないため、作り方だけを変えても古いテンプレートがそのまま複製される（`pnpm test:db:templates -- --drop` で消してもよい）。
- migration の適用を検証する試験（`runMigrations` を呼ぶ suite）は `dropAll` から自分で schema を作る。テンプレートは使わない。

## 実行の段階（quick / light / full）

| 段階 | コマンド | 何を | いつ |
|---|---|---|---|
| quick | `pnpm gate:quick` | 変更ファイルの format / lint、依存境界、typecheck、vitest のモジュールグラフで選んだ unit 試験 | 編集ごと |
| light | `pnpm gate:light` | 全体の静的検査（API/Web の typecheck を含む）と unit 全件、関連 DB suite + kernel の常時実行 suite 4 件（migration/setup suite は schema に関係する変更があるときだけ） | push 前 |
| full | `pnpm gate:full` | `pnpm gate` 全工程 + API/Web の型と build + ブラウザ・認証試験 | 「完了」の前、昇格パターンに触れた変更 |

- 選択は「どのファイルを実行するか」だけで、選んだファイル内の試験は全件実行する。試験名フィルタ・skip・only は使わない。詳細と昇格パターンは [3 段階の回帰テスト](../specs/test-tiers.md)。
- light は migration/setup suite（試験か同じディレクトリの補助ファイルが `runMigrations(` を呼ぶ DB suite）を、schema 宣言（`defineEntity(`・`registerExt(` など）、その package 内で宣言から import されるファイル、suite と同じ package の変更があるときだけ実行し、それ以外は full に回して報告に `deferred` と書く（`GATE_DEFER_SCHEMA_SUITES=0` で常に実行）。新しい migration 系 suite もこの書き方に従えば同じ扱いになる。enum の値などを宣言の外に置くときは、同じ package から import する（別 package の定数は辿らない）。
- 試験ファイルが読むデータや実行するスクリプトは、試験ソースにファイル名を書く（例: `new URL('./golden/x.json', import.meta.url)`）。quick / light はファイル名の一致でそれらの試験を選ぶ。ファイル名を組み立てて読む場合は選ばれないため、light の unit 全件で補う。
- 子プロセスで実行する入口（`fixtures/stdio-entry.ts` など）も試験ソースに相対パスで書く。`node:child_process` を import する試験は、同じ package の変更と、入口の import グラフに入る変更で選ばれる。
- vitest の `setupFiles` が特定の suite のために読むモジュールは、setupFile の中に対象 suite のパスを文字列で列挙する（`apps/api/test/payroll-provider-setup.ts` の `fiscalSuites`）。light はその setupFile の import グラフが変わったとき、列挙された suite を選ぶ。
- `@smoke`: 代表的なブラウザ試験 6〜8 件の試験名の末尾に ` @smoke` を付ける（本体は変えない）。`pnpm e2e:smoke` が `--grep @smoke` で実行する。タグの追加・削除は spec の変更として扱い、件数は `scripts/test/gate.test.ts` が検査する（試験名を直書きした `test('… @smoke'` だけを数える）。これとは別に、アクセシビリティ検査の日本語・1280px の 8 件にも付く（下記。件数は `apps/web/src/a11y-policy.test.ts` が検査）。

## アクセシビリティ自動検査（axe）

[spec](../specs/e2e-a11y.md)。`apps/web/e2e/a11y.spec.ts` が `@axe-core/playwright` で主要 8 画面（ログイン、ホーム、取引先一覧、売上請求書の新規、会社設定、`/me`、`/workforce`、`/analytics`）を日英 × 1280px / 390px の 32 件で検査する。通常のブラウザ試験（`chromium` project）に含まれ、日本語・1280px の 8 件は `@smoke`。

- 対象は WCAG 2.1 A/AA の rule tag（`wcag2a`、`wcag2aa`、`wcag21a`、`wcag21aa`）。`serious` / `critical` は失敗、`moderate` / `minor` は出力だけ。best-practice の rule は対象外。
- 失敗の報告には rule・影響度・target・説明・help URL が出る。各実行の axe の結果全体は `test-results/<試験>/axe.json` に残る。
- **まず直す。** 直せないものだけを `apps/web/e2e/a11y-exceptions.json` に登録する。項目は `rule`、`screen`（`a11y-policy.ts` の画面 id）、`target`（報告の target をそのまま。完全一致）、`reason`、`followUp`（追跡先の spec・計画項目、または期限 `YYYY-MM-DD`）が必須で、`locales`（`ja` / `en`）・`widths`（`1280` / `390`）で条件を絞れる。理由の無い項目、未知の画面・条件・項目名、重複は Web unit と a11y spec の両方で失敗する。
- **古い例外は残らない。** 例外は適用される実行ごとに照合し、その実行で 1 件も一致しなければその実行が失敗する。違反が一部の条件だけで出るなら、`locales` / `widths` で絞る。
- 例外を足す・消すときは、spec の未決事項か作業記録に理由を書く。
- 画面を追加して検査対象にするときは `a11y-policy.ts` の `A11Y_SCREENS` に足す（Web unit の画面一覧と件数も更新する）。検査は `h1` の表示、`meta-error`・`aria-busy="true"`・`loading-view` が無いこと、通信の落ち着きを待ってから行う。
- 検査は初期表示だけ。ダイアログや開いたメニューなど操作後の状態は、必要になった画面の試験で `AxeBuilder` を同じ規則（`judge`）で呼ぶ。
