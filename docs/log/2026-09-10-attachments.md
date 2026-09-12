# 作業記録: 2026-09-10 attachments（証憑・添付。電帳法の電子取引データ保存）

- セッション: 実装エージェント（**再開**。前のエージェントが modules/attachments の 13 ファイル・test 2 ファイル・apps/api/src/routes/attachments.ts を書いた時点で API レート制限により中断。本セッションは新規コンテキストで CLAUDE.md / conventions / ADR-0007・0013 / japan-tax.md / spec / kernel の公開 API・storage・registry・testing / partner モジュール / apps/api の server・rest・request-context・auth / @fastify/multipart README を読み、既存コードを AC-1..8 に対して照合してから続きを実装）／ 担当: agent ／ 対象: docs/specs/attachments.md
- 計測: tokens=null, agent_minutes=17（22:41Z 開始 → 22:58Z 記録完了。前回分は未計測）, human_minutes=0, rework_lines=31（既存コードの変更行）, gate_failures=2

## 引き継いだ状態（何があったか）
- modules/attachments/src: `entities/attachment.ts`（AC-1 の 13 フィールド、delete を誰にも与えないロール表、自己参照 `supersededById`）、`actions/{search,supersede,link,for-record,upload}.ts`、`hooks/{integrity,link-target}.ts`、`services/{validate,search,hash}.ts`、`module.ts`（name `attachment`, depends `partner`）、`index.ts` — 型・lint・境界は既に緑、db テスト 10 件＋unit 8 件が通る状態だった。
- apps/api/src/routes/attachments.ts: multipart アップロード（`req.parts()` を全消費、limit エラーを標準エラー形へ）とダウンロード（RFC 5987 の `filename*`）が書かれていた。ただし `@daifuku/mod-attachments` が apps/api から解決できず `tsc -p apps/api` は落ちていた。
- 無かったもの: apps/api/test/attachments.db.test.ts、作業記録、metrics。

## 決めたこと（と理由）
- **既存コードは書き直さず、AC 照合で見つかった穴だけ直した**（下記「見つけた問題」）。設計（upload は defineAction ではなく関数 `uploadAttachment`、整合性ルールはフックで汎用 CRUD 経路も守る、検証は storage.put の前に全部済ませる）はそのまま採用。
- **multipart の未知フィールドは 400 で拒む**（以前は黙って捨てていた）。`txn_date` のような綴り違いで証憑がメタデータ無しで保存されると電帳法の検索要件を満たせないため。zod の `unrecognized_keys` はルートパスに集約されるので、フィールド名ごとの issue に展開する。
- **`attachment.supersede` は不変条件（write-once・自己不可・差替先が現行版）をアクション側で検査**してから更新する。以前はフックだけで守っていて、同じ差替先で二度呼ぶと「変更なし」として通り、監査ログに supersede が二重に残った。フックは汎用 update 経路のバックストップとして残す。
- **API テストは server.ts/modules.ts を触らずに成り立たせる**: `@daifuku/mod-attachments` を server.ts より先に import（modules.ts の `registerCrudActions()` が attachment の汎用アクションも導出する）、`buildServer` 後に `app.hasRoute` で未登録なら `registerAttachmentRoutes` を呼ぶ（オーケストレータが server.ts に配線した後も二重登録で落ちない）。
- `apps/api/node_modules/@daifuku/mod-attachments` のシンボリックリンクは手で作った（`pnpm install` 禁止のため。apps/api/package.json に依存を足して `pnpm install` すれば同じものができる）。ソースの編集ではないが、環境操作として明記する。

## やったこと
- 追加: `apps/api/test/attachments.db.test.ts`（13 件。fastify inject で自作 multipart ボディ、フィールド順が file の前後どちらでも動くこと、20 MB ちょうど/超過、RFC 5987 ヘッダ、権限 401/403/404、別テナント/別会社、AC-4..7 をアクション経由、OpenAPI に upload/download が載ること）
- 変更: `services/validate.ts`（`cleanFormFields` が未知キーを保持）、`actions/upload.ts`（未知キーを名前付き issue に）、`actions/supersede.ts`（不変条件を先に検査）、`services/hash.ts`（ルートの tsc7＋DOM lib で `crypto.subtle.digest` の BufferSource 型が合わない → SharedArrayBuffer 上のビューだけコピー）、`test/validate.test.ts`（cleanFormFields の期待値を新仕様に。**テストの意味を変えた**: 「未知キーを捨てる」→「未知キーは strict スキーマが拒む」）
- 本ファイルと `docs/metrics/features.jsonl` への 1 行追加

