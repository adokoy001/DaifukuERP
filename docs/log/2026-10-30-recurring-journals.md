# 作業記録: 2026-10-30 recurring-journals（定期仕訳と前払費用の按分、E2）

- セッション: 実装セッション（workflow wf_194f8c9f-d8d、round 5、worktree `wf_194f8c9f-d8d-2`、ブランチ `wip/recurring-journals`）／ 担当: agent ／ 対象: [docs/specs/recurring-journals.md](../specs/recurring-journals.md)
- 計測: tokens=null, agent_minutes=115, human_minutes=0, rework_lines=40, gate_failures=1（1 回目の gate:light の DB で既存の移行試験 2 件。下の「検証」）

## 決めたこと（と理由）

- **spec 査読の 12 件をすべて採用**し、spec の決定 13 に記録した（不採用なし）。主なもの: ヘッダと明細を 1 回で送る更新の検査は kernel の印（汎用の更新が `lines` を持つ間はヘッダの更新中も置換中）で解く案 (a)、生成後に日・開始日・周期を変えた定額の次回日付は「`lastOccurrenceDate` の月より後の月」（全周期が 1 か月以上なので月で比べれば足り、規則を変えない限り従来の「日付が後」と同じ）、entity の親への直接の明細書込みは親の update でロック、按分で凍結する明細の field は行の集合・`accountId`・`debit`・`credit` に限定、止まった理由は画面が日英に変換、`endDate` ≥ `startDate`、仕訳の create / submit の事前確認は出荷時のロールでは失敗しないので単体試験の多重防御、通達 11-3-1 の追加。
- **ADR 番号は 0031**。同じ round の opening-balances（B6、worktree `wf_194f8c9f-d8d-1`）が `0030-opening-balances.md` を使っていたため。統合時に衝突したら統合担当が振り直す。
- **AC-7 (3) の範囲を狭めた**（spec 決定 14）: ヘッダだけの更新で明細の規則を検査するのは、明細の規則に効く種類・按分回数を変えたときだけで、保存済みの明細が無ければ検査しない。CSV 取込でヘッダだけ作った定期仕訳の名称を変えるたびに「明細 2 行以上」で拒否されるのを避けるため。ヘッダの規則は毎回検査する。
- **重複防止の三重化**: 会社ごとの系列ロック `accounting-recurring`（対象を読む前）、定期仕訳の行ロック（id 順）、生成記録の一意キー（`templateId`, `occurrenceDate`）。後の実行は先の実行の確定を待ってから対象を読み直すので、競合だけでは失敗しない。
- **回ごとの savepoint**（kernel の `withSavepoint`）。`DaifukuError` はその回だけ取り消して定期仕訳を止め、他の例外は実行全体を失敗させる。期間の判定は `assertOpenPeriod` をそのまま呼び（同じ advisory lock）、エラーの `details` から `closed_period` / `closed_year` / `no_period` を決める。
- **カーソル書込み**（`lastOccurrenceDate`）は module 専用の書込み権 `accounting.recurring_cursor` で行い、`before_update` hook はこの書込みでは検査を省いて次回日付だけを求める（生成の開始時に検査済み）。生成記録は `accounting.recurring_run` の書込み権（create だけ）の中だけで作れ、汎用の書込みは admin を含めて拒否する（`contract_billing` と同じ形）。汎用の create は hook より前に kernel の検査で止まる（server-owned の field を送れば `PERMISSION_DENIED`、送らなければ必須 field の欠落で `VALIDATION`）ので `before_create` の拒否は多重防御、update / delete は hook が `INVALID_STATE` で拒否する（この文言は修正セッションで実装に合わせて直した。下の「レビュー指摘への対応」）。
- **按分の端数**: `total.div(N).roundDown(scale)` を 1〜N−1 回目、残りを N 回目。回番号は日付から決まり、同じ回は何度計算しても同じ額（AC-13）。
- **生成の応答に `kind` を足した**（画面が按分向けの助言を選ぶため）。予定（`accounting.recurring_schedule`）の理由はコードだけにし、検査の要約（英語）は別の列 `detail`。
- **画面**: `/finance/recurring` は月次締めガイドと同じく finance client（`useFinanceCommand`）を使い、予定の key を `['finance', identity, ...]` に置いて生成後に読み直させた。予定は 390px で横にはみ出さないよう表ではなく折り返す一覧にした。テンプレートの編集は汎用の一覧・フォームのまま（明細グリッドは entity の明細で自動的に出る）。按分の生成開始後は `recurringLineLock` でグリッドを理由つきの読取専用にした（サーバー側の拒否が正）。
- **D3（form-ergonomics、未統合）への hook**: spec のとおり、`views.form` は従来の配列の形で書いた（基本 / 周期 / 按分 / 生成の状況の 4 群）。D3 統合後にラベル付きグループへ移す。

