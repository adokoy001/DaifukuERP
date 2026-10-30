# Spec: db-test-startup（DB suite 起動の短縮と light の DB 選択）

- 状態: implemented
- モジュール: `kernel/src/testing.ts`（`freshDb`）、`kernel/src/test-database.ts`（新規、schema テンプレート）、`kernel/src/test-database-cli.ts`（新規、テンプレートの一覧・削除。ルート `package.json` の `test:db:templates`）、`kernel/src/db/migrate.ts`（実行する文の列挙を公開。実行内容は不変）、`scripts/gate.mjs`・`scripts/gate-select.mjs`・`scripts/gate.d.mts`（light の migration/setup suite の選択） ／ 依存: [3 段階の回帰テスト](test-tiers.md)（A1）、vitest の db project（`fileParallelism: false`）
- ADR: 新規 ADR は不要（試験の実行方法の変更であり、本番の schema・権限・RLS・DSL・migration は変えない。`enforcePolicies` / `dropAll` が実行する文と順序は同一で、unit 試験で確かめる）。判断は本 spec、[検証と公開](../architecture/verification-and-release.md)、[テスト規約](../conventions/testing.md) に記す
- 作成: 2026-10-29 ／ 作成者: agent（A3 実装セッション。計画は [完成度向上の実装計画](../completion-plan.md) の A3 と [test-tiers](test-tiers.md) の未決事項。light の選択（AC-8〜AC-10）の根拠は下の「計画からの変更」）。実装: 同日、同セッション。レビュー指摘の修正: 2026-10-30（修正セッション、[作業記録](../log/2026-10-29-db-test-startup.md) の「レビュー指摘の修正」）

## 目的（1段落）

`pnpm gate:light` は module の 1 ファイル変更でも 10〜14 分かかり、目標の 6 分を外れていた（[test-tiers](test-tiers.md) の未決事項）。DB suite は `freshDb()` ごとに schema 全体（全 module を読む `apps/api` では 1,563 文）を作り直し、module の変更は全 module を読む `apps/api` の DB suite 約 30 件を選ぶ。先に suite ごとの時間を「schema 作り直し」「import」「試験本体」に分けて測り、試験の内容を変えずに取り除ける固定費だけを減らす。(1) schema をテンプレート DB として保存し、suite ごとに `CREATE DATABASE ... TEMPLATE` で複製する。(2) light では、committed migration から schema を作る migration/setup suite を、schema に関係する変更があるときだけ実行し、それ以外は full に回したと報告する（full・`pnpm gate`・`pnpm test:db` は全件のまま）。試験の件数・内容・RLS・role・grant は変えない。

## 計測（実装前、2026-10-29、この container: 4 CPU、他エージェントと同居、load average 2〜7）

方法: `freshDb()`・`dropAll()`・`runMigrations()` に一時的な計時を入れ（commit していない）、vitest の reporter API（`TestModule.diagnostic()`: collect / setup / duration）で suite ごとの実時間を取って、`pnpm test:db` 相当の全 116 suite を 1 回実行した（877.8 秒、701 試験すべて成功）。「schema」は freshDb suite では接続・`dropAll`・DDL 生成・DDL 実行・RLS/grant、migration suite では `dropAll` と migration 適用。「import」は試験ファイルの読込（全 module の評価を含む）。「試験本体」は hook と試験から schema と bootstrap を除いた残り。