## 検証（何を・どう確認したか。コードレビューか実測かを明記）
- [実測] `pnpm exec tsc -p modules/attachments/tsconfig.json --noEmit` / `pnpm exec tsc -p apps/api/tsconfig.json --noEmit` 通過
- [実測] `pnpm exec eslint modules/attachments apps/api/src/routes/attachments.ts apps/api/test/attachments.db.test.ts` 通過（警告なし）
- [実測] `pnpm exec depcruise --config .dependency-cruiser.cjs modules/attachments apps/api` 通過（101 modules, 0 violations）
- [実測] `TEST_DATABASE_URL_OWNER=…daifuku_test_attachments TEST_DATABASE_URL=… pnpm exec vitest run modules/attachments apps/api/test/attachments.db.test.ts` — 3 files, **31 tests 通過**（約 7 秒）。テスト名に AC-n を付与。
- [実測] リポジトリ全体: `pnpm typecheck`（tsc7）通過、`pnpm lint` 通過（警告 1 件は kernel/crud.ts の既存 max-lines-per-function）、`pnpm test`（unit 152 件）通過。※最初の 1 回だけ 152 件中 1 件が失敗したが失敗名を取り逃し、続く 5 回は全件通過（本機能の unit は毎回通過）。
- [実測] spec の検証手順「curl -F file=@sample.pdf …/upload → search → download」を、テスト DB＋一時ディレクトリ storage で `buildServer`＋`registerAttachmentRoutes` を 127.0.0.1:3999 に listen させた即席サーバ（scratchpad のスクリプト。リポジトリには残していない）に対して実行: `curl -F "file=@sample.pdf;filename=領収書.pdf" -F kind=receipt -F txnDate=… -F amount=3300 -F partnerId=…` → 200（filename `領収書.pdf`、sha256、amount `"3300"`）、同じファイル再送 → 409 `details.existingId`、`attachment.search`（日付範囲＋金額下限＋取引先）→ 1 件、download → `content-disposition: attachment; filename="___.pdf"; filename*=UTF-8''%E9%A0%98%E5%8F%8E%E6%9B%B8.pdf` でバイト列が `cmp` 一致、21 MB → 413 で以後 `/health` も正常。
- [レビュー] AC-1 の権限表: accounting/sales/purchasing read/create/update、viewer read、delete はどのロールにも無い（admin は暗黙に全 op を持つので `before_delete` フックで拒否。db テストで実測）。AC-5 の「旧ファイルは取得できる」は db テスト（モジュール・API 双方）で実測。
- [未検証] `pnpm gate` 全体（db テストは共有の `daifuku_test` を使うため未実行）、`pnpm db:generate && pnpm db:reset` によるマイグレーション生成（apps/api/src/modules.ts への配線はオーケストレータ担当）。
- [未検証] 実 HTTP での 413 後のコネクション扱いは curl 1 回のみ（keep-alive 越しの連続リクエストは未確認）。

## 見つけた問題と修正（発見経路つき）
- multipart の未知フィールドが黙って捨てられる — 発見: レビュー（AC-2 の照合、API テスト作成時）。修正: strict スキーマに渡して 400＋フィールド名。
- `attachment.supersede` を同じ差替先で二度呼ぶと成功し監査ログが二重になる — 発見: 実測（API テスト 1 回目）。修正: アクション側で `assertSupersedable`。
- `crypto.subtle.digest(Uint8Array)` がルート tsconfig（DOM lib＋tsc7）で型エラー — 発見: 実測（`pnpm typecheck`。パッケージ単位の tsc は通っていた）。修正: `Uint8Array<ArrayBuffer>` に絞る。
- `apps/api` から `@daifuku/mod-attachments` が解決できない（package.json 未追加・未 install） — 発見: 実測（tsc -p apps/api）。対処: node_modules に手動シンボリックリンク（要: package.json への追加＋`pnpm install`）。

## ドキュメントの穴（spec / docs だけでは決められず推測したこと）
1. multipart の未知フィールドを拒むか捨てるか（spec に無し）→ 拒む。
2. 20 MB 超過の HTTP ステータス（spec は「Max 20 MB」のみ）→ 413、`code: VALIDATION`、`details.maxBytes`。
3. 同一 sha256 の検査単位は「会社」（AC-7 の文言どおり）。テナント内の別会社は同じバイト列を保存できる。
4. `attachment.link` の対象エンティティを読む権限が無い場合は 403（PermissionDenied）、行が見えない場合は 404。spec は「visible」としか言わない。
5. `supersede` の理由は監査ログの `after.reason` にのみ記録（行には持たない）。spec のとおりだが、UI から理由を一覧するには audit を読む必要がある。

## 未実施（減らさない。完了したら「済」を付けて残す）
- apps/api/package.json に `"@daifuku/mod-attachments": "workspace:*"`、modules.ts に `AttachmentsModule`、server.ts に `registerAttachmentRoutes(server, { db: opts.app })`（オーケストレータ）
- `pnpm db:generate && pnpm db:reset`（attachment テーブルのマイグレーション）
- apps/web の証憑パネル（web-phase1 AC-4）と apps/mcp での `attachment.*` ツール確認
- storage の S3 等アダプタ（kernel、ADR-0013）。`put` 後に行作成が失敗した場合の孤児 blob 回収（storage に delete が無いので、現状は残る）

## 判断待ち（利用者）
- 未知フィールド 400 の方針（curl/ブラウザからの余計なフィールドを許すなら `cleanFormFields` を元に戻す）。
- 20 MB 超過を 413 にしている（他の検証エラーは 400）。統一するか。

## 次のセッションへ
- `uploadAttachment(ctx, { data, filename, contentType, fields })` が公開 API。apps/mcp でファイルを受ける場合もこれを呼ぶ（base64 → Uint8Array）。
- `attachment.for_record { entity, recordId }` がレコード詳細画面の添付パネル用。`contentDisposition()` は routes/attachments.ts から export 済み。
