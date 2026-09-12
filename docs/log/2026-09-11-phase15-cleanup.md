# 作業記録: 2026-09-11 phase15-cleanup（台本 INV4・消費税集計ステップ・permissions の演算子・payment の after_lines_saved・CI 定義）

- セッション: 実装エージェント（Claude）1 ラン ／ 担当: agent ／ 対象: docs/specs/phase15-cleanup.md（AC-1〜AC-6）
- 計測: tokens≈320000（概算。セッションの残量表示の差分から見積もり、実測ではない）, agent_minutes≈25, human_minutes=0, rework_lines=12（ci.yml の PG* 環境変数をワークフロー全体から psql ステップへ移した 10 行、scenario テストの重複アサーション削除と taxSummary の rate 追加 2 行）, gate_failures=0（自分の変更に起因するゲート失敗なし。下の「他エージェント作業中の失敗」は別）
- 編集範囲: docs/domain/scenario-kojin.md、apps/api/test/scenario.db.test.ts、kernel/src/permissions.ts、kernel/test/permissions.test.ts（新規）・permissions.db.test.ts（新規）、modules/payment/src/hooks/{lines,validate}.ts、modules/payment/test/payment.db.test.ts、.github/workflows/ci.yml（新規）、docs/metrics/features.jsonl（`pnpm metrics:add`）、本記録。他の kernel ファイル・他モジュール・apps/api/src・apps/web は未編集。`pnpm install` / `db:generate` / `db:reset` / `db:migrate` は実行していない。