## やったこと

- kernel（ADR-0031）: `EntityConfig.lines`、`lineSpecs` / `lockParents` / `assertAggregateLimit` / `hasLines` / `EntityMeta.lines` / 関連記録 / CSV 取込の対象外判定が `config.lines` を読む、`saveLines` と `lockParents` の凍結を document に限定、entity の親への明細の作成も親を update でロック、`lines` つきの汎用更新でヘッダの更新中も `markReplacing`。
- accounting: `recurring_journal`（明細 `recurring_journal_line`）、`recurring_journal_run`、`services/recurrence.ts`（純粋: 回の日付・次回日付・按分・検査・期間に対する計画）、`hooks/recurring.ts`、`actions/generate-recurring.ts`、`actions/recurring-schedule.ts`、`actions/todo.ts`（`accounting.todo`）、`settings.ts`（`accounting.recurring_auto_submit`、category accounting、order 30）、書込み権 2 つ、メニュー「定期仕訳」、移行 `0019_recurring_journals.sql`。
- web: `pages/recurring-page.tsx`、`api/recurring.ts`、`lib/recurring.ts`、ルート `/finance/recurring`、画面カタログ、`help.ts`（06「定期仕訳を生成する」、05「定期仕訳を登録する」）、`CONVERTED`、`line-lock.ts` の `locked`、`record-form.tsx` から `recurringLineLock`。
- 文書: ADR-0031、マニュアル 05「定期仕訳を登録する」・06「定期仕訳を生成する」と月末の流れ、`00-index.md`、`appendix-n-navigation.md`、`program-map.md`、`runtime-and-data.md`、`extension-guide.md`、`docs/domain/japan-tax.md#prepaid-expense`（11-3-1 の追加、注意文の中立化）、画面写真 `docs/manual/img/06-recurring.png`（ブラウザ試験の出力、合成会社）。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] 単体 `modules/accounting/test/recurrence.test.ts` 18 件通過（毎月・3 か月ごと・毎年、日 31 / 30 / 29、2028-02-29 と 2029-02-28、2000-02-29 と 2100-02-28、開始日の日が日より後、終了日当日、按分の N 回目で終了、`lastOccurrenceDate` からの次回日付、生成後に日 15 → 31 で翌月末・開始日を生成済みの月へ動かすと翌月・周期を 3 か月ごとへ、100,000 / 12、1,000 / 3、12 / 12、11 / 12 の拒否、100.00 / 3、検査規則、期間の状態と計画、摘要、`assertCanGenerate`）。
- [実測] 単体 `kernel/test/entity-lines.test.ts` 5 件、`apps/web/src/lib/recurring.test.ts` 6 件、`duplicate.test.ts` に entity の明細の複製 1 件、`help.test.ts` に `/finance/recurring`・`/e/recurring_journal`・`/e/recurring_journal_run` を追加（見出しの存在を検査）。
- [実測] DB `kernel/test/entity-lines.db.test.ts` 7 件（置換保存・取得・版・500 行・`after_lines_saved` 1 回・凍結しない・親の update が無いと `saveLines` と直接の create / update / delete を拒否・`lines` つき更新で `isSavingLines` が true・document は確定後に凍結）。
- [実測] DB `modules/accounting/test/recurring.db.test.ts` 19 件（AC-4〜AC-21）。同時実行は `Promise.allSettled` で 2 つの `accounting.generate_recurring` を別トランザクションで同時に走らせ、両方成功・回ごとに 1 本（7 本）を確認。生成記録の 2 行目は `CONFLICT`。締めた期間・締めた年度・会計期間なし、業務エラーの回だけ取り消し（試験用 hook）、業務エラーでない例外で何も残らない、按分 12 回の合計と最終回、自動確定の on / off と月次締めガイドの下書き件数、別会社、生成記録の汎用書込みの拒否、下書きの削除で `entryId` が空（`set null`）になり作り直さない、確定した生成仕訳の逆仕訳、上限 2 本での `truncated` / `more` と続き、入力検証、outbox、予定の状態。
- [実測] DB `modules/accounting/test/todo.db.test.ts` 2 件（AC-22）。
- [実測] ブラウザ `apps/web/e2e/recurring-journals.spec.ts` 2 件通過（slot 32、chromium、`--no-deps`、約 32 秒）: 汎用フォームで明細 2 行の定期仕訳を作成（ヘッダと明細が 1 回の POST）、次回日付が読取専用、画面検索から `/finance/recurring`、予定に「生成する」、Dialog で生成、結果のリンクから下書きの仕訳を開く、読み直して「生成する定期仕訳はありません」、月次締めガイドへのリンク、390px で横はみ出しなし、英語表示、axe（ja 1280 / en 390、serious / critical なし）、viewer の直接 URL で権限の説明。※ この時点の 390px と en/390 の axe は「生成する定期仕訳はありません」の空の状態だけで、予定・確認画面・結果・定期仕訳のフォームは 390px で検査していなかった（レビューの指摘。修正セッションで範囲を広げた）。マニュアル 05・06 の手順のうち登録・生成・結果のリンクはこの試験で画面操作として実行した。
- [実測] `pnpm gate:light` 1 回目（`TEST_DATABASE_URL_*` = `daifuku_test_e2rj`、共有コンテナで負荷 7〜10、1,823 秒）: format・docs・assurance・typecheck（全体・API・Web）・lint・unit（157 files / 1,582 tests）は通過、DB は 134 files 中 2 files 失敗（`apps/api/test/boolean-migration.db.test.ts`、`apps/api/test/ext-index-migration.db.test.ts`。下の「見つけた問題」）、deploy は未実行。2 つの試験を直して単独で再実行し通過（11 tests）。
- [実測] `pnpm gate:light` 2 回目（試験の修正後）: 通過（1,673 秒、負荷 8〜10）。format・docs・assurance・typecheck（全体・API・Web）・lint・unit 157 files / 1,582 tests・DB 134 files / 850 tests（kernel の変更で全 suite）・deploy。
- [実測] 関係するブラウザ試験（slot 32、chromium、`--no-deps`）: `recurring-journals`・`close-guide`・`navigation`・`navigation-assist`・`inbox`・`settings-console`・`document-links`・`foundation-ui`・`csv-import` の 43 件中 42 件通過、6.2 分。失敗した 1 件（`navigation.spec.ts` の店舗従業員。業種テンプレートの会社を使う）は `--no-deps` で業種 project を飛ばしたためで、業種 project 込みで単独に再実行して通過（業種 3 件 + 1 件、1.9 分）。
- [レビュー] 既存の document のヘッダ hook が `isSavingLines` を読まないこと（`modules/*/src/hooks/lines.ts` などの呼出し箇所を grep）、ヘッダの再計算 hook が明細を書かないこと（grep）。kernel の変更で document の振る舞いが変わらない根拠として ADR-0031 に記した。DB の全 suite（gate:light）で回帰を確認する。
- [未検証] ~~390px での予定・確認画面・結果・定期仕訳のフォームの横はみ出しと axe~~（済: 修正セッション）。マニュアル 05 の按分の生成開始後に明細グリッドが読取専用になる表示（web 単体で理由の選択だけを確認、ブラウザでは未操作）。自動確定 on の画面表示（「生成して確定」の文言は web 単体のみ）。`accounting.todo` の受信箱での表示（provider は DB 試験、受信箱の画面は C3 の汎用表示のまま未操作）。MCP の tool としての呼出し（派生規則に従う前提、未実行）。国税庁の通達本文（proxy が nta.go.jp への接続を拒否、【未確認】のまま）。gate:full（統合担当）。

