# Spec: csv-import（マスタの CSV 取込）

- 状態: draft
- モジュール: `kernel`（取込 port と entity ごとの派生 action）、`apps/api`（REST）、`apps/web`（`/e/:entity/import`） ／ 依存: [ui-kit](ui-kit.md)（D1）
- ADR: ADR-0028（取込 port: dry-run を savepoint で実行し `Repository` を通す）を新規作成
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) B5

## 目的（1段落）

他システムから移るとき、最初に取引先・品目・勘定科目・倉庫・従業員などのマスタを入れる必要がある。現在は 1 件ずつ画面か API で作るしかなく、CSV 取込は銀行明細に限られる。DSL の field 定義から列と検証を導出し、事前確認（変更しない）→ 行ごとの結果 → 実行の 3 段で、権限・監査・参照整合性を保ったままマスタを一括で取り込めるようにする。

## 受入基準（EARS）

- AC-1 THE SYSTEM SHALL 明細 entity（document の `lines` に含まれるもの）と document を除く、`create` 操作を持つ entity について取込を提供する。entity ごとの派生 action（例: `partner.import`）として登録し、REST `POST /api/:entity/import` と MCP から同じ action を呼ぶ。
- AC-2 THE SYSTEM SHALL 取込入力を `{ rows: Array<Record<string, string>>, mode: 'dry-run' | 'execute', onExisting: 'skip' | 'update' | 'error', keyField?: string, atomic?: boolean }` とし、行数 5,000・要求 2 MB を上限とする。列名は field 名、または field の日本語・英語ラベルのいずれでもよい。
- AC-3 THE SYSTEM SHALL 各セルの文字列を field の型に変換する: text はそのまま（空文字は未指定）、int は整数、decimal は `Decimal` 文字列（カンマ除去後、浮動小数に変換しない）、bool は `true/false/1/0/はい/いいえ/yes/no`、date は `YYYY-MM-DD`（`YYYY/MM/DD` も可）、enum は値または現在のラベル（日英）、ref は参照先の一意な `code` field、無ければ `displayField` の完全一致。
- AC-4 IF ref の値に一致する参照先が 0 件または 2 件以上 THEN THE SYSTEM SHALL その行を `error` とし、理由（見つからない／曖昧）を返す。
- AC-5 THE SYSTEM SHALL 既存行の判定を `keyField`（既定は entity の最初の `unique` な text field。無ければ判定しない）で行い、`onExisting` に従って `skip`（変更しない）・`update`（`Repository.update`、`immutable` field は比較のみ）・`error` とする。`update` は update 権限を必要とする。
- AC-6 WHEN `mode` が `dry-run` THE SYSTEM SHALL 本番と同じ `Repository` の作成・更新（権限・row rule・検証・hook）を savepoint 内で実行し、最後に巻き戻して、DB を変更せずに行ごとの結果を返す。
- AC-7 WHEN `mode` が `execute` THE SYSTEM SHALL 行ごとに savepoint を使い、失敗した行だけを巻き戻して残りを処理する。`atomic: true` のときは 1 行でも失敗したらすべて巻き戻す。作成・更新は `Repository` の通常の監査に記録される。
- AC-8 THE SYSTEM SHALL 結果を `{ summary: { created, updated, skipped, errors }, rows: [{ line, status: 'created' | 'updated' | 'skipped' | 'error', id?, messages? }] }` で返す。`line` は入力の 1 始まりの行番号（ヘッダを除く）。
- AC-9 IF 要求者が create 権限（`update` 指定時は update 権限も）を持たない THEN THE SYSTEM SHALL 取込全体を拒否する。`serverOwned` の field と system 列は入力にあっても無視し、結果に注意を返す。
- AC-10 WHEN `GET /api/:entity/import-template.csv` が呼ばれた THE SYSTEM SHALL 入力可能な field の日本語ラベル（または `?lang=en` で英語）をヘッダにした UTF-8（BOM 付き）の CSV を返す。
- AC-11 WHEN 利用者が一覧の「取込」から `/e/:entity/import` を開き CSV を選んだ THE SYSTEM SHALL UTF-8（BOM 有無）と Shift_JIS を判別して読み、ヘッダを field に自動対応させ、対応できない列は手動で選ばせる（無視も可）。
- AC-12 WHEN 利用者が「事前確認」を押した THE SYSTEM SHALL AC-6 の結果を表示し（先頭 50 行と、エラー行のみの絞り込み）、エラーがあっても実行は選択できる（エラー行は取り込まれない旨を示す）。
- AC-13 WHEN 実行が終わった THE SYSTEM SHALL 件数の要約と、エラー行と理由を含む CSV のダウンロードを提供する。
- AC-14 THE SYSTEM SHALL 画面の文言を日本語と英語で持ち、390px 幅で操作できる。

## 関係するファイル・インターフェース（名指し）

- kernel: `kernel/src/import.ts`（新規。型変換、ref 解決、dry-run / execute）、派生 action の登録箇所（CRUD action と同じ場所）、`kernel/src/index.ts`
- api: `apps/api/src/routes/rest.ts`（`/import` と `/import-template.csv` を既存の entity 経路と同じ方法で action へ委譲）
- web: `apps/web/src/pages/entity-import-page.tsx`（新規）、`apps/web/src/lib/csv-parse.ts`（新規、RFC 4180 の引用・改行・BOM）、`apps/web/src/router.tsx`、一覧画面の「取込」導線
- docs: `docs/adr/0028-import-port.md`、`docs/manual/04-masters.md`（取込の手順）、`docs/manual/09-ai.md`（MCP/REST の取込）

## データ・業務ルール（出典）

- 金額・数量は `Decimal`（ADR-0010）。確定済み伝票は取り込まない（CLAUDE.md 規約 4）。

## スコープ外（明記）

- document と明細付き伝票の取込、期首残高（[実装計画](../completion-plan.md) B6）
- ext field の取込（初版は対象外。必要なら次版）
- 定期取込、他システム固有の形式の自動変換、Excel ファイルの直接読込

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`（kernel を変更するため DB 全件へ昇格）
2. 単体: 型変換（全 field 種別、全角・カンマ・空欄）、CSV 解析（引用・改行・BOM・Shift_JIS）、列の自動対応
3. DB: dry-run が DB を変えないこと、権限なしの拒否、ref 解決（0 件・曖昧）、`onExisting` の 3 種、`atomic`、監査、5,000 行上限（AC-1〜AC-10）
4. ブラウザ: 取引先 100 行（うち 3 行エラー）を事前確認 → 実行 → エラー CSV、Shift_JIS の品目 20 行、390px（AC-11〜AC-14）
5. `pnpm gate:full`

## 未決事項（利用者の判断待ち）

- 取込 action を MCP に公開するか（初版は公開し、`mutates: true` とする）。
- ext field の取込を初版に含めるか（初版は含めない）。
