# Spec: light-tier-speed（light の短縮: 静的検査と DB 工程の並行実行、DB suite の分割実行）

- 状態: implemented
- モジュール: `scripts/gate.mjs`（light の lane 実行・DB shard・報告）、`scripts/gate-select.mjs`（DB 全件の列挙）、`scripts/gate.d.mts`、`kernel/src/test-database.ts`・`kernel/src/test-database-cli.ts`（shard DB の一覧と後始末） ／ 依存: [3 段階の回帰テスト](test-tiers.md)（A1）、[DB suite 起動の短縮](db-test-startup.md)（A3、schema テンプレート）
- ADR: 新規 ADR は不要（検証の実行方法の変更であり、本番の schema・権限・RLS・DSL・migration と試験の内容は変えない）。判断は本 spec、[テスト規約](../conventions/testing.md)、[検証と公開](../architecture/verification-and-release.md) に記す
- 作成: 2026-10-30 ／ 作成者: agent（A4 実装セッション。計画セッションの下書きは無く、統括ワークフローの作業項目文から作成）。実装: 同日、同セッション（[作業記録](../log/2026-10-30-light-tier-speed.md)）

## 目的（1段落）

`pnpm gate:light` は「push 前に回す」階層で、目標は module の 1 ファイル変更で約 6 分である（[test-tiers](test-tiers.md)）。A3 の schema テンプレート後も banking 6.8 分、sales 9.8 分、kernel 変更（DB 全件）約 16 分で、DB 工程が大半を占め、その間 CPU は 1 つの vitest worker と PostgreSQL しか使っていない。試験の選択・内容・件数を変えずに、(1) 互いに独立な静的検査（format・型・lint・unit・配布補助）と DB 工程を同時に走らせ、(2) 選ばれた DB suite を複数の試験 DB に分けて同時に実行することで、light を目標に近づける。full・`pnpm gate`・`pnpm test:db` は変えない。

## 選択肢の評価（作業項目文の 3 案）

| 案 | 内容 | 判断 |
| --- | --- | --- |
| (1) 静的検査と DB 工程の並行 | 静的検査を 1 本の lane（計画順に 1 工程ずつ）、DB 工程を別の lane とし、2 つを同時に実行する。工程ごとの結果・時間・報告の形は従来どおり | **採用**。静的検査（実測 約 170〜205 秒、load 2.6〜4.0）が DB 工程の裏に隠れる。静的検査は読取専用（`noEmit`、`.runtime/` 以外へ書かない）で DB に接続しない（下の「並行実行の安全性」） |
| (2) DB suite の shard 分割 | 選ばれた DB suite を 2 つ以上の試験 DB（`<db>` と `<db>_shard_<k>`）に分け、shard ごとに 1 つの vitest process（各 shard の中は `fileParallelism: false` のまま）で同時に実行する | **採用**。DB 工程は suite の直列実行で、1 suite の大半は import・PostgreSQL の待ち・試験本体であり、別 DB なら互いに干渉しない。shard DB は owner role が作る（CREATEDB は A3 のテンプレートと同じ前提） |
| (3) 関連 suite の選択の絞り込み | import グラフで影響し得ないと証明できる suite だけ外す | **不採用**。現在の選択はすでに vitest のモジュールグラフ（＝import グラフで到達し得るもの）であり、さらに外すには「到達するが影響しない」ことの証明が要る。証明の無い絞り込みは被覆を下げるため、この spec では行わない（スコープ外） |

## 計測（2026-10-30、この container: 4 CPU、他エージェントが同時に DB 試験・ブラウザ試験・gate を実行）

方法: A1/A3 と同じ 3 つの変更（`modules/banking/src/matching.ts`・`modules/sales/src/settings.ts`・`kernel/src/decimal.ts` の末尾に注釈 1 行）を作業ツリーに置き、`pnpm gate:light --base HEAD` を実行した。実装前は `ff65a6c`（作業ツリーを detached で切り替え）、実装後は本ブランチの `543e630`。試験 DB は `daifuku_test_w9`（テンプレート warm）、shard DB は `daifuku_test_w9_shard_2`。load average（1 分値）は 15 秒ごとに採った平均。負荷が時間帯で大きく変わったため、実装前と実装後を交互に、同じ時間帯で実行した組を主に比べる。

