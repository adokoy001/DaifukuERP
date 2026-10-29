# 作業記録: 2026-10-29 test-tiers（3段階の回帰テスト quick / light / full）

- セッション: A1 実装（Opus 5.5、worktree `wip/test-tiers`、他エージェントと同居する 4 CPU の一時 container）と、レビュー指摘の修正（同じ worktree、16:40〜 UTC） ／ 担当: agent ／ 対象: [docs/specs/test-tiers.md](../specs/test-tiers.md)
- 計測: tokens=null（未計測）, agent_minutes=実装 約100（14:15〜15:55 UTC、計測待ちを含む）+ 修正 約 90（16:40〜18:10 UTC、light 13.5 分・full 29 分の計測待ちを含む）, human_minutes=0, rework_lines=約 1,620（修正 commit の追加 1,343 + 削除 277 行、metrics を除く。scripts と文書）, gate_failures=2（実装時: 自作スクリプトの format で fail-fast、container の `NODE_PATH` による deploy 試験の失敗。修正時は 0）
- 基準: 当初 `431dda5`（origin/main）から作業していたが、計画の基準は `2edc921` 以降の統合ブランチである。修正時に統合ブランチの先頭 `25c1fb6` へ rebase し、spec の add/add 衝突は実装版を採った。`docs/specs/test-tiers.md` の下書きと `docs/completion-plan.md` は `2edc921` で commit 済みであり、「未追跡ファイルだけだった」とした実装時の説明は誤りだった（訂正）。

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

### レビュー指摘の修正で決めたこと（と理由）

