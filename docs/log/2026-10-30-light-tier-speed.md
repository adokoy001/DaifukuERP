# 作業記録: 2026-10-30 light-tier-speed（light の短縮: 静的検査と DB 工程の並行、DB suite の shard 分割）

- セッション: A4 実装（Opus 5.5、worktree `wip/light-tier-speed`、基準 `ff65a6c`、他エージェントと同居する 4 CPU の一時 container、試験 DB `daifuku_test_w9` と shard DB `daifuku_test_w9_shard_2`/`_3`、04:35〜UTC） ／ 担当: agent ／ 対象: [docs/specs/light-tier-speed.md](../specs/light-tier-speed.md)
- 計測: tokens=null（未計測）, agent_minutes=約 200（04:35〜07:55 UTC。light 15 回の計測待ち約 150 分を含む）, human_minutes=0, rework_lines=約 10（commit 前に自分の試験の誤った期待値 2 件を直した。LPT の手計算の誤りと、lane の開始順を決め打ちした比較）, gate_failures=1（実装後の kernel の light 1 回が既存の時間依存の試験 `identity-rate-limit` で失敗。下記）。レビュー後の修正（修正担当、別セッション）: agent_minutes=約 65（08:37〜09:45 UTC。light 3 回の待ち約 30 分を含む）, rework_lines=約 550（`scripts/gate.mjs`・`scripts/gate.d.mts`・`kernel/src/test-database*.ts` の追加と変更。試験と文書を除く）, gate_failures=2（修正後の light の 1 回目は既存の `identity-runner` の固定ポート、2 回目は自分の sandbox の試験の時間の競合。3 回目で成功）。2 回目のレビュー後の修正（修正担当、別セッション）: agent_minutes=約 25（09:49〜10:15 UTC。light 1 回の待ち約 4 分を含む）, rework_lines=0（試験と文書だけ。`scripts/gate.mjs` は変えていない）, gate_failures=0

## 決めたこと（と理由）

