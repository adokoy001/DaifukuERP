# ADR-0028: マスタの CSV 取込は kernel の取込 port が Repository を通して行い、事前確認は savepoint を巻き戻す

- 状態: 採択
- 日付: 2026-10-29
- 関連: [アクション・REST・MCP](0009-actions-rest-mcp.md)、[Decimal](0010-money-decimal.md)、[ポートとカスタマイズ層](0013-hexagonal-ports.md)、[基盤の不変条件と取引の port](0016-foundation-invariants.md)、[受入基準](../specs/csv-import.md)

## 背景

他システムから移るとき、最初に取引先・品目・勘定科目・倉庫・従業員などのマスタを入れる必要がある。現在は 1 件ずつ画面か API で作るしかない。取込の経路を画面だけに作ると、MCP や REST から同じ取込ができず、権限・行規則・検証・フック・監査を別に実装することになる。また「事前確認」を検証専用の関数で作ると、フックや一意制約で本番の実行と結果が食い違う。

## 決定

1. **kernel の取込 port**: `kernel/src/import.ts` の `importRecords(ctx, entity, input)` が、文字列のセルを DSL の field 型へ変換し（`kernel/src/import-values.ts`、純粋関数）、1 行ずつ `Repository.create` / `Repository.update` を呼ぶ。権限・行規則・項目グループ・検証・フック・監査・一意制約は通常の作成・更新と同じものが働く。取込専用の権限やバイパスは作らない。
2. **派生 action**: `registerCrudActions()` が、document でも明細 entity でもなく、入力できる field を 1 つ以上持つ entity に `<entity>.import` を登録する（`generic: true`、`mutates: true`、権限は `{ entity, op: 'create' }`）。汎用 CRUD と同じく画面メニューにはならない。REST `POST /api/:entity/import`、`POST /actions/<entity>.import`、MCP ツール `<entity>_import` は同じ action を呼ぶ。
3. **事前確認（dry-run）**: 外側の savepoint の中で本番と同じ書込みを実行し、最後に専用の例外で savepoint ごと巻き戻す。DB に残るものはない（監査・outbox も同じトランザクション内なので巻き戻る）。前の行で作った記録は後の行から見えるため、ファイル内の重複キーも本番と同じ結果になる。
4. **行ごとの savepoint**: 各行を `withSavepoint` で囲み、kernel のエラー（`DaifukuError`）と、Repository を抜けたデータ・制約の SQL エラー（SQLSTATE 22xxx / 23xxx）だけをその行のエラーにする。それ以外（接続断・バグ）は要求全体を失敗させ、握りつぶさない。`atomic: true` のときは外側の savepoint を使い、1 行でも失敗したら巻き戻して `committed: false` を返す。
5. **要求全体の検査（行を書く前）**: create 権限（`onExisting: 'update'` は update 権限も、キー照合には read 権限も）、列名の解決（field 名・日英ラベル・pack のラベル上書き。不明・曖昧・同じ field への重複は 400）、書けない項目グループの列（403）、参照先を読めない `ref` の列（403）、行数 5,000・要求 2 MB。`serverOwned` の field、system 列、ext の列は無視して `notices` に理由を返す。
6. **型変換**: Decimal は文字列のまま正規化し（カンマ・全角・符号）、JS の数値を経由しない（ADR-0010）。日付は `YYYY-MM-DD` と `YYYY/M/D`、真偽は `true/false/1/0/yes/no/はい/いいえ`、enum は値か現在のラベル、timestamp は UTC オフセット付きのみ。空欄は「指定なし」（作成では既定値、更新では変更なし）。
7. **参照（ref）**: UUID ならその id、次に参照先の `code`、無ければ `displayField` の完全一致で、読取権限と行規則を通して探す。0 件・2 件以上はその行のエラー（`ref_not_found` / `ref_ambiguous`）。
8. **既存行**: `keyField`（既定は最初の `unique` な text field。列が無ければ照合しない）で照合し、既存の記録は要求の最初に 500 件ずつ `$in` で読む。`skip` / `update` / `error` を選ぶ。`update` は値が変わった field だけを送り、`immutable` の field は同じ値なら比較だけ、違えばその行のエラーにする。変更が無ければ `skipped`（`unchanged`）。
9. **HTTP の上限**: action に `inputBytes`（HTTP adapter が受け付ける本文の上限）を追加し、取込 action は 2 MB とした。上限を超えた本文は 413 と `VALIDATION` の本文で返す。MCP と in-process の呼出しは kernel が同じ 2 MB を JSON の UTF-8 長で検査する。

## 対象外と理由

- document と明細付き伝票の取込: 採番・確定・帳簿への影響があり、下書きだけ作っても利用者の期待と合わない。期首残高は専用の action（[実装計画](../completion-plan.md) B6）で扱う。
- ext field の取込: 初版は対象外。列は無視して notice を返す。
- Excel ファイルの直接読込、他システム固有の形式、定期取込。

## 結果

- 良い点: 画面・REST・MCP が同じ検査を通る。事前確認と実行の結果が一致する。取込のための権限の抜け道が無い。
- 注意: 事前確認の副作用が無いのは、フックが kernel の port（`ctx.emit` など同じトランザクション内のもの）だけを使う前提による。トランザクション外へ副作用を出すフックを足すときは、取込の事前確認でも実行される点に注意する。
- 性能（この開発コンテナでの測定、2026-10-29）: 取引先 5,000 行（8 列、約 0.97 MB）の取込は、事前確認 約 19 秒、実行 約 15 秒、既存行のスキップ 約 0.8 秒（Fastify の inject、ネットワーク無し）。行ごとの savepoint とフック・監査が大半を占める。大量のマスタは 5,000 行以下に分けて実行する。
- PostgreSQL は 1 トランザクションの subtransaction が 64 を超えると可視性判定が遅くなる。5,000 行の取込は 1 要求で 5,000 個の savepoint を使うため、他の長いトランザクションと重ねない運用を推奨する。

## 検証

- unit: 型変換（全 field 種別、全角・カンマ・空欄）、列名の解決、雛形の見出し（`kernel/test/import-values.test.ts`）。
- DB: dry-run で行数と監査が変わらないこと、行ごとの巻戻し、atomic、ref（コード・名称・id・0 件・曖昧）、onExisting の 3 種と immutable、権限（create / update / 項目グループ / 参照先の読取）、無視する列、5,000 行と 2 MB、雛形（`kernel/test/import.db.test.ts`、`apps/api/test/import.db.test.ts`、MCP は `apps/mcp/test/mcp.db.test.ts`）。
- ブラウザ: 取引先 100 行（3 行エラー）と Shift_JIS の品目 20 行（`apps/web/e2e/csv-import.spec.ts`）。
