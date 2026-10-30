# Spec: csv-import（マスタの CSV 取込）

- 状態: implemented（2026-10-29）
- モジュール: `kernel`（取込 port と entity ごとの派生 action）、`apps/api`（REST）、`apps/web`（`/e/:entity/import`） ／ 依存: [ui-kit](ui-kit.md)（D1）
- ADR: [ADR-0028](../adr/0028-import-port.md)（取込 port: dry-run を savepoint で実行し `Repository` を通す）
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) B5。実装時に下記「実装で確定・変更した点」を反映した
- 作業記録: [2026-10-29-csv-import](../log/2026-10-29-csv-import.md)

## 目的（1段落）

他システムから移るとき、最初に取引先・品目・勘定科目・倉庫・従業員などのマスタを入れる必要がある。現在は 1 件ずつ画面か API で作るしかなく、CSV 取込は銀行明細に限られる。DSL の field 定義から列と検証を導出し、事前確認（変更しない）→ 行ごとの結果 → 実行の 3 段で、権限・監査・参照整合性を保ったままマスタを一括で取り込めるようにする。

## 受入基準（EARS）

- AC-1 THE SYSTEM SHALL 明細 entity（document の `lines` に含まれるもの）と document を除き、入力できる field を 1 つ以上持つ entity について取込を提供する。entity ごとの派生 action（例: `partner.import`、`generic: true`、`mutates: true`、権限は `create`）として登録し、REST `POST /api/:entity/import`、`POST /actions/<entity>.import` と MCP ツール `<entity>_import` から同じ action を呼ぶ。取込できない entity への `POST /api/:entity/import` は `INVALID_STATE`（409）。
- AC-2 THE SYSTEM SHALL 取込入力を `{ rows: Array<Record<string, string | null>>, mode: 'dry-run' | 'execute', onExisting: 'skip' | 'update' | 'error', keyField?: string, atomic?: boolean }`（`mode` と `onExisting` は必須）とし、行数 1〜5,000・要求 2 MB（JSON の UTF-8 長。HTTP では本文の上限で 413）を上限とする。列名は field 名、または field の日本語・英語ラベル（pack のラベル上書きを含む。全角半角・大小文字・空白の違いは同一視）のいずれでもよい。不明な列・複数の field に当たる列・同じ field への複数の列は取込全体を `VALIDATION`（400）とする。
- AC-3 THE SYSTEM SHALL 各セルの文字列を field の型に変換する: 空欄（空白のみを含む）は未指定、text はそのまま、int は整数（カンマ・全角を許す）、decimal は `Decimal` 文字列（カンマ・全角・符号を正規化し、浮動小数に変換しない）、bool は `true/false/1/0/はい/いいえ/yes/no`（大小文字・全角を問わない）、date は `YYYY-MM-DD` または `YYYY/MM/DD`（`2026/4/1` も可）、enum は値または現在のラベル（日英）、timestamp は UTC オフセット付きの ISO 8601、uuid は UUID、ref は UUID ならその id、次に参照先の `code` field、無ければ参照先の `displayField` の完全一致。json field は取込対象外。
- AC-4 IF ref の値に一致する参照先が 0 件または 2 件以上 THEN THE SYSTEM SHALL その行を `error` とし、理由（`ref_not_found`／`ref_ambiguous`）を返す。参照先の検索は読取権限と行規則を通す。
- AC-5 THE SYSTEM SHALL 既存行の判定を `keyField`（既定は entity の最初の `unique` な text field。その列がファイルに無ければ判定しない。明示した `keyField` は unique な text/int/date/enum/uuid の field で、列が必要）で行い、`onExisting` に従って `skip`（変更しない）・`update`（値が変わった field だけを `Repository.update`、`immutable` field は同じ値なら比較のみ・違えばその行を `immutable` エラー、変更が無ければ `skipped` と `unchanged`）・`error`（`exists`）とする。`update` は update 権限を、キー照合は read 権限を必要とする。
- AC-6 WHEN `mode` が `dry-run` THE SYSTEM SHALL 本番と同じ `Repository` の作成・更新（権限・row rule・検証・hook・監査）を savepoint 内で実行し、最後に巻き戻して、DB を変更せずに行ごとの結果を返す（`committed: false`）。
- AC-7 WHEN `mode` が `execute` THE SYSTEM SHALL 行ごとに savepoint を使い、失敗した行だけを巻き戻して残りを処理する。`atomic: true` のときは 1 行でも失敗したらすべて巻き戻す（`committed: false`）。作成・更新は `Repository` の通常の監査に記録される。kernel のエラーと、データ・制約の SQL エラー（SQLSTATE 22/23）以外の失敗は要求全体を失敗させる。
- AC-8 THE SYSTEM SHALL 結果を `{ mode, committed, keyField, summary: { created, updated, skipped, errors }, rows: [{ line, status: 'created' | 'updated' | 'skipped' | 'error', id?, messages? }], notices }` で返す。`line` は入力の 1 始まりの行番号（ヘッダを除く）。`messages[]` は `{ code, message, field?, column?, hint? }`（`code` は kernel のエラーコード、または `invalid_value`・`ref_not_found`・`ref_ambiguous`・`exists`・`immutable`・`unchanged`・`database`）。
- AC-9 IF 要求者が create 権限（`update` 指定時は update 権限も）を持たない、書けない項目グループの列がある、または読めない参照先を指す `ref` の列がある THEN THE SYSTEM SHALL 取込全体を拒否する（`PERMISSION_DENIED`）。`serverOwned` の field、system 列（`id`・`version` など）、ext の列は入力にあっても無視し、`notices` に列と理由を返す。
- AC-10 WHEN `GET /api/:entity/import-template.csv` が呼ばれた THE SYSTEM SHALL 入力可能で非表示でなく要求者が書ける field の日本語ラベル（`?lang=en` で英語。既定は要求者のロケール）をヘッダにした UTF-8（BOM 付き、CRLF）の CSV を返す。2 つの field が同じラベルを持つときは field 名を使う。create 権限を必要とする。
- AC-11 WHEN 利用者が一覧の「取込」（取込 action があり create 権限があるときだけ表示）から `/e/:entity/import` を開き CSV を選んだ THE SYSTEM SHALL UTF-8（BOM 有無）と Shift_JIS を判別して読み（判別結果を表示）、RFC 4180 で解析し、ヘッダを field に自動対応させ、対応できない列は手動で選ばせる（無視も可）。同じ field を 2 列に選んだときは先へ進めない。
- AC-12 WHEN 利用者が「事前確認」を押した THE SYSTEM SHALL AC-6 の結果を表示し（件数、先頭 50 行と、エラー行のみの絞り込み）、エラーがあっても実行は選択できる（エラー行は取り込まれない旨、`atomic` なら何も取り込まれない旨を示す）。ファイル・対応・方法を変えたら事前確認をやり直させる。
- AC-13 WHEN 実行が終わった THE SYSTEM SHALL 件数の要約と、エラー行（元の列とセルのまま）にファイル上の行番号と理由を足した CSV（UTF-8 BOM 付き）のダウンロードを提供する。
- AC-14 THE SYSTEM SHALL 画面の文言を日本語と英語で持ち、390px 幅で操作できる（ページが横にはみ出さない。結果の表は枠の中で横に動く）。

