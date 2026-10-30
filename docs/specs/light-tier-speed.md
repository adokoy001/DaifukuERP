# Spec: light-tier-speed（light の短縮: 静的検査と DB 工程の並行実行、DB suite の分割実行）

- 状態: draft
- モジュール: `scripts/gate.mjs`（light の lane 実行・DB shard・報告）、`scripts/gate-select.mjs`（DB 全件の列挙）、`scripts/gate.d.mts`、`kernel/src/test-database.ts`・`kernel/src/test-database-cli.ts`（shard DB の一覧と後始末） ／ 依存: [3 段階の回帰テスト](test-tiers.md)（A1）、[DB suite 起動の短縮](db-test-startup.md)（A3、schema テンプレート）
- ADR: 新規 ADR は不要（検証の実行方法の変更であり、本番の schema・権限・RLS・DSL・migration と試験の内容は変えない）。判断は本 spec、[テスト規約](../conventions/testing.md)、[検証と公開](../architecture/verification-and-release.md) に記す
- 作成: 2026-10-30 ／ 作成者: agent（A4 実装セッション。計画セッションの下書きは無く、統括ワークフローの作業項目文から作成）

## 目的（1段落）

`pnpm gate:light` は「push 前に回す」階層で、目標は module の 1 ファイル変更で約 6 分である（[test-tiers](test-tiers.md)）。A3 の schema テンプレート後も banking 6.8 分、sales 9.8 分、kernel 変更（DB 全件）約 16 分で、DB 工程が大半を占め、その間 CPU は 1 つの vitest worker と PostgreSQL しか使っていない。試験の選択・内容・件数を変えずに、(1) 互いに独立な静的検査（format・型・lint・unit・配布補助）と DB 工程を同時に走らせ、(2) 選ばれた DB suite を複数の試験 DB に分けて同時に実行することで、light を目標に近づける。full・`pnpm gate`・`pnpm test:db` は変えない。

## 選択肢の評価（作業項目文の 3 案）

| 案 | 内容 | 判断 |
| --- | --- | --- |
| (1) 静的検査と DB 工程の並行 | 静的検査を 1 本の lane（計画順に 1 工程ずつ）、DB 工程を別の lane とし、2 つを同時に実行する。工程ごとの結果・時間・報告の形は従来どおり | **採用**。静的検査（実測 約 160〜190 秒）が DB 工程の裏に隠れる。静的検査は読取専用（`noEmit`、`.runtime/` 以外へ書かない）で DB に接続しない（下の「並行実行の安全性」） |
| (2) DB suite の shard 分割 | 選ばれた DB suite を 2 つ以上の試験 DB（`<db>` と `<db>_shard_<k>`）に分け、shard ごとに 1 つの vitest process（各 shard の中は `fileParallelism: false` のまま）で同時に実行する | **採用**。DB 工程は suite の直列実行で、1 suite の大半は import・PostgreSQL の待ち・試験本体であり、別 DB なら互いに干渉しない。shard DB は owner role が作る（CREATEDB は A3 のテンプレートと同じ前提） |
| (3) 関連 suite の選択の絞り込み | import グラフで影響し得ないと証明できる suite だけ外す | **不採用**。現在の選択はすでに vitest のモジュールグラフ（＝import グラフで到達し得るもの）であり、さらに外すには「到達するが影響しない」ことの証明が要る。証明の無い絞り込みは被覆を下げるため、この spec では行わない（スコープ外） |

## 実装前の計測（2026-10-30、この container: 4 CPU、他エージェントと同居）

（計測の表は作業記録と同じ値。実装前は `ff65a6c`、実装後は本ブランチ。いずれも `--base HEAD` と 1 ファイルへの 1 行追加、`daifuku_test_w9` のテンプレートが warm の状態）

## 受入基準（EARS）