- **作業項目文の 3 案のうち (1) 並行と (2) shard を採り、(3) 絞り込みは採らなかった。** 実装前の light の内訳（下の表）は、静的工程が約 170〜205 秒（load 2.6〜4.0）、DB 工程が 307〜939 秒で、DB の間は CPU の大半が空いていた（vitest の DB project は `fileParallelism: false` で 1 suite ずつ）。静的工程は `noEmit` と一時ディレクトリにしか書かず DB に接続しないので、DB 工程と同時に走らせても結果は変わらない。DB suite どうしも、別の DB なら干渉しない（spec の「並行実行の安全性」の確認）。(3) は現在の選択がすでに vitest のモジュールグラフであり、それより狭めるには「到達するが影響しない」ことの証明が要るため、被覆を下げない条件では行えないと判断した。
- **lane は 2 本だけにした。** 静的工程を 1 本の lane で計画順（format → docs → assurance → typecheck ×3 → lint → unit → deploy）に、DB 工程を別の lane にした。静的工程どうしも並べられるが、4 CPU で unit（vitest の worker 3 本）・型検査・DB 2 shard を同時に動かすと CPU を奪い合い、DB 側の時間（試験の timeout に近い suite がある）を延ばす。fail-fast の意味（最初の失敗で止める）も 1 本の lane なら従来どおり保てる。`--with-smoke` の工程は両 lane の後。
- **shard DB の名前は `<db>_shard_<k>`。** 作業項目文の例（`<db>_p2`）だと、`daifuku_test` から作る `daifuku_test_p2` が gate の DB 名規則（`daifuku_test_<suffix>`）を満たし、別の checkout が自分の試験 DB として使う名前と衝突しうる。`_shard_<k>` は接尾辞が 2 つになり規則を満たさないので、shard DB を誰かの試験 DB として指定することはできない（unit 試験で確認）。明示の `TEST_DATABASE_URL_SHARD_*` 変数は、利用者の設定を増やすだけで安全性が上がらないため作らなかった。
- **shard DB は gate が owner role で作る。** 無ければ保守用 DB から `CREATE DATABASE`（template1 から、owner role の所有）、あれば所有者を確かめる。kernel の `freshDb()` は shard DB を普通の試験 DB として扱い、テンプレートも shard DB ごとに作る。shard DB どうしでテンプレートを共有する案は、kernel の印・年齢切れ・使用中の判定を複数 DB で共有する変更になるため見送った（初回の shard は cold になる。未決事項）。CREATEDB が無い・名前が規則外・長すぎるときは失敗させず 1 shard で実行して注記する。
- **shard への割り当ては所要時間で行う。** vitest の `--shard` はファイル数で等分するため、54 秒の `identity-rate-limit` と 1 秒の suite が同じ重みになる。vitest 自身が全実行で更新する results cache（`node_modules/.vite/vitest/*/results.json`）の時間を読み、長い順に合計の小さい shard へ入れる（LPT）。cache が無ければ中央値か 6 秒で見積もる。見積りが外れても偏るだけで、選択と結果は変わらない。複数の vitest process が同じ cache を書くため、最後に終わった process の値しか残らない（当初は「見積りが古くなるだけ」と書いたが、レビューで他の shard と unit のその回の値が失われることが分かった。下の「レビュー指摘への対応」）。そのため各 DB process の終了直後に cache からその process のファイルの値を読み、`.runtime/gate/durations.json` に残して優先して使う。
- **DB 全件への昇格でも shard する。** `pnpm test:db` は 1 process なので分けられない。`gate-select.mjs` に `all`（db project の全試験ファイル）を足し、vitest 自身の `vitest list --project db --filesOnly` と一致することを unit 試験で確かめた。shard 1 のときは従来どおり `pnpm test:db`。
- **失敗時の振る舞い。** lane をまたぐ fail-fast は従来の「最初の失敗で止める」に合わせ、他の lane で実行中の工程の process group を止めて `cancelled` とした（終了コード 0 で競合した工程は `passed`）。DB の shard どうしは止めない。1 つの vitest process が失敗後も残りのファイルを実行するのと同じく、どの suite が失敗したかを 1 回で知るためである。
- **出力は工程ごとの log に分けた。** 2 本の lane と 2 つの shard の出力を端末に混ぜると読めない。各工程の出力を `.runtime/gate/<UTC>-light/<工程>.log` に書き、端末には開始行（log の場所。shard は DB・ファイル数・見積り・log）と終了行（秒）、vitest の `Test Files` / `Tests` の行、失敗した log の vitest の `FAIL` 行と末尾 80 行を出す（`FAIL` 行と開始行はレビュー後に追加）。`--serial` では従来どおり端末にそのまま流す。
- **既定は CPU 4 以上で 2 shard。** 3 shard（sales、load average 13.1、shard 3 は初回でテンプレート作成を含む）は 492 秒で、2 shard の 440〜462 秒（load 8.7〜10.7）より速くならなかった。4 CPU を他のエージェントと分け合う環境では、DB process を増やしても静的 lane と CPU を奪い合うだけになる。CPU が 4 未満なら 1（lane 並行だけ）。
- **quick と full は変えなかった。** full は「完了」の根拠で、CI の gate job と同じ直列の `pnpm gate` 全工程を含むことを優先した。full での shard 利用は未決事項に残した。
- **kernel の変更は後始末の一覧と削除だけ。** `freshDb()` とテンプレートの経路は変えていない。`pnpm test:db:templates` が shard DB とそのテンプレートを一覧し、`--drop` でテンプレートを消した後、テンプレートがすべて消えた shard DB を 1 つずつ消す（使用中は残す）。shard DB は gate が作る名前（`daifuku_test[_suffix]`・`daifuku_ci_test` の `_shard_2`〜`_shard_8`）と所有者だけで判別し、そのテンプレートは印から見つける（shard DB が無くなっても残らない）。DB 試験は、どの checkout も使わない使い捨ての基名 `daifuku_test_g<16進8桁>` の shard 名で確かめ、試験 DB 自身の shard には触れない（レビュー後に変更。当初は `<db>_shard_97` を shard として扱っていた）。
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
- [実測] レビュー後の修正（修正担当、08:37〜 UTC）: `scripts/test/gate.test.ts` は 127 件成功（light-tier-speed の試験は 28 件から 41 件。うち sandbox で実プロセスを使う shard の試験 4 件）。sandbox の 7 件（並行 light の 3 件と shard の 4 件）を 3 つ同時に実行しても成功した。足した試験が回帰を捕まえることを、`runShardedDb` の 3 か所（shard ごとの所要時間の記録、開始前の取消しの確認、`FAIL` 行の出力）を壊して確かめた（4 件が失敗し、戻して成功）。`kernel/test/test-database.test.ts` は 26 件、`kernel/test/test-template.db.test.ts` は 14 件成功（`daifuku_test_w9`）。`pnpm typecheck`、変更ファイルの eslint、`pnpm docs:check` も成功。
- [実測] `pnpm test:db:templates`（修正後、`daifuku_test_w9`）: shard DB の無いテンプレート `daifuku_test_w9_shard_5_tpl_0123456789abcdef`（印あり）を「shard database no longer exists」として一覧し、`-- --drop` で消した。手で作った `daifuku_test_w9_shard_42` は一覧にも削除にも出なかった（確認後に手で消した）。
- [実測] `--dry-run`（修正後）: DB 工程の注記が `recreates daifuku_test_w9, daifuku_test_w9_shard_2 on 127.0.0.1:5432` になり、表の `concurrency:` 行は `DB shards 2 of 2`。shard DB は作られなかった（`pg_database` で確認）。
- [実測] 修正後の light の 1 回目（08:58、`daifuku_test_w9_shard_2` は初回で空から作成）: unit の `apps/api/test/identity-runner.test.ts`（固定ポート 3109/5189 を使う試験）が 1 件失敗し、DB の 2 shard は 383 秒で `cancelled`（`stopped after unit failed`）、終了コード 1、worktree のプロセスは残らなかった。新しい出力の実例になった: 終了行に秒と失敗したファイル（`unit: failed 160.1s (exit 1: apps/api/test/identity-runner.test.ts)`）、`FAIL` 行、shard ごとの開始行、`db: created empty shard database daifuku_test_w9_shard_2`。この試験は単独では成功した（3 件、2.8 秒）。2 回目（09:06）は自分の sandbox の試験 2 件が時間の競合で失敗した（下の「見つけた問題と修正」）。
- [実測] 修正後の最終状態の `pnpm gate:light`（3 回目、09:14、基準 `origin/main`@`431dda5`、変更 292 ファイル、kernel の変更で DB 全件に昇格）: **639.4 秒で成功**（load average 平均 6.5、2.5〜10.0）。静的 lane 314.8 秒（format 46.9、型 18.5 / 25.9 / 41.1、lint 43.5、unit 111.4 秒で 154 ファイル / 1,591 試験、deploy 26.8）、DB 639.3 秒（shard 1 `daifuku_test_w9` 65 ファイル / 432 試験 638.8 秒、shard 2 `daifuku_test_w9_shard_2` 66 ファイル / 391 試験 638.0 秒、見積りは 522.9 / 523 秒）。`.runtime/gate/durations.json` に 131 suite の所要時間が残った。shard 2 は直前の中断した 2 回の実行で一部のテンプレートを作ってあった。
- [実測] 修正後の `pnpm test:db:templates` と `-- --drop`（3 回目の light の後）: `daifuku_test_w9` のテンプレート 37 件（431.4 MB）、`daifuku_test_w9_shard_2` のテンプレート 39 件（450.6 MB）と shard DB 1 件を一覧し、すべて消した。残ったのは `daifuku_test_w9` だけ（`pg_database` で確認）。
- [実測] 2 回目の修正（修正担当、09:49〜 UTC）: 足した 2 件は 2.5 秒と 3.0 秒で成功し、`scripts/test/gate.test.ts` は 129 件成功（40.4 秒）。shard の sandbox の 6 件を 5 回続けて実行して全件成功し、CPU を占有する busy loop 4 本の下（load average 5.0）でも成功した。足した試験が回帰を捕まえることを、検証と同じ mutation を `scripts/gate.mjs` に当てて確かめた（戻して成功）: M14（`cancelOthers` が owner ごとに最初の子だけ止める）は fail-fast の試験が `vitest-runs.jsonl` に shard 2 の実行が残って失敗（30.7 秒）、M16（`interruptCurrent` が owner ごとに 1 つだけ止める）と M15（最初の 1 つだけ止める）は SIGTERM の試験が「still running after 20 s」で失敗。M8（shard ごとの interrupted の記録の削除）と M9（`ensureShardDatabases` 内の名前の確認の削除）は引き続き生き残る（M8 は `runSteps` も `isInterrupted()` を見るため挙動が変わらず、M9 は `shardDatabases()` が規則内の名前しか作らないための予備の確認）。
- [実測] 2 回目の修正の `pnpm gate:light --base HEAD`（10:00、変更 3 ファイル = 本修正の試験・spec・log、`daifuku_test_w9`）: **252.9 秒で成功**（開始時の load average 3.4）。静的 lane 253.1 秒（format 39.4、型 11.8 / 15.7 / 25.3、lint 28.3、unit 106.0 秒で 154 ファイル / 1,593 試験、deploy 26.0）、DB 53.4 秒（常に実行する 5 ファイルを 2 shard: `daifuku_test_w9` 1 ファイル 47.2 秒、`daifuku_test_w9_shard_2` 4 ファイル 31.1 秒。shard DB は空から作成）。branch 全体（kernel の変更で DB 全件）の light は 1 回目の修正の 3 回目（639.4 秒）が最新で、本修正では再実行していない。その後 `pnpm test:db:templates -- --drop` でテンプレート 5 件と `daifuku_test_w9_shard_2` を消し、残ったのは `daifuku_test_w9` だけ（`pg_database` で確認）。
- [レビュー] 並行実行の安全性（spec の表）: DB suite のポート・ファイル・role・DB 作成・接続先の読み方、静的工程の書込み先をソースで確認した。
- [未検証] CI（CI は light を使わないため対象外）。CPU が 4 以外の環境での既定の shard 数。macOS での動作。
- [未検証] `pnpm gate:full`（統合担当が実行する。`kernel/` と `scripts/gate.mjs` の変更は昇格パターン）。

