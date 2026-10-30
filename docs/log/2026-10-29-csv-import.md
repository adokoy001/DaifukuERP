# 作業記録: 2026-10-29 マスタの CSV 取込（B5）

- セッション: 完成度向上計画 B5（workflow の作業項目、worktree `wip/csv-import`）／ 担当: agent ／ 対象: [docs/specs/csv-import.md](../specs/csv-import.md)、[ADR-0028](../adr/0028-import-port.md)
- 計測: tokens=null（未計測）, agent_minutes=約150, human_minutes=0, rework_lines=約60（テストの期待値の誤り 3 か所、既存行照合の作り直し 約40 行、文字の扱いの修正）, gate_failures=0

## 決めたこと（と理由）

- **取込は kernel の port（`importRecords`）と、entity ごとの派生 action `<entity>.import`。** `registerCrudActions()` が汎用 CRUD と同じ場所で登録し、`generic: true` なので画面メニュー・アクション画面には出ない。REST `POST /api/:entity/import`、`/actions/<entity>.import`、MCP `<entity>_import` が同じ検査を通る。書込みは `Repository.create` / `update` だけで、取込専用の権限や抜け道は作らない（規約 2）。
- **事前確認は「本番と同じ書込みを savepoint 内で実行して巻き戻す」。** 検証専用の関数ではフックや一意制約の結果が実行時と食い違うため。行ごとにも savepoint を使い、失敗した行だけを巻き戻す（PostgreSQL ではエラー後のトランザクションが使えなくなるため、dry-run でも必要）。atomic は外側の savepoint を巻き戻す。
- **行のエラーにするのは kernel のエラーと SQLSTATE 22/23 だけ。** それ以外（接続断・バグ）は要求全体を失敗させる。黙って全行エラーにしないため。
- **要求全体で拒否するもの**: create 権限なし、`update` で update 権限なし、キー照合で read 権限なし、書けない項目グループの列、読めない参照先の `ref` 列、不明・曖昧・重複の列、5,000 行・2 MB 超。全行が同じ理由で失敗する結果を返すより、最初に止める方が分かりやすい。不明な列を無視しないのは、綴り違いの列を黙って捨てないため（spec の「実装で確定・変更した点」に記録）。
- **`serverOwned`・system 列・ext 列は無視して `notices` に返す**（AC-9）。output-hidden の field 名は公開しないので「不明な列」と同じ扱い。
- **結果に `committed`・`keyField`・`notices` を足し、`messages` を構造化した。** dry-run・atomic の失敗で「何も残っていない」ことを呼出し側が判別でき、画面は項目名と取込固有の理由を日本語で出せる。
- **ref は id → `code` → `displayField`。** 単位の `個` のように表示名でも指定できる。同名が複数あると曖昧（`ref_ambiguous`）。参照先の検索も Repository（読取権限・行規則）を通す。正の結果だけを要求内でキャッシュする（同じファイルで後から作られる参照先を見落とさないため）。
- **既存行の照合は要求の最初に 500 件ずつ `$in` で読み、書込みに合わせて手元の表を更新する。** 1 行ごとの `list`（件数取得を含めて 2 クエリ）だと 5,000 行のスキップに 8.8 秒かかった（下記の測定）。
- **`update` は変わった field だけを送る。** 同じ値の `immutable` は比較だけ、違えば行のエラー。変更が無い行は `skipped`（`unchanged`）にして、版と監査を無駄に増やさない。
- **action に `inputBytes` を追加した（DSL の拡張、ADR-0028）。** Fastify の既定の本文上限 1 MiB では 2 MB の要求が通らないため。`/actions/*` の経路は action ごとの `inputBytes` を、REST の取込経路は同じ 2 MB を使う。413 は従来 `INTERNAL` の本文だったので `VALIDATION` と「Request body is too large.」にした（共有の `plugins/errors.ts`）。
- **画面**: 文字コードは BOM → UTF-8（fatal）→ Shift_JIS の順に `TextDecoder` だけで判別（依存を足さない）。空の行（全セル空欄）は送らず、結果の行番号をファイル上のデータ行番号に戻して表示する。ファイル・対応・方法を変えたら事前確認を消してやり直させる（古い結果で実行させない）。送る前に 5,000 行と 2 MB を検査する。空欄のセルは送らない（本文を小さくする。サーバーでも空欄は未指定）。
- **エラー CSV は元の列とセルをそのまま残し、末尾に「行」「理由」を足す。** 直して取り込み直すファイルなので、数式対策の `'` は理由の列にだけ付ける。
- **純粋な型変換を `kernel/src/import-values.ts` に分けた。** DB を使う取込 port と責務が異なり、unit で全種別を検査するため（行数のためではない）。
- **一覧の「取込」は `/meta` の actions に `<entity>.import` があり、`ops` に create があるときだけ。** 現在位置（パンくず）は `/import` を「取込」と表示する（`screen-trail.tsx` の 1 分岐）。