- **中断は工程の process group ごと止める（blocker の修正）。** 各工程と試験選択を `spawn(..., { detached: true })` で自分の process group に置き、SIGINT / SIGTERM は group 全体へ、SIGHUP は SIGTERM として送り、10 秒後に SIGKILL を送る。`pnpm <script>` は SIGTERM を子へ中継しないため、直下の子だけを止める実装では prettier・vitest が残り、DB worker が残ると次の実行の DB を作り直し続ける。`pnpm gate:*` の外側の pnpm に送られた SIGTERM は gate に届かないので、1 秒ごとに `process.ppid` を見て親が変わったら SIGTERM と同じに扱う。工程の主プロセスが終わった後に group に残ったプロセスも止める。group は端末の Ctrl-C を受けないため、gate が SIGINT を中継する。試験選択も `spawnSync` から子工程に変え、選択中の中断を受けられるようにした。
- **中断は `--keep-going` でも止める。** `runSteps` に `isInterrupted` を渡し、各工程の前と、選択・fixture 準備の失敗（例外）の後にも確認する。中断後は新しい子を起動しない（`runCommand` が即座に interrupted を返す）。
- **setupFile と子プロセスの依存を選択に入れる。** `apps/api/test/payroll-provider-setup.ts` は `@daifuku/l10n-jp` を動的 import して fiscal 2 suite に日本の給与 provider を登録するが、setupFile はどの試験のグラフにも入らないため、給与の法定パラメータの変更で fiscal suite が選ばれなかった（CLAUDE.md 規則 10 の対象）。gate-select が setupFile の import グラフ（vitest と同じ `transformRequest` の deps / dynamicDeps）を辿り、変更があれば setupFile が名指しする suite を選ぶ。対象は setupFile 自身の文字列から読み、二重管理しない。パターンで `l10n/jp/**` を足す案より、l10n-jp が import する workforce・accounting などの変更も拾える。子プロセスで実行する入口（`apps/mcp/test/fixtures/stdio-entry.ts` → `src/main.ts`、`apps/runtime/test/fixtures/catalog.ts`）は試験ソースの相対パス文字列から求めて同じように辿り、esbuild の entry 文字列のように辿れないもの（`apps/edge/scripts/build.mjs` → `src/main.ts`）は「同じ package の変更で選ぶ」規則で補った。
- **light は API / Web の typecheck を常に実行し、quick は依存関係で判断する。** root の tsconfig は `test/` と `apps/web/e2e` を含まず、`apps/api/test` は API の typecheck だけが検査する。CI の gate job は両方を必ず実行するため、light で省くと push 後に初めて落ちる（レビューの実測: `invoiceBalancesAsOf` の引数追加で root typecheck は成功、API typecheck は 4 件失敗）。quick は「その app か、app が `package.json` で依存する workspace package（推移的）か、tsconfig・依存定義」の変更で実行する。レビュー案の「kernel/modules/l10n/packs/apps のどれか」より、依存しない package（Web にとっての多くの module）の変更で 20 秒を省ける。
- **昇格は「注意」と「DB 拡大」に分ける。** 注意（full が必要）は従来の全パターンに `.npmrc`、`apps/web/playwright.config.ts`・`vite.config.ts`・`index.html`、`scripts/test-identity-e2e.mjs` を足した。light が DB を全件にするのは kernel・migration・DB tooling・module 登録・DB の setupFile・vitest 設定・依存定義・`.npmrc`・tsconfig だけで、lint / format / CI / ブラウザ設定 / gate 自身の変更では DB を広げない（light の全体静的検査で扱う。DB 912 秒の無駄を避ける）。`.github/**` の `*.md` は昇格しない。
- **基準点の代替を増やし、黙って縮めない。** `origin/main` が無いときは `origin/HEAD`、ローカル `main`、`@{upstream}` の merge-base を試し、merge-base が HEAD 自身の候補は飛ばす。代替のときは標準出力に `WARNING` を出し、報告に `baseFallback: true` を記す。quick で基準点が HEAD / なしに落ちて変更が空のときは `base-unknown`（終了 1）にした（偽の成功を避ける）。
- **DB 試験の接続先を検査する。** DB suite は接続先の schema を作り直す（`kernel/src/testing.ts`）。tier runner はループバック・同じ DB・別 role・app が `daifuku_app`・DB 名 `daifuku_test` / `daifuku_ci_test` / `daifuku_test_<suffix>` を要求し、別名の破棄可能な DB だけ `GATE_ALLOW_DB_URL=1` で外せる。初期化する DB 名を DB 工程の表示に出す。`pnpm gate` は変えていない。
- **smoke の前提は `E2E_API_URL`・`E2E_BASE_URL` と到達性だけ**にした。fixture の DB 変数は Playwright の spec が読まない（`apps/web/e2e`・`playwright.config.ts` を確認）。full の browser 工程は従来どおり。
- **`--provision` は呼出し側の環境へ落ちない。** この実行で fixture を準備できなかったときは Playwright を実行せず、この実行の `build:api` が成功していなければ fixture を起動しない（以前の build の compiled API を使わない）。
- **dry-run と通常実行で変更ファイルを標準出力に出す**（dry-run は 200 件、通常は 20 件まで。超過は件数）。
- **試験は checkout の `.git` に依存しない。** gate.mjs を起動する試験は一時ディレクトリに gate.mjs を複写した使い捨て git リポジトリで動かす（`ROOT` は script の位置から決まる）。`.git` を含まない配布 ZIP（`scripts/bundle-all.sh`）でも `pnpm test` が通る。
- **AC-12 の目標 4 分を戻した。** 実装時に AC-12 から「目標 4 分以内」を落としていたが記録がなかった。目標を戻し、CI で未計測のため未検証と明記した。

## やったこと

