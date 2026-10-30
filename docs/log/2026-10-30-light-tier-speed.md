# 作業記録: 2026-10-30 light-tier-speed（light の短縮: 静的検査と DB 工程の並行、DB suite の shard 分割）

- セッション: A4 実装（Opus 5.5、worktree `wip/light-tier-speed`、基準 `ff65a6c`、他エージェントと同居する 4 CPU の一時 container、試験 DB `daifuku_test_w9` と shard DB `daifuku_test_w9_shard_2`/`_3`、04:35〜UTC） ／ 担当: agent ／ 対象: [docs/specs/light-tier-speed.md](../specs/light-tier-speed.md)
- 計測: tokens=null（未計測）, agent_minutes=約 200（04:35〜07:55 UTC。light 15 回の計測待ち約 150 分を含む）, human_minutes=0, rework_lines=約 10（commit 前に自分の試験の誤った期待値 2 件を直した。LPT の手計算の誤りと、lane の開始順を決め打ちした比較）, gate_failures=1（実装後の kernel の light 1 回が既存の時間依存の試験 `identity-rate-limit` で失敗。下記）

## 決めたこと（と理由）

- **作業項目文の 3 案のうち (1) 並行と (2) shard を採り、(3) 絞り込みは採らなかった。** 実装前の light の内訳（下の表）は、静的工程が約 190〜205 秒、DB 工程が 307〜939 秒で、DB の間は CPU の大半が空いていた（vitest の DB project は `fileParallelism: false` で 1 suite ずつ）。静的工程は `noEmit` と一時ディレクトリにしか書かず DB に接続しないので、DB 工程と同時に走らせても結果は変わらない。DB suite どうしも、別の DB なら干渉しない（spec の「並行実行の安全性」の確認）。(3) は現在の選択がすでに vitest のモジュールグラフであり、それより狭めるには「到達するが影響しない」ことの証明が要るため、被覆を下げない条件では行えないと判断した。
- **lane は 2 本だけにした。** 静的工程を 1 本の lane で計画順（format → docs → assurance → typecheck ×3 → lint → unit → deploy）に、DB 工程を別の lane にした。静的工程どうしも並べられるが、4 CPU で unit（vitest の worker 3 本）・型検査・DB 2 shard を同時に動かすと CPU を奪い合い、DB 側の時間（試験の timeout に近い suite がある）を延ばす。fail-fast の意味（最初の失敗で止める）も 1 本の lane なら従来どおり保てる。`--with-smoke` の工程は両 lane の後。
- **shard DB の名前は `<db>_shard_<k>`。** 作業項目文の例（`<db>_p2`）だと、`daifuku_test` から作る `daifuku_test_p2` が gate の DB 名規則（`daifuku_test_<suffix>`）を満たし、別の checkout が自分の試験 DB として使う名前と衝突しうる。`_shard_<k>` は接尾辞が 2 つになり規則を満たさないので、shard DB を誰かの試験 DB として指定することはできない（unit 試験で確認）。明示の `TEST_DATABASE_URL_SHARD_*` 変数は、利用者の設定を増やすだけで安全性が上がらないため作らなかった。
- **shard DB は gate が owner role で作る。** 無ければ保守用 DB から `CREATE DATABASE`（template1 から、owner role の所有）、あれば所有者を確かめる。kernel の `freshDb()` は shard DB を普通の試験 DB として扱い、テンプレートも shard DB ごとに作る。shard DB どうしでテンプレートを共有する案は、kernel の印・年齢切れ・使用中の判定を複数 DB で共有する変更になるため見送った（初回の shard は cold になる。未決事項）。CREATEDB が無い・名前が規則外・長すぎるときは失敗させず 1 shard で実行して注記する。
- **shard への割り当ては所要時間で行う。** vitest の `--shard` はファイル数で等分するため、54 秒の `identity-rate-limit` と 1 秒の suite が同じ重みになる。vitest 自身が全実行で更新する results cache（`node_modules/.vite/vitest/*/results.json`）の時間を読み、長い順に合計の小さい shard へ入れる（LPT）。cache が無ければ中央値か 6 秒で見積もる。見積りが外れても偏るだけで、選択と結果は変わらない。複数の vitest process が同じ cache を書くため、最後に終わった process の値が残る（見積りが古くなるだけで、vitest は読み書きの例外を握りつぶす。ソース確認）。
- **DB 全件への昇格でも shard する。** `pnpm test:db` は 1 process なので分けられない。`gate-select.mjs` に `all`（db project の全試験ファイル）を足し、vitest 自身の `vitest list --project db --filesOnly` と一致することを unit 試験で確かめた。shard 1 のときは従来どおり `pnpm test:db`。
- **失敗時の振る舞い。** lane をまたぐ fail-fast は従来の「最初の失敗で止める」に合わせ、他の lane で実行中の工程の process group を止めて `cancelled` とした（終了コード 0 で競合した工程は `passed`）。DB の shard どうしは止めない。1 つの vitest process が失敗後も残りのファイルを実行するのと同じく、どの suite が失敗したかを 1 回で知るためである。
- **出力は工程ごとの log に分けた。** 2 本の lane と 2 つの shard の出力を端末に混ぜると読めない。各工程の出力を `.runtime/gate/<UTC>-light/<工程>.log` に書き、端末には開始・終了の行、vitest の `Test Files` / `Tests` の行、失敗した log の末尾 80 行を出す。`--serial` では従来どおり端末にそのまま流す。
- **既定は CPU 4 以上で 2 shard。** 3 shard（sales、load average 13.1、shard 3 は初回でテンプレート作成を含む）は 492 秒で、2 shard の 440〜462 秒（load 8.7〜10.7）より速くならなかった。4 CPU を他のエージェントと分け合う環境では、DB process を増やしても静的 lane と CPU を奪い合うだけになる。CPU が 4 未満なら 1（lane 並行だけ）。
- **quick と full は変えなかった。** full は「完了」の根拠で、CI の gate job と同じ直列の `pnpm gate` 全工程を含むことを優先した。full での shard 利用は未決事項に残した。
- **kernel の変更は後始末の一覧と削除だけ。** `freshDb()` とテンプレートの経路は変えていない。`pnpm test:db:templates` が shard DB とそのテンプレートを一覧し、`--drop` でテンプレートの後に shard DB を 1 つずつ消す（使用中は残す）。DB 試験は light の shard（2〜8）と重ならない `<db>_shard_97` で確かめ、他の shard を消す操作をしない（同じ試験 DB で別の shard が実行中でも安全なように、一括削除の関数は作らなかった）。
- **ADR は書かなかった。** 検証の実行方法の変更で、本番の schema・権限・DSL・試験の内容は変えていない。