## やったこと

- kernel: `import-values.ts`（対象 entity・field、列名の解決、型変換、雛形の見出し）、`import.ts`（取込 port、ref 解決、既存行の先読み、dry-run / execute / atomic、雛形 CSV）、`actions/import.ts`（派生 action）、`actions/crud.ts`（登録）、`dsl/defs.ts`（`inputBytes`）、`index.ts`
- api: `routes/rest.ts`（`POST /api/:entity/import`、`GET /api/:entity/import-template.csv`）、`routes/actions.ts`（`inputBytes`）、`plugins/errors.ts`（413）
- web: `pages/entity-import-page.tsx`、`lib/csv-parse.ts`、`lib/import-map.ts`、`api/import.ts`、`router.tsx`（`/e/$entity/import`、遅延読込）、`pages/entity-list-page.tsx`（「取込」）、`components/screen-trail.tsx`、`ui/token-usage.test.ts`（CONVERTED に追加）
- 試験: `kernel/test/import-values.test.ts`、`kernel/test/import.db.test.ts`、`kernel/test/fixtures/import-entities.ts`、`apps/api/test/import.db.test.ts`、`apps/mcp/test/mcp.db.test.ts`（1 件追加）、`apps/web/src/lib/csv-parse.test.ts`、`apps/web/src/lib/import-map.test.ts`、`apps/web/e2e/csv-import.spec.ts`
- 文書: ADR-0028、マニュアル 04（取込の手順・セルの書き方）、09（REST/MCP の取込）、spec（状態 implemented、実装で確定した点）

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] unit: `kernel/test/import-values.test.ts` 14 件、`apps/web/src/lib/csv-parse.test.ts` 5 件、`apps/web/src/lib/import-map.test.ts` 6 件、`ui/token-usage.test.ts`（取込画面を走査対象に追加）成功。Shift_JIS の判別は cp932 のバイト列（Python で生成した 16 進）で確認。
- [実測] DB（`daifuku_test_w9`）: `kernel/test/import.db.test.ts` 14 件、`apps/api/test/import.db.test.ts` 5 件（11 秒）、`apps/mcp/test/mcp.db.test.ts` 16 件（5.6 秒）成功。dry-run 後に行数と `audit_log` の件数が変わらないこと、行ごとの巻戻し、atomic、ref の 5 通り、onExisting の 3 種と immutable・unchanged、int の keyField、権限 5 通り、無視する列、5,001 行・2 MB 超・型違いの拒否、雛形（ja/en、権限、document）を確認。
- [実測] 性能（一時的な試験ファイルで測定し、リポジトリには残していない）: 取引先 5,000 行・8 列（本文 973,937 バイト）を `POST /api/partner/import` へ inject。1 行ごとの照合では dry-run 28.96 秒・execute 21.29 秒・既存行のスキップ 8.78 秒。先読みに変えた後は dry-run 18.85 秒・execute 14.50 秒・スキップ 0.82 秒。
- [実測] ブラウザ（slot 3、隔離 fixture DB、Chromium）: `e2e/csv-import.spec.ts` 3 件成功 — 取引先 100 行（UTF-8 BOM、うち 3 行エラー）の自動対応 6 列、事前確認で 97 / 3 と DB 無変更、エラーのみの絞り込み（行 10・50・77）、390px でページが横にはみ出さない、実行で 97 件作成、引用符内のカンマを含む名称、エラー CSV（BOM、元の列 + 行 + 理由、行番号 10・50・77）。Shift_JIS の品目 20 行（試験内で decoder の逆引き表から生成）を 390px で事前確認 → 実行し、名称・カナ・種別（ラベル「物品」「サービス」）・税区分（「課税（軽減）」）・単位（表示名「個」）・販売単価（`"1,280"`）を API で確認。伝票の一覧と閲覧のみの利用者に「取込」が出ないこと、伝票の取込画面が「取り込めません」になること。スクリーンショット（390px の事前確認、1280px の結果）を目視で確認。
- [実測] 変更した画面を含む既存のブラウザ試験: `ui-kit`・`smoke`・`phase1`・`phase15`・`company-context`・`quality-read-recovery` と `csv-import` の 26 件を `--no-deps` で実行し成功（1.7 分）。
- [実測] 現在位置（パンくず）の分岐を足したので、industry の準備を含めて `navigation.spec.ts` と `csv-import.spec.ts` を実行し、industry 3 件・chromium 8 件の 11 件が成功（1.7 分）。
- [実測] `pnpm gate:quick` 成功（format 27 秒、eslint 18 秒、typecheck 10 秒、API / Web typecheck 15 / 20 秒、unit 全件 57 秒、deploy 18 秒）。
- [実測] `pnpm gate:light`（`daifuku_test_w9`、kernel の変更で DB 全件へ昇格）成功、1,058.8 秒: format 23 秒、typecheck 9.5 秒（API 14 秒・Web 20 秒）、lint 20 秒、unit 134 ファイル 1,234 件 56 秒、DB 118 ファイル 720 件 897 秒、deploy 19 秒。実行中に取込のファイルを直した（int の keyField の先読み、output-hidden の列名、画面の表示）ため、終了後に取込の DB 3 ファイル 35 件・unit 4 ファイル 97 件と `pnpm gate:quick`（160 秒、format・eslint・型・unit 全件）を再実行して成功。
- [レビュー] 取込画面のキーボード操作（ラベル付きの file / select / radio / checkbox、`aria-live` の完了通知）。
- [未検証] `pnpm gate:full`（統合担当が実行）、ブラウザ試験の全件（今回は上記の 8 ファイルだけ）、実際の Excel で保存したファイル、画面から 5,000 行を送ったときの所要時間、同じ項目を 2 列に選んだときの画面の阻止（unit の `checkMapping` だけ）、更新モードと atomic の画面操作（DB 試験だけ）、英語表示の取込画面。

