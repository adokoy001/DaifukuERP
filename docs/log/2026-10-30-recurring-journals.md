# 作業記録: 2026-10-30 recurring-journals（定期仕訳と前払費用の按分、E2）

- セッション: 実装セッション（workflow wf_194f8c9f-d8d、round 5、worktree `wf_194f8c9f-d8d-2`、ブランチ `wip/recurring-journals`）／ 担当: agent ／ 対象: [docs/specs/recurring-journals.md](../specs/recurring-journals.md)
- 計測: tokens=null, agent_minutes=115, human_minutes=0, rework_lines=40, gate_failures=1（1 回目の gate:light の DB で既存の移行試験 2 件。下の「検証」）

## 決めたこと（と理由）

- **spec 査読の 12 件をすべて採用**し、spec の決定 13 に記録した（不採用なし）。主なもの: ヘッダと明細を 1 回で送る更新の検査は kernel の印（汎用の更新が `lines` を持つ間はヘッダの更新中も置換中）で解く案 (a)、生成後に日・開始日・周期を変えた定額の次回日付は「`lastOccurrenceDate` の月より後の月」（全周期が 1 か月以上なので月で比べれば足り、規則を変えない限り従来の「日付が後」と同じ）、entity の親への直接の明細書込みは親の update でロック、按分で凍結する明細の field は行の集合・`accountId`・`debit`・`credit` に限定、止まった理由は画面が日英に変換、`endDate` ≥ `startDate`、仕訳の create / submit の事前確認は出荷時のロールでは失敗しないので単体試験の多重防御、通達 11-3-1 の追加。
- **ADR 番号は 0031**。同じ round の opening-balances（B6、worktree `wf_194f8c9f-d8d-1`）が `0030-opening-balances.md` を使っていたため。統合時に衝突したら統合担当が振り直す。
- **AC-7 (3) の範囲を狭めた**（spec 決定 14）: ヘッダだけの更新で明細の規則を検査するのは、明細の規則に効く種類・按分回数を変えたときだけで、保存済みの明細が無ければ検査しない。CSV 取込でヘッダだけ作った定期仕訳の名称を変えるたびに「明細 2 行以上」で拒否されるのを避けるため。ヘッダの規則は毎回検査する。
- **重複防止の三重化**: 会社ごとの系列ロック `accounting-recurring`（対象を読む前）、定期仕訳の行ロック（id 順）、生成記録の一意キー（`templateId`, `occurrenceDate`）。後の実行は先の実行の確定を待ってから対象を読み直すので、競合だけでは失敗しない。
- **回ごとの savepoint**（kernel の `withSavepoint`）。`DaifukuError` はその回だけ取り消して定期仕訳を止め、他の例外は実行全体を失敗させる。期間の判定は `assertOpenPeriod` をそのまま呼び（同じ advisory lock）、エラーの `details` から `closed_period` / `closed_year` / `no_period` を決める。
- **カーソル書込み**（`lastOccurrenceDate`）は module 専用の書込み権 `accounting.recurring_cursor` で行い、`before_update` hook はこの書込みでは検査を省いて次回日付だけを求める（生成の開始時に検査済み）。生成記録は `accounting.recurring_run` の書込み権の中だけで作れ、汎用の作成・更新・削除は hook が admin を含めて `INVALID_STATE` で拒否する（`contract_billing` と同じ形）。
- **按分の端数**: `total.div(N).roundDown(scale)` を 1〜N−1 回目、残りを N 回目。回番号は日付から決まり、同じ回は何度計算しても同じ額（AC-13）。
- **生成の応答に `kind` を足した**（画面が按分向けの助言を選ぶため）。予定（`accounting.recurring_schedule`）の理由はコードだけにし、検査の要約（英語）は別の列 `detail`。
- **画面**: `/finance/recurring` は月次締めガイドと同じく finance client（`useFinanceCommand`）を使い、予定の key を `['finance', identity, ...]` に置いて生成後に読み直させた。予定は 390px で横にはみ出さないよう表ではなく折り返す一覧にした。テンプレートの編集は汎用の一覧・フォームのまま（明細グリッドは entity の明細で自動的に出る）。按分の生成開始後は `recurringLineLock` でグリッドを理由つきの読取専用にした（サーバー側の拒否が正）。
- **D3（form-ergonomics、未統合）への hook**: spec のとおり、`views.form` は従来の配列の形で書いた（基本 / 周期 / 按分 / 生成の状況の 4 群）。D3 統合後にラベル付きグループへ移す。