- AC-1 WHEN `pnpm gate:light` が `--serial` も `GATE_PARALLEL=0` も無く実行された THE SYSTEM SHALL 静的工程（format・docs・assurance・typecheck・typecheck:api・typecheck:web・lint・unit・deploy）を計画順に 1 つずつ実行する static lane と、DB 工程だけの db lane を同時に実行し、`--with-smoke` の工程は両 lane の終了後に実行する。報告の工程は従来と同じ id・計画順の 1 行ずつで、各工程に `lane` と、最初の工程の開始からの `offset`（秒）を加える。
- AC-2 WHEN DB 工程の shard 数 n が 2 以上で、選んだ試験ファイルがある THE SYSTEM SHALL ファイルを min(n, ファイル数) 個の shard に、vitest の results cache（`node_modules/.vite/vitest/*/results.json` の `db:<path>`）の所要時間の長い順に、その時点で合計の最も小さい shard へ割り当て（未計測のファイルは計測済みの中央値、無ければ 6 秒とみなす）、各ファイルを 1 回だけ実行する。shard 1 は `TEST_DATABASE_URL*` の DB、shard k は `<db>_shard_k` を使い、shard ごとに `vitest run --project db <files>` を 1 process で実行する（vitest の設定は不変、shard 内は `fileParallelism: false`）。DB 全件への昇格（AC-4 of test-tiers）で n ≥ 2 のときは `gate-select.mjs` が db project の全試験ファイル（`vitest run --project db` が実行するもの）を列挙して分割する。n = 1 のときの DB 工程は従来と同一（`pnpm test:db` または選んだファイルの 1 process）。
- AC-3 THE SYSTEM SHALL shard DB の名前を、`TEST_DATABASE_NAME`（`daifuku_test[_suffix]`・`daifuku_ci_test`）を満たす DB からだけ `<db>_shard_<k>`（k = 2..8）として作り、その名前自体は `TEST_DATABASE_NAME` を満たさない（別の checkout が自分の試験 DB として使えない）。名前はテンプレート名の余地（`SHARD_NAME_LIMIT` = 42 文字）に収まること。無い shard DB は owner role が保守用 DB（`postgres`、`TEST_DATABASE_MAINTENANCE_DB`）から `CREATE DATABASE`（template1 から、owner role の所有）で作り、ある場合は owner role の所有であることを確かめる。条件を満たさない・作れないときは失敗せず shard 1 だけで実行し、理由を工程の注記に書く。
- AC-4 THE SYSTEM SHALL light の並行度を次で決める: 既定は lane 並行、DB shard は CPU（`os.availableParallelism()`）が 4 以上なら 2、未満なら 1。`--db-shards <n>` か `GATE_DB_SHARDS`（1〜8、CLI が優先）で shard 数を、`--serial` か `GATE_PARALLEL=0` で従来の 1 工程ずつ・1 DB process に戻す。範囲外・不正な値、`--serial` と `--db-shards` の併用、light 以外での指定は使い方エラー（終了コード 2）とする。quick と full は常に従来どおり 1 工程ずつ・1 DB process である。
- AC-5 WHEN lane 並行の実行中に工程が失敗した（`--keep-going` なし） THE SYSTEM SHALL 以後の工程を起動せず（`not-run`）、他の lane で実行中の工程の process group 全体を停止して `cancelled`（理由 `stopped after <id> failed`）と報告する（停止が終了と競合して終了コード 0 で終わった工程は `passed`）。DB 工程の shard どうしは、1 つの vitest process が全ファイルを実行するのと同じく、他の shard が失敗しても最後まで実行する。`--keep-going` では止めない。中断（SIGINT・SIGTERM・SIGHUP・親の変化）では、test-tiers AC-9 のとおり実行中のすべての工程・shard の process group に signal を送り（猶予 10 秒後に SIGKILL）、実行中の工程を失敗、残りを `not-run`、結果を `interrupted` とする。
- AC-6 WHEN lane 並行で工程が実行された THE SYSTEM SHALL その工程の標準出力・標準エラーを `.runtime/gate/<UTC時刻>-light/<step>.log`（DB shard は `db-<k>.log`、選択は `db-select.log`）に書き、工程（と shard）ごとに開始と終了の行、vitest の `Test Files` / `Tests` の行、失敗した log の末尾 80 行を標準出力に出す。報告 JSON は工程ごとの `lane`・`offset`・`log`・`shards`（index・database・files・paths・estimate・seconds・result・reason・log）と全体の `concurrency`（parallel・dbShards・notes）を持ち、表は shard ごとの行と lane ごとの合計時間を出す。`--dry-run` は shard DB を作らずに shard ごとの DB とファイルと見積りを表示する。
- AC-7 WHEN `pnpm test:db:templates` が実行された THE SYSTEM SHALL 試験 DB のテンプレートに加えて、owner role が所有する shard DB（`<db>_shard_<n>`、n ≥ 2）と各 shard DB のテンプレートを一覧し、`-- --drop` では各テンプレートを消した後に shard DB を消す（接続中のものは残す）。それ以外の DB には触れない。
- AC-8 THE SYSTEM SHALL 試験の被覆を変えない: quick・full・`pnpm gate`・`pnpm test:db`・vitest の設定は不変、light が選ぶ DB suite の集合（関連・常時実行・後回しの規則）は不変で、shard のファイルの和集合はその集合に等しい。試験名フィルタ・skip・only を加えない。

## 関係するファイル・インターフェース（名指し）

- `scripts/gate.mjs`: `resolveConcurrency`・`defaultDbShards`（並行度）、`planLight` の `lane`、`dbStep` の `shards` と昇格時の `selection.all`、`planPhases`（lane の段）、`runSteps`（lane 並行・`cancel`・`cancelled`・`offset`・`details`）、`shardDatabaseName`・`shardDatabases`・`SHARD_DATABASE_NAME`・`SHARD_NAME_LIMIT`、`parseSuiteDurations`・`readSuiteDurations`・`partitionShards`・`planShards`、`buildReport`・`formatTable`（`concurrency`・shard の行）、`testSummary`。実行部: `createSession`（実行中の command と所有工程の対応、`cancelOthers`）、`runCommand` の `owner`、`runShardedDb`・`availableShards`・`ensureShardDatabases`、工程 log、`reportFinished`。CLI: `--serial`、`--db-shards <n>`
- `scripts/gate-select.mjs`: `all`（db project の全試験ファイル）
- `scripts/gate.d.mts`: 型。`scripts/test/gate.test.ts`: `light-tier-speed AC-1〜AC-8`
- `kernel/src/test-database.ts`: `SHARD_INFIX`・`shardDatabaseName`・`isShardDatabase`・`ownShardDatabases`。`kernel/src/test-database-cli.ts`: shard DB とそのテンプレートの一覧・削除。`kernel/test/test-database.test.ts`: AC-7
- 環境変数（すべて任意）: `GATE_PARALLEL`（`0` で 1 工程ずつ）、`GATE_DB_SHARDS`（1〜8）
- 文書: [test-tiers](test-tiers.md)、`CONTRIBUTING.md`、[テスト規約](../conventions/testing.md)、[検証と公開](../architecture/verification-and-release.md)、`scripts/check-doc-links.mjs`