## やったこと

- `scripts/gate.mjs`: `resolveConcurrency`・`defaultDbShards`、`planLight` の lane、`dbStep` の `shards` と昇格時の `selection.all`、`planPhases`、`runSteps` の lane 並行（`cancel`・`cancelled`・`offset`・`details`）、`shardDatabaseName`・`shardDatabases`・`SHARD_DATABASE_NAME`・`SHARD_NAME_LIMIT`、`parseSuiteDurations`・`readSuiteDurations`・`partitionShards`・`planShards`、報告（`concurrency`、工程の `lane`・`offset`・`log`・`shards`、表の shard 行と lane の合計）、`testSummary`。実行部は `createSession`（実行中の command と工程の対応、`cancelOthers`）、`runCommand` の `owner`、`runShardedDb`・`availableShards`・`ensureShardDatabases`、工程 log と `reportFinished`、dry-run の shard 計画。CLI に `--serial`・`--db-shards`、環境変数 `GATE_PARALLEL`・`GATE_DB_SHARDS`。
- `scripts/gate-select.mjs`: 選択の本体を `related()` に移し、`all`（db project の全試験ファイル）を足した。`scripts/gate.d.mts`: 型。
- `kernel/src/test-database.ts`: `SHARD_INFIX`・`shardDatabaseName`・`isShardDatabase`・`ownShardDatabases`・`dropShardDatabase`。`kernel/src/test-database-cli.ts`: shard DB とそのテンプレートの一覧・削除。
- 試験: `scripts/test/gate.test.ts` に `light-tier-speed AC-1〜AC-8` の 28 件（lane の計画と実行順、shard の割り当て・見積り・DB 名、vitest との全件一致、並行度の解決と CLI、lane をまたぐ fail-fast・keep-going・中断、報告と表、sandbox で実プロセスを使う 3 件: 工程 log、静的工程の失敗で DB lane の process group が止まる、SIGTERM で両 lane の子孫が残らない）。`kernel/test/test-database.test.ts` に AC-7 の 2 件、`kernel/test/test-template.db.test.ts` に AC-7 の 1 件（実サーバーで shard DB の一覧と 1 件ずつの削除、使用中は残す）。既存の試験は変えていない（既存の light 計画の試験は lane なしの計画＝`--serial` の意味で引き続き検査する）。
- 文書: spec（新規）、[test-tiers](../specs/test-tiers.md)（実測、AC-3・AC-9 の追記、スコープ外と未決事項の更新）、[db-test-startup](../specs/db-test-startup.md)（未決事項の更新）、CONTRIBUTING（light の目安と並行・shard・log・後始末の説明）、[テスト規約](../conventions/testing.md)（DB suite が並行に耐える条件、shard DB のテンプレートと後始末、試験が作ってよい DB 名）、[検証と公開](../architecture/verification-and-release.md)、`scripts/check-doc-links.mjs`。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

