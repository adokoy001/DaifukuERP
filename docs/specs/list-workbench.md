# Spec: list-workbench（一覧の絞り込み・列・保存ビュー・CSV・一括操作）

- 状態: implemented
- モジュール: `apps/web`（汎用一覧）、`kernel`（一覧の CSV 出力用の派生 action） ／ 依存: [ui-kit](ui-kit.md)
- ADR: 不要（既存の `where`・`export` 権限（参照列を含め ADR-0018 の CSV 再認可に従う）・文書操作の組合せ）。一覧出力の監査方式はこの spec の「データ・業務ルール」に記す
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) C1。実装時の修正は末尾の「実装で確定した判断」

## 目的（1段落）

汎用一覧（`/e/:entity`）は全文検索・列ヘッダの並べ替え・ページ送りしかない。経理や店舗の担当者は毎日「今月の未確定の請求書」「この取引先の入金」のような条件で一覧を見て、まとめて確定し、表計算に持ち出す。REST の一覧は既に `where`（`Domain`）を受け付けるので、画面に絞り込み・列の選択・保存ビュー・合計・CSV 出力・一括操作を足し、毎日の操作回数を減らす。

## 受入基準（EARS）

- AC-1 WHEN 一覧を開いた THE SYSTEM SHALL entity の field から絞り込み欄を作る: document の状態（下書き・確定・取消の複数選択）、日付 field の範囲（開始・終了）、`ref` の参照先、`enum` の複数選択、金額・数量（decimal / int）の範囲、`bool`（指定なし・はい・いいえ）。対象は document の状態、業務日付（`date` / `postingDate` / `documentDate` / `transactionDate` のうち最初に存在する date field）、および `views.list` と `views.search` に含まれる field（この順）とする。text は検索欄で扱い、timestamp・uuid・json・ext・hidden の field には欄を作らない。
- AC-2 WHEN 絞り込みを「絞り込む」で適用した THE SYSTEM SHALL 条件を URL の `?f=`（JSON）に保持し、REST の `where` に `Domain` として渡す（状態は `{ docstatus: { $in } }`、範囲は `$gte` / `$lte`、金額は decimal 文字列のまま）。再読込・戻る・共有した URL で同じ条件を復元する。不正な条件（存在しない値・実在しない日付・開始 > 終了・数値でない範囲）は URL では無視して表示し、入力欄では理由を示して適用しない。条件の変更でページは先頭に戻る。
- AC-3 THE SYSTEM SHALL 他の画面からの `?status=draft&from=YYYY-MM-DD&to=YYYY-MM-DD` を、状態（`draft` / `submitted` / `cancelled`、カンマ区切り可）と業務日付（AC-1 と同じ規則）の絞り込みとして解釈する（[月次締めガイド](close-guide.md) のリンク先）。次に絞り込みを変えたとき、これらは `?f=` に書き換える。
- AC-4 WHEN 利用者が列の表示・順序を変更した THE SYSTEM SHALL 利用者・tenant・会社・entity ごとにブラウザ内へ保存し、「既定に戻す」で `views.list` に戻す。保存・読込に失敗しても画面は既定の列で動き、読めない場合はその旨を表示する。
- AC-5 WHEN 利用者が現在の絞り込み・並べ替え・検索語・列に名前を付けて保存した THE SYSTEM SHALL 同じ境界でブラウザ内に保存し（最大 30 件、同じ名前は上書き）、一覧の「保存ビュー」から呼び出し・削除できる。呼び出した条件は entity の現在の meta で検査し直す。
- AC-6 THE SYSTEM SHALL 表示中のページについて金額 field（`FieldMeta.money`）の表示列の合計と件数を表の下に表示し、ページの合計であることを明記する。合計は decimal 文字列の演算で行う。
- AC-7 WHEN 利用者が CSV 出力を押した THE SYSTEM SHALL 現在の条件・並べ替え・表示列で最大 5,000 行を、出力時に権限を取り直す経路（`POST /actions/<entity>.export_rows/export`、entity の `export` 権限）で取得し、ブラウザで CSV（UTF-8、BOM 付き、CRLF、`= + - @` で始まる文字列セルは先頭に `'` を付けて式として解釈させない）を作る。上限を超える場合は件数と上限を示して先頭 5,000 行を出力する。
- AC-8 IF 要求者が entity の `export` 権限を持たない THEN THE SYSTEM SHALL CSV 出力の操作を表示せず、API も拒否する。出力は field のマスク（field group）と `outputHidden` を一覧と同じく適用する（既定の列に含めず、明示した場合は権限エラー。`ext.<key>` の列も同じ）。参照列の表示名は参照先の台帳のデータなので、要求者が参照先の `export` 権限と読取権限を持つときだけ解決し（ADR-0018: CSV は出力するすべての台帳の export 権限を再検証する）、持たない参照先・見えない行は id のままにする。
- AC-9 THE SYSTEM SHALL CSV 出力を監査に記録する（entity、条件の要約、行数、要求者）。条件の要約では field group に属する field の値を伏せ字にし、`where` は直列化して 4,000 文字まで（REST の一覧と同じ）とする。
- AC-10 WHEN document の一覧で行を複数選択し「確定」「取消」「削除」のいずれか（要求者の ops にあるもの）を実行した THE SYSTEM SHALL 確認後に 1 件ずつ既存の文書操作 API を `expectedVersion`（一覧に表示した版）付きで呼び、行ごとの成功・失敗と理由を表示する。失敗しても成功した行は巻き戻さない。操作できない状態の行は選択時に操作ごとの件数で対象外と表示する。
- AC-11 THE SYSTEM SHALL 一括操作の対象を 1 回 100 件まで（選択も 100 件まで、同じ条件ならページをまたいで保持）とし、実行中は二重実行を防ぎ、完了後に一覧を再取得する。
- AC-12 THE SYSTEM SHALL 画面の文言を日本語と英語で持ち、390px 幅では絞り込みを折りたたみ表示にして操作できる。