## 見つけた問題と修正（発見経路つき）

- `apps/api/test/identity-rate-limit.db.test.ts` の時間依存 — 発見: 実測（実装後の kernel の light）。`kernel/src/identity/rate-limit.ts` の失敗ログインの窓は壁時計の 300 秒区切り（`floor(now / 300 s)`）で、この試験だけ `Date` を固定していないため、11 回の scrypt が窓の境目をまたぐと 11 回目が 429 にならない。同じファイルの他の 2 試験は `vi.useFakeTimers({ toFake: ['Date'] })` で固定している。A1 の記録にも直列の実行で同居負荷の下で 1 回失敗した記録がある。並行実行で 1 回の時間が延びると起きやすくなりうる。この作業項目の範囲外の試験のため直さず、統合担当へ引き継いだ（修正案: 最初の試験も `Date` を固定する。期待値は変えない）。
- 自分の試験の期待値の誤り 2 件（LPT の手計算、lane の開始順の決め打ち） — 発見: unit 試験の初回実行。commit 前に直した。

- `apps/api/test/identity-runner.test.ts` の固定ポート — 発見: 実測（修正後の light の 1 回目）。この試験は fixture のポート 3109/5189 を固定で使うため、同じ machine で他のエージェントの unit 試験（同じ試験）や認証ブラウザ試験が同時に動くと、fixture が準備完了の前に終わって失敗しうる。単独では成功した。A4 の範囲外のため直していない（統合担当への引継ぎ）。
- 自分の sandbox の試験の時間の競合 2 件 — 発見: 実測（修正後の light の 2 回目、高負荷）。fake の vitest は 2 つの shard がほぼ同時に終わる設定で、(a) 一方の shard の終了直後に他方が cache を書くと、その値を読めない（light の仕組みに残る競合で、終了がほぼ同時のときだけ起きる。見積りが古くなるだけ）、(b) 一方の shard の起動が遅れると、他方が書いた cache を読む、という 2 つの競合で期待値が揺れた。fake の vitest の終了をファイル数 × 1.5 秒にして shard の終わりを離し、(b) に依存する vitest の cache の中身の確認を sandbox の試験から外した（cache が上書きで失われることは、fake の runCommand を使う単体試験で確かめている）。