すべてこの一時 container（4 CPU、他のエージェントが同時に DB 試験・ブラウザ試験・gate を実行し、load average は 2〜18 の間で変動）での値。CI の値ではない。

- [実測] 実装前（`ff65a6c`）の light: kernel 1,143 秒（cold、DB 131 suite 938.8 秒、load 平均 4.0）、banking 490 秒（DB 34 suite + 10 後回し 306.9 秒、load 2.6）、sales 674 秒（DB 63 suite + 10 後回し 504.1 秒、load 2.6）。同じ変更で A1/A3 の記録（banking 407.6 秒、sales 588.5 秒、kernel 950 秒）より長いのは、その後の round で DB suite が 117 → 131、unit が 1,207 → 1,547 試験に増えたためと考える（推定）。
- [実測] 実装前と実装後を交互に同じ時間帯で実行した組（spec の計測表）: banking 761 → 328 秒（load 11.9 / 9.4）、sales 813 → 462 秒（load 5.2 / 10.7）、kernel（warm）1,260 → 655 秒（load 5.3 / 7.1）。2 回目の実装後: banking 304 秒（load 8.9）、sales 440 秒（load 8.7。作業中の文書の変更が作業ツリーにあり、参照規則で DB suite が 1 件多い 64 件）。
- [実測] 目標 6 分: banking は達成、sales は load average 9〜11 の下で未達（7.3〜7.7 分）。負荷の低い時間帯の実装後の sales は測れなかった。
- [実測] shard の均衡: 実測の差は banking 23%、sales 1%、kernel 3%（cache の値が前回の高負荷の実行のものだった banking が最も偏った）。
- [実測] 3 shard（sales）: 492 秒（load 13.1、shard 3 は初回）。2 shard より速くならなかった。
- [実測] `pnpm test:db:templates`（一覧）: `daifuku_test_w9` のテンプレート 64 件・729.1 MB、`daifuku_test_w9_shard_2` 61 件・700.1 MB、`daifuku_test_w9_shard_3` 15 件・203.3 MB、shard DB 2 件（21.9 MB・8.4 MB）。shard DB のテンプレートも、割り当てが実行ごとに変わるため数回で本体とほぼ同じ数になる（disk は shard 数だけ増える。spec の未決事項）。
- [実測] shard DB の自動作成: 初回の light で `daifuku_test_w9_shard_2`（と 3 shard の実行で `_shard_3`）が owner role の所有で作られ、各 shard DB でテンプレートが作られた（`daifuku_test_w9_shard_2_tpl_*` 37 件、初回の実行後）。作り直しへの退避の通知は、余分な schema・既定権限を自分で作る `test-template.db.test.ts` の 2 件だけ（実装前と同じ）。
- [実測] 中断（検証手順 5）: 実行中の light（format と DB 2 shard が実行中）の外側の pnpm に SIGTERM → 終了コード 143、12 秒後に worktree のプロセスは 0、報告は `interrupted`（format と db が失敗、DB の両 shard が `exit SIGTERM`、残りは not-run）。unit 試験の sandbox でも、gate への SIGTERM で両 lane の子と孫が止まり、静的工程の失敗で DB lane の process group が止まって `cancelled` になることを確認した。
- [実測] `pnpm exec vitest run --project unit scripts/test/gate.test.ts kernel/test/test-database.test.ts`: 139 件成功（commit 前）。`kernel/test/test-template.db.test.ts`: 14 件成功（`daifuku_test_w9`）。`pnpm typecheck` と変更ファイルの eslint が成功。
- [実測] `--dry-run`（kernel の変更を含む作業ツリー）: DB 131 ファイルを 65 / 66 に分け、shard ごとの DB 名と見積り（335.2 秒ずつ）を表示し、shard DB は作らなかった。
- [実測] 失敗の検出: 実装後の kernel の light（06:29）は、shard 2 の `apps/api/test/identity-rate-limit.db.test.ts` の 1 件（`retains failed login limits across IPs ...`、11 回目のログインが 429 ではなく 401）で失敗し、工程と shard の失敗、log の末尾 80 行が出た。原因の調査は「見つけた問題」。
- [実測] 最終状態（`8172758`）の `pnpm gate:light`（既定の基準点 `origin/main`@`431dda5`、変更 292 ファイル、kernel の変更で DB 全件に昇格）: **814.7 秒で成功**（load average 7〜9）。静的 lane 415.5 秒（format 69.2、型 24.8 / 39.4 / 60.9、lint 50.0、unit 136.6 秒で 154 ファイル / 1,577 試験、deploy 33.6）、DB 814.5 秒（shard 1 `daifuku_test_w9` 65 ファイル / 407 試験 761.5 秒、shard 2 `daifuku_test_w9_shard_2` 66 ファイル / 416 試験 813.6 秒。計 131 ファイル / 823 試験 = 実装前の 822 試験 + 本作業の DB 試験 1 件）。
- [実測] `pnpm test:db:templates -- --drop`（検証手順 6）: `daifuku_test_w9` のテンプレート 64 件、`_shard_2` 63 件、`_shard_3` 15 件を消し、shard DB 2 件を消した。残ったのは `daifuku_test_w9` だけ（`pg_database` で確認）。
- [レビュー] 並行実行の安全性（spec の表）: DB suite のポート・ファイル・role・DB 作成・接続先の読み方、静的工程の書込み先をソースで確認した。
- [未検証] CI（CI は light を使わないため対象外）。CPU が 4 以外の環境での既定の shard 数。macOS での動作。
- [未検証] `pnpm gate:full`（統合担当が実行する。`kernel/` と `scripts/gate.mjs` の変更は昇格パターン）。

