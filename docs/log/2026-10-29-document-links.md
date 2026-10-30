# 作業記録: 2026-10-29 伝票の複製・関連伝票・クイック操作（C2）

- セッション: 完成度向上計画 C2（workflow の作業項目、worktree `wip/document-links`）／ 担当: agent ／ 対象: [docs/specs/document-links.md](../specs/document-links.md)
- 計測: tokens=null（未計測）, agent_minutes=約165, human_minutes=0, rework_lines=約70（DB テスト・ブラウザ試験の期待値と手順の修正 約40、レビューでの修正 約30）, gate_failures=1（`gate:light` の DB 1 suite が PostgreSQL の共有メモリ不足で失敗。下記）。レビュー指摘の修正（2026-10-30、修正担当）: agent_minutes=約75、rework_lines=731（kernel / apps のコードとテストの変更行）、gate_failures=0

## 決めたこと（と理由）

- **関連は registry の宣言だけから求める。** `ref` field に加え、同じ entity の `<x>Entity`（text / enum）+ `<x>Id`（uuid / text）の組を辿る。入金の消込明細（`payment_allocation.invoiceEntity/invoiceId`）と仕訳の起票元（`journal_entry.sourceEntity/sourceId`）は `ref` ではないため、`ref` だけでは「請求書 → 入金」「仕訳 → 起票元」が出ない。既存の 6 entity（入金の消込明細、仕訳、在庫の入出庫・元帳・期間締め、添付）が同じ命名なので、DSL を拡張せず命名規約として読む（DSL 拡張は 6 module の entity 定義を変え、並行作業との衝突も増える）。規約は [データと処理経路](../architecture/runtime-and-data.md#関連記録の読取) に書いた。新しい ADR は作らない（既存の読取権限の組合せで、新しい書込経路・port はない）。2026-10-30 のレビュー指摘で、ADR-0009 の汎用 action の一覧に `<entity>.related` と組の規約を追記した（下記）。
- **明細は親の一部として扱う。** 明細が指す記録は親の「参照先」、記録を指す明細は親 document として「参照元」に出す（入金の消込明細 → 入出金）。自分自身の明細は関連に出さない（フォームに表示済み）。
- **読取はすべて `Repository` と呼出者の `Context`。** 関連 entity ごとに `can(read)` を確かめ、連結 field が mask / outputHidden なら group ごと出さない（`where` に使うと `assertReadableFields` が拒否するうえ、件数から mask された値を推測できるため）。行の権限・会社/拠点/店舗は `list` / `find` の可視条件で効く。会社のない文脈では会社単位の entity を読まない（`scopeCondition` が例外を出すため）。
- **件数は entity ごとに 50、超えたら `more: true`。** 対象 id の数ではなく「読める行」の総数で判定する（読めない行の存在を `more` で漏らさない）。訂正の連鎖は各方向 50 段まで。
- **逆仕訳（2 段先）は出さない。** 逆仕訳は `reversalOf` で元の仕訳を指し、`sourceEntity` は空なので請求書を直接指さない。請求書 → 仕訳 → 逆仕訳と辿る（仕訳の関連に出る）。module 固有の展開を kernel に入れない。
- **派生 action は `kernel/src/actions/related.ts` の `registerRelatedActions()` を `registerCrudActions()` の末尾で 1 回呼ぶ。** 既存の全テスト・app が `registerCrudActions()` を呼んでいるので、各所に呼出しを足さずに全 entity へ派生する。B5（import）・C1（export）も同じ場所に 1 行ずつ足す想定で、衝突しても 1 行。
- **複製の「unique」を Web に渡すため `FieldMeta.unique` を足した。** field の `unique`、1 列の複合 unique、`naming: { type: 'field' }` の field に付く（true のときだけ出すので既存の meta の形は変わらない）。複数列の複合 unique（例 `propertyId + code`）は持ち越し、保存時の CONFLICT で知らせる（どの列を外すべきか汎用には決められない）。
- **複製の日付: 既定値のある date field は今日、ほかの date field は空欄。** 支払期日は空欄なら保存時に取引先の条件から計算されるので、古い期日を持ち越すより安全。元の日付はフォーム上のお知らせに出す。spec の未決事項に「利用者の確認待ち」として残した。
- **初期値は router の history state で渡す（`draftSeed`）。** URL に業務値を載せない。再読込しても残る。`seedFromState` が形と entity を検査し、別 entity や壊れた state は無視する。2026-10-30 から、seed は作ったセッション（テナント・利用者・会社）を持ち、違うセッションでは使わない（下記）。`RecordForm` は seed を基準値にするので、開いた直後は「未保存の変更」にならず、利用者の編集だけが dirty になる（`data-dirty=false` をブラウザで確認）。保存後は `/new` の履歴を置き換え、戻るで初期値入りのフォームを開き直さない。
- **AC-7: 押したときに元の記録を読み直す（`cache: 'no-store'`）。** 失敗（権限の喪失・削除）なら開かずに理由をトーストで出す。版が表示中と違えば開かずに最新を読み込み、理由を出す（見ていない内容を複製しない）。
- **クイック操作は「確定済み かつ 残高 > 0」。** 入金済みの請求書に「入金を記録」を出しても消込が拒否されるだけなので出さない。初期値は区分・取引先・今日・残高・消込明細 1 行（請求書・残高）。入出金科目は利用者が選ぶ（会社設定の既定はサーバー側で入るが、フォームの必須表示に合わせて選ばせる）。
- **関連パネルの query key**: 当初は記録の key の下（`['record', entity, id, 'related']`）に置いたが、保存・確定の完了が関連の読込を待つため、2026-10-30 に `['related', entity, id, version]` へ分けた（下記）。失敗はパネル内だけ（`role="alert"` にしない。トーストやフォームの alert と重ねない）。伝票状態は `data-testid="docstatus"` を画面に 1 つに保つ（既存の e2e が strict mode で使っている）。当初は独自の Badge だったが、2026-10-30 に `DocstatusBadge` へ `testId` を渡す形にした。document の group を先に並べる（スクリーンショットで勘定科目・取引先が先頭に来て読みにくかったため）。
- **`queries.ts` / `strings.ts` は触らない。** C1・D2 が並行で編集するため、hook は `api/related.ts`、文言は各部品の `{ ja, en }` に置いた。`entity-form-page.tsx` の変更は import・props・3 か所の差し込みに留めた（D2 の最近の記録と衝突しにくくする）。

## やったこと

- kernel: `kernel/src/related.ts`（`relatedRecords`、`linkSpecs`、`RELATED_LIMIT`）、`kernel/src/actions/related.ts`（`<entity>.related`、出力 schema）、`registerCrudActions()` から登録、`kernel/src/meta.ts`（`FieldMeta.unique`）、`kernel/src/index.ts`
- api: `GET /api/:entity/:id/related`（`apps/api/src/routes/rest.ts`、action へ委譲）
- web: `api/related.ts`（`useRelated`、`fetchFreshRecord`）、`lib/duplicate.ts`（`duplicateSeed`、`isCopyable`、`seedFromState`、`seededValues` / `seededLines`）、`lib/quick-actions.ts`（`QUICK_ACTIONS`、`quickActionsFor`、`quickActionSeed`）、`components/related-panel.tsx`、`components/record-links.tsx`（複製・クイック操作のボタン、`SeedNotice`、`useDraftSeed`）、`record-form.tsx`（`initial`）、`entity-form-page.tsx`、`api/types.ts`（`FieldMeta.unique`）、`ui/token-usage.test.ts` の `CONVERTED` に新しい 2 部品
- テスト: `kernel/test/related.db.test.ts`（9 件、修正後 11 件）、`apps/api/test/related.db.test.ts`（4 件、修正後 5 件）、`apps/web/src/lib/duplicate.test.ts`（8 件、修正後 10 件）、`apps/web/src/lib/quick-actions.test.ts`（4 件）、`apps/web/e2e/document-links.spec.ts`（5 件、修正後 7 件）
- 文書: spec（状態 implemented、受入基準の具体化、実装時の変更点）、`docs/manual/02-basics.md`「複製と「関連」」、`docs/manual/05-daily.md`（請求書の複製、請求書から入金・支払を記録）、`docs/conventions/ui.md`「複製・関連・クイック操作」、`docs/architecture/runtime-and-data.md`「関連記録の読取」

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] `pnpm gate:light`（kernel の変更で DB を全 118 suite に拡大）: 1,126 秒。format・docs・assurance・typecheck（root / api / web）・lint・unit（133 ファイル 1,223 件）は成功。DB は 117/118 suite 成功（712 件成功、2 件 skip）。失敗した 1 suite は `packs/real-estate/test/lease-period.db.test.ts` の `beforeAll` で、`DROP SCHEMA public CASCADE` が PostgreSQL `53200 out of shared memory`（`max_locks_per_transaction`）で失敗し、2 件が skip になった。同時刻の負荷は load average 約 9.8（他の agent の DB suite と共有）。同じ suite を単独で再実行すると成功（下記）。配備補助（deploy）は light では前段の失敗で未実行のため、最後の `gate:quick` で実行した。
- [実測] 再実行: `lease-period.db.test.ts`（2 件）、`kernel/test/related.db.test.ts`（9 件）、`apps/api/test/related.db.test.ts`（4 件）の 3 suite 15 件が成功（21.6 秒）。DB 件数は基準の 701 件 + 今回の 13 件 = 714 件。
- [実測] 最後の `pnpm gate:quick`（全変更に対して）: 成功（211.6 秒）。format・docs・assurance・eslint・boundaries・typecheck（root / api / web）・unit 全件・deploy。`record-links.tsx` の読み直し処理の整理と AC-4 のブラウザ試験は `gate:light` の typecheck / unit の後に変えたため、この `gate:quick` とブラウザ試験で確かめた。
- [実測] 新しい DB テスト: kernel 9 件（4.1 秒）— 順参照・逆参照・`<x>Entity`/`<x>Id` の両方向・明細の親への置換・自分の明細を出さない・訂正の連鎖（3 版）・50 件上限（順参照 52 品目、逆参照 53 メモ）・読めない entity と mask された連結 field の除外・行の権限（入出金の区分、取引先の担当者）・別会社の uuid 連結が出ない・会社なしの文脈・派生 action の PERMISSION_DENIED / NOT_FOUND。API 4 件（11.5 秒）— 実 module で確定請求書・入金・仕訳・訂正、sales 利用者での読取、REST の 403 / 404 / 400。
- [実測] 新しい Web unit: `duplicate.test.ts` 8 件、`quick-actions.test.ts` 4 件（0.5 秒）。seed から `planSave` が作る作成 body（明細は id なし、`number` / `status` / `journalEntryId` / unique なし）まで確かめた。
- [実測] ブラウザ試験（slot 23、隔離 fixture DB、`--no-deps`）: `document-links.spec.ts` 5 件と、汎用フォームを使う `payment` / `phase1` / `phase15` / `foundation-ui` / `smoke` / `ui-kit` / `quality-read-recovery` の計 29 件が成功（2.6 分）。それ以前に `quality-ref-search` / `navigation` / `company-context` を含む 37 件を実行し 36 件成功。失敗した `navigation AC-3/10` は飲食店の会社（industry project が作る）を前提とする試験で `--no-deps` のため。industry project 込みで `navigation.spec.ts` を実行し 8 件成功（1.1 分）。
- [実測] 関連の応答時間（API の DB テストと同じ構成、請求書 21 件の小さなデータ、一時的な計測用テストで測定し削除）: 1 回あたり 売上請求書 37 ms、入出金 22 ms、取引先 34 ms、売掛金の科目 40 ms。同じ請求書の `GET /api/sales_invoice/:id` は 8 ms。
- [目視] ブラウザ試験のスクリーンショット（デスクトップの見出しと関連パネル、390px の見出しと関連パネル）。390px で見出しの操作が折り返し、横スクロールが無いことは `assertNoOverflow` で実測。
- [実測] レビュー指摘の修正後（2026-10-30）の `pnpm gate:light`（同じ `daifuku_test_w29`、kernel の変更で DB 全件）: 成功、1,442 秒。format・docs・assurance・typecheck（root / api / web）・lint（警告 4 件は既存の関数行数）・unit 133 ファイル 1,225 件・DB 118 suite 717 件（1,219 秒、load average 5〜8）・deploy。DB 件数は 714 + kernel 2 + API 1。セッションの試験（ブラウザ）と文書の一部はこの実行の静的検査の後に足したため、そのあと `format:check`・`docs:check`・typecheck を個別に実行した（下記）。
- [実測] 修正後のブラウザ試験（slot 23、隔離 fixture DB、`--no-deps`）: `document-links.spec.ts` 7 件が成功（48 秒）。続けて `payment` / `phase1` / `phase15` / `foundation-ui` / `smoke` / `ui-kit` / `quality-read-recovery` と合わせて 31 件が成功（3.1 分）。`DocstatusBadge`・`entity-form-page.tsx` を変えたため汎用フォームの試験も含めた。
- [実測] 修正前の実装で新しい試験が失敗すること: kernel の DB テスト 2 件（項目ごとの連結 field、明細を指す明細）は修正前の `related.ts` で失敗、修正後に成功。ブラウザのセッション試験は owner の検査を外すと `seed-notice` が表示されて失敗。
- [目視] 修正後のスクリーンショット（関連パネル。document の group が先、連結 field の表示）。
- [未検証] `pnpm gate:full`（統合担当）。大量データでの関連の応答時間。スクリーンリーダーでの読み上げ（axe の自動検査は A2）。会社の切替後に「戻る」で seed を使わないこと（単体テストだけ）。