- `scripts/gate.mjs`（純粋関数 + 薄い実行部）、`scripts/gate.d.mts`（型）、`scripts/gate-select.mjs`、`scripts/test/gate.test.ts`（AC-1〜AC-18、70 試験）を追加。
- `package.json` に `gate:quick` / `gate:light` / `gate:full` / `e2e:smoke` を追加（`gate` は不変）。
- `apps/web/e2e` の 7 試験名に ` @smoke`。
- `.github/workflows/ci.yml` に `quick` job、`.github/ci/README.md` の表に追記。
- CONTRIBUTING（検査の段階）、CLAUDE.md（= AGENTS.md の symlink）のコマンド欄、`docs/conventions/testing.md`、`docs/architecture/verification-and-release.md`、spec（状態 implemented、AC 改訂、確認した前提の表）、`scripts/check-doc-links.mjs`（spec と本記録を検査対象に追加）。
- 修正: `scripts/gate.mjs`（process group、中断、選択規則、昇格の分割、基準点、DB / smoke の前提、provision の保護、変更ファイル表示、環境の純粋関数化）、`scripts/gate-select.mjs`（setupFile・子プロセス入口のグラフ、常時実行 suite の存在検査、入力ファイル）、`scripts/gate.d.mts`、`scripts/test/gate.test.ts`（70 → 76 試験）。spec（AC-1/3/4/7/9/11/12/13/15/17/18、選択規則、昇格の表、前提の表、手順 11、リンク）、CONTRIBUTING（目安の実測値、基準点、DB 条件、中断）、`docs/conventions/testing.md`（節の位置、setupFile・子プロセスの書き方）、`docs/conventions/lint.md`、`README.md`、CLAUDE.md（`gate:full` と `pnpm gate` の関係）、`docs/architecture/verification-and-release.md`、`docs/metrics/features.jsonl`（基準 commit）。

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
- [代替・未検証] 手順 10（`pnpm gate`）: `pnpm gate` そのものは実行していない。上の full が `package.json` の `gate` script を分解した同じ 8 工程を同じ順に実行し全件成功したことで代えた（`gate` script の文字列は不変であることを unit 試験 AC-8 で固定）。
- [実測] 手順 5（前提不足）: ブラウザ前提なしの `gate:full --dry-run` で browser / identity / db が `blocked` と案内付きで表示され、前提不足の実行は何も実行せずに失敗する（unit 試験 AC-6 と light の AC-18 実行で確認）。
- [未検証] 手順 5（`--without-browser` の実行）: `partial: true` は dry-run と unit 試験で確認したが、`--without-browser` を付けた実際の実行は行っていない（フィルタなしの full 実行で代えた）。
- [実測] 手順 8: 各実行の表と `.runtime/gate/*.json` の工程・結果・秒・選択数が一致することを目視で照合し、unit 試験 AC-7 で表が JSON から生成されることを検査。
- [実測] 手順 7（`pnpm gate:light --base HEAD --with-smoke --provision`、変更は spec の Markdown 1 ファイル）: **218.9 秒**で成功。DB は常時実行 4 suite だけ（17.4 秒）、`build:api` 17.7、browser:prepare 8.6、smoke 63.9 秒で 10 試験成功（`industry` 3 + `@smoke` 7。`pnpm e2e:smoke` と同じ `playwright test --grep @smoke`）。作成した DB `daifuku_e2e_test_g20261029154812e029c8` は残した。
- [レビュー] CI の `quick` job は既存 job の SHA・`persist-credentials: false`・`contents: read` をそのまま使い、services・DB 変数を持たない（unit 試験 AC-12 でも検査）。
- [未検証] GitHub Actions 上の `quick` job の所要時間と、既存 job より先に完了すること（push していない）。
- [未検証] macOS でのプロビジョニングと停止（Linux のみで実行）。

### 修正後の検証（統合ブランチ `25c1fb6` へ rebase 後。同じ container、load average 2〜4）