## 見つけた問題と修正（発見経路つき）

- 生成記録の `indexes: [['entryId']]` が ref の自動索引と同名で `db:schema` が失敗 — 発見: 実測（`pnpm db:schema`）、修正: 明示の索引を削除。
- 試験で取得した明細 JSON の `ext: null` をそのまま更新に送ると `VALIDATION` — 発見: 実測（DB 試験）、修正: 試験側で編集できる field だけを送る（web のグリッドは `ext` を送らないので製品の問題ではない）。
- 別会社の生成試験で会計年度を開いていなかった — 発見: 実測（DB 試験）、修正: 試験の準備に会計年度を追加。
- 新規画面では serverOwned の次回日付が入力欄に出ない（試験の前提違い）、390px では言語切替がヘッダの外 — 発見: 実測（ブラウザ試験）、修正: 試験を直した。
- 既存の移行試験 2 つ（0016 の ext 索引、0017 の真偽値列）が、移行の前後で public の全制約を比べていたため、表を足す後の移行（0018）で必ず失敗した — 発見: 実測（gate:light の DB）、修正: 試験を直した（規則 8）。移行前からある関係（表）の制約は従来どおり完全一致を求め、後の移行が足した表の制約だけを比較から外す（commit「test(api): compare only pre-existing relations' constraints after legacy upgrades」）。試験の意図（既存の値・版・設定・制約を変えない）は弱めていない。
- 次回日付の計算で、生成後に日や開始日を変えると同じ月に 2 回目ができる（spec 査読の指摘）— 発見: レビュー（critic）、修正: 月で比べる規則と単体試験。

