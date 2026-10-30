# 作業記録: 2026-10-29 一覧の絞り込み・列・保存ビュー・CSV・一括操作（C1）

- セッション: 完成度向上計画 C1（workflow の作業項目、worktree `wip/list-workbench`、起点 `0dded55`）／ 担当: agent ／ 対象: [docs/specs/list-workbench.md](../specs/list-workbench.md)
- 計測: tokens=null（未計測）, agent_minutes=約75（実装。壁時計 21:03〜22:15。gate:light の待ち約 21 分を含む。2 回目の gate:light は含まない）＋レビュー対応（2026-10-30。コンテナ再起動で中断した前任の修正担当の時間は不明で含まない。引き継いだ修正担当は約 60 分、gate:light の待ちを含む）, human_minutes=0, rework_lines=約30（実装中: 試験の期待値 2 か所・型 2 か所・既存 e2e 2 ファイルの前提・英語の件数表記）＋約800（レビュー対応の差分。試験と文書を含む）, gate_failures=1（gate:light 1 回目の DB 2 ファイルが共有 PostgreSQL のロック表不足で開始前に失敗。下記。レビュー対応では 0）

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
- [実測] `pnpm gate:light`（1 回目、コミット `8125c0a`、1,265 秒、kernel の変更で DB は全件）: format・docs・assurance・typecheck（root/api/web）・lint・unit（135 ファイル 1,251 件）は成功。DB は 118 ファイル中 116 成功・704 件成功、`modules/group-accounting/test/group.db.test.ts` と `modules/inventory/test/foundation.db.test.ts` の 2 ファイルが `freshDb` の `DROP SCHEMA public CASCADE` で PostgreSQL の `out of shared memory`（`max_locks_per_transaction`、同じクラスタを最大 4 エージェントが共有、負荷平均 8 台）により開始前に失敗し、そのため deploy は未実行になった。2 ファイルを単独で再実行して 6 件成功（9 秒）、`pnpm test:deploy` を単独で実行して 16 件成功。変更とは無関係の環境要因と判断したが、gate:light が 1 回で成功した記録ではない。
- [実測] `pnpm gate:light`（2 回目、コミット `a01fd8a`）: 成功、1,064 秒。format・docs・assurance・typecheck・lint・unit（135 ファイル 1,251 件）・DB 全件（118 ファイル 710 件、898 秒）・deploy（16 件）。その後 `list-workbench`・`ui-kit`・`smoke`・`phase1` のブラウザ試験 17 件を新しい fixture DB で再実行して成功。
- [レビュー] 390px と 1280px のスクリーンショット（絞り込み欄、一括操作の結果）を目視で確認した。
- [未検証] `pnpm gate:full`（統合担当が実行）。axe による検査（A2 の範囲。取引先一覧は A2 の対象画面）。5,000 行を超える出力の画面表示（上限は DB 試験で確認）。Web Locks の無いブラウザでの画面の動き（純粋関数は単体試験。保存を拒否するブラウザは 2026-10-30 にブラウザ試験で確認、下記）。ref・enum・bool の絞り込み欄の画面操作（変換は単体試験）。英語表示の画面（文言は単体試験で一部）。

## 見つけた問題と修正（発見経路つき）