| 変更 | 実装前（1 工程ずつ・1 DB process） | 実装後（lane 並行・2 shard） |
| --- | --- | --- |
| banking | 490 秒（load 2.6、04:59）、761 秒（load 11.9、05:47） | **328 秒**（load 9.4、05:41）、**304 秒**（load 8.9、07:01） |
| sales | 674 秒（load 2.6、05:07）、813 秒（load 5.2、06:16） | **462 秒**（load 10.7、06:00）、**440 秒**（load 8.7、07:06。作業ツリーに文書の変更 5 件があり、DB suite は 64 件）、3 shard 492 秒（load 13.1、shard 3 は初回） |
| kernel（DB 全件） | 1,143 秒（cold、load 4.0、04:39）、1,260 秒（warm、load 5.3、06:40） | 1,045 秒（shard 2 が初回、load 11.8、05:23）、**655 秒**（warm、load 7.1、06:29。`identity-rate-limit` の時間依存の 1 件が失敗）、**815 秒**（成功。最終状態 `8172758`、基準 `origin/main`@`431dda5` で変更 292 件、load 7〜9、07:18）、**639 秒**（成功。レビュー後の最終状態、load 平均 6.5（2.5〜10.0）、09:14） |

工程ごと（同じ時間帯の組。秒）:

| 組 | 静的工程の合計 | DB 工程 | 全体 |
| --- | ---: | ---: | ---: |
| banking 実装前 05:47（34 suite + 10 後回し） | 294.3 | 466.1 | 761 |
| banking 実装後 05:41 | 328.2（lane） | 290.1（shard 282.8 / 230.0） | 328 |
| sales 実装前 06:16（63 suite + 10 後回し） | 254.9 | 557.6 | 813 |
| sales 実装後 06:00 | 375.8（lane） | 460.8（shard 447.8 / 453.6） | 462 |
| kernel 実装前 06:40（131 suite） | 201.6 | 1,058.7 | 1,260 |
| kernel 実装後 06:29 | 316.2（lane） | 654.3（shard 653.8 / 634.1） | 655 |

- 同じ時間帯の組で、light は banking 57%、sales 43%、kernel 48% 短くなった。ただし kernel の 655 秒の回は試験 1 件が失敗しており、成功した 815 秒の回（別の時間帯）で比べると 1,260 秒から 35% である（参考: レビュー後の 639 秒の回、load 平均 6.5 では 49%）。静的工程は DB 工程と CPU を分け合うため単独より 1.1〜1.6 倍遅くなるが、DB 工程の裏に入る（banking では静的 lane が全体を決めた）。
- shard の見積り（vitest の results cache）による割り当ては、実測の差が 1〜23% だった（banking 282.8 / 230.0 秒、sales 447.8 / 453.6 秒、kernel 653.8 / 634.1 秒）。
- 目標 6 分（360 秒）: banking は達成（304〜328 秒）。sales は load average 9〜11 の下で 440〜462 秒で**未達**。負荷の低い時間帯の実装後の sales は測れていない（未決事項）。

## 受入基準（EARS）

