# 作業記録: 2026-09-11 kernel-phase15（ext フィールド登録・after_lines_saved・internal アクション・currency）

- セッション: 実装エージェント（Claude）1 ラン ／ 担当: agent ／ 対象: docs/specs/kernel-phase15.md（AC-10 は本体で実施済みのため対象外）
- 計測: tokens=null, agent_minutes=37, human_minutes=0, rework_lines=10（src 3: registry の private `actions` と新メソッド名の衝突。test 7: 自作テストのデータ・比較の誤り）, gate_failures=4（tsc 1、vitest db 3。内訳は下記）
- 設計の要点は ADR-0014（docs/adr/0014-ext-fields-internal-actions-lines-hook.md）。ここには判断の経緯と検証だけを書く。

## 決めたこと（と理由）
- **ext の検証は `buildSchemas` に焼き込まず、Repository の parse 直後の別ステップ**（`kernel/src/ext.ts`）。`defineEntity` 時点では pack の登録がまだ無いため。zod は遅延生成し、`registry.extVersion(entity)`（登録ごとに単調増加、`reset` でも戻らないスタンプ）でキャッシュを無効化。`z.lazy` は使わない: zod 4.6 の `$ZodLazy` は getter の結果を def にキャッシュするので、初回参照後の登録が反映されない（node_modules/zod/v4/core/schemas.js で確認）。
- **update の ext は patch に含まれるときだけ検証**。既存の Repository は `ext` を丸ごと置換する意味なので、それを変えずに「置換後の値」を検証する。patch に ext が無い更新（名前変更など）は、登録前に作られた行でも通す。insert は ext を省略しても必須キーを要求。
- **`ext.<key>` の where は登録済みキーだけ許可**。未登録キーでのフィルタも技術的には可能だが、typo が「0 件」で黙って通るのをエージェントが見抜けないため、登録キー一覧を hint に VALIDATION にした（ADR-0003 の自由形式キーは保存はできるが検索対象外）。比較は `ext ->> 'key'` のテキスト。範囲演算子は拒否、`$like` は text 種別のみ（spec AC-4 の範囲）。キーは登録時の正規表現を通ったものなので SQL リテラルで埋め込む（式インデックスが効く形を残す）。
- **空の `$in` は ext では「偽」**にした。既存のエンティティ列の `compileCondition` は `$in: []` を `col = col`（NULL 以外すべて真）、`$ne: null` を `col <> col`（常に偽）にしており、SQL の意味と逆に見える。既存挙動は変えていない（下の「見つけた問題」）。
- **`searchable` は ext 専用の TextOpts**。エンティティ項目に付けると `defineEntity` がエラー（`views.search` を使え、の hint）。黙って無視されるオプションを作らないため。
- **ext に `default` / `unique` / `index` / `immutable` を付けると登録エラー**。JSONB では効かない（または今回実装しない）オプションが黙って無視されるのを避けた。既定値は before_validate フックで入れる。
- **汎用 create/update の input（OpenAPI・MCP の元）に ext の形を載せる方法**: `registerCrudActions` の後に登録された ext も反映させるため、`ActionDef.input` を getter にして extVersion（明細エンティティ分も含む）が変わったら再生成（`kernel/src/actions/crud-schemas.ts` `followExtFields`）。`defineAction` は cfg をスプレッドするので、定義後に `Object.defineProperty` で差し替えている。apps は無改修で拾える（fastify のルート登録時・MCP の tools/list ごとに読む）。
- **`after_lines_saved` の `row` はフックごとに親を読み直す**。1 本目のフックが親を更新した場合、2 本目が古い行を受け取らないように（spec「parent row passed is fresh」）。`row` は他の after_* と同じく DB の生の行（numeric は `'60.500000'`）、`lines` は `getLines` と同じドメイン行（Decimal、seq 順、全明細セット）。
- **sales / purchase の明細フックは残し、saveLines 中だけ no-op**（spec AC-7 が許す形）。明細フックを消すと、REST/MCP の `sales_invoice_line.create` や repo 直書きでヘッダ合計が古いまま残る（既存テスト AC-2「direct line write recalculates the header too」がそれを検証している）。「saveLines 中か」は kernel の `isSavingLines(ctx, document, id)`（WeakMap<Context> の参照カウント、`finally` で解除、フック発火前に解除）で判定。発火前に解除するのは、after_lines_saved のフックが明細を直接書いたときに通常の再計算を走らせるため。
- **internal アクションの HTTP 拒否は `callAction`（apps/api/src/request-context.ts）の 1 箇所**。`/actions/<name>` の個別ルートは作らず（OpenAPI にも出ない）、catch-all と REST sugar の両方が通る `callAction` で 404 NOT_FOUND＋hint。存在を完全に隠すより「内部用なので API には無い」と言う方がエージェントの自己修正に役立つと判断。
- **`registry.actions()` を足し、`allActions()` は全件のまま**。l10n/jp・mcp のテストが `allActions()` を使っており、意味を変えると他パッケージのテストの意味が変わるため。
- **money の scale**: `f.money()` と `f.quantity()` はどちらも `scale: 6` で区別できなかった。`f.money()` に `money: true` を持たせ既定 `scale: 6` を外し（列は常に numeric(20,6)、`pnpm db:schema` の pendingStatements 0 で確認）、meta で「明示 scale > 会社通貨の桁 > 6」の順に解決。`FieldMeta.money: true` も出す（web-polish の判断待ち「金額と数量の区別」への回答）。meta 関数は同期のまま `opts.currency` を受け取り、apps/api の `/meta` 系ルートが `findCompany` で通貨を渡す（apps/api/src/routes/meta.ts を最小限編集。AC-11 の `/meta` scale に必要なため。orchestrator の編集範囲指示「internal フィルタと /auth/me」の外なので報告に明記）。MCP の resources（daifuku://meta）は通貨を渡していない（scale は従来の 6）。
- **`/auth/me` の company は app 接続の request context（RLS）で `findCompany`**。auth プラグインは owner 接続しか持っていなかったので `registerAuth` に `db`（app 接続）を渡すよう server.ts を変更。会社が無い（default 無し・ヘッダ無し）ときは `company: null`。settings は返さない（spec `settings?: never`）。
- **未登録エンティティの registerExt は `DependencyError`**（spec 指定）。既存コンストラクタは「cancel 時の依存文書」専用の文言だったので、後方互換の 4 番目の引数 `override: { message, hint }` を足した。