- `navigation.spec.ts` が全 table action を画面検索に期待していた — 発見: ブラウザ試験、修正: 前提を generic でない table action に変更し、generic action が出ないことの確認を追加（同じコミット）。
- API 試験の監査行の探し方が前の試験の行にも一致していた — 発見: DB 試験、修正: where の完全一致で探す。
- 一括操作の失敗理由がサーバーのメッセージだけで原因が分かりにくかった（例: 貸借不一致） — 発見: スクリーンショットの目視、修正: hint も表示。
- 参照列の表示名を参照先の読取権限だけで解決しており、参照先の `export` を持たない役割（例: 作業を出力できるが取引先は出力できない `sales`）が参照元の CSV で取引先名を 5,000 行ずつ取り出せた（ADR-0018 の「出力するすべての台帳の export を再検証」と矛盾） — 発見: レビュー（再現試験つき）、修正: 参照先の `export` がなければ id（2026-10-30）。
- 出力の監査に `where` を長さ無制限・値そのままで保存していた（追記専用の表に 1 回で約 0.5 MB、field group の値が残る） — 発見: レビュー（試行）、修正: 4,000 文字の上限と field group の値の伏せ字（2026-10-30）。
- 500 行 × 最大 10 ページの読取が read committed で、出力中の変更で行の重複・欠落がありえた（spec の理由「監査の書込が要るため読取専用スナップショットは使わない」も誤り） — 発見: レビュー、修正: 出力経路を repeatable read（読書き可）に（2026-10-30）。
- 「BI・レポート」の入口が generic な表 action（`export_rows`）だけでも出て、空のレポート一覧に案内していた — 発見: レビュー（試行）、修正: `isReportAction` を共有（2026-10-30）。
- 保存ビューの並べ替えを現在の meta で検査しておらず、消えた・マスクされた field の並べ替えで一覧が「読み込めません」になった — 発見: レビュー、修正: `restorableSort`（2026-10-30）。
- ブラウザが保存そのものを拒否すると注意が出なかった（AC-4・マニュアルと不一致） — 発見: レビュー（試行）、修正: 別文言の注意（2026-10-30）。
- 絞り込みの適用・札の解除・クリア・一括確定・保存ビューの削除の後に焦点が `<body>` に落ちた — 発見: レビュー（Playwright の試行で計測）、修正: 下記の焦点の規則（2026-10-30）。
- `ext.<key>` の outputHidden 列の明示が権限エラーでなく「不明な列」になった — 発見: レビュー、修正: meta の検索より前に `assertReadableFields`（2026-10-30）。

## レビュー対応（2026-10-30、修正担当 agent）

レビュー 3 観点（spec・安全・UX）の指摘 20 件（同じ内容の重複 1 組を除くと 19 件）をコードと照合した。前任の修正担当がコンテナ再起動で中断し、未コミットの変更が worktree に残っていたので、全差分を読んで妥当と判断したものを残し、足りない部分（出力経路の分離レベルを経路そのもので確かめる試験、マニュアルの画像、作業記録）を補った。18 件は指摘どおりに対応、1 件（各ページの `count(*)`）は理由を付けて見送り、1 件（ファイル名の時刻）は主な部分だけ対応した。

### 決めたこと（と理由）