- AC-1 WHEN `pnpm gate:light` が `--serial` も `GATE_PARALLEL=0` も無く実行された THE SYSTEM SHALL 静的工程（format・docs・assurance・typecheck・typecheck:api・typecheck:web・lint・unit・deploy）を計画順に 1 つずつ実行する static lane と、DB 工程だけの db lane を同時に実行し、`--with-smoke` の工程は両 lane の終了後に実行する。報告の工程は従来と同じ id・計画順の 1 行ずつで、各工程に `lane` と、最初の工程の開始からの `offset`（秒）を加える。
- AC-2 WHEN DB 工程の shard 数 n が 2 以上で、選んだ試験ファイルがある THE SYSTEM SHALL ファイルを min(n, ファイル数) 個の shard に、vitest の results cache（`node_modules/.vite/vitest/*/results.json` の `db:<path>`）の所要時間の長い順に、その時点で合計の最も小さい shard へ割り当て（未計測のファイルは計測済みの中央値、無ければ 6 秒とみなす。light が各 DB process の終了直後に results cache から読んで `.runtime/gate/durations.json` に残した値があれば、そちらを優先する）、各ファイルを 1 回だけ実行する。shard 1 は `TEST_DATABASE_URL*` の DB、shard k は `<db>_shard_k` を使い、shard ごとに `vitest run --project db <files>` を 1 process で実行する（vitest の設定は不変、shard 内は `fileParallelism: false`）。DB 全件への昇格（test-tiers の AC-4）で n ≥ 2 のときは `gate-select.mjs` が db project の全試験ファイル（`vitest run --project db` が実行するもの）を列挙して分割する。n = 1 のときの DB 工程は従来と同一（`pnpm test:db` または選んだファイルの 1 process）。
- AC-3 THE SYSTEM SHALL shard DB の名前を、`TEST_DATABASE_NAME`（`daifuku_test[_suffix]`・`daifuku_ci_test`）を満たす DB からだけ `<db>_shard_<k>`（k = 2..8）として作り、その名前自体は `TEST_DATABASE_NAME` を満たさない（別の checkout が自分の試験 DB として使えない）。名前はテンプレート名の余地（`SHARD_NAME_LIMIT` = 42 文字）に収まること。無い shard DB は owner role が保守用 DB（`postgres`、`TEST_DATABASE_MAINTENANCE_DB`）から `CREATE DATABASE`（template1 から、owner role の所有）で作り、ある場合は owner role の所有であることを確かめる。条件を満たさない・作れないときは失敗せず shard 1 だけで実行し、理由をその時点の標準出力（`db: one DB process (<理由>)`）、工程の注記の先頭、報告の `concurrency.notes` に書く（shard DB を作ったときも同じ）。DB 工程の注記は、使いうるすべての shard DB を `recreates <db>, <db>_shard_2 on <host>` のように名指しする。
- AC-4 THE SYSTEM SHALL light の並行度を次で決める: 既定は lane 並行、DB shard は CPU（`os.availableParallelism()`）が 4 以上なら 2、未満なら 1。`--db-shards <n>` か `GATE_DB_SHARDS`（1〜8、CLI が優先）で shard 数を、`--serial` か `GATE_PARALLEL=0` で従来の 1 工程ずつ・1 DB process に戻す。範囲外・不正な値、`--serial` と `--db-shards` の併用、light 以外での指定は使い方エラー（終了コード 2）とする。quick と full は常に従来どおり 1 工程ずつ・1 DB process である。
- AC-5 WHEN lane 並行の実行中に工程が失敗した（`--keep-going` なし） THE SYSTEM SHALL 以後の工程を起動せず（`not-run`）、他の lane で実行中のすべての工程（command の合間、例えば選択の後で shard の起動前の工程を含む。以後の command を起動しない）の process group 全体を停止して `cancelled`（理由 `stopped after <id> failed`）と報告する（停止が終了と競合して終了コード 0 で終わった工程は `passed`）。DB 工程の shard どうしは、1 つの vitest process が全ファイルを実行するのと同じく、他の shard が失敗しても最後まで実行する。`--keep-going` では止めない。中断（SIGINT・SIGTERM・SIGHUP・親の変化）では、test-tiers AC-9 のとおり実行中のすべての工程・shard の process group に signal を送り（猶予 10 秒後、その command がまだ終わっていなければ SIGKILL）、実行中の工程を失敗、残りを `not-run`、結果を `interrupted` とする。
- AC-6 WHEN lane 並行で工程が実行された THE SYSTEM SHALL その工程の標準出力・標準エラーを `.runtime/gate/<UTC時刻>-light/<step>.log`（DB shard は `db-<k>.log`、選択は `db-select.log`）に書き、工程（と shard）ごとに開始と終了の行（工程の開始行に log の場所、shard の開始行に DB・ファイル数・見積り・log、終了行に秒）、vitest の `Test Files` / `Tests` の行、失敗した log の vitest の `FAIL` 行（失敗した suite と試験。最大 20 件）と末尾 80 行を標準出力に出し、失敗した試験ファイルを工程の理由に加える。試験の選択が失敗したときも `db-select.log` の末尾を出し、報告の `log` に記録する。報告 JSON は工程ごとの `lane`・`offset`・`log`・`failed`・`shards`（index・database・files・paths・estimate・seconds・result・reason・failed・log）と全体の `concurrency`（parallel・dbShards・notes）を持ち、表は shard ごとの行、lane ごとの合計時間、DB 工程が使った shard 数（`DB shards <使った数> of <指定数>`）を出す。`--dry-run` は shard DB を作らずに shard ごとの DB とファイルと見積りを表示する。
- AC-7 WHEN `pnpm test:db:templates` が実行された THE SYSTEM SHALL 試験 DB のテンプレートに加えて、owner role が所有する shard DB（`<db>_shard_<n>`、n = 2〜8、`<db>` が `daifuku_test[_suffix]`・`daifuku_ci_test` のとき。gate が作る名前だけ）と、shard DB のテンプレート（名前と印で見つける。shard DB が無くなったものも）を一覧し、`-- --drop` では各テンプレートを消した後、テンプレートがすべて消えた shard DB を消す（接続中のもの、使用中のテンプレートが残るものは残す）。shard DB は試験 DB として使われ、DB 単位のコメントを持つ試験 DB はテンプレートを使えないため、印を付けず名前と所有者で判別する。それ以外の DB には触れない。
- AC-8 THE SYSTEM SHALL 試験の被覆を変えない: quick・full・`pnpm gate`・`pnpm test:db`・vitest の設定は不変、light が選ぶ DB suite の集合（関連・常時実行・後回しの規則）は不変で、shard のファイルの和集合はその集合に等しい。試験名フィルタ・skip・only を加えない。