| suite | 合計 s | import s | schema s | bootstrap s | 試験本体 s | schema の割合 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| kernel/test/foundation.db.test.ts | 3.8 | 1.2 | 0.7 | 0.3 | 1.7 | 18% |
| kernel/test/document.db.test.ts | 2.9 | 1.3 | 0.9 | 0.3 | 0.5 | 30% |
| kernel/test/access-boundary.db.test.ts | 2.5 | 1.5 | 0.4 | 0.3 | 0.2 | 18% |
| kernel/test/noninterference.db.test.ts | 4.5 | 1.3 | 0.8 | 0.3 | 2.1 | 18% |
| modules/sales/test/sales.db.test.ts | 7.7 | 1.3 | 0.9 | 0.3 | 5.2 | 11% |
| modules/accounting/test/accounting.db.test.ts | 6.2 | 1.2 | 0.3 | 0.3 | 4.3 | 5% |
| modules/banking/test/banking.db.test.ts | 5.6 | 1.5 | 1.0 | 0.3 | 2.8 | 18% |
| packs/retail/test/scenario-retail.db.test.ts | 7.1 | 1.5 | 1.5 | 0.3 | 3.9 | 21% |
| apps/api/test/api.db.test.ts | 10.4 | 1.8 | 3.3 | 0.3 | 5.0 | 31% |
| apps/api/test/meta.db.test.ts | 7.6 | 1.8 | 3.5 | 0.3 | 2.1 | 46% |
| apps/api/test/companies.db.test.ts | 8.3 | 2.4 | 4.5 | 0.3 | 1.0 | 55% |
| apps/api/test/scenario.db.test.ts | 10.6 | 4.3 | 2.9 | 0.3 | 3.1 | 27% |
| apps/api/test/boolean-migration.db.test.ts | 31.7 | 2.0 | 7.9 | 0.0 | 21.7 | 25% |
| apps/api/test/commerce-finance-migration.db.test.ts | 5.5 | 1.8 | 1.0 | 0.0 | 2.8 | 18% |
| apps/api/test/edge-migration.db.test.ts | 6.9 | 1.9 | 2.4 | 0.0 | 2.6 | 34% |
| apps/api/test/enterprise-migration.db.test.ts | 6.4 | 2.2 | 1.7 | 0.0 | 2.5 | 28% |
| apps/api/test/ext-index-migration.db.test.ts | 7.0 | 2.2 | 1.3 | 0.0 | 3.5 | 19% |
| apps/api/test/operations-migration.db.test.ts | 15.9 | 1.8 | 6.1 | 0.0 | 8.0 | 38% |
| apps/api/test/shift-migration.db.test.ts | 5.6 | 1.7 | 2.1 | 0.0 | 1.8 | 37% |
| apps/api/test/migrations.db.test.ts | 6.6 | 2.2 | 3.1 | 0.0 | 1.3 | 46% |
| apps/api/test/upgrade.db.test.ts | 15.7 | 1.8 | 11.2 | 0.0 | 2.8 | 71% |
| apps/api/test/industry-templates.db.test.ts | 7.8 | 1.8 | 2.8 | 0.0 | 3.3 | 35% |
| **全 116 suite** | **862.3** | **181.2** | **232.4** | **36.1** | **412.5** | **27%** |

- 内訳: freshDb の 106 suite（freshDb 呼出し 125 回）で合計 753 秒、schema 193 秒（26%。DDL 実行 135、`dropAll` 40、RLS/grant 14、DDL 生成 11、接続 4）、bootstrap 36 秒（scrypt のパスワードハッシュ）、import 162 秒。migration/setup の 10 suite で合計 109 秒、うち `dropAll` と migration 適用 40 秒（これは検証対象そのもの）。
- schema の作り直しは全体の 27% で、計画の判断基準「50% 超」には届かない。試験本体（48%）と import（21%）は試験の変更や isolate の変更なしには減らせないため、取り除ける最大の固定費は依然として schema の作り直しである。light の対象（sales の 1 ファイル変更で 65 suite、計測値の合計 635 秒）では freshDb の schema が 164 秒（26%）、migration/setup suite が 85〜109 秒（13〜17%）を占める。両方を実装した。
- 1,563 文の DDL 実行は `synchronous_commit = off` でも 1 transaction にまとめても 1.9〜2.2 秒でほぼ変わらなかった（試作で実測。fsync ではなく catalog 処理が律速）。複製は `CREATE DATABASE ... TEMPLATE`（既定の WAL_LOG）で 0.14〜0.31 秒、`DROP DATABASE` 0.04〜0.06 秒、`STRATEGY FILE_COPY` は 0.24〜0.31 秒で遅かった。
- registry の構成（DDL の文数）は全 suite で約 41 種類（125 回の freshDb のうち 1,563 文の構成が 24 回、455 文が 13 回など）。