## 見つけた問題と修正（発見経路つき）

- API の DB テストで「取消した請求書の関連に仕訳が 2 件（転記と逆仕訳）」と期待したが 1 件だった — 発見: DB テスト（実測）。逆仕訳は `reversalOf` で仕訳を指し請求書を指さないため。期待値を「請求書 → 転記仕訳、転記仕訳 → 逆仕訳」に直し、spec のスコープ外に 2 段先を明記した（テストを弱めたのではなく、誤った前提を直した）。
- 同テストの仕入請求書の明細に勘定科目が無く作成できなかった — 発見: DB テスト、修正: 費用科目を指定。
- ブラウザ試験 AC-7 の 2 段目で、読み直しを止める route が画面自身の記録の取得まで止めていた — 発見: E2E（1 回目、負荷の高い時間帯に 2.3 分）、修正: 画面の表示を待ってから route を張る。
- ブラウザ試験 AC-8 で 390px のときに言語切替を探していた（切替はデスクトップのサイドバーにある）— 発見: E2E、修正: 1280px で切り替えてから 390px に戻す。
- 関連パネルで勘定科目・取引先が先頭に並び、仕訳・入金が下に埋もれた — 発見: スクリーンショットの目視、修正: document の group を先に並べる。
- 初期値から保存した後に「戻る」で初期値入りのフォームが再表示され、二重作成を招く — 発見: レビュー、修正: 保存後の遷移で `/new` の履歴を置き換え、E2E で戻り先を確認。
- 会社のない文脈で会社単位の entity を読むと `scopeCondition` が例外を出し、関連の取得全体が失敗する — 発見: レビュー、修正: 会社単位の entity は会社のある文脈だけ読む。DB テスト（tenant 単位の記録を会社なしで読む）を追加。
- 訂正版の連鎖が 50 件を超えても `more` が付かなかった — 発見: レビュー、修正: 段数・件数の上限に達したら `more: true`。
- 複製の押下で、遷移の失敗まで「元の記録を読み直せない」と表示しうる構造だった — 発見: レビュー、修正: 読み直しと遷移を分けた。
- 関連の取得失敗時にフォームが使えることを試験していなかった — 発見: レビュー、修正: 関連 API を 503 にするブラウザ試験（AC-4）を追加。