## 未実施（減らさない。完了したら「済」を付けて残す）

- gate:full とブラウザの全 suite（統合担当）。
- 統合時: ADR 番号の衝突確認（B6 の 0030）、移行番号 0018 の衝突確認（round 4 の B2 も移行を足す見込み）、`router.tsx` と `navigation-data.ts` の併合。
- D3 統合後: 定期仕訳の `views.form` をラベル付きグループ（基本 / 周期 / 按分 / 生成の状況）へ。
- 国税庁の通達本文（消費税法基本通達 11-3-1・11-3-8、法人税基本通達 2-2-14）の確認と【未確認】の解除。

## 判断待ち（利用者）

- spec の未決事項 1〜5 のまま（特定の回の作り直し、月次締めガイドへの未生成の定期仕訳の表示、複数行の按分、洗替え、通達本文）。推奨の既定で実装した。

## 次のセッションへ

- entity の明細（ADR-0031）は他のマスタ（レシピなど）にも使える。履歴に効く値を守るのは各 module の hook。
- 定期実行は F1（worker）の後。`generateRecurring(ctx, { asOf }, { maxEntries })` を worker から呼べる形にしてある。

## レビュー指摘への対応（2026-10-30、修正担当 agent、同じ worktree・branch）

spec・安全性・UX の 3 観点のレビュー指摘 21 件（重複 2 件を含み、内容は 19 件）をコードと照らして確かめ、すべて妥当と判断した。直したもの 18 件、記録だけにしたもの 1 件（直接の明細書込みの検査、下記）。却下なし。

