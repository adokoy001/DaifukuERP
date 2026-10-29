# 作業記録: 2026-10-29 test-tiers（3段階の回帰テスト quick / light / full）

- セッション: A1 実装（Opus 5.5、worktree `wip/test-tiers`、他エージェントと同居する 4 CPU の一時 container） ／ 担当: agent ／ 対象: [docs/specs/test-tiers.md](../specs/test-tiers.md)
- 計測: tokens=null（未計測）, agent_minutes=約100（14:15〜15:55 UTC、計測待ちを含む）, human_minutes=0, rework_lines=null（未計測）, gate_failures=2（自作スクリプトの format で fail-fast、container の `NODE_PATH` による deploy 試験の失敗）

## 決めたこと（と理由）

- **試験選択は vitest の公開 Node API で列挙し、明示ファイル列で実行する。** vitest 5.0.0 の `--changed <since>` と `vitest related` は同じ `filterTestsBySource` を使い、sales の 1 ファイル変更で同じ 13 ファイル / 113 試験を選んだ（実測）。精度は同じなので、base の代替（origin/main が無い・shallow）、削除ファイル、dry-run での列挙、報告のファイル数を gate 側で制御できる明示リストを採用した。`vitest list` には related の指定が無い（`--related` は未知のオプション、実測）ため、列挙は `scripts/gate-select.mjs`（`createVitest` → `globTestSpecifications` / `getRelevantTestSpecifications`）で行い、`gate.mjs` は Node 組込みだけに保った。
- **モジュールグラフ外の依存を 2 規則で補う。** 試験が `readFileSync(new URL('./golden/x.json'))` で読むデータ、`verification/edge/traces.json`、子プロセスとして実行する `scripts/test-identity-e2e.mjs` はグラフに現れない（ソース確認）。ファイル名一致（参照規則）と、`test/` 配下の非モジュールファイル変更でそのディレクトリ全体を選ぶ規則を足した。
- **削除・改名。** `--no-renames` で改名を削除 + 追加として読み、作業ツリーに無いパスを削除とした。削除されたソースは related に渡せないので、quick は unit 全件、light は昇格理由として DB 全件にした。
- **quick の typecheck はルート全体（10.9 秒）で統一**し、tsconfig が test / e2e を含む `apps/api`（14.4 秒）・`apps/web`（20.5 秒）は変更時だけ足した。依存境界は 1 ファイル指定だと被参照側の違反を見落とすうえ全体でも 4.4 秒なので全体にした。docs:check（0.5 秒）と台帳検査（0.4 秒）は常に実行する（spec の当初案「.md 変更時のみ」から変更）。
- **DB 試験は `TEST_DATABASE_URL_*` の明示を必須にした。** `kernel/src/testing.ts` は未設定時に `daifuku_test` へ接続して schema を作り直す（ソース確認）。tier runner は既定 DB に落ちず、何も実行する前に止める。`pnpm gate` 自体の挙動は変えていない。
- **認証試験の変数衝突。** `scripts/test-identity-e2e.mjs` は `TEST_DATABASE_URL_*` を自分の空 DB として読む。full では DB 試験と同じ変数名になるため、認証工程にだけ `GATE_IDENTITY_DATABASE_URL_OWNER` / `GATE_IDENTITY_DATABASE_URL`（またはプロビジョニングした DB）を `TEST_DATABASE_URL_*` として渡し、ブラウザ fixture の工程からは DB 試験用の変数を取り除いた。
- **`--provision`。** `TEST_DATABASE_URL_OWNER` のサーバー（ループバック限定、owner に CREATEDB）に `daifuku_e2e_test_g<UTC秒><乱数>` と `daifuku_e2e_test_enterprise_g<UTC秒><乱数>` を `CREATE DATABASE` で新規作成し、既存の fixture CLI（DB 名・空 DB・role を自分で検査する）で準備、`build:api` 済みの compiled API と Vite を OS が割り当てた空きポートで起動し、終了時・中断時に自分が起動した process group だけを停止する。DB は削除しない（報告に名前を残す）。`postgres` は `scripts/setup-test-cluster.mjs` と同じく `apps/api` の依存から解決し、依存を増やしていない。
- **full は `pnpm gate` を `&&` で分解して同じ順に実行**し、工程ごとの時間を残す。分解できない形に変わったら `pnpm gate` を 1 工程として実行する。CI の gate job と同じく `pnpm --filter @daifuku/edge build`（0.7 秒）も含めた（計画の列挙には無かったが CI との一致を優先）。
- **fail-fast は前提不足を最初に判定する。** ブラウザ・認証・DB の前提が無いとき、13 分の gate を回してから失敗するのではなく、何も実行せずに案内を出して止める。`--keep-going` 時は他を実行して失敗にする。
- **@smoke は 7 件。** ログインと失敗表示（smoke.spec 2 件）、取引先の作成・一覧・編集・監査、画面検索（navigation AC-1/2/4/5/11）、390px のメニュー（AC-8）、店舗従業員の権限（AC-3/10）、売上請求書の保存・確定・取消（foundation-ui）、2 行伝票の確定と帳票（phase1 AC-6）。試験名の末尾に ` @smoke` を足しただけで本体は変えていない。Playwright 1.63 は `--grep` を依存 project に適用しない（`--list` で確認）ため、`e2e:smoke` でも `industry` の 3 試験が先に走る。依存の意味を保つため `--no-deps` は付けない。
- **CI の `quick` job** を先頭に追加（同じ固定 SHA、`contents: read`、DB・secrets なし、format:check・typecheck・lint・unit）。既存 4 job は変更していない。

