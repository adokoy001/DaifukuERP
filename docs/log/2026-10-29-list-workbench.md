# 作業記録: 2026-10-29 一覧の絞り込み・列・保存ビュー・CSV・一括操作（C1）

- セッション: 完成度向上計画 C1（workflow の作業項目、worktree `wip/list-workbench`、起点 `0dded55`）／ 担当: agent ／ 対象: [docs/specs/list-workbench.md](../specs/list-workbench.md)
- 計測: tokens=null（未計測）, agent_minutes=約75（壁時計 21:03〜22:15。gate:light の待ち約 21 分を含む。2 回目の gate:light は含まない）, human_minutes=0, rework_lines=約30（試験の期待値 2 か所・型 2 か所・既存 e2e 2 ファイルの前提・英語の件数表記）, gate_failures=1（gate:light 1 回目の DB 2 ファイルが共有 PostgreSQL のロック表不足で開始前に失敗。下記）

## 決めたこと（と理由）

- **CSV は kernel の派生 action `<entity>.export_rows` にした（spec どおり、計画の `GET /api/:entity/export.csv` ではない）。** レポートと同じ再認可経路 `POST /actions/:name/export` を変更なしで使え、`checkActionExport` が generic action の `permission.entity` に `export` を要求する。読取は `repo(ctx, entity).list` を 500 行 × 最大 10 回で、行の権限・会社/拠点の境界・field group・`outputHidden` は一覧と同じになる。B5 の取込と衝突しないよう `kernel/src/actions/export-rows.ts` に分け、`registerCrudActions` のループに 1 行だけ足した（独自の `<entity>.list` を持つ entity には付かない）。
- **出力の値は画面と同じ表示値。** 参照列は参照先の Repository を要求者の Context で読んで表示名（`displayField` → name → number → code）にし、読めない参照先・見えない行は id のまま（`/e/<target>` より多くを見せない）。選択肢と伝票状態は入力 `locale`（既定は要求の言語）のラベル。id やコード値の列は未決事項に残した。
- **マスク対象・`outputHidden` の列は既定の列から外し、明示されたら権限エラー（PERMISSION_DENIED）。** where / orderBy と同じ扱いで、黙って空欄にしない。
- **監査は出力 1 回に `audit_log` 1 行。** 記録に属さないので `record_id` は出力ごとの新しい uuid、`op: 'export'`、`action: '<entity>.export_rows'`、`after.export` に条件・列・行数・総数・切り捨て有無。記録単位の監査パネルには出ない（F3 の横断検索で扱う想定、spec の未決事項）。
- **`mutates: false` のまま監査を書く。** レポートの再認可経路は `mutates` の action を拒否する。監査は業務データの変更ではなく、API は 1 要求 1 トランザクションなので書ける。
- **generic な表 action をレポート一覧・画面検索・`/r/` から外した。** `export_rows` は TableResult を返すため、そのままでは entity の数だけ「レポート」が増える。`api/reports.ts` と `lib/navigation.ts` に `!generic` を足し、ブラウザ試験 `navigation.spec.ts`（全 table action が画面検索にある前提）と `phase1.spec.ts`（最初の table action を使う予備）の前提を「generic でない table action」に直した。テストを弱めたのではなく、レポートの定義が変わったことに合わせた修正（generic な action が出ないことの確認を足した）。
- **絞り込みは `?f=` の 1 つの JSON 値。** field ごとの key より URL の検査と保存ビューへの写しが単純。entity の meta で検査し、不正な部分は無視する。締めガイドの `?status=&from=&to=` は状態と業務日付（締めガイドと同じ `date` → `postingDate` → `documentDate` → `transactionDate`）として重ね、次の変更で `f` に書き換える（二重の情報源を残さない）。
- **絞り込み欄は下書きを持ち「絞り込む」で適用する。** 入力途中の日付・金額が URL と API に流れない。不正な欄は理由を出して適用しない。適用中の条件は折りたたみ中も札で見え、1 つずつ外せる。欄は全幅で既定は折りたたみ（390px の AC-12 と、表の高さを保つため）。
- **列・保存ビューは `localStorage` の `daifuku.list.v1.[tenantId, userId, companyId, entity]`。** 保存分析（`analytics-storage.ts`）と同じ境界: 厳密な読込、読込と同じ検査を通した書込、Web Locks での排他。違いは Web Locks が無くても書くこと（利用者ごとの表示設定であり、保存分析のように拒否すると列の変更自体ができなくなる）と、この版で読めない値は置き換え、新しい版の値は上書きしないこと。`analytics-storage.ts` は D2 も使う可能性があるので変更せず、型だけ import した。
- **一括操作は document だけ、要求者の ops にある確定・取消・削除。** 1 件ずつ既存 REST を一覧に表示した版の `expectedVersion` で呼ぶ（その後に変わった行は CONFLICT で失敗表示）。結果は確認ダイアログではなくページ上のパネルに出す（実行中にダイアログを閉じられても結果が残り、失敗行のリンクから伝票を開ける）。二重実行は ref の判定と実行中のボタン無効化で防ぐ。選択は同じ条件ならページをまたいで保持し、100 件で止める。
- **UI 文字列は新しいファイルの中に `{ ja, en }` で置いた。** `strings.ts` は他の作業項目も触るため、衝突を避けた。

## やったこと