- [major・spec] AC-10 の同時実行の試験が「どちらの実行も競合だけを理由に失敗しない」を確かめていなかった（系列ロックと行ロックを外しても、一意キーが後の実行の定期仕訳を `failed` にするだけで試験は通った）。修正: 両方の結果に `generated` 以外の定期仕訳が無いこと、`created: 0` の実行が `templates: []`（先の実行の確定後に対象を読んだ）であることを足した。発見: レビュー（変異）。確認: `generate-recurring.ts` の `withLock` と行ロックを外した変異で、この試験が `['同時A', 'failed', …]` で失敗することを実測した（元に戻して成功）。
- [minor・spec / minor・safety（重複）] AC-17 と作業記録は「汎用の create / update / delete は `INVALID_STATE`」と書いていたが、汎用の create は hook に届く前に kernel の検査で止まる（server-owned の field を送れば `PERMISSION_DENIED`、送らなければ `VALIDATION`）。`before_create` の拒否はどの試験にも通らず、登録を消しても試験は通った。修正: AC-17・決定 14 (7)・この記録の文言を実装に合わせた。DB 試験は、field なしの create が `VALIDATION` であることを確かめ、登録された `recurring_journal_run` の hook を直接呼んで、生成の外の create を `INVALID_STATE` で拒否し、生成の書込み権の中では create だけを通すことを確かめる。確認: `before_create` の登録を消した変異で `no guard registered` により失敗することを実測。
- [nit・safety] `runGuard` の update / delete が「生成の書込み権を持つか」だけを見ていた（書込み権は create だけを許す）。修正: `isRecurringRunWrite(ctx, op)` で守る操作の書込み権を見る。生成の中でも update / delete は拒否される（上の試験で確認）。
- [minor・spec] AC-9 の拡張 field（共有の key だけを写す）に試験が無かった。修正: 試験の先頭でヘッダ・明細の両側に共有の key と片側だけの key を `registerExt` し、生成した仕訳のヘッダが `{ department }`、明細が `[{ costCenter }, {}]` だけを持つことを確かめた。確認: `postingDimensions` を通さず ext をそのまま写す変異で失敗することを実測。
- [nit・spec / nit・safety（重複）] AC-20 の「取り消した回のイベントが残らない」の assertion が成り立ちえない条件（`entryId === undefined`）で、決して失敗しなかった。修正: その確認を AC-12 の試験へ移し、失敗する定期仕訳の outbox のイベントが生成できた回（2026-08-31）だけであることを確かめる。イベントは回の savepoint の最後の手順なので、手前で失敗した回はイベントに届かないことを試験のコメントに書いた（イベントの後で失敗する手順は無いので、savepoint の取消でイベントが消えることそのものは試験していない）。
- [nit・spec] 明細 entity への直接の書込みは AC-7 の明細の規則で検査しない。記録だけにした（spec 決定 14 (6)）: 1 行ずつ作る途中は必ず規則を満たさないため、行ごとに検査すると直接の書込みで明細を組み立てられない。不正な明細は生成で `invalid_template` として止まり、予定にも理由つきで出る（下の UX の修正）。
- [nit・spec] 決定 1 の ADR 番号が 0030 のままだった。修正: 0031 に直した。
- [major・ux] 生成に成功すると、予定の読み直しで開き元の「下書きを生成」が無効になり、ダイアログが焦点を戻せず `<body>` に落ちた。修正: kit の `FormSection` に `headingRef`（見出しを `tabIndex=-1` にして script から焦点を移せる）を足し、結果が出たら結果の見出しへ焦点を移す。ブラウザ試験に焦点の確認を足し、移す処理を消した変異でこの assertion が失敗する（`inactive`）ことを実測した。`docs/conventions/ui.md` の `FormSection` の行と「押した要素が消える操作の焦点」に追記、kit の unit 試験を 1 件追加。
- [major・ux] AC-25 の確認が空の状態だけだった。修正: ブラウザ試験を、期日の回がある予定を 390px で横はみ出し確認 → 確認の `Dialog` を開いて横はみ出し確認と axe（ja/390）→ 390px のまま生成 → 結果と空の状態で横はみ出し確認と axe（ja/390）→ 保存した定期仕訳のフォーム（明細 2 行。グリッドは自分の枠の中で横に送り、中に入力欄があるので枠は Tab の止まりにならない）を 390px で横はみ出し確認と axe → 英語の空の状態を 390px で横はみ出し確認と axe、の順に直した。コメントと上の [実測] の範囲も直した。
- [発見・修正] 上のフォームの axe で、記録画面の監査ログの表（`components/audit-panel.tsx`、全 entity 共通）の横スクロール枠が `scrollable-region-focusable`（serious）になった。中に焦点を受ける要素が無いのに枠が Tab で止まらず、390px で横に送れない。発見: 実測（修正後のブラウザ試験）。修正: `docs/conventions/ui.md` の横に流れる枠の規則どおり、枠に `tabIndex=0`・`role="region"`・`aria-label`（「監査ログの表」/ "Audit log table"）を付けた。既存の記録画面すべてに効く（spec 決定 14 (8)）。
- [minor・ux] 予定の「止まる」「定期仕訳の内容に誤り」の行は理由だけで、ヒントもサーバーが送る検査の要約（`detail`）も出ず、期日の回が無く実行ボタンが押せないと何を直せばよいか分からなかった。修正: 行の下に日英のヒント（`lib/recurring.ts scheduleRowHint`。按分の行は按分向けの助言）と、`detail` があれば閉じた技術情報を出す（AC-23 に追記、Web unit 1 件）。ブラウザでの表示は未操作。
- [minor・ux] マニュアルの画面写真が古い版の画面（区画の見出しが「基準日」、toast が重なる）だった。修正: 修正後のブラウザ試験の出力（toast が消えてから 1280px で撮影）で `docs/manual/img/06-recurring.png` を差し替えた。
- [minor・ux] マニュアル 03 の会社設定の表と付録 N の受信箱の表に、新しい設定と提供元が無かった。修正: 行を足した。
- [minor・ux] `docs/conventions/ui.md` の明細グリッドの行が document だけを書き、マニュアル 02 も伝票だけを書いていた。修正: entity の明細（ADR-0031）、読取専用になる条件（親を更新できない、下書きでない document、`lib/line-lock.ts` の `locked` による entity ごとの凍結）を書き、02 に定期仕訳を足した。
- [minor・ux] マニュアル 05・06 の定期仕訳の節に検証の記載が無かった。修正: ブラウザ試験・DB 試験で確かめた範囲と未検証の範囲を各章の末尾に書いた。
- [minor・ux] AC-24 の「実行できない利用者には画面検索・分野一覧に出さない」に直接の試験が無かった。修正: `navigation.test.ts` の専用画面の表に `accounting.generate_recurring` → `/finance/recurring`（finance）を足し、viewer のブラウザ試験で画面検索に定期仕訳の一覧は出て生成の画面は出ないことを確かめた。spec の AC-24 の検証の記述も直した。
- [nit・ux] 使われていない `RECURRING_PATH`・`entryHref`・`templateHref` を削除した（画面は `<Link to="/e/$entity/$id">` でリンクを作る）。
- [nit・ux] マニュアル 06 の状態の説明が 3 つだった。修正: 「定期仕訳の内容に誤り」を分けて 4 つにした。
- [nit・ux] 不正な日付のエラーが入力欄に結び付いていない、英語でも全角の括弧、番号の無い下書きのリンクの横に同じ日付が重複。修正: `aria-describedby`、`periodSuffix`（英語は ` (code)`）、下書き（番号なし）では日付の span を出さない。
- [nit・ux] 画面の説明が「下書きで作ります」と言い切っていた。修正: 「（既定は下書き）」にした。生成記録の画面の説明リンク（05「定期仕訳を登録する」）は、その節に生成記録の 1 段落を足して対応させた（対応表は変えない）。

