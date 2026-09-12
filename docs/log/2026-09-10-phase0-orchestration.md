# 作業記録: 2026-09-10 Phase 0 — ハーネスとカーネル試作、partner 貫通

- セッション: Claude（claude-fable-5-1）アーキテクト役 ＋ 研究サブエージェント4 ＋ 実装サブエージェント3 ／ 対象: PLAN.md Phase 0、docs/specs/{partner,api-app,web-app,mcp-app}.md
- 計測: tokens ≈ 1.43M（サブエージェント合計、実測）＋ 本体セッション（推定 0.5〜0.7M、未計測）／ agent_minutes: 研究 4×約13分並列、実装 3×約17〜26分並列、本体 約2.5時間 ／ human_minutes: 0（利用者未介入）／ rework_lines: 約12（CORS 1行、kernel 3箇所は実装エージェントの指摘に基づく修正）／ gate_failures: 本体 4（TS7 API、depcruise 設定×2、RLS '' キャスト）

## 決めたこと（と理由）
- PLAN.md §4 の ADR-0001〜0012 をそのまま `docs/adr/` に投入し、Phase 0 で ADR-0002（DSL 型推論）・0004（RLS）・0006（docstatus）・0007（権限）・0009（アクション→REST/MCP）を実装で検証した。
- **TypeScript は 6.0.3 を主、7.0.2 を `tsc7` エイリアスで併用**。理由: `typescript@7` の npm パッケージは JS コンパイラ API を公開しない（`exports['.']` が `lib/version.cjs` のみ）ため typescript-eslint が動かない。PLAN.md §5 の「TypeScript 7.0」は「型チェックのみ TS7、ツール連携は TS6」と読み替える（計画の訂正事項）。
- **オーナーロールは BYPASSRLS**（ADR-0004 に追記）。理由: FORCE RLS のままだとログイン時のテナント横断ユーザー検索が不可能。app ロールだけが RLS 対象、owner は migration/seed/login 専用。
- **DSL 定義型を `kernel/src/dsl/defs.ts` に分離**。理由: registry ⇄ dsl の実行時循環を dependency-cruiser が検出（型のみの循環は許可する設定にした上で、実行時循環を解消）。
- **`@daifuku/kernel/testing` を公開エントリに**。理由: 各パッケージの DB テストが同じ「まっさらなスキーマ＋テナント bootstrap」を要る。boundary ルールに例外を1行追加。
- テスト DB はパッケージごと（`daifuku_test_{api,mcp,web,partner}`）に分けて並列実装エージェントの衝突を回避。`pnpm gate` は `daifuku_test` で直列実行。

## やったこと
- リポジトリ骨格: pnpm workspace、Turborepo（現状未使用・将来用）、tsconfig、eslint（行数上限・any禁止・parseFloat禁止・ignorePermissions禁止・test.skip禁止）、dependency-cruiser（レイヤ一方向・他パッケージ内部 import 禁止・実行時循環禁止）、vitest projects（unit / db）。
- docs: README、experiment.md（H1〜H4）、ADR×12、conventions×6、domain（用語集・日本制度事実）、spec 雛形、log 雛形、metrics。CLAUDE.md（≒AGENTS.md）は 60 行。
- kernel（3,423 行、テスト含む）: Decimal、errors、i18n、ids、normalize（半角カナ）、DSL（fields/types/defs/entity/action/module）、Drizzle テーブル導出（RLS ポリシー付き）、Zod 導出、registry、context、DB client（withContext = トランザクション＋set_config）、system tables、permissions（ロール×操作・行ルール→SQL・フィールド群）、repository（CRUD・楽観ロック・監査・フック・制約エラー変換）、document（submit/cancel/amend/transition・依存検出）、numbering（no-gap UPSERT）、audit、events（outbox）、actions（汎用 CRUD・実行）、meta、migrate（FORCE RLS・GRANT・audit_log 不変トリガ）、schema-sync（drizzle-kit API）、auth、testing。
- 実装エージェント3並列: modules/partner（601 行）、apps/api（981 行）、apps/mcp（876 行）、apps/web（2,953 行）。統合後に本体で CORS 修正・kernel 修正・E2E 実行。