## やったこと
- 読んだもの: CLAUDE.md、spec kernel-phase15 / web-phase15、ADR-0003/0008/0009/0013、conventions（layers / code-style / errors / testing / lint）、log テンプレートと payment / web-polish の作業記録、kernel の registry / dsl(*) / db(zod, table, client, migrate, system-tables) / repository(*) / lines / meta / settings / permissions / document / actions(run, crud) / errors / decimal / index / testing とテスト・fixture、apps/api（server, auth, request-context, routes/*, openapi, テスト）、apps/mcp（tools, resources, schema, modules, テスト）、modules/sales・purchase（hooks, record-payment, recalculate, DB テスト）、apps/web の format / currency / company（契約の確認のみ、編集なし）、zod 4.6 の `$ZodLazy` 実装。
- kernel（src 新規 4、変更 15）:
  - 新規 `src/dsl/ext.ts`（登録時チェック）、`src/ext.ts`（遅延 zod・`validateExt`・`extInputSchema`）、`src/repository/ext-query.ts`（`ext.<key>` の where / search）、`src/actions/crud-schemas.ts`（汎用 CRUD の zod 形、ext 追従 getter）
  - 変更 `registry.ts`（`after_lines_saved`、`HookArgs.lines`、`registerExt` / `extFields` / `extVersion`、`actions({ includeInternal })`、private の `actions` Map を `actionDefs` に改名）、`dsl/defs.ts`・`dsl/action.ts`（`internal`）、`dsl/fields.ts`（`TextOpts.searchable`、`DecimalOpts.money`、`f.money`）、`dsl/entity.ts`（searchable ガード）、`db/zod.ts`（`fieldInputSchema` を export）、`repository/repository.ts`（parse で `validateExt`）、`repository/query.ts`（where キー検査・search に ext）、`permissions.ts`（`compileCondition` が `ext.` を委譲）、`lines.ts`（`isSavingLines`、`replaceLineSet` に分割、`after_lines_saved` 発火）、`meta.ts`（`extFields`、`MetaOptions`、money scale、internal 除外）、`settings.ts`（`currencyScale`、`findCompany`）、`actions/crud.ts`（read/write/document に分割、ext 追従）、`errors.ts`（`DependencyError` の override）、`index.ts`
  - テスト新規 `test/ext.test.ts`（unit 11）、`test/internal-action.test.ts`（unit 4）、`test/ext.db.test.ts`（db 8）、`test/lines-hook.db.test.ts`（db 4）
- apps/api: `request-context.ts`（`assertExposedAction`）、`routes/actions.ts`（`registry.actions()`）、`routes/meta.ts`（通貨を meta に）、`plugins/auth.ts`（`/auth/me` の company）、`server.ts`（registerAuth に app 接続）、`test/api.db.test.ts`（describe 1 つ・3 件、追加のみ +54 行）
- apps/mcp: `tools.ts`（`listTools` / `findAction` を `registry.actions()`）、`modules.ts`（起動ログの actions 数を公開分に）
- modules/sales: `actions/record-payment.ts`（`internal: true`）、`hooks/recalc.ts`（`after_lines_saved` でヘッダを 1 回 touch）、`hooks/lines.ts`（saveLines 中は touch しない）、`recalculate.ts`（コメント）、`test/sales.db.test.ts`（追加のみ +8 行、下記）
- modules/purchase: `actions/record-payment.ts`（`internal: true`）、`hooks/recalc.ts`（`after_lines_saved` で `recalculateInvoice`）、`hooks/lines.ts`（saveLines 中は再計算しない）、`test/purchase.db.test.ts`（追加のみ +7 行、下記）
- docs: ADR-0014 新規、本作業記録。
- `pnpm install` / `db:reset` / `db:migrate`（daifuku_dev）は実行していない。検証用に一時 DB `daifuku_test_k15_scratch` を作成し、他パッケージの db テストと実 HTTP 確認に使って最後に DROP した。

## テスト期待値の変更（挙動変更による。弱めていない）
- `modules/sales/test/sales.db.test.ts` AC-1: `expect(inv.version).toBe(2)` を追加（作成 1 ＋ after_lines_saved の 1 回。切替前は明細 3 行ぶん touch して 4 — 計算値。isSavingLines を無効化したミューテーションでは 1+3+1 = 5 を実測）。AC-2: 既存の `toBeGreaterThan` は残し、`expect(u.version).toBe(inv.version + 1)` を追加（lines だけの update は 1 回）。AC-7: `registry.action('sales.record_payment').internal === true` と `registry.actions()` に含まれないことを追加（テストは従来どおり `runAction` / `applyPayment` を呼ぶ）。
- `modules/purchase/test/purchase.db.test.ts` AC-2: `b.version === 2`（作成 1 ＋ 1 回。切替前は 1 + 明細 2 行 = 3 — 計算値、未実測）、`u.version === b.version + 2`（ヘッダ patch 1 ＋ 明細保存 1）。AC-5: internal の 2 行を追加。
- 既存の期待値を書き換えた箇所は無い。直接の明細書き込みで再計算される既存アサーション（sales AC-2 / purchase AC-2）はそのまま通る。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）
- [実測] `pnpm typecheck`（tsc7、リポジトリ全体）: exit 0。
- [実測] `npx eslint . --max-warnings 0`: exit 0（警告 0）。`pnpm lint:boundaries`: no dependency violations（319 modules, 1417 dependencies）。kernel/src に循環 import が無いことを depcruise の JSON 出力で別途確認。
- [実測] `pnpm test`（unit 全体）: **28 files, 251 tests passed**（15.8 秒）。うち新規 kernel unit 15 件。
- [実測] `npx vitest run --project db kernel`（daifuku_test）: **5 files, 35 tests passed**（新規 ext.db 8、lines-hook.db 4）。
- [実測] sales（daifuku_test_sales）: **1 file, 9 tests passed**。purchase（daifuku_test_purchase）: **1 file, 8 tests passed**。
- [実測] apps/api 全 db テスト（daifuku_test_api。api / meta / attachments / migrations / scenario）: **5 files, 46 tests passed**。migrations テストと `tsx src/db/cli.ts snapshot` の pendingStatements 0 で「マイグレーション不要」を確認。
- [実測] apps/mcp db テスト（daifuku_test_mcp）: 2 files, 18 tests passed。internal の除外は tsx の使い捨てスクリプトで確認（internal を 1 つ定義 → `listTools` に出ない、`findAction` undefined、`callTool` は NOT_FOUND の isError）。apps/mcp のテストファイルは編集していない。
- [実測] 他パッケージの db テストを一時 DB で実行（他エージェントの DB を drop しないため）: partner 10、product 11、tax 9、accounting 14、attachments 10、payment 8、l10n/jp 4 — 全 passed（その時点の他エージェントのコードに対して）。
- [実測] spec 検証手順 2 を実 HTTP で: 一時 DB に `cli.ts reset` → `PORT=3915 tsx src/main.ts` → `/auth/me` に `"company":{"id":…,"name":"デモ株式会社","currency":"JPY"}`、`/openapi.json` に `record_payment` 0 件（`/actions/sales.ar_aging` 等は有り）、`/meta/entities/sales_invoice` の `extFields: []` と money 5 項目の `scale: 0, money: true`、`/meta` の actions に record_payment 無し（113 件）、`POST /actions/sales.record_payment` は 404 NOT_FOUND＋hint。確認後にサーバを停止（PID と環境変数 PORT=3915 を確認して kill）。
- [実測] spec 検証手順 3 は kernel の db テストで `test_partner`（kernel テストに `partner` は無い）に対して実施: registerExt → ext 付き create → 不正値で VALIDATION（パスは `ext.<key>`、件数不変、汎用アクション経由も同じ）→ `where: { 'ext.jan': … }`（等価・$in・$ne・null・$like・$or・count、decimal の正規化比較）→ search ヒット（searchable でない ext はヒットしない）。
- [実測] 変更の効き目の確認（ミューテーション）: `isSavingLines` を常に false にすると sales の新アサーションが `expected 5 to be 2` / `expected 10 to be 6` で落ちることを確認し、元に戻した。
- [レビュー] ファイル ≤ 400 行・関数 ≤ 80 行（eslint で担保）、`any` と非 null アサーション無し、kernel に業務用語を入れていない（`currency` は会社マスタの既存列）。
- [未検証] `pnpm gate` の一括実行（db プロジェクトは既定の daifuku_test を共有し、他エージェントの DB と衝突するため、パッケージ別 DB で分けて実行した）。
- [未検証] web での ext 描画・通貨桁の表示（web-phase15 の担当）。MCP resources（daifuku://meta）の money scale は通貨を渡していないので 6 のまま。

## 見つけた問題と修正（発見経路つき）
- registry の private フィールド `actions`（Map）と新メソッド `actions()` が同名で tsc エラー — 発見: 実測（kernel の tsc）。修正: private を `actionDefs` に改名。gate_failures 1。
- ext.db テストの初回: 登録キー `since` が `test_partner` の既存項目と衝突し、`registerExt` が意図どおり ValidationError（AC-12 の実証になった）— 発見: 実測。修正: テストのキーを `firstOrder` に。gate_failures 1。
- ext.db テストの `$or` 期待値: 先行テストで作った別の取引先も rank c を持っていた（テストデータの重なり）— 発見: 実測。修正: name の条件で絞る。gate_failures 1。
- lines-hook テスト: `row.amount` を `'60.5'` と比較したが、after_* の `row` は DB の生の行で `'60.500000'` — 発見: 実測。修正: Decimal で比較し、仕様としてテストのコメントに書いた。gate_failures 1。
- 既存の不具合候補（修正していない）: `permissions.ts` の `compileCondition` で `$in: []` が `col = col`（NULL 以外すべて一致）、`$ne: null` が `col <> col`（常に不一致）。rowRules に空の `$in` が来ると行制限が外れる方向に働く可能性がある — 発見: レビュー（ext の条件を書く際に比較）。ext 側は SQL の意味（空 `$in` は偽、`$ne: null` は IS NOT NULL）で実装。

## 未実施（減らさない。完了したら「済」を付けて残す）
- ext の範囲検索・`orderBy`（spec で「not required」）。
- `views.list` に `ext.<key>` を書く手段（エンティティ定義時の検証で弾かれる。L2 のビュー定義が要る）。
- テナント別の ext 定義（`ext_field_definitions` テーブルからの流し込み）。
- 登録済み ext の GIN / 式インデックス（ADR-0003 の記述。マイグレーションが要るので本 spec の範囲外）。
- modules/payment の明細フック（`touchPayment`）の `after_lines_saved` 化（他エージェントの担当範囲のため未編集）。
- docs/conventions/reports.md・ADR-0008 のフック一覧・ADR-0013 のポート一覧への追記（編集範囲外。ADR-0014 から参照）。
- MCP resources の money scale（通貨を渡す）。

## 判断待ち（利用者）
- **money の FieldMeta.scale を通貨桁（JPY=0）にしたことの表示影響**: 現在の apps/web `formatDecimal` は「scale を超える桁は表示しない」ので、端数のある単価や未丸めの明細金額（sales の `amount = quantity × unitPrice`、例 1234.5）が「1,234」と切り捨て表示になる（[実測] 現時点の apps/web/src/lib/format.ts を tsx で呼び `formatDecimal('1234.500000', 0, 0)` → `"1,234"`、scale 6 なら `"1,234.5"`）。選択肢: (a) web で scale を「最小表示桁」として扱う、(b) 端数を持ちうる money 項目に明示 `scale` を付ける（例 `unitPrice: f.money({ scale: 2 })`）、(c) kernel は money に通貨桁を別フィールド（例 `currencyScale`）で渡し `scale` は 6 のまま。spec の文言どおり (現状) にしているが、(a) か (c) を推奨。
- rowRules の `$in: []` / `$ne: null` の既存挙動を SQL の意味に直すか（影響範囲の調査込みで別 spec に）。

## 次のセッションへ
- pack.md（definePack）で `registry.registerExt(..., { source: '<pack>' })` を使う。source は Conflict の hint と meta の `source` に出る。
- web-phase15: `EntityMeta.extFields`（`name: 'ext.<key>'`、値は `row.ext[key]`）、`FieldMeta.money`、`/auth/me` の `company.currency` を使う。上の判断待ち（scale の意味）を先に決める。
- 明細を持つ新しい伝票モジュールは、ヘッダ再計算を `after_lines_saved` に置き、明細の after_* では `isSavingLines` で重複を避ける（sales / purchase が手本）。
