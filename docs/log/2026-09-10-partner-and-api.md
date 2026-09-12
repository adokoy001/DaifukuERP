# 作業記録: 2026-09-10 partner モジュールと apps/api の実装

- セッション: 実装エージェント（Claude）／ 担当: agent ／ 対象: docs/specs/partner.md, docs/specs/api-app.md
- 計測: tokens=null, agent_minutes=28（partner 10 + api 18、推定）, human_minutes=0, rework_lines=0, gate_failures=5（内訳は下記）

## 決めたこと（と理由）
- **支払期日の算出規則**（partner AC-10）: 締め日 = `min(closingDay, 月の日数)`。請求日が締め日以前ならその月、後なら翌月の締め期間。支払日 = 締め月 + `paymentMonthOffset` の月の `min(paymentDay, 月の日数)`。**算出した支払日が締め日より前になる設定**（例: 月末締め・当月10日払い = offset 0 で paymentDay < closingDay）は翌月に繰り越す。これにより「支払期日 ≥ 締め日 ≥ 請求日」が常に成り立つ（property test で担保）。純粋関数 `services/due-date.ts` は年月日の整数演算のみで、`Date` のタイムゾーンに依存しない。
- **`code` の一意性は before_create フックで Conflict(409) にする**（partner AC-4）。DB の unique index は残す（競合時の最後の砦）。kernel の Repository は PostgreSQL の 23505 を Conflict に変換しないため、フック無しだと 500 になる。api 側のエラーハンドラでも 23505 → 409 を backstop として実装した。
- **シードは「code が無ければ作成」**（AC-9）。既存行の更新はしない（再実行のたびに audit_log が増えるのを避ける）。
- **api の検証は kernel が単一の検証点**: `POST /actions/<name>` は各アクションの zod スキーマをルートに付ける（OpenAPI 用）が、ルートの validator は pass-through にし、`runAction` の ValidationError（フィールドパス付き）をそのまま返す。二重 parse（Decimal 変換・カナ正規化の再適用）と、エラー形状の二重化を避けるため。手書きルート（login, /api/:entity の params・querystring）は fastify-type-provider-zod の validator を使い、エラーハンドラで同じ `{ error: { code, message, hint, details.issues[] } }` に変換する。
- **レスポンスの serializer は pass-through**（`JSON.stringify`）。出力は `runAction` が output スキーマで検証済み。response スキーマは OpenAPI 専用。
- **`x-company-id` は自テナントの companies に存在することを確認**する（400 VALIDATION）。partner に company_id の FK が無いため、未検証だと他テナントの company id で行が作れてしまう。
- **`POST /actions/:name`（動的）はルートとして残すが OpenAPI からは隠す**。未知のアクションは `runAction` が 404 + hint を返す。
- 401 は `code: 'PERMISSION_DENIED'` に httpStatus 401 を載せた `Unauthorized`（`ErrorCode` に 401 用のコードが無いため）。
- `db:schema`（`cli.ts snapshot`）は「生成されるであろう SQL の dry-run」を JSON で出す。ADR-0002 の「生成ファイルを作らない」に合わせ、スナップショットファイルは drizzle の `meta/` 以外に置かない。
- マイグレーションは drizzle-kit の journal 形式（`meta/_journal.json`, `NNNN_<name>.sql`, `meta/NNNN_snapshot.json`、`prevId` 連鎖、`--> statement-breakpoint` 区切り）。kernel の `runMigrations`（drizzle-orm migrator）がそのまま読める。初回は `0000_init`（30 文、8 テーブル）。
- Fastify 5.12 で `disableRequestLogging` が deprecated だったため `logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: 'requestId' })` を使用。