## 見つけた問題と修正（発見経路つき）

- 雛形の英語見出しの検査が末尾の CRLF を含めて比較していた — 発見: DB 試験、修正: テストの期待値（実装は正しい）。
- エラー CSV の期待値で、理由のセルの引用符のエスケープを書き忘れていた — 発見: unit、修正: テストの期待値。
- 5,000 行のスキップが 8.8 秒 — 発見: 測定、修正: 既存行の先読み。
- ソースに BOM（U+FEFF）の文字が直接入り `no-irregular-whitespace` に掛かった — 発見: eslint、修正: `﻿` のエスケープに置換。
- 事前確認の再実行中に「取り込む」も「取り込み中…」と表示される — 発見: レビュー、修正: 実行中の mode でラベルを分けた。
- 結果の表の「理由」が 390px で 1 文字幅に潰れる — 発見: スクリーンショット、修正: 列の最小幅（表は枠の中で横に動く）。

## 未実施（減らさない。完了したら「済」を付けて残す）

- ext field の取込（spec の未決事項）。
- kernel の検証メッセージ（zod の英語文）の日本語化。画面は項目名と取込固有の理由だけを日本語にしている。
- 空欄で値を消す指定。
- `docs/STATUS.md`・`PLAN.md`・計画書・候補一覧の更新（統合担当）。`pnpm metrics:add`（統合担当がまとめて記録）。

## 判断待ち（利用者）

- 取込 action の MCP 公開（初版は公開。マニュアル 09 で dry-run を先に使うよう案内）。
- ext field の取込を次版に入れるか。

## 次のセッションへ

- B6（期首残高）は `importRecords` と同じ savepoint の型（dry-run → 行ごとの結果 → 実行）を使える。document は対象外のままにし、専用の action で扱う。
- 取込は 1 要求で最大 5,000 個の savepoint を使う。PostgreSQL の subtransaction が 64 を超えると可視性判定が遅くなるので、もっと大きな取込が必要になったら要求を分けるか、検証と書込みの分離を検討する。