## 関係するファイル・インターフェース（名指し）

- `scripts/gate.mjs`: `resolveConcurrency`・`defaultDbShards`（並行度）、`planLight` の `lane`、`dbStep` の `shards` と昇格時の `selection.all`、`planPhases`（lane の段）、`runSteps`（lane 並行・`cancel`・`cancelled`・`offset`・`details`）、`shardDatabaseName`・`shardDatabases`・`SHARD_DATABASE_NAME`・`SHARD_NAME_LIMIT`、`parseSuiteDurations`・`readSuiteDurations`・`partitionShards`・`planShards`、`buildReport`・`formatTable`（`concurrency`・shard の行）、`testSummary`。実行部: `createSession`（実行中の command と所有工程の対応、`cancelOthers`、`notes`）、`runCommand` の `owner`、`runShardedDb`・`availableShards`（試験のため process の処理を引数で差し替えられる）・`ensureShardDatabases`、`runLogged`（工程 log）、`failedTests`・`failedFiles`、`StepError`（選択の失敗の log）、`parseGateDurations`・`captureSuiteDurations`・`recordSuiteDurations`・`DURATIONS_FILE`、`reportFinished`。CLI: `--serial`、`--db-shards <n>`
- `scripts/gate-select.mjs`: `all`（db project の全試験ファイル）
- `scripts/gate.d.mts`: 型。`scripts/test/gate.test.ts`: `light-tier-speed AC-1〜AC-8`
- `kernel/src/test-database.ts`: `SHARD_INFIX`・`SHARD_BASE_NAME`・`MAX_SHARD_INDEX`・`shardDatabaseName`・`isShardDatabase`・`isShardTemplate`・`ownShardDatabases`・`ownShardTemplates`・`ownShards`・`dropShardDatabase`。`kernel/src/test-database-cli.ts`: shard DB とそのテンプレートの一覧・削除。`kernel/test/test-database.test.ts`: AC-7
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
| vitest の results cache | 各 process（DB shard と unit）が終了時に、開始時に読んだ内容へ自分の結果を足して同じ `results.json` を書く。読み書きは vitest 側で例外を握りつぶすため失敗にはならないが、最後に書いた process の値しか残らず、他の shard と unit のその回の更新は失われる（実測: 2 shard の light の後、cache の db 項目は 1 shard 分だけ）。vitest はこの cache をファイルの実行順にしか使わず、結果は変わらない。light は各 DB process の終了直後に cache からその process のファイルの値を読み、`.runtime/gate/durations.json` に残して割り当てに優先して使う（unit の値は戻さない） |
| 接続数 | shard ごとに suite が使う接続（owner 2・app 4・保守 1 と試験が起こすサーバー）。`max_connections` 100 に対し 2 shard で十分余る |

## 実装時に確認した前提（ソース確認と実測）