## 決めたこと（と理由）
- **AC-1 の数値は spec を鵜呑みにせず手計算で導出し、spec と一致した**（spec の算術に誤りは見つからなかった）。INV4: 1,111 × 3 = 3,333、3,333 × 0.08 = 266.64 → 切捨て 266（行ごとなら 88.88 → 88 × 3 = 264）、税込 3,599、C1 月末締め翌月末払いで期日 2026-11-30。影響: 売上 239,000 → 242,333、仮受 23,900 → 24,166、売掛 229,900 → 233,499、試算表合計 860,300 → 863,899（借方・貸方とも +3,599）、差引 18,000 → 18,266、損益 82,500 → 85,833、年齢表 C1 165,000 → 168,599・合計 229,900 → 233,499。試算表合計は「取引ごとの和」と「科目ごとの和」の 2 通りで検算し台本に両方書いた。
- **台本の INV4 は「税抜入力なので売上高は明細ごと 3 行、仮受消費税は税率ごと 1 行」と転記形まで書いた**（sales の services/posting.ts の規則。消費税集計表の count 4 = 3 + 1 の根拠になるため）。
- **P4 の税区分 reduced は台本の入力データとして与え、軽減税率の対象判定（飲食料品の譲渡か）の根拠は範囲外と明記**。docs/domain/japan-tax.md に飲食料品の範囲の出典が無く、本 spec の編集範囲にも無いため（下の未実施）。端数処理の規則は既存の japan-tax.md#rounding（国税庁 Q&A 問57）を引用。
- **ステップ 11 のコードは自分で書いた**。tax-period-summary の作業記録には「コードは最終報告に貼付」とあり、ログ本体にコードは無い（最終報告は本セッションに渡されていない）。行の形 `[side, taxCategory, taxRate, taxableAmount, taxAmount, count]` と count の意味（その行に集計した転記済み仕訳明細の数 = 税抜額の明細 + 税額の明細、伝票数ではない）は services/tax-summary.ts の `b.count += g.lines` と actions/tax-period-summary.ts の `lines: { count: true }` を読んで確認。売上 reduced の count は 4（4000 の 3 明細 + 2200 の 1 明細）で spec と一致。加えて totals を試算表の 2200 / 1500 の残高と突き合わせ、HTTP の結果が in-process と一致することも見る。
- **ステップ 8（仕訳明細の直接集計）は残した**。ステップ 11 のレポートと独立した経路での確認になるため。出力税が 2 グループになり aggregate の返却順が保証されないので、4000 の集計にも並べ替えを入れた。
- **「行ごとに丸めると 264」の否定アサーション**は、spec の `not.toBe('264')` に加えて、INV4 の明細から行ごと切捨ての合計を実際に計算して 264 になることも確かめた（264 がこのデータで起こりうる誤りであることをテスト内で示す）。
- **AC-3 は `compileCondition` の 1 箇所を直した**（`compileDomain` は行ルールだけでなく利用者の `where` でも使われるので両方に効く）: `$in: []` → `false`、`$ne: null` → `IS NOT NULL`、`$in` の null 要素 → `(col IN (非 null) OR col IS NULL)`、null だけなら `col IS NULL`。**`$ctx.*` トークンが null に解決される場合（`$ctx.companyId` で会社なし）も同じ規則**にした（置換後の値で判定。旧コードは `$ne` の判定を置換前の値で行っていたので `$ne: '$ctx.companyId'` は `col <> NULL` = 常に不一致だった）。等価 `field: '$ctx.companyId'`（null に解決）→ `col = NULL` は spec の対象外なので変えていない（下の判断待ち）。
- **ext の条件（kernel/src/repository/ext-query.ts）は編集していない**（編集範囲外、別エージェントが kernel を編集中）。そちらは `$in` の null 要素を捨てる（`IS NULL` を足さない）ので、エンティティ列と ext で `$in: [x, null]` の意味が異なる（下の未実施）。
- **SQL 文字列の unit テストは drizzle の `PgDialect.sqlToQuery` で描画**（DB 不要）。行が実際にどう返るかは `permissions.db.test.ts`（daifuku_test）で別に固定した。修正前のコードで何行返っていたかも実測してテストのコメントに書いた。
- **AC-4 は sales の形をそのまま写した**: 明細の after_* の `touchPayment` は `isSavingLines(ctx, 'payment', id)` 中は no-op、ヘッダの `after_lines_saved`（hooks/validate.ts、ヘッダの before_update と同じファイル）が draft なら 1 回だけ空 update。明細フックは消していない（repo 直書き・`payment_allocation.*` の直接書き込みでヘッダが古くならないように。既存 AC-2 の直接書き込みアサーションがそれを検証している）。
- **payment のテストに version のアサーションを 2 つ追加**（sales/purchase と同じく、切替の効果を観測できる形）: 2 明細の create は version 2（旧: 1 + 明細 2 = 3 — 計算値。旧コードでは先に update 側のアサーションで止まったので未実測）、1 明細を置き換える replace-all update は `p.version + 2`（旧: +3 = ヘッダ patch + 新明細 create + 旧明細 delete — 実測 5 = 2 + 3）。
- **CI の pnpm は `pnpm/action-setup@v4` に version を渡さず package.json の `packageManager: pnpm@10.28.0` を使う**。両方指定すると action が「複数のバージョン指定」で失敗するため（action の仕様の記憶に基づく判断。GitHub 上では未確認）。
- **Playwright は `--reporter=list,html` を CLI で足した**。apps/web/playwright.config.ts は `list` だけで playwright-report/ を作らない（apps/web は編集範囲外）。失敗時のアーティファクトは playwright-report/・test-results/（trace）・API/web のログ。サーバは `pnpm --filter @daifuku/api start`（tsx、watch なし）と `pnpm dev:web` をバックグラウンド起動し `/health` と `:5173/` を最大 90 秒待つ。