## 関係するファイル・インターフェース（名指し）

- kernel: `kernel/src/import-values.ts`（新規。対象 entity・field、列名の解決、型変換。純粋）、`kernel/src/import.ts`（新規。取込 port、ref 解決、dry-run / execute、雛形）、`kernel/src/actions/import.ts`（新規。派生 action）、`kernel/src/actions/crud.ts`（`registerCrudActions` から登録）、`kernel/src/dsl/defs.ts`（`ActionConfig.inputBytes`）、`kernel/src/index.ts`
- api: `apps/api/src/routes/rest.ts`（`POST /api/:entity/import`、`GET /api/:entity/import-template.csv`）、`apps/api/src/routes/actions.ts`（`inputBytes` を本文の上限に使う）、`apps/api/src/plugins/errors.ts`（413 を `VALIDATION` の本文に）
- web: `apps/web/src/pages/entity-import-page.tsx`（新規）、`apps/web/src/lib/csv-parse.ts`（新規、文字コード判別と RFC 4180）、`apps/web/src/lib/import-map.ts`（新規、自動対応・要求・エラー CSV）、`apps/web/src/api/import.ts`（新規）、`apps/web/src/router.tsx`、`apps/web/src/pages/entity-list-page.tsx`（「取込」）、`apps/web/src/components/screen-trail.tsx`（現在位置「取込」）、`apps/web/src/ui/token-usage.test.ts`（CONVERTED）
- docs: `docs/adr/0028-import-port.md`、`docs/manual/04-masters.md`（取込の手順）、`docs/manual/09-ai.md`（MCP/REST の取込）