## 関係するファイル・インターフェース（名指し）

- web: `apps/web/src/pages/entity-list-page.tsx`、`apps/web/src/components/data-table.tsx`（選択列）、`apps/web/src/lib/query.ts`（URL 状態 `f` / `status` / `from` / `to`）、`apps/web/src/lib/list-filters.ts`（新規、meta → 絞り込み欄と `Domain` の変換）、`apps/web/src/lib/list-views.ts`（新規、保存境界は `analytics-storage.ts` と同じ）、`apps/web/src/lib/list-workbench.ts`（新規、ページ合計・出力入力・一括操作の計画）、`apps/web/src/components/list-filter-panel.tsx` / `list-columns-dialog.tsx` / `list-views-dialog.tsx` / `list-bulk.tsx` / `list-export.tsx`（新規）、`apps/web/src/lib/csv.ts`（既存の CSV 化をそのまま使う）、`apps/web/src/api/reports.ts` と `apps/web/src/lib/navigation.ts`（generic な表 action をレポートに出さない）
- kernel: `kernel/src/actions/export-rows.ts`（新規。`<entity>.export_rows`、`permission: { entity, op: 'export' }`、`mutates: false`、`TableResult` を返す、`EXPORT_ROWS_LIMIT = 5000`）、`kernel/src/actions/crud.ts`（登録 1 行）
- api: 既存 `POST /actions/:name/export` の再認可経路を使う（変更なし）
- docs: `docs/manual/02-basics.md`（一覧の操作）、`docs/conventions/ui.md`

## データ・業務ルール（出典）