| 前提 | 結果 | 方法 |
| --- | --- | --- |
| vitest の results cache | `node_modules/.vite/vitest/<hash>/results.json` に `[["<project>:<path>", { duration, failed }]]`。`vitest run` の終了時に書き、読み書きの例外は握りつぶす | vitest 5.0.0 の dist ソース |
| `vitest list --project db --filesOnly` と `gate-select` の `all` | 同じ 131 ファイル | unit 試験（AC-2 AC-8） |
| 2 shard の見積りの均衡 | 全 131 suite で 351.9 / 352.0 秒（cache の値） | `partitionShards` を cache で実行 |
| shard DB の作成 | owner role が `CREATE DATABASE daifuku_test_w9_shard_2`（初回の light で自動）、その後の suite はテンプレートを作って複製（作り直しへの退避の通知なし） | 実測 |
| 複数 process の results cache | 2 shard の light の後、cache の db 項目は 1 shard 分しか残らない（レビューの実測）。各 process の終了直後に読めば、その process の値は取れる | 実測（レビュー）、vitest 5.0.0 のソース、単体試験 |
| 実リポジトリでの中断 | 実行中の light（静的 lane の format と DB 2 shard）の外側 pnpm に SIGTERM: 終了コード 143、12 秒後に worktree のプロセス 0、報告は `interrupted`（format・db が失敗、残りは not-run） | 実測（検証手順 5） |

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
8. （レビュー後に追加）`scripts/test/gate.test.ts` の shard 実行の試験（fake の runCommand による `runShardedDb`・`availableShards` の単体試験と、fake の gate-select・vitest・postgres driver を置いた sandbox で `GATE_DB_SHARDS=2` の light を実プロセスで実行する試験。他の lane の失敗と gate への SIGTERM で両 shard の vitest とその子孫がすべて止まることを含む）と、`kernel/test/test-template.db.test.ts` の AC-7（使い捨ての基名の shard DB、規則外の名前、shard DB の無いテンプレート、使用中のテンプレート）が成功する。

結果は [作業記録](../log/2026-10-30-light-tier-speed.md) に記す。手順 1〜7 は実施した（手順 3 は同居負荷の高い時間帯で、負荷の低い時間帯の実装後は未計測。手順 7 は 814.7 秒で成功、DB 131 ファイルを 2 shard で実行）。手順 8 はレビュー後に実施し、修正後の最終状態で手順 7 を再実行した639.4 秒で成功、load average 平均 6.5。

## 未決事項（利用者の判断待ち）

- **sales の 1 ファイル変更の目標 6 分は、同居負荷（load average 9〜11）の下では未達**（440〜462 秒）。残りは CPU の総量で決まる。目標を「load average が CPU 数以下のとき 6 分」と読み替えるか、目標を改めるか。負荷の低い時間帯の実装後の計測は未実施。
- 既定の shard 数（CPU 4 以上で 2）。3 shard は load average 13 の下で速くならなかった（492 秒。shard 3 は初回で、テンプレート作成を含む）。CPU の多い環境で既定を増やすか。
- full（`gate:full`）でも DB 工程を shard 化するか。今回は CI の gate job（`pnpm gate`）との同一性を優先して変えていない。
- shard DB どうしでテンプレートを共有するか（disk と初回の作成時間が減るが、kernel の印・年齢切れ・使用中の判定を複数 DB で共有する変更になる）。shard DB ごとのテンプレートは上限 80 件（shard DB ごと）。実測では、割り当てが実行ごとに変わるため数回の実行で shard DB も試験 DB 本体とほぼ同じ数になった（`daifuku_test_w9` 64 件・729 MB、`_shard_2` 61 件・700 MB、3 shard を 1 回試した `_shard_3` 15 件・203 MB）。shard 数だけ disk が増える。
- 実装後の kernel の計測（06:29）で `apps/api/test/identity-rate-limit.db.test.ts` の最初の試験（10 回の失敗ログインの後の 11 回目が 429）が 1 回失敗した（401）。`kernel/src/identity/rate-limit.ts` の窓は壁時計の 300 秒区切りで、この試験だけ `Date` を固定していない（同じファイルの他の 2 試験は固定している）。11 回の scrypt が窓の境目をまたぐと失敗する時間依存の試験で、A1 の計測（直列）でも同居負荷の下で 1 回失敗している。並行実行で 1 回の時間が延びると起きやすくなりうる。この spec の範囲外のため直していない（統合担当への引継ぎ）。
- 作業項目文の (2) にある明示の `TEST_DATABASE_URL_SHARD_*` 変数は作らず、名前を導出する方式だけにした。別サーバーや別名の shard DB が必要になったら足す。