## やったこと

- `scripts/gate.mjs`（純粋関数 + 薄い実行部）、`scripts/gate.d.mts`（型）、`scripts/gate-select.mjs`、`scripts/test/gate.test.ts`（AC-1〜AC-18、70 試験）を追加。
- `package.json` に `gate:quick` / `gate:light` / `gate:full` / `e2e:smoke` を追加（`gate` は不変）。
- `apps/web/e2e` の 7 試験名に ` @smoke`。
- `.github/workflows/ci.yml` に `quick` job、`.github/ci/README.md` の表に追記。
- CONTRIBUTING（検査の段階）、CLAUDE.md（= AGENTS.md の symlink）のコマンド欄、`docs/conventions/testing.md`、`docs/architecture/verification-and-release.md`、spec（状態 implemented、AC 改訂、確認した前提の表）、`scripts/check-doc-links.mjs`（spec と本記録を検査対象に追加）。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

すべてこの一時 container（4 CPU、他エージェントが同時に DB 試験・ブラウザ試験を実行、load average 3〜5）での値。CI の値ではない。

- [実測] `scripts/test/gate.test.ts` 70 試験が成功（5.9 秒）。AC-1〜AC-18 を試験名に含む。
- [実測] 試験の効き目: `kernel/**` を `kernelx/**` に、fail-fast 条件を `stopped` だけに一時的に書き換えると AC-4 の 2 試験と AC-9 の 1 試験が失敗することを確認し、元に戻した（意味のない緑でないことの確認）。
- [実測] 手順 1（dry-run）: quick の dry-run は unit 選択の列挙込みで 5.3 秒、選択不要の場合 0.5 秒。light の dry-run（banking、DB 選択の列挙）4.2 秒。表示のみで検査・試験は実行されず、`.runtime/gate/*-quick.json` に `dryRun: true` が残った。
- [実測] 手順 2（quick、`modules/sales/src/services/recalculate.ts` の 1 ファイル変更、`--base HEAD`）: **40.4 秒**（目標 2 分以内）。format 0.5、docs 0.5、assurance 0.1、eslint 1.2、boundaries 4.7、typecheck 9.8、unit 23.6（選択列挙約 4 秒を含む。13/124 ファイル、113 試験。`vitest related` / `--changed` と同じ集合）。api/web typecheck と deploy は skipped。
- [実測] quick（このブランチ自身の変更 18 ファイル、base = origin/main の merge-base）: 152 秒。`package.json` 変更で format・eslint・unit が全体に拡大し、`.github/**`・`package.json`・`scripts/gate*.mjs` の昇格注意と e2e 変更の hint が出た。
- [実測] 手順 4（light、`modules/banking/src/matching.ts` の 1 ファイル変更）: **598.8 秒**（目標 6 分を**超過**）。format 22.3、docs 0.5、assurance 0.1、typecheck 10.2、lint 22.3、unit 57.1（124 ファイル / 1,022 試験）、db 466.8（37/116 ファイル、189 試験。graph 33 + 常時 4。うち `apps/api` 30 件）、deploy 19.4（下記の環境要因で失敗）。DB 選択の時間が大半で、suite あたり約 12.6 秒（同居負荷下）。
- [実測] 手順 3（light、`kernel/src/decimal.ts` の 1 ファイル変更）: **1,046 秒**で成功。DB は昇格して全件（116 ファイル / 701 試験、912.5 秒）、報告に `kernel/** the kernel is imported by every module and DB suite` と `pnpm gate:full` の hint。DB 実行中の約 45 秒、`build:api` とプロビジョニングの試行を並行実行した。
- [実測] fail-fast（AC-9）: 初回の light は format で失敗し、残り 9 工程が `not-run` になった（23.2 秒で終了）。
- [実測] AC-18: `TEST_DATABASE_URL_*` 未設定の light は何も実行せず終了コード 1、DB 工程に案内。AC-15: 不明な `--base` は終了コード 2。AC-2: 変更なしの quick は 0.1 秒で `no-changes`、終了コード 0。
- [実測] AC-15 / AC-16（実 git）: `git clone --depth 1 --single-branch` した clone で full の dry-run を実行し、`origin/main is not available` → `HEAD has no parent` の注記付きで base = HEAD、空白を含む未追跡ファイル 1 件を検出した。改名・staged 削除・未ステージ編集・空白と非 ASCII の未追跡名は unit 試験内の一時 git リポジトリで確認。
- [実測] プロビジョニング（AC-17）単体試行: 新規 DB 作成 + fixture 準備 + compiled API / Vite 起動まで 13.2 秒、`smoke.spec.ts`（`@smoke` 2 件）が 8.1 秒で成功、停止後に両 process group が残っていないことを確認。使ったポートが空いていることは、最初に使った `ss` がこの container に無く結果が無効だったため、後で Node の listen で確認し直した。
- [実測] `pnpm e2e:smoke` の対象: `playwright test --list --grep @smoke` で 10 試験（`industry` 3 + `@smoke` 7）。
- [実測] pnpm の引数転送: `pnpm gate:full --dry-run --provision -- --grep @smoke` で Playwright 引数が渡り、`partial: true (custom Playwright arguments: --grep @smoke)` になった。
- [実測] 手順 6（`pnpm gate:full --provision`、フィルタなし、このブランチの変更 18 ファイル）: **1,697 秒（28.3 分）で全工程成功**、`partial: false`。format 24.7、typecheck 7.4、lint 19.3、unit 50.4（125 ファイル / 1,092 試験）、db 865.9（116 ファイル / 701 試験）、deploy 18.8、docs 0.4、assurance 0.4、typecheck:api 15.9、build:api 28.0、build:edge 0.7、typecheck:web 19.8、build:web 2.3、browser:prepare 9.5（新規 DB 作成 + fixture + compiled API / Vite 起動）、browser 588.6（`industry` 3 を含む 77 試験成功、9.8 分。計画書の「69 件」から増えている）、identity 42.9（3 シナリオ成功）。作成した DB `daifuku_e2e_test_g2026102915342209267b`、`daifuku_e2e_test_enterprise_g202610291544203cd5b6` は残した。終了後、API/Web/認証 fixture のプロセスが残っていないこと、使用ポート（3109・3110・5189 と割当ポート）が空いていることを Node の listen で確認した。
- [実測] 手順 10（`pnpm gate`）: `pnpm gate` そのものは実行していない。上の full が `package.json` の `gate` script を分解した同じ 8 工程を同じ順に実行し全件成功した（`gate` script の文字列は不変であることを unit 試験 AC-8 で固定）。
- [実測] 手順 5: ブラウザ前提なしの `gate:full --dry-run` で browser / identity / db が `blocked` と案内付きで表示され、前提不足の実行は何も実行せずに失敗する（unit 試験 AC-6 と light の AC-18 実行で確認）。`--without-browser` の `partial: true` は dry-run と unit 試験で確認（`--without-browser` の実行そのものは、フィルタなしの full 実行で代えた）。
- [実測] 手順 8: 各実行の表と `.runtime/gate/*.json` の工程・結果・秒・選択数が一致することを目視で照合し、unit 試験 AC-7 で表が JSON から生成されることを検査。
- [実測] 手順 7（`pnpm gate:light --base HEAD --with-smoke --provision`、変更は spec の Markdown 1 ファイル）: **218.9 秒**で成功。DB は常時実行 4 suite だけ（17.4 秒）、`build:api` 17.7、browser:prepare 8.6、smoke 63.9 秒で 10 試験成功（`industry` 3 + `@smoke` 7。`pnpm e2e:smoke` と同じ `playwright test --grep @smoke`）。作成した DB `daifuku_e2e_test_g20261029154812e029c8` は残した。
- [レビュー] CI の `quick` job は既存 job の SHA・`persist-credentials: false`・`contents: read` をそのまま使い、services・DB 変数を持たない（unit 試験 AC-12 でも検査）。
- [未検証] GitHub Actions 上の `quick` job の所要時間と、既存 job より先に完了すること（push していない）。
- [未検証] macOS でのプロビジョニングと停止（Linux のみで実行）。