- 文書の状態遷移と `expectedVersion` — ADR-0006。金額の合計は `lib/decimal.ts` の文字列演算（ADR-0010）。
- 一覧出力の監査（AC-9）: 1 回の出力ごとに `audit_log` へ 1 行。`entity` = 出力した entity、`record_id` = 出力ごとの新しい uuid（特定の記録に属さないため）、`op` = `export`、`action` = `<entity>.export_rows`、`before` = null、`after` = `{ export: { where, search, orderBy, columns, rows, total, truncated } }`（`where` は field 名と演算子を残し、`permissions.fieldGroups` のいずれかに属する field（`ext` 全体を含む）の値を `'[masked]'` に置き換える。後で監査を見る人がその group に属さなくても値が出ないように、出力者によらず伏せる）、実行者と request id は Context から。記録画面の監査パネル（記録 id 単位）には出ない。横断検索は [実装計画](../completion-plan.md) F3。
- CSV の式インジェクション対策は既存 `lib/csv.ts`（先頭の空白を除いた最初の文字が `= + - @` の文字列セルに `'` を前置。数値列の数値は前置しない）。

## スコープ外（明記）

- 会社内で共有する保存ビュー（DSL entity が必要。次版）
- 条件全体の合計（集計 API が必要。次版）
- 一覧からの一括編集、列幅の保存、仮想スクロール
- timestamp・ext field の絞り込み欄、ref の複数選択、一括取消の訂正日指定

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`
2. 単体: meta → 絞り込み欄、絞り込み → `Domain`、URL の往復、`?status/from/to` の解釈、保存境界、保存ビューの並べ替えの再検査、ページ合計、出力入力と CSV、generic な表 action がレポート・入口に出ないこと、一括操作の計画、選択の上限・保持・解除（AC-1〜AC-7、AC-10〜AC-12）— `apps/web/src/lib/list-filters.test.ts`、`list-views.test.ts`、`list-workbench.test.ts`、`apps/web/src/components/list-workbench-ui.test.ts`
3. DB: 出力 action の権限（`export` なしで拒否）、マスク（ext 列を含む）、参照先の `export` がなければ参照列は id、`where` の長さ上限、5,000 行上限、監査（伏せ字を含む）、出力経路の repeatable read（AC-7〜AC-9）— `kernel/test/export-rows.db.test.ts`、`apps/api/test/list-export.db.test.ts`
4. ブラウザ: 期間と状態で絞り込み → URL 再読込・戻るで復元、締めガイドのリンク、列の変更と保存ビュー、ページ合計、CSV の中身、閲覧者に CSV なし、3 件一括確定で 1 件失敗の表示と二重実行防止、390px、保存を拒否するブラウザでの注意、キーボードの焦点（適用・不正な欄・札・クリア・一括確定後・ビュー削除後）（AC-1〜AC-12）— `apps/web/e2e/list-workbench.spec.ts`
5. `pnpm gate:full`

## 未決事項（利用者の判断待ち）

- 一括取消で訂正日を指定できるようにするか（初版は元の日付のみ。指定が必要な場合は個別に取消）。
- CSV の値は画面と同じ表示値（参照は表示名、選択肢と状態はラベル）にした。取込（[csv-import](csv-import.md)）との往復や機械処理のために、id やコード値の列を選べるようにするか。
- 出力の監査は記録されるが、画面から見る場所がない（F3 の監査横断検索で扱う想定）。

## 実装で確定した判断（2026-10-29）

- `?f=` は 1 つの JSON 値にした（field ごとの key より URL 長と検査が単純）。URL 側の上限は 3,000 文字（REST の `where` は 4,000 文字）。
- 絞り込み欄は下書きを持ち「絞り込む」で適用する（入力途中の日付や金額を URL・API に流さない）。適用中の条件は表の上に「項目: 値 ×」のボタンで常に表示し、1 つずつ外せる。欄は全幅で既定は折りたたみ。
- 保存は `localStorage` の `daifuku.list.v1.[tenantId, userId, companyId, entity]`。読込は厳密（知らない key や値は拒否）、書込は読込と同じ検査を通してから保存する。Web Locks があれば排他して読み直してから書く。無い場合も書く（利用者ごとの表示設定であり、保存分析のように拒否しない）。この版で読めない値は置き換え、新しい版の値は上書きしない。
- `<entity>.export_rows` は generic action として `registerCrudActions` の中で登録する（独自の `<entity>.list` を持つ entity には付かない。独自の一覧の見せ方を迂回しないため）。Repository の 1 ページ上限 500 行で最大 10 回読む。各ページの `list` は総数の `count(*)` も実行する（最大 10 回。使うのは最初のページの総数だけ。総数なしの読取を Repository に足すのは kernel の変更になるため初版では行わない。2026-10-30 のレビューの指摘を受けて記録）。
- 出力経路 `POST /actions/:name/export` は 1 要求を repeatable read（読書き可）のトランザクションで実行する（`withContext` の `snapshot: true`。2026-10-30 のレビューで修正）。全ページが同じスナップショットを読むので、出力中に行が増減・並び替わってもページ境界で行が重複・欠落せず、監査の rows / total とファイルが一致する。監査の insert は repeatable read の読書きトランザクションで書ける（当初の「監査の書込が要るため読取専用スナップショットは使わない」は、読取専用と repeatable read を混同した誤り）。レポートも同じ経路なので複数文の読取が 1 つのスナップショットになる。通常の `POST /actions/<entity>.export_rows`（MCP を含む）は従来どおり read committed。
- 出力の列は TableResult の列。参照は表示名の text、選択肢と状態は `locale`（入力、既定は要求の言語）のラベル、真偽は `true` / `false`、日付は `YYYY-MM-DD`、decimal は文字列。
- generic な action はレポート一覧・画面検索・`/r/`・「BI・レポート」の入口に出さない（`export_rows` も TableResult を返すため）。判定は `lib/report.ts isReportAction` 1 か所で、レポート一覧とナビゲーションが共有する。`navigation.spec.ts` と `phase1.spec.ts` の前提を「表 action のうち generic でないもの」に直した。

## レビュー後の修正で確定した判断（2026-10-30）

- 参照列の表示名は参照先の `export` 権限が要る（AC-8 を修正。当初は読取権限だけで解決しており ADR-0018 と矛盾していた）。例: `sales` は作業（jobs）を出力できるが取引先は出力できないので、作業の CSV の取引先列は id になる。
- 保存ビューの並べ替えも呼び出し時に現在の meta で検査する（`list-views.ts restorableSort`）。並べ替えられるのは、要求者の meta にある ext 以外の field、document の `number` / `docstatus`、`createdAt` / `updatedAt` / `id`。消えた・マスクされた field の並べ替えは落として一覧を開く（API の拒否で「読み込めません」にしない）。
- 選択の規則（100 件の上限、ページの一括選択は順に上限まで、条件 = 検索語・並べ替え・絞り込みの変更で空にする、ページ送りでは保持、表示中の行は新しい版で置き換える）は `lib/list-workbench.ts` の純粋関数にし、単体試験で確かめる。
- ブラウザが保存そのものを拒否する（`localStorage` の取得で例外）場合も、読めない場合と同じく既定の列で表示して注意を出す（文言は別: 「このブラウザでは列と保存ビューを保存できません」）。
- キーボードの焦点: 絞り込み欄は適用で作り直さない（「絞り込む」「すべてクリア」に焦点が残る。外からの条件変更では下書きだけ置き換える）。適用を拒否したら最初の不正な欄へ。札を外したら次の札、なければ前の札、なければ「絞り込み」ボタン。札の行の「絞り込みをクリア」も「絞り込み」ボタンへ。一括操作の確定後は結果の見出し（`tabIndex=-1`）へ。保存ビューの削除後は次のビューの「呼び出す」、なければ前、なければ名前の欄へ。
- 札と札の行の「絞り込みをクリア」は高さ 24px 以上（WCAG 2.2 SC 2.5.8）。
- 出力のファイル名は既存の `lib/csv.ts csvFilename` に統一（UTC の時刻。レポートの CSV と同じ規則のまま）。