- [実測] `scripts/test/gate.test.ts` 76 試験が成功（約 16 秒）。unit 全件 125 ファイル / 1,098 試験（59 秒）、`pnpm lint`（依存境界を含む、25 秒）、`pnpm typecheck`（12 秒）、`node scripts/check-doc-links.mjs` が成功。
- [実測] 試験の効き目（一時的な書換えで失敗することを確認して戻した）: 工程の子を detached にしない → AC-9 の中断 2 試験が失敗（修正後は失敗時も sandbox のプロセスを片付け、20 秒で失敗する）。親プロセスの監視を外す → 外側 pnpm 経由の中断試験が失敗。setupFile 規則を外す → gate-select の DB 選択試験が失敗。light の API / Web typecheck を条件付きに戻す → AC-3 試験が失敗。
- [実測] 中断（修正前後の比較、sandbox）: 子 `node slow.mjs` と孫を持つ工程を、gate への SIGTERM と外側 `pnpm gate:full` への SIGTERM で止めた。修正前の gate.mjs はどちらも子・孫が 8 秒後も生存し、外側経由では報告も書かれなかった。修正後はどちらも子・孫が消え、報告は `interrupted`。
- [実測] 手順 11（実リポジトリの light を DB 工程中に中断）: banking の 1 ファイル変更で `pnpm gate:light` を `setsid` で起動し、DB 工程開始の 20 秒後に (1) 外側 pnpm へ SIGTERM、(2) 外側 pnpm の process group 全体へ SIGINT（端末の Ctrl-C 相当）。どちらも 1〜2 秒で vitest と gate が消え、`daifuku_test_w1` への接続は 0、報告は `result=interrupted`、DB 工程は `interrupted (exit SIGTERM / SIGINT)`、deploy は `not-run`。vitest の process group は gate と別であることを `ps` の PGID で確認した。最初の確認で「1 件残存」と出たのは、`pgrep -f` の検索語が計測用シェル自身のコマンド行に含まれていたためで（`pgrep -af` で確認）、実際の残存ではなかった。
- [実測] `.git` の無いツリー（`git archive HEAD` を展開、`pnpm install --offline`）で `pnpm test` が 1,098 試験成功。dry-run と中断の試験は一時ディレクトリの使い捨てリポジトリで動く。
- [実測] 選択の dry-run（`--base HEAD` + 1 ファイルの追記）: `l10n/jp/src/payroll/provider.ts` → DB 57 / 116（fiscal 2 suite を `setup`、stdio suite を `subprocess` で追加。修正前 54 で fiscal なし）。`apps/mcp/src/main.ts` → 5 / 116（stdio を追加。修正前は常時 4 だけ）。`modules/sales/src/settings.ts` → 65 / 116（修正前 64）。`modules/banking/src/matching.ts` と `packs/retail/src/index.ts` → 38 / 116。quick の unit: `apps/edge/scripts/build.mjs`・`apps/edge/src/main.ts` → edge の子プロセス試験 3 件（修正前 0）、`apps/runtime/test/fixtures/catalog.ts` → `runtime.test.ts`（修正前 0）。
- [実測] 手順 2 相当（quick、`modules/sales/src/services/recalculate.ts`）: **70.8 秒**（目標 2 分以内）。API / Web typecheck 31 秒が加わった。
- [実測] 手順 4 相当（light、`modules/sales/src/settings.ts`）: **809 秒**で成功（目標 6 分を**超過**）。DB 65 suite が 641 秒。deploy は `NODE_PATH` を設定したまま成功（`187ad68` の修正による）。
- [実測] 手順 6 相当（`pnpm gate:full --provision`、修正後のコード、base = origin/main の merge-base で変更 39 ファイル）: **1,756 秒（29.3 分）で全 16 工程成功**、`partial: false`。format 19.4、typecheck 7.4、lint 18.9、unit 50.5（1,098 試験）、db 910.3（116 ファイル / 701 試験）、deploy 19.8（`NODE_PATH` 設定のまま成功）、docs 0.5、assurance 0.5、typecheck:api 16.1、build:api 21.9、build:edge 1.9、typecheck:web 21.0、build:web 3.5、browser:prepare 13.4、browser 610.3（77 試験成功、10.1 分）、identity 40.4（3 試験成功）。各工程を自分の process group で動かす変更の後も Playwright・認証 runner・fixture が動くことの確認を兼ねる。作成した DB `daifuku_e2e_test_g202610291755321cd983`、`daifuku_e2e_test_enterprise_g202610291805565e9015` は残した。終了後、compiled API / Vite のプロセスが無く、割当ポート（37795・39633）と認証 runner の固定ポート（3109・3110・5189）が空いていることを Node の listen で確認した。

## 見つけた問題と修正（発見経路つき）