## 見つけた問題と修正（発見経路つき）

- `apps/api/test/identity-rate-limit.db.test.ts` の時間依存 — 発見: 実測（実装後の kernel の light）。`kernel/src/identity/rate-limit.ts` の失敗ログインの窓は壁時計の 300 秒区切り（`floor(now / 300 s)`）で、この試験だけ `Date` を固定していないため、11 回の scrypt が窓の境目をまたぐと 11 回目が 429 にならない。同じファイルの他の 2 試験は `vi.useFakeTimers({ toFake: ['Date'] })` で固定している。A1 の記録にも直列の実行で同居負荷の下で 1 回失敗した記録がある。並行実行で 1 回の時間が延びると起きやすくなりうる。この作業項目の範囲外の試験のため直さず、統合担当へ引き継いだ（修正案: 最初の試験も `Date` を固定する。期待値は変えない）。
- 自分の試験の期待値の誤り 2 件（LPT の手計算、lane の開始順の決め打ち） — 発見: unit 試験の初回実行。commit 前に直した。

## 未実施（減らさない。完了したら「済」を付けて残す）

- 負荷の低い時間帯（load average が CPU 数以下）での実装後の sales・banking の計測。
- `pnpm gate:full`（統合担当）。
- full での shard 利用、shard DB 間のテンプレート共有（spec の未決事項）。

## 判断待ち（利用者）

- sales の 1 ファイル変更の目標 6 分の扱い（高負荷では未達）。既定の shard 数。full での shard 利用。（spec の未決事項）

## 次のセッションへ

- light は既定で並行・2 shard。挙動を疑うときは `pnpm gate:light --serial` で従来どおりに戻して比べられる。工程の出力は `.runtime/gate/<UTC>-light/<工程>.log`。
- shard DB（`<試験DB名>_shard_<k>`）とそのテンプレートは `pnpm test:db:templates -- --drop` で消える。共有サーバーで試験 DB を多数持つ環境では、shard ごとにテンプレートが増える分の disk に注意する。
- DB suite を足すときは、別の DB で同時に動く他の suite と干渉しないこと（テスト規約の light の項）。