## 受入基準（EARS）

schema テンプレート（`kernel/src/test-database.ts`、`kernel/src/testing.ts`）:

- AC-1 WHEN `freshDb()` が呼ばれ、テンプレートが使える（AC-4）とき THE SYSTEM SHALL schema を作る全文（`RESET_STATEMENTS`・registry の DDL・`policyStatements()`）と形式版のハッシュを鍵にし、`<db>_tpl_<鍵の先頭16桁>` が自分の印付きで存在すれば、試験 DB を `DROP DATABASE` → `CREATE DATABASE <db> TEMPLATE <テンプレート>` で作り直してから、従来どおり tenant を bootstrap する。鍵に入る文は `dropAll` / `enforcePolicies` が実行する文と同一である。
- AC-2 WHEN 鍵に対応するテンプレートが無い THE SYSTEM SHALL schema を従来と同じ文・同じ順で 1 文ずつ実行して作り、テンプレートにする。試験 DB の encoding・locale が template1 と同じときは template1 の新しい複製の中で作り（以前の作り直しによる catalog の肥大を持ち込まない）、違うときは試験 DB の中で作ってその DB を複製する。作成が失敗したときは作りかけのテンプレート DB を消してから失敗させる（印の無い DB が年齢切れの対象外のまま残らないように）。テンプレートには試験 DB 名・完全な鍵・最終利用時刻を含む印（`COMMENT ON DATABASE`）を付け、`ALLOW_CONNECTIONS false` で接続を閉じ、同じ試験 DB の自分のテンプレートが上限（既定 80、`TEST_DATABASE_TEMPLATE_LIMIT`）を超えたら最終利用が古いものから削除する。
- AC-3 THE SYSTEM SHALL どの経路（作り直し・テンプレート作成・複製）でも同じ catalog を suite に渡す: relation・列・制約・索引・RLS（`relrowsecurity` / `relforcerowsecurity`）・policy・grant・trigger・関数・schema とその権限・型・拡張・既定権限・DB 属性（所有者・encoding・locale・ACL・設定）。作り直しが残し DB の再作成が失う物（AC-4 の一覧）を試験 DB が持つときは、どの経路でも DB を削除せず従来の作り直しを行う。`kernel/test/test-template.db.test.ts` が 3 経路の catalog と、余分な schema・既定権限を持つ試験 DB の catalog を比較する。`kernel/test/access-boundary.db.test.ts`・`noninterference.db.test.ts` は両方の経路で成功する（手動の実行で確認する。自動試験ではない）。
- AC-4 THE SYSTEM SHALL 次をすべて満たすときだけテンプレートを使い、満たさなければ従来の作り直しを行って理由を標準エラーに出す（suite、つまり試験ファイルごとに 1 回。vitest は試験ファイルごとに process を分けるため。`TEST_DATABASE_TEMPLATE=off` で出なくなる）: owner / app の URL が同じサーバー・同じ DB を指し query を持たない、DB 名が小文字の識別子で `test` を `_` で区切られた 1 語として含み（`daifuku_test`・`daifuku_test_w3`・`daifuku_ci_test`。`daifuku_latest`・`contest_prod` は不可）テンプレート名が 63 文字に収まる、保守用 DB（既定 `postgres`、`TEST_DATABASE_MAINTENANCE_DB`）に接続できる、owner role が CREATEDB を持ち試験 DB を所有する、試験 DB が既定の DB ACL・DB 設定なし・DB のコメントなし・接続上限なし・template1 と同じ tablespace・template でない、そして試験 DB が `RESET_STATEMENTS` の後に残る物（public / drizzle 以外の schema、plpgsql 以外の拡張、既定権限 `pg_default_acl`、event trigger、publication、large object、外部データラッパー・外部サーバー、追加の手続き言語、利用者定義の cast）を持たない。最後の条件は複製・テンプレート作成・復元のどの経路でも `DROP DATABASE` の前に確かめる。作成・削除・変更するのは試験 DB と、`<db>_tpl_<16桁の16進>` の名前で自分の印（同じ試験 DB 名と、名前に一致する鍵）を持つ DB だけである（例外: 現在の鍵の名前を持ちコメントが無い DB は作成途中で中断した自分のテンプレートとして削除して作り直す）。
- AC-5 WHERE `TEST_DATABASE_TEMPLATE=off`（`0` / `false` / `no`）THE SYSTEM SHALL 常に従来どおり schema を作り直し、通知を出さない。未知の値は通知付きで作り直しに戻る。`auto`（既定、空も同じ）・`on`・`1`・`true`・`yes` はテンプレートを使う。
- AC-6 WHEN 試験 DB（またはテンプレート）に他のセッションが接続している THE SYSTEM SHALL この harness のセッション（`application_name` が postgres.js の既定値 `postgres.js`。前の suite の接続、試験が起動したサーバーや子プロセス）は最大 15 秒待ち、それ以外のクライアント（psql、GUI など）が接続していれば待たずに、試験 DB を削除せずに従来の作り直しに戻り、理由に `application_name` を出す（作成中ならテンプレートを作らずに続ける）。`DROP DATABASE` が使用中（SQLSTATE 55006）で失敗したとき（試験 DB、中断したテンプレートの作り直し）も作り直しに戻る。年齢切れの削除は使用中のテンプレートを飛ばす。autovacuum の worker は数えない（`DROP DATABASE` が止める）。
- AC-7 IF 試験 DB が存在しない（前回の実行が `DROP` と `CREATE` の間で止まった） THEN THE SYSTEM SHALL 同じ試験 DB の自分のテンプレートから作り直し、無ければ DB が無いことを報告する（何も作らない）。テンプレート経路の想定外の失敗は、試験 DB 名と `TEST_DATABASE_TEMPLATE=off` の案内を付けて失敗させる。

