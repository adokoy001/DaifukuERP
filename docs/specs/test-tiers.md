# Spec: test-tiers（3段階の回帰テスト: quick / light / full）

- 状態: implemented
- モジュール: `scripts/`（`gate.mjs` 階層実行、`gate-select.mjs` 試験選択）、`package.json` scripts、`apps/web/e2e`（`@smoke`）、`.github/workflows/ci.yml` ／ 依存: 既存の `pnpm gate` 構成、vitest projects（unit / db）、Playwright 設定
- ADR: 新規 ADR は不要（検証の実行方法の追加であり、設計境界・権限・DSL・テスト内容を変えない）。[検証と公開](../architecture/verification-and-release.md) と [テスト規約](../conventions/testing.md) を更新した
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。実装: 2026-10-29 agent（A1 実装セッション）。実装計画は `docs/completion-plan.md` の A1

## 目的（1段落）

現在の `pnpm gate` は型・lint・単体（1,003件）・DB（668件）・配備補助・文書・台帳検査を一括で実行し、公開 CI では 13 分 19 秒かかる（2026-09-14 の run #44、`gate and Web build` job の `Run pnpm gate` step）。ブラウザ試験は別 job で 8 分 42 秒、認証試験 37 秒、セットアップ受入 32 秒である。編集のたびに全体を回すと開発が遅くなり、逆に何も回さないと回帰が PR まで見つからない。そこで、変更ファイルから関連する検査だけを選ぶ **quick**、全体の静的検査と単体に関連 DB 試験を足す **light**、既存の gate にブラウザ試験まで含む **full** の 3 段階を用意し、人と AI エージェントが「いつ何を回すか」を迷わず選べるようにする。選択は緩和ではない。「完了」の主張には引き続き full が必要である。

## 階層の定義

| 階層 | コマンド | 内容 | 目標時間 | 実測（この環境） | 使う場面 |
| --- | --- | --- | --- | --- | --- |
| quick（超軽量） | `pnpm gate:quick` | 変更ファイルに限定した Prettier 検査と ESLint、依存境界（全体）、ルート typecheck（`apps/api`・`apps/web` を変えたときは各 app の typecheck も）、関連する unit 試験、docs:check と台帳検査 | 2 分以内 | 1 ファイルの module 変更で 40 秒 | 編集ループ、コミット前 |
| light（軽量） | `pnpm gate:light` | 全体の format:check・typecheck・lint（依存境界含む）・unit 全件・test:deploy・docs:check・台帳検査、変更した app の typecheck、DB 試験は関連 suite と常時実行 suite の和集合 | 6 分以内（DB 全件昇格時は gate と同程度） | banking の 1 ファイル変更で 10 分（DB 37 suite が 7.8 分。**目標未達**、未決事項参照）。文書だけの変更（DB は常時 4 suite）で 3.6 分（`--with-smoke --provision` の smoke 64 秒を含む）。kernel 変更（DB 全件に昇格）で 17.4 分 | push 前、作業の区切り、PR 下書き |
| full（フル） | `pnpm gate:full` | 既存の `pnpm gate` 全工程、API/Web の typecheck と build、中継 agent の build、通常ブラウザ試験、認証ブラウザ試験 | 現状どおり（CI 並列で約 15 分、ローカル直列で 25〜40 分） | `--provision` で 28.3 分（DB 14.4 分、ブラウザ 77 試験 9.8 分、認証 3 試験 43 秒を含む） | 「完了」の主張前、PR を ready にする前、main を取り込んだ後、昇格条件に該当する変更 |

`pnpm gate` の内容と意味は変えない。`gate:full` は `package.json` の `gate` script を `&&` で分解した各工程をそのまま順に実行し（工程ごとの所要時間を記録するため）、CI 側の追加工程を足した別名である。CI の gate job はそのまま `pnpm gate` を実行する。

### 基準点と変更集合

基準点（base）は次の順に決める（AC-15）。