## 並行実行の安全性（ソース確認、2026-10-30）

| 共有しうる資源 | 確認結果 |
| --- | --- |
| 試験 DB | shard ごとに別 DB。`OWNER_URL` / `APP_URL` は環境変数から読む（`kernel/src/testing.ts`）。子プロセスへ渡す suite（`apps/mcp/test/stdio.db.test.ts`）も同じ値を渡す |
| サーバー全体の物（role・DB・設定） | DB suite に `CREATE/ALTER/DROP ROLE`・`ALTER SYSTEM`・`pg_terminate_backend` は無い。DB を作る・消すのは `kernel/test/test-template.db.test.ts` だけで、名前は自分の試験 DB を接頭辞にした `<db>_tpl_*`（shard ごとに別名） |
| 待ち受けポート | DB suite のサーバーは `port: 0`（`apps/api/test/edge-relay.db.test.ts` など） |
| ファイル | DB suite が書くのは `mkdtemp` の一時ディレクトリ（証憑・旧 migration の複製）。静的工程は `noEmit` と一時ディレクトリ（`deploy/test`）だけ |
| テンプレート | shard DB ごとに自分のテンプレート（`<db>_shard_k_tpl_*`）を持つ。template1 からの同時 `CREATE DATABASE` は PostgreSQL の共有ロックで両立する（他エージェントの試験 DB で既に同時に起きている） |
| vitest の results cache | 各 process が終了時に同じ `results.json` を書く。読み書きは vitest 側で例外を握りつぶすため失敗にはならず、最後に書いた process の値が残る（所要時間の見積りが古くなるだけ） |
| 接続数 | shard ごとに suite が使う接続（owner 2・app 4・保守 1 と試験が起こすサーバー）。`max_connections` 100 に対し 2 shard で十分余る |

## スコープ外（明記）

- (3) 関連 suite の選択の絞り込み（上の評価）。後回し規則（[db-test-startup](db-test-startup.md) AC-8〜AC-10）も変えない
- quick と full の並行化・shard 化（full は CI と同じ直列の `pnpm gate` 全工程を正とする。未決事項）
- vitest の `fileParallelism`・isolate・worker 数の変更、試験の内容・時間の変更
- shard DB 間でのテンプレートの共有（shard ごとに作る。未決事項）
- CI 設定の変更（CI の gate job は `pnpm gate` を実行し、light を使わない）
- Windows でのプロセスグループ停止（test-tiers と同じ前提）

## 検証手順（実行して記録する）

1. 実装前（`ff65a6c`）に、A1/A3 と同じ 3 つの変更（`modules/banking/src/matching.ts`・`modules/sales/src/settings.ts`・`kernel/src/decimal.ts` への 1 行追加）で `pnpm gate:light --base HEAD` を warm のテンプレートで実行し、工程ごとの時間と load average を記録する。
2. `pnpm exec vitest run --project unit scripts/test/gate.test.ts kernel/test/test-database.test.ts` が成功する。
3. 実装後に手順 1 と同じ変更・同じ machine で light を実行し（shard DB を warm にした後）、実装前と比べる。可能なら実装前と交互に実行して負荷の偏りを減らす。
4. `--dry-run` で shard の割り当て（DB・ファイル数・見積り）が表示され、shard DB が作られないことを確認する。
5. 実行中の light に SIGTERM を送り、両 lane と全 shard の子孫が残らないことを確認する（unit 試験の sandbox と、実リポジトリでの手動実行）。
6. `pnpm test:db:templates` と `-- --drop` で shard DB とそのテンプレートが一覧・削除され、試験 DB 自身と他の DB が残ることを確認する。
7. `pnpm gate:light` を最終状態で実行する（`kernel/` を変えたため DB 全件に昇格する）。

## 未決事項（利用者の判断待ち）

- 既定の shard 数（4 CPU で 2）。3 以上は計測で判断した（作業記録）。CPU の多い環境での既定を変えるか。
- full（`gate:full`）でも DB 工程を shard 化するか。今回は CI との同一性を優先して変えていない。
- shard DB どうしでテンプレートを共有するか（disk と初回の作成時間が減るが、kernel の印・年齢切れの規則を複数 DB で共有する変更になる）。