light の migration/setup suite（`scripts/gate.mjs`・`scripts/gate-select.mjs`）:

- AC-8 WHEN `pnpm gate:light` が DB 試験を選び（DB 全件への昇格がないとき）、migration/setup suite（試験ファイル自身か、同じディレクトリから import する補助ファイルが `runMigrations(` を呼ぶ DB suite。現在は `apps/api/test` の 10 件）がモジュールグラフだけで選ばれ、schema に関係する変更（AC-9）が無い THE SYSTEM SHALL その suite を実行せず full に回す。参照・ディレクトリ・setupFile・子プロセス・常時実行の規則でも選ばれた suite は回さない（`gate-select.mjs` はファイルごとに選んだ規則をすべて記録し、モジュールグラフが唯一の理由のときだけ回す）。`GATE_DEFER_SCHEMA_SUITES=0` のときは回さない。quick・full・`pnpm gate`・`pnpm test:db` の対象は変えない。
- AC-9 THE SYSTEM SHALL 次のいずれかを schema に関係する変更として migration/setup suite を実行する: 変更ファイルが schema を宣言する（`defineEntity(`・`defineDocument(`・`definePack(`・`registerExt(`・`registerSystemTable(` を含む）、同じ workspace package の schema 宣言ファイルから import される（enum の値や項目一覧を services に置く場合。vitest の Vite server で package 内の import を辿り、辿れなければ実行する側に倒す）、suite と同じ workspace package（`apps/api`: fixture・setup・seed・suite 自身）にある。migration・kernel・`apps/api/src/db` などは従来どおり昇格して DB 全件になる。
- AC-10 WHEN migration/setup suite を full に回した THE SYSTEM SHALL DB 工程の `selected.deferred`（件数）と報告の `deferred`（ファイル一覧）、工程の注記、表の `(+N deferred)`、hint（`pnpm gate:full` と `pnpm test:db` が実行する）に記録し、dry-run と実行時の標準出力に一覧を出す。schema に関係する変更があって実行したときは、その変更ファイルと理由を工程の注記に出す。

テンプレートの後始末（`kernel/src/test-database-cli.ts`）:

- AC-11 WHEN `pnpm test:db:templates` が実行された THE SYSTEM SHALL `TEST_DATABASE_URL_OWNER` / `TEST_DATABASE_URL`（環境変数かカレントディレクトリの `.env`）が指す試験 DB の自分のテンプレートを、大きさと最終利用時刻つきで最終利用の古い順に一覧し、`-- --drop` では接続中のものを除いて削除する。AC-4 の条件（`TEST_DATABASE_TEMPLATE` を除く）を満たさない DB、試験 DB 自身、他の試験 DB のテンプレート、印の無い DB には触れない。両方の変数が無ければ何もせず終了コード 2 で終わる。

## 関係するファイル・インターフェース（名指し）

- `kernel/src/test-database.ts`（新規）: `schemaBuild`・`applySchemaBuild`・`templateKey`・`templateName`・`templateComment` / `parseTemplateComment`・`isOwnTemplate`・`templatesToDrop`・`templateTarget`・`targetProblem`・`readTargetState`・`extraObjects`・`listTemplates`・`ownTemplates`・`prepareFromTemplate`（`sessionWaitMs`・`build` は試験用の引数）。`kernel/src/test-database-cli.ts`（新規）: `pnpm test:db:templates`。kernel 内の試験支援で、module からは使わない（`@daifuku/kernel/testing` 経由の `freshDb` だけが使う）
- `kernel/src/testing.ts`: `freshDb()` がテンプレートを試し、使えなければ従来の `dropAll` + `createSchemaFromScratch`。`schemaPreparation()`（直近の経路: `clone` / `built` / `legacy` と理由）を追加
- `kernel/src/db/migrate.ts`: `policyStatements()` と `RESET_STATEMENTS` を公開し、`enforcePolicies` / `dropAll` はそれを順に実行する（文・順序は従来と同一）
- `kernel/test/test-database.test.ts`（新規、unit）・`kernel/test/test-template.db.test.ts`（新規、DB）
- `scripts/gate.mjs`: `buildsSchemaFromMigrations`・`declaresSchema`・`deferSchemaSuites`、light の DB 選択に `deferSchemaSuites: true`、`applySelection`・`buildReport`・`formatTable` の記録。`scripts/gate-select.mjs`: 判定と package 内 import の探索。`scripts/gate.d.mts`: 型。`scripts/test/gate.test.ts`: `db-test-startup AC-8〜AC-10`
- 環境変数（すべて任意）: `TEST_DATABASE_TEMPLATE`（`auto` / `on` / `off`）、`TEST_DATABASE_TEMPLATE_LIMIT`（既定 80）、`TEST_DATABASE_MAINTENANCE_DB`（DB の作成・削除で接続する DB、既定 `postgres`）、`GATE_DEFER_SCHEMA_SUITES`（`0` で light の後回しをやめる）
- 文書: `CONTRIBUTING.md`、`README.md`（DB 試験の説明）、`docs/conventions/testing.md`、`docs/architecture/verification-and-release.md`、[test-tiers](test-tiers.md)（未決事項の解決、AC-3 と選択規則）、`scripts/check-doc-links.mjs`

## 実装時に確認した前提（計測とソース確認）

（実装後の計測は「検証手順」の結果欄と [作業記録](../log/2026-10-29-db-test-startup.md)）

| 前提 | 結果 | 方法 |
| --- | --- | --- |
| suite ごとに registry が違う | vitest の db project は file ごとに分離し、suite が import する module だけが登録される。DDL の構成は約 41 種類 | ソース確認と計測 |
| 試験が `OWNER_URL` / `APP_URL` を直接使う | `apps/mcp/test/stdio.db.test.ts` が子プロセスに渡す。別名の DB を suite ごとに作る方式では壊れるため、同じ名前の DB を作り直す方式にした | ソース確認 |
| `freshDb` の前に試験 DB へ接続する suite | 見当たらない（`beforeEach` で呼ぶ 3 suite は `afterEach` で閉じる）。前の suite の process の接続が残る場合に備え、待機と作り直しへの退避を入れた | ソース確認 |
| 試験 DB からテンプレートを複製した場合の大きさ | 49 MB（繰り返しの作り直しで system catalog が肥大。kernel だけの registry でも同じ）。template1 の新しい複製で作ると 8.6 MB | 実測 |
| `CREATE DATABASE` の権限 | CREATEDB と、複製元が template でなければ所有者であること。テンプレートは owner role の所有で作る。CI の `daifuku_ci_test` と `scripts/db-setup.sql` の owner は CREATEDB を持つ | ソースと PostgreSQL 16 の文書 |
| migration/setup suite の判定 | `runMigrations(` を自分で呼ぶのは 6 件。4 件（commerce-finance / edge / enterprise / shift）は `./legacy-fixture.ts` 経由のため、同じディレクトリの補助ファイルも見る | ソース確認と unit 試験 |