1. `--base <ref>`、無ければ環境変数 `GATE_BASE`。指定した ref が commit として解決できなければ使い方エラー（終了コード 2）で止め、推測しない。
2. `git merge-base HEAD origin/main`。
3. `origin/main` が無い、または merge-base が求まらない（shallow clone・無関係な履歴）ときは `HEAD~1`。報告の `base.notes` に理由を書く。
4. `HEAD~1` も無い（depth 1 の clone、初回 commit）ときは `HEAD`（コミット済み差分なし、未コミットの変更だけ）。`HEAD` 自体が無いときは staged と未追跡だけ。

変更集合は base からのコミット済み差分（`git diff base HEAD`）、ステージ済み、未ステージ、未追跡（`git ls-files --others --exclude-standard`）の和集合である（AC-16）。`-z` で読み、空白・日本語を含むパスをそのまま扱う。`--no-renames` により改名は「旧パスの削除 + 新パスの追加」になる。どの経路で報告されたかに関係なく、作業ツリーに存在しないパスを削除として扱う。

### 試験の選択

unit（quick）と DB（light）の選択は vitest 自身のモジュールグラフ選択を使う。`scripts/gate-select.mjs` が vitest の公開 Node API（`createVitest` → `globTestSpecifications` / `getRelevantTestSpecifications`、`vitest related` と `--changed` が内部で使うのと同じ `filterTestsBySource`）で関連ファイルを列挙し、試験は実行しない。`gate.mjs` は列挙結果のファイルを絶対パスで `vitest run --project <unit|db> <files>` に渡す。これに次を加える。

- 変更された試験ファイルは自分自身に関連するので必ず選ばれる（モジュールグラフの性質）。
- **参照規則**: モジュールグラフに現れない変更（`.json` などのデータ、`.md`、`scripts/`・`deploy/`・`verification/` のスクリプト）は、試験ソースにそのファイル名（basename）が書かれている試験を選ぶ。例: `verification/edge/traces.json` → `model-traces` 試験、`scripts/test-identity-e2e.mjs` → `identity-runner.test.ts`。`package.json` など汎用名は除外（昇格・拡大で扱う）。
- **試験ディレクトリ規則**: `test/` 配下の非モジュールファイル（golden、fixture）が変わったら、そのディレクトリの全試験を選ぶ。
- **常時実行 suite**（light の DB）: `kernel/test/foundation.db.test.ts`、`kernel/test/document.db.test.ts`、`kernel/test/access-boundary.db.test.ts`、`kernel/test/noninterference.db.test.ts`。
- **拡大**（quick）: 削除されたソース（モジュールグラフで追えない）、`vitest.config.mts`、各 workspace の `package.json`、`pnpm-lock.yaml`、`tsconfig*.json` を含む変更では unit を全件にする（vitest 自身も `package.json` と setupFiles を `forceRerunTriggers` として全件にする）。`.prettierrc.json`・`.prettierignore`・ルート `package.json`・lockfile では `format:check` を全体に、`eslint.config.js`・ルート `package.json`・lockfile では `eslint .` を全体にする。ファイル数が 300 を超える工程も全体形にする。

### 昇格パターン