- kernel: `kernel/src/actions/export-rows.ts`（新規）、`crud.ts` に登録 1 行、`index.ts` で `EXPORT_ROWS_LIMIT` を export
- web lib: `list-filters.ts`、`list-views.ts`、`list-workbench.ts`（新規）、`query.ts`（`f` / `status` / `from` / `to`、`SearchPatch`）
- web 部品: `list-filter-panel.tsx`、`list-columns-dialog.tsx`、`list-views-dialog.tsx`、`list-bulk.tsx`、`list-export.tsx`（新規）、`data-table.tsx`（選択列）、`list-empty-state.tsx`（絞り込み中の空状態）、`ui/ui.css`（選択列・札）、`pages/entity-list-page.tsx`
- `api/reports.ts`、`lib/navigation.ts`（generic な表 action を除外）、`ui/token-usage.test.ts`（新しい部品 5 つを CONVERTED に追加）
- 文書: spec（状態 implemented、受入基準を実装に合わせて具体化、判断と未決事項）、マニュアル 02「一覧画面」、`docs/conventions/ui.md`（汎用一覧の契約の表、レポートの定義）、`docs/conventions/reports.md`（`export_rows` との違い）

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] 単体: `apps/web/src/lib/list-filters.test.ts`（AC-1〜AC-3）、`list-views.test.ts`（AC-4/AC-5）、`list-workbench.test.ts`（AC-6/AC-7/AC-10/AC-11、generic action がレポートに出ないこと）、`components/list-workbench-ui.test.ts`（AC-2/AC-10/AC-11/AC-12）が成功。
- [実測] DB（`daifuku_test_w21`）: `kernel/test/export-rows.db.test.ts` 6 件（5.4 秒。`export` なしの拒否と /meta 非表示、条件・並び・列・表示値、マスクと outputHidden の拒否、行の権限、読めない参照先は id、監査 1 行、5,003 行で 5,000 行と truncated）、`apps/api/test/list-export.db.test.ts` 3 件（12 秒。HTTP の 403、TableResult の値、監査）が成功。
- [実測] ブラウザ（`e2e-run.sh` slot 21、新しい fixture DB）: `list-workbench.spec.ts` 4 件が成功（状態と日付の絞り込み → `where` の中身 → 再読込・戻る、締めガイドのリンク、札の解除で `status` が `f` に変わる、不正な URL 条件の無視、絞り込み中の空状態、390px で折りたたみと横スクロールなし、列の変更・再読込・既定に戻す、保存ビューの保存・呼び出し・削除、ページ合計 3,500、CSV の要求内容・BOM・見出し・行・式の無効化、閲覧者に CSV ボタンと選択欄なし・API 403、一括確定で成功 2・失敗 1、要求の順序と `expectedVersion`、実行中の二重実行防止、成功分が確定のまま）。関連する既存 spec（`ui-kit`、`foundation-ui`、`smoke`、`phase1`、`phase15`、`navigation`、`quality-ref-search`、`company-context`、`payment`、industry project 3 件）も実行し、`navigation.spec.ts` の前提修正後に全件成功。
- [実測] `pnpm gate:quick` 成功（format・docs・assurance・eslint・依存境界・typecheck（root/api/web）・unit 全件・deploy）。
- [実測] `pnpm gate:light`（1 回目、コミット `8125c0a`、1,265 秒、kernel の変更で DB は全件）: format・docs・assurance・typecheck（root/api/web）・lint・unit（135 ファイル 1,251 件）は成功。DB は 118 ファイル中 116 成功・704 件成功、`modules/group-accounting/test/group.db.test.ts` と `modules/inventory/test/foundation.db.test.ts` の 2 ファイルが `freshDb` の `DROP SCHEMA public CASCADE` で PostgreSQL の `out of shared memory`（`max_locks_per_transaction`、同じクラスタを最大 4 エージェントが共有、負荷平均 8 台）により開始前に失敗し、そのため deploy は未実行になった。2 ファイルを単独で再実行して 6 件成功（9 秒）、`pnpm test:deploy` を単独で実行して 16 件成功。変更とは無関係の環境要因と判断したが、gate:light が 1 回で成功した記録ではない（2 回目は下の追記）。
- [レビュー] 390px と 1280px のスクリーンショット（絞り込み欄、一括操作の結果）を目視で確認した。
- [未検証] `pnpm gate:full`（統合担当が実行）。axe による検査（A2 の範囲。取引先一覧は A2 の対象画面）。5,000 行を超える出力の画面表示（上限は DB 試験で確認）。Web Locks の無いブラウザ・保存を拒否するブラウザでの画面の動き（純粋関数は単体試験）。ref・enum・bool の絞り込み欄の画面操作（変換は単体試験）。英語表示の画面（文言は単体試験で一部）。

## 見つけた問題と修正（発見経路つき）

- `navigation.spec.ts` が全 table action を画面検索に期待していた — 発見: ブラウザ試験、修正: 前提を generic でない table action に変更し、generic action が出ないことの確認を追加（同じコミット）。
- API 試験の監査行の探し方が前の試験の行にも一致していた — 発見: DB 試験、修正: where の完全一致で探す。
- 一括操作の失敗理由がサーバーのメッセージだけで原因が分かりにくかった（例: 貸借不一致） — 発見: スクリーンショットの目視、修正: hint も表示。

## 未実施（減らさない。完了したら「済」を付けて残す）

- 会社内共有の保存ビュー（DSL entity）、条件全体の合計、timestamp・ext の絞り込み、ref の複数選択（spec のスコープ外）
- 出力の監査を画面で見る場所（F3）

## 判断待ち（利用者）

- 一括取消で訂正日を指定できるようにするか。
- CSV に id・コード値の列を選べるようにするか（取込との往復）。

## 次のセッションへ

- B5 の統合: `kernel/src/actions/crud.ts` のループに `registerExportRowsAction(entity);` があり、B5 の取込の登録と隣り合う。一覧の見出しの操作は `PageHeader` の `actions` の fragment（CSV 出力・新規）に「取込」を足す。
- C4 の締めガイドの href `/e/<entity>?status=draft&from=&to=` はこの一覧で絞り込みとして開く（C4 の「解釈できない段階」の代替表示は不要になった）。