## スコープ外（明記）

- DB 試験の並列化（`fileParallelism: false` は維持）、vitest の isolate 設定の変更、light の静的検査と DB 工程の並行実行
- 試験本体の高速化（待ち時間や反復回数の変更）、試験の削除・skip・期待値の変更
- bootstrap tenant（scrypt のパスワードハッシュ、約 0.3 秒 / suite）のテンプレート化
- migration suite 自体の高速化（migration の適用そのものを検証するため複製しない）
- `pnpm gate`・`pnpm test:db`・`gate:full` の対象の変更（全 suite を実行する）
- テンプレート DB の自動全削除（上限を超えた古いものだけを落とす。全削除は `pnpm test:db:templates -- --drop` を手で実行する）、CI 設定の変更
- 開発環境で上限を下げること（全 suite の 1 回の実行で約 59 件の鍵を使うため、80 より下げると毎回作り直しが起きる）

## 検証手順（実行して記録する）

1. 実装前に全 DB suite の時間を分けて測る（上の計測）。
2. `pnpm exec vitest run --project unit kernel/test/test-database.test.ts scripts/test/gate.test.ts` が成功する。
3. `kernel/test/test-template.db.test.ts` が成功し、テンプレートの文を 1 つ欠かすと catalog 比較が失敗する（効き目の確認）。
4. `kernel/test/access-boundary.db.test.ts` と `noninterference.db.test.ts` を `TEST_DATABASE_TEMPLATE=off` と既定の両方で実行して成功する。
5. `pnpm test:db` 相当の全 116 suite を、テンプレートの無い状態（cold）と、ある状態（warm）で 1 回ずつ実行して成功し、suite ごとの時間を実装前と比べる。
6. 実装前と同じ変更（`modules/sales/src/settings.ts` に 1 行）で `pnpm gate:light --base HEAD` を実行し、所要時間を実装前と比べる（目標 6 分以内）。
7. `gate-select` を sales・banking・entity・enum 定数の変更で実行し、回す suite と理由を確認する。
8. `pnpm gate:light` を最終状態で実行する（`kernel/` を変えたため DB 全件に昇格する）。
9. （レビュー指摘の修正後）`kernel/test/test-template.db.test.ts` の AC-6・AC-7・余分な物の試験が成功し、修正を 1 つずつ戻すとそれぞれの試験が失敗する（効き目の確認）。`pnpm test:db:templates` の一覧と `-- --drop` を試験 DB で実行する。手順 4 と 8 をやり直す。

結果は [作業記録](../log/2026-10-29-db-test-startup.md) に記す。手順 1〜7 は実施済み（手順 5 の cold 実行の途中でテンプレート経路の 2 点を直したため、その実行は 2 つの版が混ざる。warm と手順 6 は最終の版）。手順 8 も実施した（`--base ebc7574`、kernel の変更で DB 全件に昇格、950 秒で成功）。手順 9 はレビュー指摘の修正（2026-10-30）で実施した。手順 5〜7 の時間はレビュー指摘の修正前の版の値で、修正後は測り直していない（修正は待機・余分な物の確認・失敗時の後始末で、正常経路で増えるのは試験 DB への確認の接続 1 回）。

### 結果の要約（この container、4 CPU、他エージェントと同居）