この変更を含むと quick/light だけでは不十分（AC-4）: `kernel/**`、`apps/api/drizzle/**`、`apps/api/src/db/**`、`apps/api/src/modules.ts`、`apps/api/test/payroll-provider-setup.ts`（DB project の setupFile。モジュールグラフ外）、`vitest.config.mts`、`**/package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`**/tsconfig*.json`、`eslint.config.js`、`.dependency-cruiser.cjs`、`.prettierrc.json`、`.prettierignore`、`turbo.json`、`.github/**`、`scripts/gate.mjs`、`scripts/gate-select.mjs`、および削除されたソース（`.ts` などのモジュールと `.json`・`.sql`。試験・文書を除く）。

## 受入基準（EARS）

- AC-1 WHEN `pnpm gate:quick` が実行された THE SYSTEM SHALL 基準点からの変更集合を求め、変更された `ts/tsx/js/mjs/cjs/css` に限定した `prettier --check`、変更された lint 対象に限定した `eslint --no-warn-ignored`、`lint:boundaries`（`kernel/modules/l10n/packs/apps` 配下のモジュール、`.dependency-cruiser.cjs`、`package.json` を変えたとき。1 ファイル指定では被参照側の違反を見落とすため常に全体。4.4 秒）、ルートの `typecheck`（TypeScript に関係する `.ts` などのモジュールや `.json` を変えたとき）、`apps/api`・`apps/web` を変えたときだけ各 app の `typecheck`、「試験の選択」で選んだ unit 試験、`docs:check` と `check-assurance.mjs --changed <base>`（各 1 秒未満のため常に）、`deploy/` と配布スクリプトを変えたときだけ `test:deploy` を実行する。
- AC-2 WHEN quick の変更集合が空 THE SYSTEM SHALL 検査を実行せず「変更なし」と報告して成功終了する。
- AC-3 WHEN `pnpm gate:light` が実行された THE SYSTEM SHALL 全体の `format:check`・`docs:check`・台帳検査・`typecheck`・`lint`・`test`（unit 全件）・`test:deploy` と、変更した app の `typecheck` を実行し、DB 試験は「試験の選択」で得た関連 suite と常時実行 suite の和集合を `vitest run --project db <files>` で実行する。
- AC-4 WHILE 変更集合に昇格パターンが含まれる WHEN light が実行された THE SYSTEM SHALL DB 試験を全件（`pnpm test:db`）に拡大し、報告に「includes changes that need full regression」と該当パス・規則・理由を記す。quick は実行内容を変えず（拡大規則を除く）、同じ注意と `pnpm gate:full` の案内を報告する。
- AC-5 WHEN `pnpm gate:full` が実行された THE SYSTEM SHALL `pnpm gate` の全工程を同じ順で、続けて `pnpm --filter @daifuku/api typecheck`、`pnpm build:api`、`pnpm --filter @daifuku/edge build`、`pnpm --filter @daifuku/web typecheck`、`pnpm --filter @daifuku/web build`、通常ブラウザ試験（`playwright test`）、認証ブラウザ試験（`pnpm test:identity:e2e`）を実行する。`--` 以降の引数は通常ブラウザ試験の Playwright にそのまま渡す。
- AC-6 IF full でブラウザ試験の前提（`DATABASE_URL_OWNER`・`DATABASE_URL`・`E2E_PREPARE=1`・`E2E_API_URL`・`E2E_BASE_URL` と両サーバーの到達性、認証試験の `GATE_IDENTITY_DATABASE_URL_OWNER` / `GATE_IDENTITY_DATABASE_URL`）が無く `--provision` も無い THEN THE SYSTEM SHALL 何も実行せずに失敗終了し（`--keep-going` 時は他の工程を実行した上で失敗）、CONTRIBUTING の該当節を案内する。`--without-browser` を明示したときだけ両試験を未実行として継続し、報告に `partial: true` と未実行工程を記す。
- AC-7 WHEN いずれかの階層が終了した THE SYSTEM SHALL 工程ごとの所要時間・成否・選択したファイル数・昇格注意・未実行工程を標準出力の表と `.runtime/gate/<UTC時刻>-<tier>.json` に記録する。JSON には base（ref・commit・決定方法・注記）、変更ファイル数、階層、`partial`、`escalation` を含む。
- AC-8 THE SYSTEM SHALL テストの skip / only / 除外設定や試験名フィルタを追加せず、`pnpm gate` の内容と終了条件を変更しない。quick / light は実行するファイルの選択であり、選んだファイル内の試験は全件実行する。
- AC-9 WHEN 工程が失敗した THE SYSTEM SHALL 既定では以後の工程を実行せずに失敗終了する（fail-fast）。`--keep-going` が指定されたときは全工程を実行してから失敗終了する。中断（SIGINT/SIGTERM）時は残りを未実行とし、自分が起動したプロセスだけを停止する。
- AC-10 WHEN 試験の選択結果が空 THE SYSTEM SHALL その工程を `no-target` として成功扱いし、報告に明記する。
- AC-11 WHEN `pnpm e2e:smoke` が実行された THE SYSTEM SHALL `@smoke` タグを持つブラウザ試験（6〜8 件）を既存の Playwright 設定で実行する。Playwright は `--grep` を依存 project に適用しないため、`industry` project の 3 試験も先に実行される（依存の意味を保つ）。light に `--with-smoke` が指定されたときは light の最後に同じ試験を実行し、サーバーに到達できなければ（`--provision` が無い限り）失敗として案内する。
- AC-12 WHEN pull_request または push が CI で実行された THE SYSTEM SHALL 既存の 4 job を変更せず、`quick` job（format:check・typecheck・lint・unit 全件、DB なし、同じ固定 SHA の Action、`contents: read`）を追加して先に結果を返す。
- AC-13 WHEN `--dry-run` が指定された THE SYSTEM SHALL 変更集合、昇格判定、実行予定の工程と選択した試験ファイルを表示し、報告 JSON（`dryRun: true`）を書いて、検査も試験も実行しない（git と vitest の読取専用の選択列挙だけを行う）。
- AC-14 THE SYSTEM SHALL 新しい依存ライブラリを追加しない。`gate.mjs` は Node 組込みモジュールと既存の pnpm / vitest / eslint / prettier / playwright CLI だけを使い、`gate-select.mjs` は既存 devDependency の vitest 公開 Node API（`vitest/node`）だけを使う。プロビジョニングの DB 接続は既存の `postgres`（`apps/api` の依存、`scripts/setup-test-cluster.mjs` と同じ解決）を使う。
- AC-15 WHEN 基準点を決める THE SYSTEM SHALL 「基準点と変更集合」の順で解決し、使った方法と代替の理由を報告に記す。明示した基準点が解決できないときは使い方エラーで止める。
- AC-16 WHEN 変更集合を求める THE SYSTEM SHALL コミット済み・ステージ済み・未ステージ・未追跡の和集合を NUL 区切りで読み、改名を削除 + 追加として、存在しないパスを削除として扱う。git が失敗したときは空集合で続けず失敗する。削除されたソースがあれば quick の unit を全件に拡大し、light では昇格理由として DB を全件にする。
- AC-17 WHERE `--provision` が指定された（full、または light の `--with-smoke`） THE SYSTEM SHALL `TEST_DATABASE_URL_OWNER` / `TEST_DATABASE_URL` がループバック・同一サーバー・別 role・app が `daifuku_app` であることを確認し、`apps/api/src/db/e2e-fixture.ts` と `apps/api/test/identity-e2e-database.ts` の DB 名規則を満たす一意な名前（`daifuku_e2e_test_g<UTC秒><乱数>`、`daifuku_e2e_test_enterprise_g<UTC秒><乱数>`）で新しい空 DB を `CREATE DATABASE` で作り、fixture を準備し、compiled API と Web を空きポートで起動して Playwright を実行し、自分が起動したプロセスグループだけを停止する。DB は削除・初期化せず残し、報告に名前を記す（後片付けは利用者が行う）。
- AC-18 IF DB 試験を実行する階層で `TEST_DATABASE_URL_OWNER` と `TEST_DATABASE_URL` が明示されていない THEN THE SYSTEM SHALL 既定の `daifuku_test` に接続せず、何も実行する前に失敗して設定を案内する。認証試験の fixture は `TEST_DATABASE_URL_*` を自分の DB として読むため、gate は認証工程にだけ `GATE_IDENTITY_*`（またはプロビジョニングした DB）を `TEST_DATABASE_URL_*` として渡し、ブラウザ fixture の工程からは DB 試験用の変数を取り除く。

## 関係するファイル・インターフェース（名指し）

- `scripts/gate.mjs`（新規）: 純粋関数（`resolveBase`、`collectChangeSet`、`classifyChanges`、`packageOf`、`detectEscalation`、`planSteps`、`applyPreflight`、`applySelection`、`runSteps`、`buildReport`、`formatTable`、`parseCli` ほか）と薄い実行部。`node scripts/gate.mjs --tier quick|light|full [--base <ref>] [--keep-going] [--dry-run] [--with-smoke] [--without-browser] [--provision] [-- <playwright args>]`。型は `scripts/gate.d.mts`
- `scripts/gate-select.mjs`（新規）: vitest 公開 Node API による関連試験の列挙（試験は実行しない）
- `scripts/test/gate.test.ts`（新規）: unit project が拾う位置（`**/test/**/*.test.ts`）。gate の構成は変えない
- `package.json`: `gate:quick`、`gate:light`、`gate:full`、`e2e:smoke` を追加。`gate` は不変
- `vitest.config.mts`: 変更しない
- `apps/web/e2e/smoke.spec.ts`（2 件）、`navigation.spec.ts`（3 件）、`foundation-ui.spec.ts`（1 件）、`phase1.spec.ts`（1 件）: 試験名の末尾に ` @smoke` を付けた（本体は不変）。ログインと失敗表示、取引先の作成・一覧・編集・監査、画面検索、390px のメニュー、店舗従業員の権限、売上請求書の保存・確定・取消、2 行伝票の確定と帳票
- `.github/workflows/ci.yml`: `quick` job の追加。既存 job の step は変更しない
- `CONTRIBUTING.md`、`CLAUDE.md` / `AGENTS.md`（コマンド欄）、`docs/conventions/testing.md`、`docs/architecture/verification-and-release.md`、`.github/ci/README.md`: 3 階層の使い分けを記載
- `scripts/check-doc-links.mjs`: この spec と作業記録を検査対象に追加
- `.gitignore`: `.runtime/` は既に除外済み（報告 JSON・選択結果・プロビジョニングのログの置き場）

## 実装時に確認した前提（計測とソース確認、2026-10-29、この container: 4 CPU、他エージェントと同居）

| 前提 | 結果 | 方法 |
| --- | --- | --- |
| vitest 5.0.0 の `--changed <since>` | `git diff --name-only <since>...HEAD` + `git diff --cached` + `git ls-files --other --modified --exclude-standard` を related に入れ、`vitest related` と同じ `filterTestsBySource` で絞る。未追跡も含む | vitest の dist ソース確認 |
| `--changed` と `related` の精度 | sales の 1 ファイル変更で両方とも 13 ファイル / 113 試験（同一集合）。所要 16.7 秒 / 20.3 秒（同居負荷による揺れ） | 実測 |
| `vitest list` で related を列挙できるか | できない（`--related` は未知のオプション）。列挙には公開 Node API が必要 | 実測 |
| 採用した方式 | 明示ファイル列による related（Node API で列挙）。精度は `--changed` と同じで、base の代替・削除ファイル・dry-run の列挙・報告のファイル数を gate 側で制御できるため | 判断 |
| `forceRerunTriggers` | 既定 `**/package.json`、`**/{vitest,vite}.config.*` と setupFiles。related に含まれると全件 | dist ソース確認 |
| ルート typecheck / api / web | 10.9 秒 / 14.4 秒 / 20.5 秒 | 実測 |
| depcruise 全体 / 1 ファイル | 4.4 秒 / 1.3 秒（1 ファイルでは被参照側の違反を検出できないため全体を採用） | 実測 |
| eslint 1 ファイル / prettier 1 ファイル | 1.3 秒 / 0.26 秒 | 実測 |
| test:deploy / docs:check / verify:assurance / edge build | 16.2 秒 / 0.5 秒 / 0.4 秒 / 0.7 秒 | 実測 |
| prettier・eslint に ignore 対象を明示した場合 | prettier は成功扱い、eslint は `--no-warn-ignored` で警告なし。存在しないパスは prettier がエラーにするため、存在するファイルだけを渡す | 実測 |
| Playwright 1.63 の `--grep` と依存 project | `--grep "AC-9 smoke"` でも `industry` project の 3 試験が列挙される（依存 project は絞られない） | `playwright test --list` |
| DB 全件（参考） | この環境で `pnpm test:db` 832 秒、116 ファイル / 701 試験（うち同居負荷下で `identity-rate-limit` の時間依存 1 件が失敗。main checkout のベースライン計測） | 実測 |
| banking の 1 ファイル変更で選ばれる DB suite | 37 / 116（graph 33、常時 4。`apps/api` の DB suite 30 件は runtime 経由で全 module を読むため選ばれる） | dry-run 実測 |
| ブラウザ試験の件数 | 77（`industry` 3 を含む。実装計画の記載 69 から増加）、認証 3 | full 実測 |
| `NODE_PATH` の影響 | この container は `NODE_PATH` を設定しており、`deploy/test/compiled-api.test.mjs` の AC-5 が global の typescript を解決して失敗する。外すと成功。CI は未設定。gate は環境を書き換えない | 実測 |

## データ・業務ルール（出典）

- 業務データ・制度への影響はない。開発基盤の変更である。
- 実測の基準: CI run #44（2026-09-14、`431dda5`）の job 所要時間。`gate and Web build` 13 分 19 秒、`browser workflows` 8 分 42 秒、`identity browser workflows` 37 秒、`safe setup acceptance` 32 秒。

## スコープ外（明記）

- DB suite 起動（`freshDb()` の schema 再作成）の短縮。計測後に別仕様（実装計画の A3）で扱う
- mutation（Stryker）、TLA+/TLC、セットアップ受入、エッジサービス受入、ブラウザ保護受入の階層化。既存の別 CI のまま
- テストの sharding や並列化の変更、Playwright の worker 数の変更
- 既存テストの削除・skip・期待値の変更
- 変更集合に基づく e2e の自動選択（`@smoke` の手動タグ付けまで）
- プロビジョニングした DB の自動削除（安全のため行わない）
- Windows でのプロセスグループ停止（POSIX の process group を前提。CI と開発環境は Linux / macOS）

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:quick --dry-run` で変更集合・昇格判定・実行予定が表示され、何も実行されないことを確認する。
2. `modules/sales/src/` の 1 ファイルだけを変更し、`pnpm gate:quick` が sales 関連の unit だけを実行して 2 分以内に終わることを確認し、所要時間を記録する。
3. `kernel/src/` の 1 ファイルを変更し、`pnpm gate:light` が DB 全件に昇格し、報告に注意が出ることを確認する。
4. 変更を戻して `modules/banking/src/` を変更し、`pnpm gate:light` が banking 関連と `apps/api` の DB suite、常時実行 suite だけを実行することを確認し、所要時間を記録する（目標 6 分以内）。
5. ブラウザ前提なしで `pnpm gate:full` が失敗し、準備手順を案内することを確認する。`--without-browser` で `partial: true` の報告が出ることを確認する。
6. `pnpm gate:full --provision`（または CONTRIBUTING の手順で用意した fixture とサーバー）で、CI と同じ工程が成功することを確認する。
7. `pnpm e2e:smoke` が `@smoke` の試験（と依存 project）だけを実行することを確認する。
8. `.runtime/gate/*.json` の内容が標準出力の表と一致することを確認する。
9. PR で CI の `quick` job が既存 job より先に完了することを Actions で確認する。
10. `pnpm gate` を実行し、既存の全工程が変更なく成功することを確認する。

