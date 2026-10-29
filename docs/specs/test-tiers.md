# Spec: test-tiers（3段階の回帰テスト: quick / light / full）

- 状態: draft
- モジュール: `scripts/`（gate orchestrator）、`package.json` scripts、`apps/web/e2e`、`.github/workflows/ci.yml` ／ 依存: 既存の `pnpm gate` 構成、vitest projects（unit / db）、Playwright 設定
- ADR: 新規 ADR は不要（検証の実行方法の追加であり、設計境界・権限・DSL・テスト内容を変えない）。[検証と公開](../architecture/verification-and-release.md) と [テスト規約](../conventions/testing.md) を更新する
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。実装計画は [完成度向上の実装計画](../completion-plan.md) A1

## 目的（1段落）

現在の `pnpm gate` は型・lint・単体（1,003件）・DB（668件）・配備補助・文書・台帳検査を一括で実行し、公開 CI では 13 分 19 秒かかる（2026-09-14 の run #44、`gate and Web build` job の `Run pnpm gate` step）。ブラウザ試験は別 job で 8 分 42 秒、認証試験 37 秒、セットアップ受入 32 秒である。編集のたびに全体を回すと開発が遅くなり、逆に何も回さないと回帰が PR まで見つからない。そこで、変更ファイルから関連する検査だけを選ぶ **quick**、全体の静的検査と単体に関連 DB 試験を足す **light**、既存の gate にブラウザ試験まで含む **full** の 3 段階を用意し、人と AI エージェントが「いつ何を回すか」を迷わず選べるようにする。選択は緩和ではない。「完了」の主張には引き続き full が必要である。

## 階層の定義

| 階層 | コマンド | 内容 | 目標時間 | 使う場面 |
| --- | --- | --- | --- | --- |
| quick（超軽量） | `pnpm gate:quick` | 変更ファイルに限定した Prettier 検査と ESLint、変更 package の typecheck、`vitest run --project unit --changed <base>`、`.md` 変更時のみ docs:check | 2 分以内（通常 1 分前後） | 編集ループ、コミット前 |
| light（軽量） | `pnpm gate:light` | 全体の format:check・typecheck・lint（依存境界含む）・unit 全件・test:deploy・docs:check・verify:assurance、DB 試験は関連 suite と常時実行 suite の和集合 | 6 分以内（DB 全件昇格時は gate と同程度） | push 前、作業の区切り、PR 下書き |
| full（フル） | `pnpm gate:full` | 既存の `pnpm gate` 全工程、API/Web の typecheck と build、通常ブラウザ試験、認証ブラウザ試験 | 現状どおり（CI 並列で約 15 分、ローカル直列で 25 分程度） | 「完了」の主張前、PR を ready にする前、main を取り込んだ後、昇格条件に該当する変更 |

`pnpm gate` の内容と意味は変えない。`gate:full` は `gate` を包含する別名であり、CI の gate job はそのまま `pnpm gate` を実行する。

基準点（base）は `git merge-base HEAD origin/main`、`origin/main` が無ければ `HEAD~1`。`--base <ref>` か環境変数 `GATE_BASE` で上書きできる。変更集合は base からのコミット済み差分、作業ツリーの変更、ステージ済み、未追跡ファイルの和集合である。

昇格パターン（この変更が含まれると quick/light だけでは不十分）: `kernel/**`、`apps/api/drizzle/**`、`apps/api/src/db/**`、`apps/api/src/modules.ts`、`vitest.config.mts`、`package.json`（各 workspace を含む）、`pnpm-lock.yaml`、`tsconfig*.json`、`eslint.config.js`、`.dependency-cruiser.cjs`、`turbo.json`、`.github/**`、`scripts/gate.mjs`。

常時実行する DB suite（light で変更集合に関係なく実行する kernel の番人）: `kernel/test/foundation.db.test.ts`、`kernel/test/document.db.test.ts`、`kernel/test/access-boundary.db.test.ts`、`kernel/test/noninterference.db.test.ts`。

## 受入基準（EARS）