## やったこと
- modules/partner: `entities/partner.ts`（spec のフィールド表そのまま、ラベル ja/en、views）、`services/due-date.ts`、`actions/compute-due-date.ts`、`hooks/unique-code.ts`、`seeds/partners.ts`、`module.ts`、`index.ts`。
- modules/partner/test: `due-date.test.ts`（例 6 + fast-check property 4）、`partner.db.test.ts`（AC-1〜AC-10、10 tests）。
- apps/api: `server.ts`（buildServer）、`main.ts`、`modules.ts`、`config.ts`、`request-context.ts`、`plugins/{auth,errors,openapi,request-log}.ts`、`routes/{meta,actions,rest}.ts`、`db/{cli,migrations,reset}.ts`、`drizzle/migrations/0000_init.sql` + meta。
- apps/api/test: `api.db.test.ts`（AC-1〜AC-8 + テナント分離、11 tests）、`migrations.db.test.ts`（AC-9: 生成物と registry の同期・空 DB への適用・冪等・RLS/grant・seed、3 tests）。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）
- [実測] `pnpm exec tsc -p modules/partner/tsconfig.json --noEmit` / `pnpm exec tsc -p apps/api/tsconfig.json --noEmit`: エラー 0。`pnpm typecheck`（リポジトリ全体, tsc7）: エラー 0（4.2 秒）。
- [実測] `pnpm exec eslint modules/partner apps/api`: エラー 0・警告 0。
- [実測] `pnpm exec vitest run modules/partner apps/api`（TEST_DATABASE_URL* = daifuku_test_api）: **4 files, 34 tests passed**（7.1 秒）。内訳: due-date 10、partner.db 10、api.db 11、migrations.db 3。
- [実測・失敗] `pnpm exec depcruise --config .dependency-cruiser.cjs modules/partner apps/api`: **3 errors** — すべて `no-cross-package-internals: <test> → kernel/src/testing.ts`。`@daifuku/kernel/testing` は kernel/package.json の `exports` に宣言された公開エントリだが、ルールの `pathNot` が `/src/index.ts$` しか許していない。scratchpad にコピーした設定に `'^kernel/src/testing\\.ts$'` を 1 行追加して実行すると **violations 0**（modules/partner apps/api）、リポジトリ全体でも errors 0（既存の warn 1: apps/web/playwright.config.ts の orphan）を実測。設定ファイルは担当範囲外なので未修正（→ 判断待ち）。
- [実測] `pnpm db:generate init` → `0000_init.sql`（29 breakpoints = 30 文）。直後の `pnpm db:generate again` → `no schema changes; nothing written`。
- [実測] `pnpm db:reset`（daifuku_dev）: migrate → seed → 8 テーブル、partner 3 行、`drizzle.__drizzle_migrations` 1 行、`partner` の relrowsecurity/relforcerowsecurity = t、`audit_log` の daifuku_app 権限 = SELECT, INSERT。`pnpm db:migrate` 再実行は no-op。`pnpm db:reset` 2 回目も成功。
- [実測] `pnpm dev:api` + curl（抜粋、トークン等は省略）:
  ```
  POST /auth/login {"email":"admin@example.com","password":"password"}
    → {"token":"eyJ…","user":{"id":"…","name":"Admin","email":"admin@example.com","roles":["admin"],"tenantId":"…","defaultCompanyId":"…"}}
  POST /auth/login (password: nope) → 401 {"error":{"code":"PERMISSION_DENIED","message":"invalid email or password","hint":"Log in with POST /auth/login and send `Authorization: Bearer <token>`."}}
  GET /meta (no token) → 401 {"error":{"code":"PERMISSION_DENIED","message":"No Authorization was found in request.headers",…}}
  GET /meta → entities 1 ['partner'], actions 6, modules ['partner'], roles ['admin']
  GET /auth/me (x-agent-id: claude-1) → {"user":{…},"companyId":"…","actor":{"type":"agent","id":"claude-1","onBehalfOf":"<admin id>"},"locale":"ja"}
  POST /api/partner {"name":"curl 商店"} → 200 {…,"code":null,"isCustomer":false,"isSupplier":false,"taxStatus":"registered","closingDay":31,"paymentMonthOffset":1,"paymentDay":31,"isActive":true,"version":1,…}   (AC-1)
  POST /api/partner {"name":"NG","invoiceRegistrationNo":"T123"} → 400 {"error":{"code":"VALIDATION","message":"invalid input for partner.create","hint":"See details.issues; …","details":{"issues":[{"path":"invoiceRegistrationNo","message":"Invalid string: must match pattern /^T\\d{13}$/"}]}}}   (AC-2)
  POST /api/partner {"nameKana":"かーるしょうてん","bankAccountHolderKana":"ｶ)ｶｰﾙ abc"} → nameKana "ｶｰﾙｼｮｳﾃﾝ", bankAccountHolderKana "ｶ)ｶｰﾙ ABC"   (AC-3)
  PATCH /api/partner/:id {"patch":{"closingDay":32},"expectedVersion":2} → 400 issues [{"path":"patch.closingDay","message":"Too big: expected number to be <=31"}]   (AC-5)
  PATCH /api/partner/:id {"patch":{"notes":"x"},"expectedVersion":1} → 409 {"error":{"code":"CONFLICT","message":"partner … was modified (version 2, expected 1)",…}}
  POST /api/partner {"name":"dup","code":"C-0001"} → 409 {"error":{"code":"CONFLICT","message":"partner code \"C-0001\" already exists in this company","hint":"Use a different code, or update the existing partner instead.","details":{"field":"code","code":"C-0001"}}}   (AC-4)
  GET /api/partner?search=サンプル&orderBy=code:asc&limit=5 → total 1 [['C-0001','株式会社サンプル商事']]
  GET /api/partner?where={"isSupplier":true} → total 2 ['B-0001','S-0001']
  POST /actions/partner.compute_due_date {"partnerId":…,"invoiceDate":"2026-09-21"}（20日締め翌月10日払い）→ {"closingDate":"2026-10-20","dueDate":"2026-11-10"}   (AC-10)
  POST /actions/partner.nope → 404 {"error":{"code":"NOT_FOUND","message":"action \"partner.nope\" does not exist","hint":"List available actions with GET /meta or the MCP tool list.",…}}
  GET /api/partner/:id/audit → [['update','user',3 fields],['create','user',32 fields]]
  DELETE /api/partner/:id → {"ok":true}
  GET /openapi.json → openapi 3.1.0, paths 14: /auth/login, /auth/me, /meta, /meta/entities/{name}, /actions/partner.{compute_due_date,list,get,create,update,delete}, /api/{entity}, /api/{entity}/{id}, /api/{entity}/{id}/{op}, /api/{entity}/{id}/audit
      partner.create body: 24 properties (23 fields + ext), required ["name"], taxStatus enum ["registered","exempt"], closingDay {integer, 1..31}; response 200: 32 properties; securitySchemes bearerAuth
  GET /docs/ → 200 text/html
  GET /api/partner (x-company-id: nope) → 400 issues [{"path":"headers.x-company-id"}]
  POST /api/partner (body "{bad") → 400 {"error":{"code":"VALIDATION","message":"Body is not valid JSON …","details":{"fastifyCode":"FST_ERR_CTP_INVALID_JSON_BODY"}}}
  GET /nothing → 404 {"error":{"code":"NOT_FOUND","message":"route GET /nothing does not exist","hint":"See /openapi.json …"}}
  ```
  リクエストログ（AC-8）1 行/リクエスト: `{"level":30,…,"requestId":"01a0…","method":"GET","url":"/health","status":200,"ms":4.87,"actor":{"type":"anonymous","id":null},"msg":"request"}`。Fastify の deprecation 警告なし（`logController` 採用後に再起動して確認）。サーバは確認後に停止。