- 自作の `scripts/gate.mjs` / `gate-select.mjs` が Prettier 未適用だった — 発見: 実測（初回の `gate:light` が format で fail-fast し、以後の工程を `not-run` にした。AC-9 の動作確認にもなった）、修正: `pnpm format` 後に再実行。
- `deploy/test/compiled-api.test.mjs` の AC-5（凍結 source の compiler 選択）が、この container では失敗した — 発見: 実測（light の deploy 工程）。原因はこの container の `NODE_PATH=/usr/local/lib/node_modules_global` で、最初の `require.resolve('typescript')` が global の typescript に解決されて Node の path cache に残るため。`NODE_PATH` を外すと 3/3 成功した。今回の変更とは無関係で CI では `NODE_PATH` を設定しないため、修正せず計測は `NODE_PATH` を外して行った。統合ブランチの `187ad68`（14:37 UTC、試験側で lookup のディレクトリを分けた）が既に直しており、そこへ rebase した修正後の light / full は `NODE_PATH` を設定したまま成功した（済）。
- ベースライン計測（main checkout）の `pnpm test:db` で `identity-rate-limit.db.test.ts` の時間依存試験 1 件が同居負荷下で失敗していた（832 秒）。今回の light（kernel 昇格）では同じ suite が成功。変更とは無関係で、試験は変更していない。統合ブランチの `187ad68` が時刻を固定して直している（済）。
- 以下はレビュー（別コンテキストのレビュア 3 観点）で見つかり、修正セッションで直したもの。発見はいずれもレビューの実測またはコード確認、修正は `fix(gate)` commit。
  - [blocker] SIGTERM で中断しても prettier・vitest が残り、`pnpm gate:*` の外側 pnpm への SIGTERM では gate 自身も走り続けた（AC-9 違反）。修正前後で同じ sandbox 手順を実行し、修正前は子・孫が生存、修正後は消えることを確認した。
  - setupFile 経由の依存（JP 給与 provider → fiscal 2 suite）と子プロセスの入口（MCP stdio、edge bundle、runtime catalog）が選択から漏れた。
  - light / quick が API / Web の typecheck を省き、`apps/api/test` の型崩れを push 後の CI まで見逃した。
  - 中断が選択・fixture 準備の失敗に埋もれ、`--keep-going` では中断後に次の工程を起動した。`--provision` + `--keep-going` で準備に失敗すると呼出し側の環境の Playwright を実行し、build 失敗時は以前の compiled API を起動しえた。
  - 昇格が粗く、`.prettierignore` や `.github` の README で DB 全件（約 15 分）になった。逆に `.npmrc` とブラウザ設定は注意も出なかった。
  - `origin/main` が無いとき、ローカル `main` があっても `HEAD~1` に縮み、depth 1 の clone では quick が何も見ずに成功した。
  - 常時実行 suite の改名が黙って選択から落ちた。DB 試験の接続先は変数の有無しか見ていなかった。smoke の前提に使われない DB 変数を要求した。
  - dry-run の標準出力に変更ファイルの一覧が無かった（AC-13）。AC-12 の目標 4 分が記録なく落ちていた。AC-18 の後半（工程ごとの環境）と AC-4 の規則表に意味のある試験が無かった。dry-run 試験が checkout の `.git` と `.runtime/` に依存していた。
  - 文書: CONTRIBUTING の light の目安「数分」が実測と合わない、testing.md の節の位置で共通規則が段階の注記に見える、lint.md・README・CLAUDE.md が段階と `pnpm gate` の関係を書いていない、作業記録が未実行の手順 10 を [実測] としていた。

## 未実施（減らさない。完了したら「済」を付けて残す）

- CI の `quick` job が既存 job より先に完了すること、目標 4 分以内であることの Actions 上の確認（検証手順 9）。push していないため未確認。
- `pnpm gate` 単体の実行（検証手順 10）。同じ工程を同じ順に実行する `gate:full` の成功で代えた。
- `--without-browser` を付けた実リポジトリでの full 実行（検証手順 5 の後半）。dry-run と unit 試験（sandbox での実行を含む）で代えた。
- Windows でのプロセス停止（POSIX の process group 前提。スコープ外）。
- 実装計画の想定（light 6 分以内）はこの環境では満たせなかった。A3 か選択範囲の判断が必要（spec の未決事項）。
- `.runtime/gate/` に溜まる報告と、`--provision` が残す DB の掃除手順は用意していない（報告は gitignore 済み、DB は意図して残す）。

## 判断待ち（利用者）

- CI の `quick` job を必須チェックにするか。
- light の目標 6 分を超える件の扱い: (a) A3（DB suite 起動短縮）を先に行う、(b) `apps/api` の migration 系 suite 9 件を migration・schema 変更時だけに限定する、(c) 目標を 10〜15 分に改める。module 変更では `apps/api` の DB suite 約 30 件が runtime 経由で選ばれ、light の DB 時間の大半を占める（修正後の sales で 809 秒中 641 秒）。それまで CONTRIBUTING には実測の目安を書いた。
- DB 接続先の名前規則（`daifuku_test` 系）を `pnpm gate` / `kernel/src/testing.ts` にも入れるか。
- `--provision` で残る DB の定期削除手順を運用文書に足すか。

## 次のセッションへ

- 開発中は `pnpm gate:quick`、push 前に `pnpm gate:light`（`TEST_DATABASE_URL_*` を自分の専用 DB `daifuku_test_<suffix>` に）、完了前に `pnpm gate:full --provision`（ループバック PostgreSQL、owner に CREATEDB）。
- 途中で止めるときは Ctrl-C か、gate / 外側 pnpm への SIGTERM でよい。工程の子孫まで止まる。
- setupFile が特定 suite のために読むモジュールを足すときは、setupFile に対象 suite のパスを文字列で書く（gate-select がそこから対象を読む）。子プロセスで実行する入口は試験ソースに相対パスで書く。
- `@smoke` の追加・削除は spec の変更として扱い、件数（6〜8）は `scripts/test/gate.test.ts` が検査する。