検証（修正後）:

- [実測] DB `modules/accounting/test/recurring.db.test.ts` 19 件成功（`daifuku_test_e2rj`、約 10 秒）。変異 3 種（ロックを外す、`before_create` の登録を消す、ext をそのまま写す）でそれぞれ該当の試験だけが失敗することを確かめ、元に戻した。
- [実測] Web unit: `navigation.test.ts`・`recurring.test.ts`・`ui-kit.test.ts`・`help.test.ts`・`token-usage.test.ts` の 5 ファイル 241 件成功。
- [実測] ブラウザ `apps/web/e2e/recurring-journals.spec.ts` 2 件成功（slot 32、chromium、`--no-deps`、38 秒）。1 回目は保存した定期仕訳のフォームの axe で監査ログの枠の違反（上記）で失敗し、直して成功。結果の見出しへ焦点を移す処理を消した変異で失敗することも確かめた。
- [実測] `node scripts/gate.mjs --tier light --base b63a833`（修正前の最後の commit と比べる。`daifuku_test_e2rj`、共有コンテナで負荷 5〜16、1,560 秒）: format・docs・assurance・typecheck（root / API / Web）・lint（警告 5 件はすべて既存の別画面の関数長）・unit 157 files / 1,584 tests は成功。DB は 90/134 files 中 1 件（`apps/api/test/boolean-migration.db.test.ts` の 1 試験）が `out of shared memory`（共有サーバーの lock 表不足）で失敗し、deploy は未実行になった。その suite を単独で再実行して 9 件成功、`pnpm test:deploy` を単独で実行して 17 件成功。
- [実測] 関係するブラウザ試験（slot 32、chromium、`--no-deps`）: `recurring-journals`・`smoke`（監査ログの表）・`a11y`・`ui-kit`・`foundation-ui`・`close-guide` の 53 件成功（3.6 分）。
- [未検証] `pnpm gate:full` とブラウザの全件（統合担当）。予定の「止まる」「定期仕訳の内容に誤り」の行のヒントと技術情報のブラウザでの表示（Web unit で文言の選択だけを確認）。監査ログの枠が Tab で止まることの実際のキーボード操作（axe の結果で確認）。