- [レビュー] spec のフィールド表と `entities/partner.ts` の対応（23 フィールド、制約、ラベル、views.list/search/form）。
- [レビュー] apps/api に業務ロジックが無いこと（rest.ts / actions.ts は `runAction` への委譲のみ）。
- [未検証] partner spec 検証手順 3（MCP `partner_list`）、4（画面 `/e/partner`）— apps/mcp・apps/web は本セッションの範囲外。
- [未検証] `pnpm gate` 全体の通過（`pnpm lint` はリポジトリ既存の `.dependency-cruiser.cjs` と `scripts/metrics-add.mjs` の `no-undef` 6 件で落ちる。本作業とは無関係だが、gate としては失敗する）。
- [未検証] JWT 12h の失効挙動を実時間で確認していない（claims の `exp - iat = 43200` を assert したのみ）。

## 見つけた問題と修正（発見経路つき）
- `@daifuku/kernel/testing` の import が dependency-cruiser の `no-cross-package-internals` に違反 — 発見: 実測（depcruise）。修正: **未**（`.dependency-cruiser.cjs` は範囲外）。提案する修正は `pathNot` に `'^kernel/src/testing\\.ts$'` を追加（scratch 設定で 0 violations を実測済み）。
- kernel の `createSchemaFromScratch` / `currentSnapshot` / `diffSql`（`kernel/src/db/schema-sync.ts`）が index から export されていない — 発見: レビュー。回避: apps/api/src/db/migrations.ts が `drizzle-kit/api` を直接使って同じ処理を再実装。
- kernel の Repository が PostgreSQL の一意制約違反（23505）を `Conflict` に変換しない — 発見: レビュー（AC-4 の 409 を満たす経路が無い）。回避: partner モジュールの before_create フック + api のエラーハンドラ。
- api.db.test の AC-3 でフィールド数を 24 と書いたが正しくは 23（spec 表を数え間違え）— 発見: 実測（vitest 失敗）。修正: テストの期待値を 23 に直した（実装は正しかった）。
- `disableRequestLogging` が Fastify 5.12 で deprecated（FSTDEP023）— 発見: 実測（dev サーバのログ）。修正: `logController` に切替。
- `requestIdLogLabel: 'requestId'` と自前の `requestId` でログのキーが重複 — 発見: 実測（ログ行）。修正: 自前行から `requestId` を外し、バインドされたラベルに任せる。
- `db/cli.ts` は import 時に `main()` を実行するため、テストから `seedAll` を import できない — 発見: レビュー（テスト作成時）。修正: `db/reset.ts` に分離。
- gate 失敗の内訳（gate_failures=5）: tsc(partner) 1、tsc(api) 1、vitest(api) 1、depcruise(partner, api) 各 1（設定起因、未解消）。