## レビュー指摘への対応（2026-10-30、修正担当）

実装後のレビュー（spec・safety・ux の 3 観点で 19 件）を、指摘ごとにコードと照合した。すべて妥当と判断して直し、却下はない（同じ内容の指摘が 2 組ある。時間の記述と、shard の開始行）。

- [major] shard 実行の経路（`runShardedDb`・`availableShards`・`ensureShardDatabases`・dry-run の shard 計画）に自動試験が無い — `runShardedDb` と `availableShards` を export し、process の処理（`env`・`run`・`ensure`・`root`・`print`）を引数で差し替えられるようにした。単体試験（fake の runCommand）で次を確かめる: shard ごとの URL・ファイル・log・開始行、shard DB 作成の注記、1 つの shard が失敗しても他の shard は最後まで実行され、理由に失敗した試験ファイルが出ること、失敗した shard がすべて cancelled なら `cancelled`、開始前に取り消されていれば DB を準備せず shard も起動しないこと、shard DB を準備できないと 1 process で実行して理由を出すこと、dry-run・1 ファイル・規則外の名前では shard DB を準備しないこと。sandbox で実プロセスを使う 4 件（fake の gate-select・vitest・postgres driver を置き `GATE_DB_SHARDS=2`）で次を確かめる: shard DB を作って 2 shard を実行すること、他の role の shard DB を拒否して 1 process に退避すること、失敗した shard の `FAIL` 行が出て他の shard が最後まで実行されること、選択の失敗の log が出ること。実サーバーでの `ensureShardDatabases` の作成は手動の light だけで確かめた（下の検証。拒否と、実サーバーに対する自動の DB 試験は無い）。
- [minor] 失敗した suite と試験の名前が、末尾 80 行に入らないと端末にも報告にも出ない — 失敗した log の vitest の `FAIL` 行（最大 20 件）を末尾の前に出し、報告の工程と shard の `failed` に残し、失敗した試験ファイルを理由に加えた（例: `shard 2 (<db>) exit 1: <file>`）。
- [minor] results cache の上書きで、所要時間が古くなるのではなく失われる — 各 DB process の終了直後に cache からその process のファイルの値を読み、`.runtime/gate/durations.json` に残して優先して読むようにした。unit の値は戻さない（vitest は cache をファイルの実行順にしか使わない）。spec の安全性の表を「失われる」に直した。
- [minor] shard に開始行が無い（2 件） — shard ごとに `db[k/n] <db>: <n> files, estimated <s>s, log <path>` を出し、shard DB を作ったことと 1 process に退避したことも、その時点で出す。log を持つ工程の開始行に log の場所を、終了行に秒を加えた。
- [minor] 並行 light で DB の試験選択が失敗すると、診断が何も出ない — 選択の失敗は `StepError` で log を運び、`db-select.log` の末尾を出して報告の `log` に記録する。
- [minor] 取消しの競合（DB 工程が選択と shard 起動の間にあると取り消されない） — fail-fast で実行中のすべての工程 id を `cancelOthers` に渡し、その瞬間に command が無い工程も取消し済みにした。`runShardedDb` は、開始時に取消し済みなら何もしない。
- [minor] 時間の主張（2 件。失敗した 655 秒の回を見出しに使っていた） — kernel の light を成功した回の範囲（815 秒と、修正後の 639 秒で 639〜815 秒）で書き、spec の表に成功した 2 回を加え、48% に、成功した 815 秒の回で比べた 35% を併記した（CONTRIBUTING・test-tiers・spec）。
- [nit] sales 440 秒の注記、静的工程の時間（170〜205 秒、load 2.6〜4.0）、spec の名指しに `dropShardDatabase` など — 直した。
- [minor] `--drop` で shard DB のテンプレートが二度と見えなくなりうる — テンプレートを shard DB 経由でなく、名前と印で探す（`ownShardTemplates`）ようにし、テンプレートがすべて消えた shard DB だけを消す（`ownShards`）。DB 試験に、shard DB の無いテンプレートと使用中のテンプレートの場合を加えた。手動でも、`daifuku_test_w9_shard_5` が無いテンプレートが一覧・削除され、`daifuku_test_w9_shard_42` には触れないことを確かめた。
- [minor] shard DB を名前だけで消す範囲が、gate が作る名前より広い — kernel の `isShardDatabase` を、gate が作る名前（基名 `SHARD_BASE_NAME` = gate の `TEST_DATABASE_NAME`、番号 2〜`MAX_SHARD_INDEX` = 8）に限った。gate の試験で両者の一致を確かめる。DB 試験の `_shard_97` は規則外の例（一覧されず、削除は拒否）に変えた。CLI の冒頭・CONTRIBUTING・テスト規約に、shard DB は名前と所有者で判別すること、試験 DB として使われるので印のコメントを付けられないことを書いた。
- [nit] 猶予後の SIGKILL が、終わった process group にも送られうる — command がまだ追跡中のときだけ送る。
- [minor] 1 process への退避が、表では注記の末尾に隠れる — 退避の注記を工程の注記の先頭に置き、表の `concurrency:` 行を `DB shards <使った数> of <指定数>` にした。
- [minor] 案内と DB 工程の注記が shard DB に触れない — `GUIDANCE.testDb` に、shard DB の作成（CREATEDB）、`--serial`・`GATE_DB_SHARDS=1`、後始末を足した。DB 工程の注記で、使いうる shard DB を名指しする。
- [minor] test-tiers AC-4 に shard 時の追記が無い — 追記した。
- [nit] 引継ぎの「done」 — 引継ぎは「実装済み、gate:light 成功、`pnpm gate`・`gate:full` は未実行」と書く（統合担当が full を実行してから完了とする）。
- 試験の期待値の変更: 本作業項目で足した試験のうち 2 か所を、挙動の変更に合わせて直した。表の `concurrency:` 行の期待（`DB shards up to 2` → `DB shards 2 of 2`）と、`_shard_12` を shard DB と認める期待（否定の例に移した）。弱めてはいない。