- AC-1 WHEN `pnpm gate:quick` が実行された THE SYSTEM SHALL 基準点からの変更集合を求め、変更された `ts/tsx/js/mjs/cjs/css` に限定した `prettier --check` と `eslint`、変更ファイルが属する workspace package の `typecheck`、`vitest run --project unit --changed <base>` を順に実行する。`.md` が変更されたときだけ `docs:check` を加える。
- AC-2 WHEN quick の変更集合が空 THE SYSTEM SHALL 検査を実行せず「変更なし」と報告して成功終了する。
- AC-3 WHEN `pnpm gate:light` が実行された THE SYSTEM SHALL 全体の `format:check`・`typecheck`・`lint`・`test`（unit 全件）・`test:deploy`・`docs:check`・`verify:assurance` を実行し、DB 試験は `vitest list --project db --changed <base>` で得た関連 suite と常時実行 suite の和集合を `vitest run --project db <files>` で実行する。
- AC-4 WHILE 変更集合に昇格パターンが含まれる WHEN light が実行された THE SYSTEM SHALL DB 試験を全件（`pnpm test:db` と同じ集合）に拡大し、報告に「フル回帰が必要な変更を含む」と該当パスを記す。quick は実行内容を変えず、同じ注意を報告する。
- AC-5 WHEN `pnpm gate:full` が実行された THE SYSTEM SHALL `pnpm gate` の全工程、`pnpm --filter @daifuku/api typecheck`、`pnpm build:api`、`pnpm --filter @daifuku/web typecheck`、`pnpm --filter @daifuku/web build`、通常ブラウザ試験（`playwright test`）、認証ブラウザ試験（`pnpm test:identity:e2e`）を実行する。
- AC-6 IF full でブラウザ試験の前提（`TEST_DATABASE_URL_OWNER` / `TEST_DATABASE_URL` と `E2E_BASE_URL` のサーバー到達性、認証試験の fixture 変数）が無い THEN THE SYSTEM SHALL その工程を失敗として終了し、[CONTRIBUTING](../../CONTRIBUTING.md) の準備手順を案内する。`--without-browser` を明示したときだけ未実行として継続し、報告に `partial: true` と未実行工程を記す。
- AC-7 WHEN いずれかの階層が終了した THE SYSTEM SHALL 工程ごとの所要時間・成否・選択した試験ファイル数・昇格注意・未実行工程を標準出力の表と `.runtime/gate/<UTC時刻>-<tier>.json` に記録する。JSON には base、変更ファイル数、階層、`partial`、`escalation` を含む。
- AC-8 THE SYSTEM SHALL テストの skip / only / 除外設定を追加せず、`pnpm gate` の内容と終了条件を変更しない。quick / light は実行対象の選択であり、既存テストの緩和・削除を伴わない。
- AC-9 WHEN 工程が失敗した THE SYSTEM SHALL 既定では以後の工程を実行せずに失敗終了する（fail-fast）。`--keep-going` が指定されたときは全工程を実行してから失敗終了する。
- AC-10 WHEN `vitest --changed` の選択結果が空 THE SYSTEM SHALL その工程を「対象なし」として成功扱いし、報告に明記する。
- AC-11 WHEN `pnpm e2e:smoke` が実行された THE SYSTEM SHALL `@smoke` タグを持つブラウザ試験だけを既存の Playwright 設定（`industry` 依存を含む）で実行する。light に `--with-smoke` が指定され、サーバーに到達できるときは light の最後に同じ試験を実行する。
- AC-12 WHEN pull_request または push が CI で実行された THE SYSTEM SHALL 既存の 4 job を変更せず、`quick` job（format:check・typecheck・lint・unit 全件、DB なし、目標 4 分以内）を追加して先に結果を返す。
- AC-13 WHEN `--dry-run` が指定された THE SYSTEM SHALL 変更集合、昇格判定、実行予定の工程と選択 suite を表示して何も実行しない。
- AC-14 THE SYSTEM SHALL 新しい依存ライブラリを追加せず、`node:child_process` と既存の pnpm / vitest / eslint / prettier / playwright の CLI だけで実装する。