## やったこと
- 読んだもの: CLAUDE.md、spec、台本、scenario.db.test.ts（全体）、作業記録（tax-period-summary / kernel-phase15 / scenario / web-phase15 冒頭）、accounting の services/tax-summary.ts・actions/tax-period-summary.ts・tax-period-summary.db.test.ts、kernel の permissions.ts・lines.ts・dsl/types.ts・dsl/entity.ts・repository/ext-query.ts・testing.ts・test（ext.test / dsl.test / lines-hook.db.test / repository.db.test 冒頭 / fixtures）、payment の src 全体と db テスト、sales の hooks/{lines,recalc}.ts と services/posting.ts、purchase の hooks/{lines,recalc}.ts と services/posting.ts 冒頭、tax の services/compute.ts と seeds/rates.ts、scripts/metrics-add.mjs・docs/metrics/features.jsonl、.env.example、scripts/db-setup.sql、package.json、vitest.config.mts、eslint.config.js、tsconfig、apps/web/playwright.config.ts・vite.config.ts・e2e/smoke.spec.ts 冒頭・src/api/client.ts 冒頭、apps/api の config.ts・db/cli.ts・server.ts（/health）、docs/domain/japan-tax.md 冒頭。
- 台本（docs/domain/scenario-kojin.md）: P4、INV4 行と導出・転記、売上計、残高、試算表 3 行と合計（導出 2 通り）、消費税の集計（差引 18,266 と `accounting.tax_period_summary` の 5 行・count の導出）、損益、年齢表、ひっかけ 6。
- scenario.db.test.ts（510 → 575 行、`it` 10 → 11）: ステップ 2 に P4、ステップ 4 に INV4（明細の説明「菓子A/B/C」、仕訳 5 行、明細、taxSummary、行ごと丸め 264 の否定）と計、ステップ 6 に INV4 の open、ステップ 7 の試算表・残高・outstanding・損益、ステップ 8 の出力税 2 グループと差引、ステップ 9 の年齢表、ステップ 11（新規）。
- kernel/src/permissions.ts（112 → 126 行）: `compileIn` を追加、`$ne` を置換後の値で判定。
- kernel/test/permissions.test.ts（unit 9 件）、kernel/test/permissions.db.test.ts（db 2 件）。
- modules/payment/src/hooks/lines.ts（`isSavingLines`）、hooks/validate.ts（`after_lines_saved`）、test/payment.db.test.ts（version アサーション 2 つ、追加のみ +5 行）。
- .github/workflows/ci.yml（新規 150 行、ジョブ gate / e2e）。
- `pnpm metrics:add` で 4 行: kernel-phase15（tokens 427826、38 分 — spec の値。作業記録本文は 37 分）、tax-period-summary（255260、20 分）、web-phase15（393555、40 分）、phase15-cleanup（≈320000 概算、≈25 分）。rework / gate_failures / testsAdded は各作業記録から転記。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）
- [実測] 着手前のベースライン: scenario（daifuku_test_scenario）10 passed、payment db（daifuku_test_payment）8 passed、kernel unit 4 files / 26 passed。
- [実測] **scenario**（daifuku_test_scenario）: **1 file, 11 tests passed**、最終版で 3 回連続。台本の数値はすべて文字列一致で検証（INV4 税額 266、合計借方 863899 など）。
- [実測] scenario のアサーションが効いていることの確認: 期待値を一時的に INV4 税額 264・試算表借方 860300・集計表 totals 23,900/18,000・reduced count 5 に書き換えて実行 → ステップ 4 / 7 / 11 が `expected '266' to be '264'`、`expected '863899' to be '860300'` 等で失敗 → 元に戻した（diff で復元を確認）。
- [実測] **kernel unit**: `npx vitest run --project unit kernel` **5 files, 35 tests passed**（新規 9）。**kernel db**（daifuku_test）: `npx vitest run --project db kernel` **6 files, 37 tests passed**（新規 2）。
- [実測] permissions の SQL（`PgDialect.sqlToQuery`、使い捨て tsx スクリプト、fixture `test_partner`）: 修正前 `$in: []` → `"test_partner"."owner_id" = "test_partner"."owner_id"`、`$ne: null` → `"owner_id" <> "owner_id"`、`$in: ['customer', null]` → `"kind" in ($1, $2)` params `['customer', null]`、`$in: [null]` → `"kind" in ($1)` params `[null]`。修正後 `false`、`"owner_id" is not null`、`("kind" in ($1) or "kind" is null)` params `['customer']`、`"kind" is null`。`$ne: 'customer'`・`null`・行ルール `$or` は前後で同一。
- [実測] 行の返り方（使い捨てスクリプト、A: owner あり・region east / B: 両方 null / C: owner あり・region west）: 修正前 where `$in []` → A,C、`$ne null` → なし、`$in [east,null]` → A、`$in [null]` → なし、行ルール `$in: []` のロール → **A,C（制限が外れて見えていた）**、`$ne: null` のロール → なし、`$in [east,null]` → A。修正後 → なし / A,C / A,B / B / なし / A,C / A,B。
- [実測] テストの効き: permissions.ts を修正前に一時的に戻すと unit 8/9 failed（残る 1 件は「変わらない演算子」のテスト）、db 2/2 failed（`expected { names: ['A','C'], count: 2 } to deeply equal { names: [], count: 0 }`）→ 修正版に戻した（diff で確認）。
- [実測] **payment db**（daifuku_test_payment）: 追加アサーションを先に入れて**修正前のコードで実行 → `expected 5 to be 4`（replace-all update が +3）で失敗**。切替後 **1 file, 8 tests passed**（2 回）。ミューテーション（`isSavingLines` の判定を無効化）で `expected 7 to be 5` の失敗を確認し元に戻した。payment unit 12 passed。
- [実測] kernel の変更の回帰（`compileDomain` は全モジュールの where で使われるため）: 使い捨て DB `daifuku_test_p15c_scratch` を作り、`npx vitest run --project db modules l10n apps/api apps/mcp` → **17 files, 151/153 passed**（api 14、attachments(api) 13、meta 6、scenario 11、mcp 15 + stdio 3、l10n/jp 4、accounting 14 + tax-period-summary 5、attachments 10、partner 10、payment 8、product 11、purchase 8、sales 9、tax 9）。失敗 2 件は `apps/api/test/migrations.db.test.ts`（下の「他エージェント作業中の失敗」）。実行後 DROP 済み。
- [実測] `pnpm test`（unit 全体）: **33 files, 308 tests passed**。
- [実測] `pnpm typecheck`（tsc7、ルート）: exit 0。ルート tsconfig はテストを含まないので、kernel / modules/payment / apps/api の各 tsconfig（src + test）でも tsc7 を実行: いずれも exit 0。
- [実測] `pnpm lint`（eslint . + boundaries）: exit 0、`no dependency violations found (352 modules, 1570 dependencies cruised)`。触ったファイルは `eslint --max-warnings 0` でも 0。
- [実測] ci.yml の構文: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` で parse 成功（jobs: gate 7 steps、e2e 11 steps）。actionlint は環境に無く未実行。
- [レビュー] ファイル ≤ 400 行（テストは eslint で除外）・関数 ≤ 80 行・`any` 無し・非 null アサーション無し。
- [未検証] **CI ワークフローの実行**（GitHub リモート未設定のため一度も走らせていない）。特に: `pnpm install --frozen-lockfile` がロックファイルと一致するか（作業中の他エージェントが apps/api/package.json に依存を足している）、`pnpm/action-setup@v4` の version 解決、`scripts/db-setup.sql` を postgres サービスに流す手順、`pnpm gate` の db テストが daifuku_test 1 つで全パッケージ直列に通るか、Playwright のブラウザ導入・サーバ起動待ち・レポートのアップロード。
- [未検証] `pnpm gate` の一括実行（db テストを既定の daifuku_test で全部流すと並行作業中の他エージェントと衝突しうるため、パッケージ別 DB と使い捨て DB で分けて実行）。web の e2e（payment 画面は version の増え方が変わるが、画面はサーバの再読込値を使うのでレビュー上は影響なし）。

## 見つけた問題と修正（発見経路つき）
- `$in: []` が行ルールで全行（列が非 null の行）を見せていた・`$ne: null` が全行を隠していた・`$in` の null 要素が効かなかった — 発見: kernel-phase15 のレビュー（本 spec の前提）、本ランで修正前後の行を実測。修正: kernel/src/permissions.ts。
- `$ne: '$ctx.companyId'`（会社なしで null に解決）が `col <> NULL`（常に不一致）になっていた — 発見: レビュー（修正時に置換前の値で null 判定していることに気付いた）。修正: 置換後の値で判定し `IS NOT NULL`。unit テストで固定。
- 他エージェント作業中の失敗（本ランの変更と無関係、未修正）: `apps/api/test/migrations.db.test.ts` 2 件が失敗 — packs/example の `example_tag` エンティティが登録されているがマイグレーションが未生成（`pendingStatements` に CREATE TABLE "example_tag" …）。発見: 使い捨て DB での回帰実行。
- **CLAUDE.md の書式 `pnpm metrics:add -- --feature …` だと、記録に `"": true` のキーが入る** — 発見: 実測（本ランの 4 行に `"date":"2026-09-11","":true,` が付いた。pnpm 10.28.0 がルートのスクリプトに `--` をそのまま渡し、scripts/metrics-add.mjs が `--` を空キーのフラグとして読む）。修正: 追記直後に自分の 4 行からだけ `"":true,` を取り除いた（値は変えていない。既存 17 行には空キー無しを確認）。scripts/metrics-add.mjs（`--` を読み飛ばす）か CLAUDE.md の例の修正は編集範囲外で未実施。rework_lines には数えていない。
- 同期ずれ（未修正、編集範囲外）: `modules/accounting/test/tax-period-summary.db.test.ts` の「AC-6 台本 10 月分（scenario-kojin.md §消費税の集計）」は INV4 追加前の台本（23,900 / 18,000）を postFromSource で再現しており、台本の更新後は「台本 10 月分」の名前と数値が一致しない（テスト自体はその入力に対して正しく通る）。

## 未実施（減らさない。完了したら「済」を付けて残す）
- CI の初回実行（GitHub 設定後）と、失敗した場合の修正。
- `modules/accounting/test/tax-period-summary.db.test.ts` の台本 10 月分に INV4 相当の明細（4000 reduced 1,111 × 3、2200 reduced 266）を足すか、名前から「台本」を外す（accounting の担当範囲）。
- ext の `$in` の null 要素（`ext-query.ts` は null を捨てる）をエンティティ列と同じ `OR ... IS NULL` にそろえる（kernel、別エージェントの編集中ファイルの近くなので本ランでは触らない）。
- docs/domain/japan-tax.md に軽減税率の対象（飲食料品の譲渡の範囲・判定時点）の一次出典を足す。
- `pnpm gate` の一括実行。
- apps/web/playwright.config.ts に html レポーターを入れる（CI 側は CLI 引数で代替中）。
- scripts/metrics-add.mjs で `--` を読み飛ばす（または CLAUDE.md の例から `--` を外す）。

## 判断待ち（利用者）
- 等価条件で `$ctx.*` トークンが null に解決される場合（`{ companyId: '$ctx.companyId' }` を会社なしで評価）を `col IS NULL` にするか、現状の `col = NULL`（常に不一致 = 安全側）のままにするか。行ルールでは「不一致」の方が安全なので現状維持を推奨。
- `$ne: <値>` は SQL どおり NULL の行を含まない（`col <> 'x'`）。ドメイン式の利用者（エージェント）が「x 以外 = null も含む」と期待しがちなら `OR col IS NULL` にする選択肢がある（今回は spec の範囲外で未変更）。

## 次のセッションへ
- 台本の期待値（INV4 追加後）: 売上 242,333 / 仮受 24,166 / 売掛 233,499 / 試算表 863,899 / 差引 18,266 / 損益 85,833 / 年齢表 C1 168,599・計 233,499。Odoo / ERPNext の比較でもこの値を使う。
- 明細を持つ伝票はすべて「ヘッダ再計算は after_lines_saved、明細フックは isSavingLines 中 no-op」になった（sales / purchase / payment）。
- ドメイン式の演算子の意味: `$in: []` = 偽、`$in` の null 要素 = `IS NULL` を OR、`$ne: null` = `IS NOT NULL`（kernel/test/permissions.test.ts が SQL を固定）。