## 未実施（減らさない。完了したら「済」を付けて残す）
- `.dependency-cruiser.cjs` の修正（範囲外。上記の 1 行）。
- kernel index から `createSchemaFromScratch` / `currentSnapshot` / `diffSql` を export し、apps/api/src/db/migrations.ts の drizzle-kit 直接依存を外す。
- kernel Repository で 23505 → `Conflict` 変換（するなら partner の before_create フックは削除可能）。
- 公表サイト Web-API による登録番号の実在確認（spec のスコープ外, Phase 1）。
- MCP ツール `partner_list`、画面 `/e/partner` の確認（apps/mcp, apps/web 未実装）。
- OpenAPI: `/meta`, `/auth/me`, `/api/*` の response スキーマ（現状は action ルートのみ response を持つ）。
- レート制限・OIDC（spec のスコープ外）。
- `pnpm lint` を通すための既存ファイル（`.dependency-cruiser.cjs`, `scripts/metrics-add.mjs`）の eslint 設定（`no-undef`: Node グローバル）。

## 判断待ち（利用者）
- `.dependency-cruiser.cjs` の `no-cross-package-internals` に `@daifuku/kernel/testing` を許可する 1 行を入れてよいか（代替: kernel の testing を `kernel/src/index.ts` 経由で再 export する — ただし本番コードから `freshDb` が見えてしまう）。
- 支払期日の「締め日より前になる設定は翌月へ繰り越す」規則でよいか（業務上あり得ない設定の扱い）。
- `code` 一意性のフック（モジュール側）と kernel 側 23505 変換のどちらに寄せるか。

## 次のセッションへ
- apps/mcp: registry の action から tool 生成（`toolNameOf`）。`partner_list` で spec 検証手順 3 を閉じる。
- apps/web: `/e/partner` の汎用一覧・フォーム（`GET /meta/entities/partner` の views.form を使う）。
- 次のモジュール（product 等）を追加する際は `apps/api/src/modules.ts` に import を足すだけで REST/OpenAPI が増えることを H1 の計測点として記録する。