| 計測 | 実装前 | 実装後 |
| --- | ---: | ---: |
| 全 DB suite（`pnpm test:db` 相当、warm） | 877.8 秒（116 suite。計時を入れた実行、load average 2.0〜6.7。suite の時間の合計は 862.3 秒で、差の 15.5 秒は vitest の起動・終了と suite ごとの process 起動（推定）） | 776.1 秒（117 suite。新しい DB 試験 1 件を含む。計時なし、`TEST_DATABASE_TEMPLATE_LIMIT=200`、load average 1.8〜2.7。条件が違うため差は目安） |
| `freshDb()` 1 回（全 module の registry） | 3.5〜4.3 秒 | 0.6〜1.1 秒 |
| light、sales の 1 ファイル変更 | 792.6 秒（db 631.3、65 suite。負荷の高い 1 回目は 825.6） | **588.5 秒**（db 428.7、55 suite + 10 件後回し） |
| light、banking の 1 ファイル変更 | 未計測（suite ごとの値から DB 約 420 秒） | **407.6 秒**（db 244.4、28 suite + 10 件後回し） |

## 未決事項（利用者の判断待ち）

- **light の目標 6 分は未達。** banking の 1 ファイル変更で 6.8 分、sales で 9.8 分。残りは静的検査約 160 秒（format・typecheck 3 種・lint・unit・deploy）と、選ばれた DB suite の試験本体と import である（sales の 55 suite では `apps/api/test/identity-rate-limit.db.test.ts` が単独で約 54 秒）。次の選択肢: (a) light の静的検査と DB 工程を並行に実行する（gate の実行方法の変更。4 CPU の同居環境では効果を測ってから）、(b) 全 module を読む `apps/api` の DB suite（約 20 件）を module 変更でどこまで選ぶかを見直す（モジュールグラフより狭める判断）、(c) 目標を「module の 1 ファイル変更で 10 分以内」などに改める、(d) bootstrap tenant のテンプレート化（全 suite で約 36 秒、テナント ID が実行間で固定になる影響の確認が要る）。
- テンプレートの disk 使用を開発環境で許容するか。全 suite の 1 回の実行で約 59 件・約 0.7 GB、上限 80 件では 1 件 8〜21 MB で最大約 1.7 GB（試験 DB ごと）。試験 DB を多数持つ環境（この container は `daifuku_test_w1`〜`w36`）では合計が大きくなる。`pnpm test:db:templates -- --drop`（後始末）、`TEST_DATABASE_TEMPLATE_LIMIT`、`TEST_DATABASE_TEMPLATE=off` で調整できる。
- 従来の作り直し経路でも DB 名に `test` を要求するか（[test-tiers](test-tiers.md) の未決事項の残り）。今回はテンプレート経路だけに要求し、従来経路の挙動は変えていない。
- **light の後回し（AC-8〜AC-10）を受け入れるか。** test-tiers はこれを「モジュールグラフより狭める判断なので利用者の承認待ち」としていた。実施の根拠は下の「計画からの変更」のとおりワークフローの作業項目文で、利用者の承認ではない。承認されなければ `GATE_DEFER_SCHEMA_SUITES=0` で無効にでき、既定を変えるのは `scripts/gate.mjs` の 1 行である。後回しにより、module のサービス変更が旧データの移行結果と組み合わさったときだけ壊れる場合（`upgrade.db.test.ts` の `applyPayment` / `invoiceBalancesAsOf`、`industry-templates.db.test.ts` の売上請求書作成、`migrations.db.test.ts` の `seedAll`）は full まで見つからない。サービス単体と seed は後回しにしない他の suite（`sales.db.test.ts`、`demo-identity.db.test.ts` など）が実行する。この幅を受け入れるか。
- 計画からの変更: 計画は「schema の作り直しが 50% を超えるなら」実装するとしていたが、計測は 27% だった。light の目標に対して取り除ける最大の固定費だったため実装した（作業記録の「決めたこと」）。light の migration/setup suite の後回し（test-tiers の選択肢 (b)）は [完成度向上の実装計画](../completion-plan.md) の A3 には書かれていない。実施の根拠は、統括セッションのワークフローが 2026-10-29 に生成した round 2 の作業項目文（A3 を「DB test harness + light selection」と記す）である。test-tiers が挙げた migration 系 9 件に `industry-templates.db.test.ts` を加えた（同じく旧 schema に migration を適用する）。