## データ・業務ルール（出典）

- 金額・数量は `Decimal`（ADR-0010）。確定済み伝票は取り込まない（CLAUDE.md 規約 4）。日本の制度値は扱わない（出典不要）。

## スコープ外（明記）

- document と明細付き伝票の取込、期首残高（[実装計画](../completion-plan.md) B6）
- ext field の取込（初版は対象外。列は notice を付けて無視する）
- 空欄で既存の値を消す更新（空欄は常に未指定）
- 定期取込、他システム固有の形式の自動変換、Excel ファイルの直接読込、UTF-16 の CSV

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`（kernel を変更するため DB 全件へ昇格）
2. 単体: 型変換（全 field 種別、全角・カンマ・空欄）、CSV 解析（引用・改行・BOM・Shift_JIS）、列の自動対応、エラー CSV（`kernel/test/import-values.test.ts`、`apps/web/src/lib/csv-parse.test.ts`、`apps/web/src/lib/import-map.test.ts`）
3. DB: dry-run が DB を変えないこと、権限なしの拒否、ref 解決（0 件・曖昧）、`onExisting` の 3 種、`atomic`、監査、5,000 行上限、REST・`/actions`・MCP（AC-1〜AC-10。`kernel/test/import.db.test.ts`、`apps/api/test/import.db.test.ts`、`apps/mcp/test/mcp.db.test.ts`）
4. ブラウザ: 取引先 100 行（うち 3 行エラー）を事前確認 → 実行 → エラー CSV、Shift_JIS の品目 20 行、390px、「取込」の表示条件（AC-11〜AC-14。`apps/web/e2e/csv-import.spec.ts`）
5. `pnpm gate:full`（統合担当が実行）

## 実装で確定・変更した点（2026-10-29）

- 結果に `mode`・`committed`・`keyField`・`notices` を足した（AC-8）。dry-run と atomic の失敗で「何も残っていない」ことを呼出し側が判別できるようにするため。`messages` は文字列でなく `{ code, message, field?, column?, hint? }` にした（画面の多言語表示とエラー CSV の列名のため）。
- `onExisting` は既定値なしの必須にした（計画の骨子どおり。黙って skip / error を選ばない）。
- AC-1 の「`create` 操作を持つ entity」は、admin が常に create を持つため判定に使えない。「入力できる field を 1 つ以上持つ master」に置き換え、権限は実行時に create を検査する。
- 明示した `keyField` に decimal を許さない（表記ゆれで一致しないため）。timestamp・bool・ref も対象外。
- 不明な列は無視せず取込全体を 400 にした（綴り違いの列を黙って捨てないため）。書けない項目グループの列と、読めない参照先の `ref` 列も全行を同じ理由で失敗させず、取込全体を 403 にした。
- 既存行の照合は 1 行ごとの読取でなく、要求の最初に 500 件ずつ `$in` で読む（5,000 行のスキップが 8.8 秒 → 0.8 秒、測定は作業記録）。
- ファイル上の行番号: 画面は空の行（全セル空欄）を送らないため、結果の `line`（送った行の番号）をファイル上のデータ行番号に戻して表示・エラー CSV に出す。
- エラー CSV の元のセルは数式対策の `'` を付けない（直して取り込み直すファイルなので値を変えない）。理由の列だけ数式対策をする。
- 純粋な型変換を `import-values.ts` に分けた（DB を使う取込 port と責務が異なり、unit で全種別を検査するため）。

## 未決事項（利用者の判断待ち）

- 取込 action を MCP に公開するか（初版は公開し、`mutates: true` とした。エージェントには dry-run を先に使うようマニュアル 09 に書いた）。
- ext field の取込を初版に含めるか（初版は含めない。列は無視して notice を返す）。
- 空欄で値を消す指定（例: `NULL` という文字列）を設けるか（初版は設けない）。
- 理由のうち kernel の検証メッセージ（zod の英語文）は日本語化していない。画面は項目名と取込固有の理由だけを日本語にしている。