## 関係するファイル・インターフェース（名指し）

- `scripts/gate.mjs`（新規）: 階層定義、変更集合の算出、昇格判定、工程の逐次実行、報告の出力。`node scripts/gate.mjs --tier quick|light|full [--base <ref>] [--keep-going] [--with-smoke] [--without-browser] [--dry-run]`
- `package.json`: `gate:quick`、`gate:light`、`gate:full`、`e2e:smoke` を追加。`gate` は不変
- `vitest.config.mts`: 変更しない。`--changed` と `vitest list` は CLI 引数で使う
- `apps/web/e2e/smoke.spec.ts`、`foundation-ui.spec.ts`、`navigation.spec.ts`、`phase1.spec.ts`: 代表的な 6〜8 件の `test` 名に `@smoke` を付ける（ログイン、取引先の作成と検索、売上請求書の保存と確定、画面検索、390px のメニュー）
- `.github/workflows/ci.yml`: `quick` job の追加。既存 job の step は変更しない
- `CONTRIBUTING.md`、`CLAUDE.md`（コマンド欄）、`AGENTS.md`、`docs/conventions/testing.md`、`docs/architecture/verification-and-release.md`: 3 階層の使い分けを記載
- `.gitignore`: `.runtime/` は既に除外済み（報告 JSON の置き場）

## データ・業務ルール（出典）

- 業務データ・制度への影響はない。開発基盤の変更である。
- 実測の基準: CI run #44（2026-09-14、`431dda5`）の job 所要時間。`gate and Web build` 13 分 19 秒、`browser workflows` 8 分 42 秒、`identity browser workflows` 37 秒、`safe setup acceptance` 32 秒。

## スコープ外（明記）

- DB suite 起動（`freshDb()` の schema 再作成）の短縮。計測後に別仕様（[完成度向上の実装計画](../completion-plan.md) A3）で扱う
- mutation（Stryker）、TLA+/TLC、セットアップ受入、エッジサービス受入、ブラウザ保護受入の階層化。既存の別 CI のまま
- テストの sharding や並列化の変更、Playwright の worker 数の変更
- 既存テストの削除・skip・期待値の変更
- 変更集合に基づく e2e の自動選択（`@smoke` の手動タグ付けまで）

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:quick --dry-run` で変更集合・昇格判定・実行予定が表示され、何も実行されないことを確認する。
2. `modules/sales/src/` の 1 ファイルだけを変更し、`pnpm gate:quick` が sales 関連の unit だけを実行して 2 分以内に終わることを確認し、所要時間を記録する。
3. `kernel/src/` の 1 ファイルを変更し、`pnpm gate:light` が DB 全件に昇格し、報告に注意が出ることを確認する。
4. 変更を戻して `modules/banking/src/` を変更し、`pnpm gate:light` が banking 関連と `apps/api` の DB suite、常時実行 suite だけを実行することを確認し、所要時間を記録する（目標 6 分以内）。
5. ブラウザ前提なしで `pnpm gate:full` が失敗し、準備手順を案内することを確認する。`--without-browser` で `partial: true` の報告が出ることを確認する。
6. CONTRIBUTING の手順で fixture DB とサーバーを用意し、`pnpm gate:full` が CI と同じ件数（単体・DB・ブラウザ 69 件・認証）で成功することを確認する。
7. `pnpm e2e:smoke` が `@smoke` の試験だけを実行することを確認する。
8. `.runtime/gate/*.json` の内容が標準出力の表と一致することを確認する。
9. PR で CI の `quick` job が既存 job より先に完了することを Actions で確認する。
10. `pnpm gate` を実行し、既存の全工程が変更なく成功することを確認する。

## 未決事項（利用者の判断待ち）

- quick の typecheck を package 単位にするか、全体 `tsc7` にするか。全体が 60 秒以内なら全体で統一する（実装時に計測して決める）。
- light の目標 6 分を超える場合、DB suite 起動短縮（A3）をどの時点で優先するか。
- CI の `quick` job を必須チェックにするか（既存 gate job が必須であることは変えない）。