## 見つけた問題と修正（発見経路つき）

- 自作の `scripts/gate.mjs` / `gate-select.mjs` が Prettier 未適用だった — 発見: 実測（初回の `gate:light` が format で fail-fast し、以後の工程を `not-run` にした。AC-9 の動作確認にもなった）、修正: `pnpm format` 後に再実行。
- `deploy/test/compiled-api.test.mjs` の AC-5（凍結 source の compiler 選択）が、この container では失敗した — 発見: 実測（light の deploy 工程）。原因はこの container の `NODE_PATH=/usr/local/lib/node_modules_global` で、最初の `require.resolve('typescript')` が global の typescript に解決されて Node の path cache に残るため。`NODE_PATH` を外すと 3/3 成功した。今回の変更とは無関係で CI では `NODE_PATH` を設定しないため、修正せず計測は `NODE_PATH` を外して行った（候補として integrator に引き継ぐ）。
- ベースライン計測（main checkout）の `pnpm test:db` で `identity-rate-limit.db.test.ts` の時間依存試験 1 件が同居負荷下で失敗していた（832 秒）。今回の light（kernel 昇格）では同じ suite が成功。変更とは無関係で、試験は変更していない。

## 未実施（減らさない。完了したら「済」を付けて残す）

- CI の `quick` job が既存 job より先に完了することの Actions 上の確認（検証手順 9）。push していないため未確認。
- Windows でのプロセス停止（POSIX の process group 前提。スコープ外）。
- 実装計画の想定（light 6 分以内）はこの環境では満たせなかった。A3 か選択範囲の判断が必要（spec の未決事項）。
- `.runtime/gate/` に溜まる報告と、`--provision` が残す DB の掃除手順は用意していない（報告は gitignore 済み、DB は意図して残す）。

## 判断待ち（利用者）

- CI の `quick` job を必須チェックにするか。
- light の目標 6 分を超える場合に A3（DB suite 起動短縮）を優先するか。module 変更では `apps/api` の DB suite 30 件が runtime 経由で選ばれ、light の DB 時間の大半を占める。
- `--provision` で残る DB の定期削除手順を運用文書に足すか。

## 次のセッションへ

- 開発中は `pnpm gate:quick`、push 前に `pnpm gate:light`（`TEST_DATABASE_URL_*` を自分の専用 DB に）、完了前に `pnpm gate:full --provision`（ループバック PostgreSQL、owner に CREATEDB）。
- `@smoke` の追加・削除は spec の変更として扱い、件数（6〜8）は `scripts/test/gate.test.ts` が検査する。