## 検証（何を・どう確認したか）
- [実測] `pnpm gate`: tsc7 通過（約1.3秒）、eslint 0 エラー、depcruise 0 違反（116 modules / 391 deps）、unit 66 テスト、db 59 テスト、合計約38秒。
- [実測] `pnpm db:reset` → API 起動 → `POST /auth/login` → `GET /api/partner` で seed 3件。
- [実測] Playwright E2E（apps/web/e2e/smoke.spec.ts）2/2 通過: ログイン → 取引先作成 → 一覧で検索 → 編集 → 監査ログ2件。スクリーンショット: outputs の screenshot-partner-{list,form}.png。
- [実測] MCP: 実装エージェントが stdio クライアントで `partner_list` 等6ツールを呼び出し、監査に actorType='agent' が残ることを確認（apps/mcp/test/stdio.db.test.ts）。
- [実測] RLS: app ロールでの生 SQL が他テナント行を返さない／他テナント行の INSERT が WITH CHECK で拒否（kernel/test/repository.db.test.ts AC-10）。audit_log の DELETE はオーナーでもトリガで拒否（AC-11）。
- [実測] 採番: ロールバックした submit が番号を消費しない（document.db.test.ts AC-2）。
- [レビュー] apps/api/src/plugins/auth.ts を目視: JWT 検証→毎リクエストの principal 再読込→`x-company-id` のテナント所属検証→agent ヘッダ。問題なし。
- [未検証] 負荷・同時実行（採番の並行 submit は直列化の設計のみ、実測なし）。TS7 の速度優位（コードベースが小さく差が出ない）。MCP Inspector / Claude Code からの実接続。JWT 12h 失効の実時間観測。

## 見つけた問題と修正（発見経路つき）
- `typescript@7` に JS API が無く typescript-eslint が peer 不整合 — 発見: pnpm install の警告＋パッケージ内容確認、修正: TS6 主＋tsc7 エイリアス。
- RLS ポリシーの `current_setting(...)::uuid` が未設定セッションで `''::uuid` エラー — 発見: bootstrapTenant の DB テスト失敗、修正: `NULLIF(..., '')`。
- FORCE RLS でオーナーもログイン検索不可 — 発見: 同上、修正: owner に BYPASSRLS（ADR-0004 追記）。
- registry ⇄ dsl の実行時循環 — 発見: dependency-cruiser、修正: defs.ts 分離。
- ガードのフィクスチャが numeric 文字列 '0.000000' を '0' と比較していた — 発見: DB テスト（transition が通ってしまう）、修正: Decimal 比較。
- **マスクされたフィールドが汎用 list/get の出力スキーマ検証で INTERNAL になる** — 発見: MCP 実装エージェントの viewer ロールテスト、修正: fieldGroup 対象を出力スキーマで optional に（kernel/src/db/zod.ts）。
- 一意制約違反が 500 になる — 発見: partner 実装エージェント（規約 errors.md との不一致）、修正: repository で 23505→Conflict、23503→ValidationError。
- **CORS: `@fastify/cors` v11 の既定 methods が GET,HEAD,POST のみで PATCH/DELETE の preflight が失敗** — 発見: **E2E 実測**（API の inject テストにも web のモック実行にも現れない）、修正: methods/allowedHeaders を明示。→ 「別々に検証した部品を実機で結合する」工程の価値の実例。
- `@daifuku/kernel/testing` が boundary ルールに引っかかる — 発見: 実装エージェント2名が独立に報告、修正: 例外1行。

## 未実施（減らさない）
- [ ] GitHub リポジトリへの push（利用者の判断待ち）
- [ ] Phase 0 出口基準の本番検証: 別セッションのエージェントに spec だけ渡して `product` エンティティを追加させ、H1 の2点目を測る
- [ ] Turborepo を実際に使う（現状 root スクリプト直実行）／ CI（GitHub Actions）
- [ ] worker アプリ（outbox 配信の常駐プロセス）— `deliverPending` は kernel にあるが常駐は未実装
- [ ] ext フィールド定義（テーブルはあるが定義に基づく検証は未実装）
- [ ] 台帳（ADR-0005）は Phase 1
- [ ] トークン実測の仕組み（現状 tokens=null。サブエージェントの usage は本記録に手書き）
- [ ] metrics キーの snake/camel 不一致（scripts が camelCase、experiment.md が snake_case）→ experiment.md を camelCase に合わせる（次回）
- [ ] MCP: outputSchema / structuredContent、tools/list ページング
- [ ] web: `/meta` 失敗時の表示方針、ref フィールドのラベル解決の N+1

## 判断待ち（利用者）
- PLAN.md §10 の 1〜4（リポジトリ／コードネーム／最初の業種パック／公開・ライセンス）。
- 本記録の「TypeScript 7」訂正を計画に反映してよいか。
- Phase 1 の着手順（既定: マスタ → 会計コア → 販売 → 購買 → 在庫 → l10n/jp）。

## 次のセッションへ
- `tar.gz` を展開 → `pnpm install` → `scripts/db-setup.sql` を superuser で実行 → `.env` を用意 → `pnpm db:reset` → `pnpm gate` → `pnpm dev:api` / `pnpm dev:web`。
- 最初にやること: 出口基準の検証（product エンティティを spec から別コンテキストで追加、metrics に2点目を記録）。
