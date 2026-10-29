# Spec: list-workbench（一覧の絞り込み・列・保存ビュー・CSV・一括操作）

- 状態: draft
- モジュール: `apps/web`（汎用一覧）、`kernel`（一覧の CSV 出力用の派生 action） ／ 依存: [ui-kit](ui-kit.md)
- ADR: 不要（既存の `where`・`export` 権限・文書操作の組合せ）。一覧出力の監査方式は spec に記す
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) C1

## 目的（1段落）

汎用一覧（`/e/:entity`）は全文検索・列ヘッダの並べ替え・ページ送りしかない。経理や店舗の担当者は毎日「今月の未確定の請求書」「この取引先の入金」のような条件で一覧を見て、まとめて確定し、表計算に持ち出す。REST の一覧は既に `where`（`Domain`）を受け付けるので、画面に絞り込み・列の選択・保存ビュー・合計・CSV 出力・一括操作を足し、毎日の操作回数を減らす。

## 受入基準（EARS）

- AC-1 WHEN 一覧を開いた THE SYSTEM SHALL entity の field から絞り込み欄を作る: document の状態（下書き・確定・取消の複数選択）、日付 field の範囲（開始・終了）、`ref` の参照先、`enum` の複数選択、金額・数量の範囲、`bool`。対象は `views.list` と `views.search` に含まれる field、および document の状態と業務日付とする。
- AC-2 WHEN 絞り込みを変更した THE SYSTEM SHALL 条件を URL の search（`?f=` に JSON、または field ごとの key）に保持し、REST の `where` に `Domain` として渡す。再読込・戻る・共有した URL で同じ条件を復元する。不正な条件は無視して表示する。
- AC-3 THE SYSTEM SHALL 他の画面からの `?status=draft&from=YYYY-MM-DD&to=YYYY-MM-DD` を業務日付と状態の絞り込みとして解釈する（[月次締めガイド](close-guide.md) のリンク先）。
- AC-4 WHEN 利用者が列の表示・順序を変更した THE SYSTEM SHALL 利用者・tenant・会社・entity ごとにブラウザ内へ保存し、「既定に戻す」で `views.list` に戻す。保存に失敗しても画面は既定で動く。
- AC-5 WHEN 利用者が現在の絞り込み・並べ替え・列に名前を付けて保存した THE SYSTEM SHALL 同じ境界でブラウザ内に保存し、一覧の「保存ビュー」から呼び出し・削除できる。
- AC-6 THE SYSTEM SHALL 表示中のページについて金額 field の合計と件数を表の下に表示し、ページの合計であることを明記する。
- AC-7 WHEN 利用者が CSV 出力を押した THE SYSTEM SHALL 現在の条件・並べ替え・表示列で最大 5,000 行を、出力時に権限を取り直す経路（entity の `export` 権限）で取得し、ブラウザで CSV（UTF-8、BOM 付き）を作る。上限を超える場合は件数と上限を示して先頭 5,000 行を出力する。
- AC-8 IF 要求者が entity の `export` 権限を持たない THEN THE SYSTEM SHALL CSV 出力の操作を表示せず、API も拒否する。出力は field のマスク（field group）を一覧と同じく適用する。
- AC-9 THE SYSTEM SHALL CSV 出力を監査に記録する（entity、条件の要約、行数、要求者）。
- AC-10 WHEN document の一覧で行を複数選択し「確定」「取消」「削除」のいずれかを実行した THE SYSTEM SHALL 確認後に 1 件ずつ既存の文書操作 API を `expectedVersion` 付きで呼び、行ごとの成功・失敗と理由を表示する。失敗しても成功した行は巻き戻さない。操作できない状態の行は選択時に対象外と表示する。
- AC-11 THE SYSTEM SHALL 一括操作の対象を 1 回 100 件までとし、実行中は二重実行を防ぎ、完了後に一覧を再取得する。
- AC-12 THE SYSTEM SHALL 画面の文言を日本語と英語で持ち、390px 幅では絞り込みを折りたたみ表示にして操作できる。

## 関係するファイル・インターフェース（名指し）

- web: `apps/web/src/pages/entity-list-page.tsx`、`apps/web/src/components/data-table.tsx`、`apps/web/src/lib/query.ts`（URL 状態と `where`）、`apps/web/src/lib/list-filters.ts`（新規、meta → 絞り込み欄と `Domain` の変換）、`apps/web/src/lib/list-views.ts`（新規、保存境界は `analytics-storage.ts` と同じ）、`apps/web/src/lib/csv.ts`
- kernel: entity ごとの派生 action（例: `<entity>.export_rows`、`permission: { entity, op: 'export' }`、`mutates: false`、`TableResult` を返す）と監査
- api: 既存 `/actions/:name/export` の再認可経路を使う
- docs: `docs/manual/02-basics.md`（一覧の操作）、`docs/conventions/ui.md`

## データ・業務ルール（出典）

- 文書の状態遷移と `expectedVersion` — ADR-0006。金額の合計は `lib/decimal.ts` の文字列演算（ADR-0010）。

## スコープ外（明記）

- 会社内で共有する保存ビュー（DSL entity が必要。次版）
- 条件全体の合計（集計 API が必要。次版）
- 一覧からの一括編集、列幅の保存、仮想スクロール

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`
2. 単体: meta → 絞り込み欄、絞り込み → `Domain`、URL の往復、`?status/from/to` の解釈、保存境界（AC-1〜AC-5）
3. DB: 出力 action の権限（`export` なしで拒否）、マスク、5,000 行上限、監査（AC-7〜AC-9）
4. ブラウザ: 期間と状態で絞り込み → URL 再読込で復元、列の変更と保存ビュー、CSV の中身、3 件一括確定で 1 件失敗の表示、390px（AC-1〜AC-12）
5. `pnpm gate:full`

## 未決事項（利用者の判断待ち）

- 一括取消で訂正日を指定できるようにするか（初版は元の日付のみ。指定が必要な場合は個別に取消）。