## レビュー指摘への対応（2026-10-30、修正担当）

3 観点（spec・safety・ux）のレビュー指摘 18 件をコードと照合した。すべて実在を確認し、16 件を修正、2 件は一部だけ対応した（理由つき）。

- **連結 field を項目ごとにした**（safety、minor）。`collectTargets` が entity ごとに最初の field を `via` にしていたため、確定した仕入請求書では明細の費用科目も「統制勘定」と表示された。対象 id ごとに field を持ち、`Groups.add` は行ごとの `via` を受け取る。発見: レビュー。確認: kernel の DB テスト（ヘッダの 2 項目と明細で同じ entity を指す）と API の DB テスト（確定した仕入請求書の `controlAccountId` と `purchase_invoice_line.accountId`）。新しい kernel テストは修正前の実装で失敗することを実測した。
- **別 document の明細を指す明細を親 document として返す**（spec、minor）。`trade_fulfillment_line.orderLineId` / `trade_billing_line.fulfillmentLineId` が、題名のない明細の行として出ていた。順参照では対象の明細を読み（明細の親 field を読めない役割では辿らない）、親 document に置き換える。逆参照では記録の明細を指す連結も辿る（対象 entity を名指しする `ref` / enum の組だけ。自由文字の組まで明細ごとに問い合わせると、関連の読取の問い合わせが増えるため）。確認: kernel の DB テスト（出荷 → 受注、受注 → 出荷、受注明細を読めない役割では両方向とも出ない）。修正前の実装で失敗することを実測した。
- **`<x>Entity`/`<x>Id` の組は serverOwned か書込時の検査を必須にした**（safety、minor）。`runtime-and-data.md`・`related.ts` の冒頭・ADR-0009 の追記に書いた。利用者が書ける既存の 4 組（添付、入金の消込明細、在庫の入出庫、在庫元帳）の書込検査をコードで確かめ、API の DB テストで「serverOwned でない組 = 確認済みの 4 組」を固定した（新しい組は一覧に足すまで失敗する）。
- **関連の query key を記録の key から分けた**（spec、minor）。`useInvalidate` が記録の key を前方一致で無効化して待つため、保存・確定の spinner が `/related` の応答まで続いていた。`['related', entity, id, version]` にし、版が変わると裏で読み直す（同じ記録の前の結果は表示したまま。別の記録の結果は出さない）。`queries.ts` は変えていない。
- **seed をセッションに結びつけた**（safety、minor）。history state はログアウト・ログイン・会社の切替をまたいで残り、別の利用者が「戻る」で前の利用者の複製元の内容を見られた。`seedState(seed, owner)` が「テナント:利用者:会社」を入れ、`seedFromState` は一致しないと使わない。確認: 単体テスト（別の利用者・会社・テナント、owner なし）と、ブラウザ試験（複製の新規画面からログアウトし、同じタブで sales の利用者がログインして「戻る」→ 新規画面は開くがお知らせも値も入らない）。このブラウザ試験は owner の検査を外すと失敗することを実測した（`seed-notice` が表示される）。会社の切替後に「戻る」はブラウザでは試していない（同じ検査で、単体テストで会社違いを確かめた）。
- **複製・クイック操作の「今日」を日本時間にした**（ux、minor）。ブラウザの時間帯の日付を使っていたため、UTC の端末では朝 9 時前に前日になった。`lib/operations.ts` の `businessToday`（Asia/Tokyo）を使い、`todayLocal` を消した。確認: 単体テスト（JST 0 時の前後、年末）。
- **仕入請求書の先方請求書番号を持ち越さない**（spec、minor）。schema では unique でないが 1 通の請求書を指し、表示名でもある。DSL の拡張（ADR が要る）ではなく、クイック操作と同じく Web の宣言 `NOT_COPIED`（`purchase_invoice` / `trade_billing` の `supplierInvoiceNo`）にした。DSL へ昇格するかは spec の未決事項に追加。確認: 単体テスト。
- **ブラウザ試験の不足を足した**（spec、minor）。(a) 複製元を月初の日付で作り、お知らせに元の日付、フォームに今日が出ることを確かめる（月初の実行日だけは同じ日になる）。(b) 閲覧だけの利用者（`viewer`）では「複製」もクイック操作も出ず、関連パネルは出る。(c) 関連パネルの group が document から並ぶ。
- **関連パネルの失敗と再試行**（ux、minor 2 件）。失敗の文の下に、メッセージ・コード・HTTP・hint を「技術情報」として折りたたんで残す（`MetaError` と同じ並び）。読込中・失敗を常設の `aria-live="polite"` で知らせ、再試行を押したら見出し（`tabIndex=-1`）へ焦点を移す。確認: ブラウザ試験（技術情報の内容、live region の文、再試行後に見出しが focus）。スクリーンリーダーでの読み上げは未検証。
- **文書**: `docs/manual/09-ai.md` に `GET /api/<台帳>/<id>/related` と MCP ツール `<台帳>_related`、`docs/manual/02-basics.md` の「たどれる限り」を「最大 50 段」へ、目次（00-index）に「複製と関連」、ADR-0009 に追記。
- **細かい点**: 英語の件数（`1 type` / `N types`）と関係の表示（`Linked from this` / `Links to this`）、group を landmark にしない（`section` → `div`）、`DocstatusBadge` に `testId`、使われていない export を外した（`relatedKey`・`recordTitle`・`SEED_STATE_KEY`・`relatedOutput`。`linkSpecs` は `relatedLinkSpecs` として API のテストが、`RELATED_LIMIT` は kernel のテストが使う）、metrics の行の名前（`e2eTestsAdded`、失敗した回の秒数は `lightKernelSecondsFailedRun`）。
- **一部だけ対応 1: 新しい ADR は書かない**（ux、minor）。ADR-0027/0028 は予約、0029 は B2 の予定で、並行作業と番号が衝突しうる。既存の ADR に日付つきの追記をする前例（ADR-0013）に合わせ、ADR-0009 の汎用 action の一覧に `<entity>.related` と組の規約を追記し、spec の ADR 行を直した。
- **一部だけ対応 2: `more` を読める親だけで数える処理は入れない**（safety、nit）。記録を指す明細が 500 行を超えたときだけの真偽値の目安で、件数は返さない。明細を追加で読み進める処理を足すより、`RelatedGroup.more` の説明と `runtime-and-data.md` に「多めに出ることがある目安」と書いた。