- **参照列の表示名は参照先の `export` 権限が要る（重大）。** 表示名は参照先の台帳のデータであり、ADR-0018 は CSV で出力するすべての台帳の export を再検証すると定める。既存の帳票は `exportEntities` に参照先（例: 売掛金年齢表の `partner`）を名指しする。汎用の出力では参照先は列で決まるので、`refLabels` で `can(ctx, target, 'export')` を確かめ、無ければ id のままにした（出力全体を拒否する案より、参照先の権限が無い役割でも自分の台帳は出力できる）。ADR の改訂は不要（ADR どおりにした）。spec AC-8 と DB 試験の期待値（`xr_limited` は取引先を読めるが出力できない → id）を直した。テストを弱めたのではなく、誤った期待値（読めれば名前が出る）を ADR に合わせた。
- **監査の `where` は 4,000 文字まで（REST の一覧と同じ）、field group の値は `'[masked]'`。** 出力者がその group に属していても伏せる（後で監査を見る人が属するとは限らない）。field 名と演算子は残すので、何で絞ったかは分かる。`orderBy` も field 名 120 文字・5 件までにした。
- **出力経路 `POST /actions/:name/export` は repeatable read（読書き可）。** `withContext` に `snapshot: true` を足した（既存の `readOnlySnapshot` の隣。新しい port ではなく既存の関数の選択肢なので ADR は書かない。`docs/conventions/reports.md` に記した）。監査の insert は repeatable read でも書け、`audit_log` の trigger は update / delete の拒否だけなので直列化の失敗も起きない。帳票も同じ経路なので複数文の読取が 1 つのスナップショットになる。通常の `POST /actions/:name`（MCP を含む）は read committed のまま。
- **generic な表 action の判定は `lib/report.ts isReportAction` 1 か所。** レポート一覧・画面検索・`/r/`・「BI・レポート」の入口が共有する。
- **保存ビューの並べ替えは `restorableSort` で検査。** 要求者の meta にある ext 以外の field、document の `number` / `docstatus`、`createdAt` / `updatedAt` / `id` だけを残す（kernel の `orderClauses` が受け付ける列の部分集合）。
- **選択の規則は `lib/list-workbench.ts` の純粋関数**（`toggleSelection`・`togglePageSelection`・`refreshSelection`・`selectionCriteria`）にして単体試験で確かめた。画面の `useSelection` はそれを呼ぶだけ。
- **保存を拒否するブラウザ（`localStorage` の取得で例外）でも注意を出す。** 文言は読めない場合と分けた（「このブラウザでは列と保存ビューを保存できません。既定の列で表示しています。」）。
- **焦点の規則**（`docs/conventions/ui.md` に記した）: 絞り込み欄は適用で作り直さない（`key` を外し、外から条件が変わったときだけ下書きを置き換える）。適用を拒否したら最初の `aria-invalid` の欄へ。札を外したら次の札、前の札、「絞り込み」ボタンの順。札の行の「絞り込みをクリア」は「絞り込み」ボタンへ。一括確定後は結果の見出し（`tabIndex=-1`）へ。保存ビューの削除後は次の「呼び出す」、前、名前の欄の順（ダイアログに留める）。
- **札と札の行の「絞り込みをクリア」は高さ 24px 以上**（WCAG 2.2 SC 2.5.8。A2 の axe は 2.1 なので検出しない）。
- **使われていない `ListViewsDialog` の `error` を削除**（保存の失敗は一覧のトーストで出す。ダイアログは変わらない）。
- **件数の文言は `countLabel`**（日本語は「n 件」、英語は単数・複数。`toLocaleString` で桁区切り）。「絞り込みをクリア」の文言は `CLEAR_FILTERS` 1 つにした。
- **ファイル名は既存の `lib/csv.ts csvFilename` に統一**（重複していた `exportFilename` を削除）。時刻は UTC のまま: `csvFilename` は帳票の CSV と共有しており、地方時への変更は C1 の外の振る舞いを変えるため（主な部分だけ対応）。
- **見送り: 出力の各ページで `count(*)` が走る（最大 10 回）。** 総数なしの読取を Repository に足すのは kernel の公開 API の変更になる。1 回の出力で最大 10 回の count であり、repeatable read で結果も一致するので初版では残し、spec の「実装で確定した判断」に記録した。
- **マニュアル 02 に現在の画面の画像 `img/02-list-workbench.png` を足した**（仕訳の一覧、日付で絞り込み、絞り込み欄を開き 2 件を選択。fixture DB に一時的な Playwright の手順でデータを作って撮影し、手順のファイルは消した）。出力の監査は「現在は画面からは確認できません」と書き、伏せ字のことも書いた。既存の `img/02-list.png`（検索と並べ替えの例）は C1 より前の画面のままで、撮り直していない。

### 検証