実施結果は [作業記録](../log/2026-10-29-test-tiers.md) に記す。手順 1〜8 は実行済み（手順 6 は `--provision` で実施）。手順 9 は push していないため未実施。手順 10 は `pnpm gate` そのものではなく、同じ 8 工程を同じ順に実行する `gate:full` の成功で代えた。

## 未決事項（利用者の判断待ち）

- 解決済み: quick の typecheck は全体（`tsc7`、10.9 秒）で統一し、`apps/api`・`apps/web` の変更時だけ各 app の typecheck（tsconfig が test / e2e を含むため）を足す。
- **light の目標 6 分はこの環境で未達**（banking の 1 ファイル変更で 599 秒、DB 37 suite が 467 秒）。`apps/api` の DB suite 30 件が module 変更のたびに選ばれる（runtime が全 module を読むため）ことが主な時間要因である。選択肢: (a) DB suite 起動短縮（A3）を先に行う、(b) `apps/api` の migration 系 suite 9 件（`*-migration.db.test.ts`、`migrations.db.test.ts`、`upgrade.db.test.ts`）を migration・schema 変更時（昇格パターン）だけに限定する、(c) 目標を「DB 選択 + 静的検査で 10 分以内」に改める。(b) はモジュールグラフより狭める判断なので利用者の承認待ちとし、実装していない。CI 上の時間は未計測。
- CI の `quick` job を必須チェックにするか（既存 gate job が必須であることは変えない）。
- `--provision` で作った DB は残る。定期的な削除手順（`dropdb` の一覧化など）を運用文書に足すか。
- 参照規則はファイル名の文字列一致であり、ファイル名を組み立てて読む試験は選べない。light が unit 全件を実行することで補う前提でよいか。