## 2 回目のレビュー指摘への対応（2026-10-30、修正担当）

修正後の検証（mutation 16 件）で、上の [major] のうち 1 点が未解決と判定された: fail-fast（他の lane の失敗）と gate への SIGTERM で **すべての** shard の process が止まることを、自動試験が確かめていない。既存の単体試験は fake の runCommand が自分で `cancelled` を返すため結果の合成しか見ず、`GATE_DB_SHARDS=2` の sandbox 4 件はどれも正常に終わり、実プロセスの SIGTERM の試験は 1 shard だった。`createSession` の `cancelOthers` や `interruptCurrent` を「owner ごとに最初の子だけ止める」に壊しても（検証の M14・M16）全件成功していた。指摘は妥当と判断した。`scripts/gate.mjs` は変えていない（現在の実装は正しく、試験が欠けていた）。

- `scripts/test/gate.test.ts` の「sharded light runs as processes」に 2 件を足した。fake の vitest に `FAKE_HOLD`（ms）を足し、指定時は開始時に孫 process を起こして自分と孫の pid を `vitest-started.jsonl` に記録し、成功の終了を `FAKE_HOLD` ms 後にする（止められなければ孫を止めて終わり、終わりを `vitest-runs.jsonl` に記録する）。`prepare` に package.json の script の上書きを渡せるようにした（既存の 4 件は変わらない）。
  - `AC-5 a failing static step stops every DB shard process and its descendants and reports each shard cancelled`: format:check は 2 つの shard の vitest が起動した後に失敗する。終了コード 1、両 shard の vitest がそれぞれの DB（`daifuku_test_x` と `_shard_2`）で起動していたこと、5 秒以内に両 shard の vitest と孫がすべて止まること、`vitest-runs.jsonl` が空（どの shard も最後まで実行されていない）、gate が保留の 30 秒を待たずに終わること、db が `cancelled`（`stopped after format failed`）で両 shard が `cancelled` であることを確かめる。
  - `AC-5 SIGTERM to the gate stops every DB shard process and its descendants and reports interrupted`: 両 shard の vitest の起動後に gate へ SIGTERM。20 秒以内に終了コード 143、5 秒以内に両 shard の vitest と孫がすべて止まること、`vitest-runs.jsonl` が空、報告が `interrupted` で db と両 shard が `failed`（`failed` の試験名は空）であることを確かめる。
- 検証の probe（固定の待ち 13 秒と、vitest の記録の有無だけを見るもの）と違い、起動の記録を待ってから失敗・中断させ、残った pid を直接確かめるため、待ちの時間に依存せず、実行も短い（2.5 秒と 3.0 秒）。

## 統合時の修正（2026-10-30、統合担当）

- 上記で記録した `apps/api/test/identity-rate-limit.db.test.ts` の不安定なテスト（失敗した login の上限が固定 300 秒窓をまたぐと 429 にならない）は、同じファイルの他 2 件と同じく `vi.useFakeTimers({ toFake: ['Date'] })` で Date を固定した。期待値は変えていない（テストを弱めていない）。lane 並列化で負荷が上がると窓をまたぐ確率が上がるため、本項目の統合で直した。

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