- [実測] DB（`daifuku_test_w21`）: `kernel/test/export-rows.db.test.ts` 8 件（参照先の `export` が無い `xr_limited` は id で取引先名が出ない・`export` のある役割は名前、`ext.vaultTag`（outputHidden）の明示は PERMISSION_DENIED・`ext.nope` は VALIDATION_ERROR、600 件の `$in` の `where` は読取前に VALIDATION_ERROR、監査の `where` で `secret` の値が `'[masked]'`・`owner` は残る・`classified-` を含まない）、`apps/api/test/list-export.db.test.ts` 5 件（試験用の帳票 action が `POST /actions/:name/export` では `repeatable read`、`POST /actions/:name` では `read committed` を返す、`snapshot: true` のトランザクションでは開始後に別のトランザクションが作った行が出力に現れず、監査の行は書ける）が成功（約 25 秒）。
- [実測] 単体（gate:quick の unit 全件に含む）: `list-workbench.test.ts`（選択の 100 件上限、ページの一括選択、条件の変更で解除・ページ送りで保持、表示中の行の差し替え、`/reports` の入口が export だけの役割に出ない、`countLabel`）、`list-views.test.ts`（`restorableSort`）。
- [実測] ブラウザ（`e2e-run.sh` slot 21、新しい fixture DB、`--project=chromium --no-deps`）: `list-workbench`・`ui-kit`・`smoke`・`phase1`・`navigation` の 22 件中 21 件成功。失敗の 1 件は `navigation.spec.ts` AC-3/10（飲食店の業務画面が要り、`--no-deps` で industry project を飛ばしたため）で、industry project 付きで `navigation.spec.ts` を再実行して 8 件（industry 3 件を含む）すべて成功。`list-workbench.spec.ts` に足した確認: 不正な期間で「絞り込む」→ 開始の欄に焦点と `aria-invalid`、URL に `f` が入らない、適用後も「絞り込む」に焦点、札を外すと次の札、札の行の「絞り込みをクリア」で「絞り込み」ボタン、「すべてクリア」に焦点が残る、保存ビューの削除後に名前の欄、`localStorage` の取得が例外になるブラウザで注意の文言と既定の列、一括確定後に結果の見出し。
- [実測] `pnpm gate:quick` 成功（format・docs・assurance・eslint・依存境界・typecheck（root/api/web）・unit 全件・deploy、196 秒）。
- [実測] `pnpm gate:light`（未コミットのレビュー対応の作業木、`TEST_DATABASE_URL_*` = `daifuku_test_w21`）: 成功、1,220 秒。format・docs・assurance・typecheck（root/api/web）・lint・unit（135 ファイル 1,255 件）・DB 全件（kernel の変更で拡大、118 ファイル 714 件、996 秒）・deploy。その後、札の高さの確認を足した `list-workbench.spec.ts` を新しい fixture DB で再実行して 4 件成功（30 秒）。
- [レビュー] マニュアルの画像（1280×900）を目視で確認した。
- [実測] 390px で札と札の行の「絞り込みをクリア」の高さが 24px 以上（`boundingBox()`、`list-workbench.spec.ts` AC-12。レビュー時の計測は 19.5px / 16.5px）。
- [未検証] `pnpm gate:full`（統合担当）。axe。英語表示の画面での件数の文言（単体試験のみ）。札の高さの確認（e2e の数行）は gate:light の format の段階の後に足したので、その段階には含まれない（`prettier --check` と `eslint` を個別に実行して成功）。

## 未実施（減らさない。完了したら「済」を付けて残す）

- 会社内共有の保存ビュー（DSL entity）、条件全体の合計、timestamp・ext の絞り込み、ref の複数選択（spec のスコープ外）
- 出力の監査を画面で見る場所（F3）

## 判断待ち（利用者）

- 一括取消で訂正日を指定できるようにするか。
- CSV に id・コード値の列を選べるようにするか（取込との往復）。

## 次のセッションへ

- B5 の統合: `kernel/src/actions/crud.ts` のループに `registerExportRowsAction(entity);` があり、B5 の取込の登録と隣り合う。一覧の見出しの操作は `PageHeader` の `actions` の fragment（CSV 出力・新規）に「取込」を足す。
- C4 の締めガイドの href `/e/<entity>?status=draft&from=&to=` はこの一覧で絞り込みとして開く（C4 の「解釈できない段階」の代替表示は不要になった）。