## 未実施（減らさない。完了したら「済」を付けて残す）

- `pnpm gate:full`（統合担当が実行する）。
- 大量データ（数万件の仕訳明細を持つ勘定科目など）での関連の応答時間。逆参照は ref 列に索引が無い entity もあり、`list` の件数 query を entity ごとに実行する。小さなデータでの実測は上記。
- ext field の ref を辿ること、2 段先の記録、関連の図示（spec のスコープ外）。
- 複数列の複合 unique を持つ entity の複製で、どの列を空にするかの指定（現在は持ち越して CONFLICT で知らせる）。

## 判断待ち（利用者）

- 複製時の日付の扱い（既定値のある date は今日、ほかの date は空欄）でよいか。spec の未決事項。

## 次のセッションへ

- 統合時: `kernel/src/actions/crud.ts` の `registerCrudActions()` 末尾に B5・C1 の派生 action の呼出しが並ぶ（各 1 行）。`entity-form-page.tsx` は D2 と、`router.tsx` / `navigation-data.ts` は変更していない。
- クイック操作を足すときは `lib/quick-actions.ts` に宣言を 1 件足し、`quick-actions.test.ts` に表示条件と初期値の検査を足す（計画にあった「見積 → 受注」は trade 画面の専用 action があるため初版では入れていない）。