## やったこと

- kernel（ADR-0031）: `EntityConfig.lines`、`lineSpecs` / `lockParents` / `assertAggregateLimit` / `hasLines` / `EntityMeta.lines` / 関連記録 / CSV 取込の対象外判定が `config.lines` を読む、`saveLines` と `lockParents` の凍結を document に限定、entity の親への明細の作成も親を update でロック、`lines` つきの汎用更新でヘッダの更新中も `markReplacing`。
- accounting: `recurring_journal`（明細 `recurring_journal_line`）、`recurring_journal_run`、`services/recurrence.ts`（純粋: 回の日付・次回日付・按分・検査・期間に対する計画）、`hooks/recurring.ts`、`actions/generate-recurring.ts`、`actions/recurring-schedule.ts`、`actions/todo.ts`（`accounting.todo`）、`settings.ts`（`accounting.recurring_auto_submit`、category accounting、order 30）、書込み権 2 つ、メニュー「定期仕訳」、移行 `0018_recurring_journals.sql`。
- web: `pages/recurring-page.tsx`、`api/recurring.ts`、`lib/recurring.ts`、ルート `/finance/recurring`、画面カタログ、`help.ts`（06「定期仕訳を生成する」、05「定期仕訳を登録する」）、`CONVERTED`、`line-lock.ts` の `locked`、`record-form.tsx` から `recurringLineLock`。
- 文書: ADR-0031、マニュアル 05「定期仕訳を登録する」・06「定期仕訳を生成する」と月末の流れ、`00-index.md`、`appendix-n-navigation.md`、`program-map.md`、`runtime-and-data.md`、`extension-guide.md`、`docs/domain/japan-tax.md#prepaid-expense`（11-3-1 の追加、注意文の中立化）、画面写真 `docs/manual/img/06-recurring.png`（ブラウザ試験の出力、合成会社）。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] 単体 `modules/accounting/test/recurrence.test.ts` 18 件通過（毎月・3 か月ごと・毎年、日 31 / 30 / 29、2028-02-29 と 2029-02-28、2000-02-29 と 2100-02-28、開始日の日が日より後、終了日当日、按分の N 回目で終了、`lastOccurrenceDate` からの次回日付、生成後に日 15 → 31 で翌月末・開始日を生成済みの月へ動かすと翌月・周期を 3 か月ごとへ、100,000 / 12、1,000 / 3、12 / 12、11 / 12 の拒否、100.00 / 3、検査規則、期間の状態と計画、摘要、`assertCanGenerate`）。
- [実測] 単体 `kernel/test/entity-lines.test.ts` 5 件、`apps/web/src/lib/recurring.test.ts` 6 件、`duplicate.test.ts` に entity の明細の複製 1 件、`help.test.ts` に `/finance/recurring`・`/e/recurring_journal`・`/e/recurring_journal_run` を追加（見出しの存在を検査）。
- [実測] DB `kernel/test/entity-lines.db.test.ts` 7 件（置換保存・取得・版・500 行・`after_lines_saved` 1 回・凍結しない・親の update が無いと `saveLines` と直接の create / update / delete を拒否・`lines` つき更新で `isSavingLines` が true・document は確定後に凍結）。
- [実測] DB `modules/accounting/test/recurring.db.test.ts` 19 件（AC-4〜AC-21）。同時実行は `Promise.allSettled` で 2 つの `accounting.generate_recurring` を別トランザクションで同時に走らせ、両方成功・回ごとに 1 本（7 本）を確認。生成記録の 2 行目は `CONFLICT`。締めた期間・締めた年度・会計期間なし、業務エラーの回だけ取り消し（試験用 hook）、業務エラーでない例外で何も残らない、按分 12 回の合計と最終回、自動確定の on / off と月次締めガイドの下書き件数、別会社、生成記録の汎用書込みの拒否、下書きの削除で `entryId` が空（`set null`）になり作り直さない、確定した生成仕訳の逆仕訳、上限 2 本での `truncated` / `more` と続き、入力検証、outbox、予定の状態。
- [実測] DB `modules/accounting/test/todo.db.test.ts` 2 件（AC-22）。
- [実測] ブラウザ `apps/web/e2e/recurring-journals.spec.ts` 2 件通過（slot 32、chromium、`--no-deps`、約 32 秒）: 汎用フォームで明細 2 行の定期仕訳を作成（ヘッダと明細が 1 回の POST）、次回日付が読取専用、画面検索から `/finance/recurring`、予定に「生成する」、Dialog で生成、結果のリンクから下書きの仕訳を開く、読み直して「生成する定期仕訳はありません」、月次締めガイドへのリンク、390px で横はみ出しなし、英語表示、axe（ja 1280 / en 390、serious / critical なし）、viewer の直接 URL で権限の説明。マニュアル 05・06 の手順のうち登録・生成・結果のリンクはこの試験で画面操作として実行した。
- [実測] `pnpm gate:light` 1 回目（`TEST_DATABASE_URL_*` = `daifuku_test_e2rj`、共有コンテナで負荷 7〜10、1,823 秒）: format・docs・assurance・typecheck（全体・API・Web）・lint・unit（157 files / 1,582 tests）は通過、DB は 134 files 中 2 files 失敗（`apps/api/test/boolean-migration.db.test.ts`、`apps/api/test/ext-index-migration.db.test.ts`。下の「見つけた問題」）、deploy は未実行。2 つの試験を直して単独で再実行し通過（11 tests）。
- [実測] `pnpm gate:light` 2 回目（試験の修正後）: 通過（1,673 秒、負荷 8〜10）。format・docs・assurance・typecheck（全体・API・Web）・lint・unit 157 files / 1,582 tests・DB 134 files / 850 tests（kernel の変更で全 suite）・deploy。
- [実測] 関係するブラウザ試験（slot 32、chromium、`--no-deps`）: `recurring-journals`・`close-guide`・`navigation`・`navigation-assist`・`inbox`・`settings-console`・`document-links`・`foundation-ui`・`csv-import` の 43 件中 42 件通過、6.2 分。失敗した 1 件（`navigation.spec.ts` の店舗従業員。業種テンプレートの会社を使う）は `--no-deps` で業種 project を飛ばしたためで、業種 project 込みで単独に再実行して通過（業種 3 件 + 1 件、1.9 分）。
- [レビュー] 既存の document のヘッダ hook が `isSavingLines` を読まないこと（`modules/*/src/hooks/lines.ts` などの呼出し箇所を grep）、ヘッダの再計算 hook が明細を書かないこと（grep）。kernel の変更で document の振る舞いが変わらない根拠として ADR-0031 に記した。DB の全 suite（gate:light）で回帰を確認する。
- [未検証] マニュアル 05 の按分の生成開始後に明細グリッドが読取専用になる表示（web 単体で理由の選択だけを確認、ブラウザでは未操作）。自動確定 on の画面表示（「生成して確定」の文言は web 単体のみ）。`accounting.todo` の受信箱での表示（provider は DB 試験、受信箱の画面は C3 の汎用表示のまま未操作）。MCP の tool としての呼出し（派生規則に従う前提、未実行）。国税庁の通達本文（proxy が nta.go.jp への接続を拒否、【未確認】のまま）。gate:full（統合担当）。

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
