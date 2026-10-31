# 作業記録: 2026-10-29 月次締めガイド（C4）

- セッション: 完成度向上計画 C4（workflow の作業項目、worktree `wip/close-guide`、統合 head `ebc7574` から）／ 担当: agent ／ 対象: [docs/specs/close-guide.md](../specs/close-guide.md)
- 計測: tokens=null（未計測）, agent_minutes=約90, human_minutes=0, rework_lines=約45（ブラウザ試験 1 回目の失敗で直したリンクの名前、英語ラベルの言い回し、期間選択の幅、再点検ボタン、pack 適用の DB 試験の追加）, gate_failures=2（gate:light 2 回とも DB の 1 suite が共有 PostgreSQL の lock 表不足で失敗。環境要因、単独再実行で成功）

## 決めたこと（と理由）

- **点検はサーバーの読取専用 action `accounting.close_readiness` に置いた。** 画面・MCP・API が同じ規則で同じ件数を得る。`tx: 'none'`、`mutates: false`、権限は既存の締め action と同じ accounting / admin。新しい書込経路・kernel port・依存は無いので ADR は書いていない。
- **件数はすべて `Repository.count`（または `list`）で、要求者の Context のまま数える。** ロール・行の権限・会社/拠点の境界・pack の適用がそのまま効く。entity を含めるかどうかは kernel の `can(ctx, entity, 'read')` で決め（未適用 pack の entity・店舗範囲の利用者が読めない entity もここで落ちる）、日付・docstatus の field が要求者に隠されていれば除く。読めない entity は項目ごと出さない（件数 0 として出すと存在が漏れる）。`systemContext` は使っていない（試験の seed を除く）。
- **document の列挙は `registry.allEntities()`、payment と banking は registry から名前で探す。** payment / banking は accounting に依存する側なので import できない（依存は下向きだけ）。名前で見つからない・読めない・想定の field（`unallocatedAmount`、`bookedOn`、`statementId` / `state`）が無いときは項目を出さない。module からの registry の読取は既存（`attachments`、`inventory` の `registry.entity`）と同じ使い方で、新しい port ではない。
- **blocking の判定は「`journal_entry` 自身」と「`journalEntryId` field を持つ document」。** 確定すると仕訳を作る伝票（売上・仕入請求書、入出金）は、締めた期間の日付では確定できなくなる。それ以外（入出庫伝票、業種別の作業記録など）は注意にした。
- **未照合の銀行明細 = 期間内の明細の件数 − その明細に対する有効な照合の件数。** banking は 1 明細に有効な照合を 1 件しか許さない（`modules/banking/src/reconcile.ts` が 2 件目を拒否）ので差で数えられる。where に副問合せは書けないため、明細 id を 500 件ずつ読んで `$in` で照合を数える。
- **既定の期間はサーバー（`defaultClosePeriod`）が決め、`periodId` は省略可能にした。** 「終了日が今日より前の最も古い未締め期間、無ければ今日を含む期間」に、どちらも無いとき（今日の年度を開いていない等）の「今日より前に終わった最後の期間、それも無ければ最初の期間」を足した。期間が 1 つも無ければ `StateError`（`accounting.open_fiscal_year` の案内）。
- **関連レポートはサーバーが `canRunAction` で絞って返し、入力（`from`/`to` または `asOf`）も付ける。** 画面はどの module が入っているかを知らずに済み、MCP の利用者も同じ入力でレポートを呼べる。
- **レポート画面が URL の `from` / `to` / `asOf` を初期値として受け取るようにした。** 「期間指定付きリンク」を意味のあるものにするために必要だった（従来は URL を読まなかった）。日付型の期間項目で実在する日付だけを受け取り、識別子などは URL から入れない。実行は利用者が押す。規約は `docs/conventions/ui.md` に書いた。
- **一覧へのリンクは当面 `/e/<entity>`。** 一覧はまだ状態や日付で絞り込めない（C1）。画面には件数と対象期間（「2026-09-01〜2026-09-30の下書き」）を出し、項目には `filter: { status: 'draft', field, from, to }` を持たせた。C1 の後は `href` を作る 1 か所（`draftItems`）を変えればよい。
- **締めの確認を承認した直前に、もう一度点検する。** 画面を開いた後に別の利用者が下書きを作った場合に締めないため。`accounting.close_period` 自体には検査を足していない（API・MCP の締めの挙動を変えないため。spec の未決事項に残した）。
- **確認は kit の `Dialog`、締め・再開の後は点検の再取得が済んでから期間の見出しへ焦点を移す。** 確認ボタンは締め済み表示で消えるため、`Dialog` の焦点の復帰先が無くなる（kit の規約どおり画面で決めた）。
- **0 件の項目は「問題のない項目（n）」に畳んだ。** 業種 pack を適用した会社では document の種類が多く、0 件の行が並ぶと残件が埋もれる。
- **計画の「在庫期間の未締め」「未転記の原資料」は実装していない。** draft の受入基準に無く、スコープ外に「在庫期間の締めの自動連動」があるため。spec の未決事項に、足すなら同じ形の注意項目になることを書いた。

## やったこと

- `modules/accounting`: `actions/close-readiness.ts`（action と出力 schema）、`services/close.ts`（`defaultClosePeriod`、`previousPeriod`、`closeDateField`、`isBlockingDraft`、`blockingCount`、`closeReady`）、`module.ts` / `index.ts` に登録・公開
- `apps/web`: `pages/close-page.tsx`（UI キットの `PageHeader` / `Card` / `FormSection` / `Badge` / `Button` / `Dialog` / `EmptyState` / `SkeletonCard`、意味トークンのユーティリティだけ）、`api/close.ts`、`lib/close-guide.ts`、`router.tsx` に `/finance/close`（`?periodId=`）、`lib/navigation-data.ts` に会計・資金の専用画面（`accounting.close_readiness` で表示を判定）、`ui/token-usage.test.ts` の `CONVERTED` に追加、`lib/report.ts` の `reportSearchValues` と `pages/report-page.tsx` の初期値
- 試験: `modules/accounting/test/close-guide.test.ts`（unit 9 件）、`apps/api/test/close-readiness.db.test.ts`（DB 12 件）、`apps/web/src/lib/close-guide.test.ts`（Web unit 7 件）、`apps/web/e2e/close-guide.spec.ts`（ブラウザ 1 件）
- 文書: spec を implemented に（draft から変えた点を末尾に記録）、マニュアル 06 に「月次締めガイド」節・期間の締め・月末の流れ・レポート画面の注記、`docs/conventions/ui.md` にレポートへの期間指定リンクの規約

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] `modules/accounting/test/close-guide.test.ts` 9 件成功（0.2 秒）: 既定期間（最も古い未締め・今日を含む・最後に終わった期間・最初の期間・期間なし、入力順に依存しない）、直前期間（年度またぎ）、業務日付 field の優先順と型、blocking 判定、`ready`。
- [実測] `apps/api/test/close-readiness.db.test.ts` 12 件成功（daifuku_test_w13、22 秒。最初の 11 件で 10.5 秒、pack 適用の 1 件を後から追加）: 全 module・全 pack を登録した runtime（`apps/api/src/modules.ts`）と各 seed で、売上請求書の下書き 1 件で blocking 1・`ready` false、確定で 0・true、期間外（10 月）の下書きは 9 月に数えない、仕訳の下書きは blocking で先頭、入出庫伝票の下書きは注意で `ready` を止めない、別会社の仕訳の下書きは数えない（別会社では 1 件あることも確認）、未配分の入出金（期間末日以前だけ）、未照合の銀行明細（CSV 取込 3 件・照合 1 件で 9 月 1 件）、直前期間の注意と締め後の 0・最初の期間で項目なし、`periodId` 省略時の既定（2026-01 → 1〜7 月と 8 月を締めた後は 2026-09）、accounting ロールで読めない document（admin では出る）が出ないこと、未適用 pack の document（`retail_closing` を含む）が出ないこと、関連レポートの一覧と入力、締め済みで `ready` false・再開で戻る、sales ロールは PermissionDenied、farm pack を `applyPack` で適用すると `farm_work` の項目が出る（未適用の retail は出ないまま）。
- [実測] Web unit: `close-guide.test.ts` 7 件と、触ったファイルの既存試験（`report.test.ts`、`navigation.test.ts`、`ui/token-usage.test.ts`）を含む 4 ファイル 142 件成功（0.6 秒）。
- [実測] ブラウザ試験 `e2e/close-guide.spec.ts`（slot 4、新しい fixture DB、`--project=chromium --no-deps`）1 件成功（9.6 秒）: 画面検索から開く、既定の期間（API で求めた期待値と一致）、期間選択と URL、仕訳の下書き 1 件で締めボタン無効・理由の表示とボタンの説明、一覧リンク、試算表・売掛金年齢表のリンクの期間、試算表を開くと開始日・終了日が入っている、API で確定後の「再点検」で有効、後から作った下書きで締めない（期間は未締めのまま）、kit の Dialog で締める（最初の焦点は「戻る」、`accounting.close_period` の応答成功、締め済み表示、見出しへの焦点、API で `isClosed` true）、訂正日の案内、再開（API で false）、390px で横はみ出しなし・確認ダイアログが画面内、英語表示。1 回目はリンクの名前の期待値の誤り（sr-only の補足で名前に空白が入った）で失敗し、`aria-label` に変えて成功。
- [実測] ブラウザ試験の関連 spec（slot 4、新しい fixture DB、`--project=industry --project=chromium`）: `industry-templates`（3）、`analytics`（10、試算表の期間初期値を含む）、`close-guide`、`navigation`（5）、`phase1`（1、レポート画面）、`phase15`（2、レポートの合計）、`ui-kit`（10）の 32 件すべて成功（4.2 分）。触った画面（レポート画面・画面検索・会計・資金の分野）を含む。別に `foundation-ui`（1）も成功。
- [実測] `pnpm gate:light --base ebc7574`（1 回目、load average 約 10 の共有コンテナ、1,175 秒）: format・docs・assurance・typecheck・API/Web typecheck・lint・unit 全件は成功、DB は 79 suite 中 78 成功・1 失敗。失敗は `apps/mcp/test/stdio.db.test.ts` の schema 作成時の `DROP SCHEMA public CASCADE` が `out of shared memory`（`max_locks_per_transaction` = 64、PostgreSQL の lock 表はサーバー全体で共有）で、同じ PostgreSQL で他の作業の DB suite が同時に動いていたことによる環境要因と判断した（この変更は entity・table を足していない）。同じ suite を単独で再実行して 4/4 成功（22 秒）、DB の後で実行されなかった `pnpm test:deploy` を単独で実行して 16/16 成功（20 秒）。
- [実測] `pnpm gate:light --base ebc7574`（2 回目、2 つ目のコミットの後、877 秒）: format・docs・assurance・typecheck・lint・unit 全件（133 ファイル）成功、DB は 79 suite 中 78 成功（`close-readiness.db.test.ts` を含む、472 件中 471 件）・1 失敗。失敗は `apps/api/test/boolean-migration.db.test.ts` の schema 作成で、1 回目と同じ `out of shared memory`（`DROP SCHEMA public CASCADE`）。単独で再実行して 9/9 成功（44 秒）、`pnpm test:deploy` を単独で実行して 16/16 成功。2 回とも失敗した suite は別で、どちらも試験本体に入る前の schema 削除で落ちている。
- [実測] `pnpm gate:quick`（統合 head の差分を含む既定の基準 `431dda5` で実行）: format・docs・assurance・eslint・boundaries・typecheck・API/Web typecheck・unit 全件・deploy すべて成功（3 分 5 秒）。
- [実測] `node scripts/check-assurance.mjs --changed ebc7574`: 再確認が必要な前提なし。`node scripts/check-doc-links.mjs`: 118 文書・1,111 リンク成功。
- [レビュー] modules から drizzle / postgres / fastify / node:fs を import していない（`pnpm lint:boundaries` 成功）。金額の比較は文字列の `'0'` を DB の numeric と比べるだけで JS の number にしていない。UI 文言はすべて `{ ja, en }`。
- [未検証] `pnpm gate:full`（統合担当が実行する）。ブラウザ試験の全件（industry project を含む）は実行していない。業種 pack を適用した会社での画面（項目が多い場合の見え方）は見ていない。
- [未検証] 店舗・拠点範囲の利用者（`accessScope` が all 以外）。action は `storeAccess` を宣言していないので kernel が拒否する（コードで確認、試験なし）。
- [未検証] ~~URL を直接開いた権限の無い利用者への説明表示~~（済: 2026-10-30 の修正でブラウザ試験を追加、下の「レビュー指摘への対応」）。MCP からの呼出し（action は自動で tool になるが、MCP 経由では試していない）。大量データ（明細数千件以上）での所要時間。スクリーンリーダーでの読み上げ。

## 見つけた問題と修正（発見経路つき）

- 一覧リンクの名前を `一覧を開く` + sr-only の `: 仕訳の下書き` で作ったところ、accessible name が「一覧を開く : 仕訳の下書き」（要素の境界で空白が入る）になり、ブラウザ試験の期待値と一致しなかった — 発見: E2E（error-context の aria スナップショット）、修正: `aria-label`「一覧を開く（仕訳の下書き）」（見えている文字で始まる名前）。
- 期間の選択欄が flex の縦並びで全幅に伸びた — 発見: デスクトップのスクリーンショット（目視）、修正: `sm:max-w-md`。
- 「再点検」ボタンを取得中は無効にしていたため、押すとキーボードの焦点がボタンから外れうる — 発見: 自己レビュー、修正: 締め・再開の処理中だけ無効にし、取得中は `aria-busy`（押し直すと react-query が取得をやり直す）。
- DB 試験に「pack を適用すると項目に出る」場合が無かった — 発見: 自己レビュー（AC-7 の逆側）、修正: farm pack を適用する試験をファイルの最後に追加（会社の設定を変えるため最後に置いた）。

## レビュー指摘への対応（2026-10-30、修正担当 agent、同じ worktree・branch）

spec・安全性・UX の 3 観点のレビュー指摘 18 件（重複 2 件を含む）をコードと照らして確かめ、すべて妥当と判断して直した（却下なし）。

- [major・spec] 既定の期間（`?periodId` なし、画面検索・分野一覧から来た場合）のまま締めると、`useFinanceCommand` の無効化で再取得した点検が次の既定の期間を返し、締めた期間の締め済み表示・訂正の案内・再開が出なかった。発見: レビュー（ブラウザでの再現）。修正: 既定で決まった期間を URL に `replace` で固定し、固定前の答えを固定後の key の初期値に使う（`api/close.ts` の `initialData`、受け渡しのためだけの 2 秒の staleTime）。ブラウザ試験に「既定の期間のまま締めて同じ期間に留まる」を追加し、修正前のコードではこの試験が「締め済み」を期待して「締められます」で失敗することを確かめた（`close-page.tsx` と `api/close.ts` だけを元に戻して実行）。
- [major・ux] 期間の選択欄の値が読込済みの点検から決まり、次の期間の読込中は「読み込み中…」が選択値になって、2 回目の矢印キーが先頭（最新の期間）へ飛んだ。修正: 値を URL の期間から取り、選択肢に無いときだけ仮の option を出す。ブラウザ試験で点検の応答を 3 秒遅らせて矢印キーを押し、読込中（skeleton 表示中）の選択値が URL の期間であることを 1 回だけ読んで確かめ（再試行する assertion だと遅れた応答の後で通ってしまうため）、続けてもう 1 回押して URL と選択値が 2 つ先の期間になることを確かめた。選択値の決め方だけを修正前（読込済みの点検の期間）に戻すと、この試験が読込中の選択値 `""` で失敗することも確かめた。最初に書いた版は再試行する assertion で、修正前の決め方でも通ってしまった（自己確認で発見して直した）。
- [minor・safety] `ready` は要求者が数えられる下書きだけで決まるため、blocking の document が accounting に読めない・行の制限がある・日付か docstatus が隠される定義になると、見えない下書きを残して `ready` が true になりうる（現在の定義では起きない）。修正: 全 registry（全 module・pack）を読み込む unit 試験 `apps/api/test/close-readiness.test.ts` で、`accounting.close_readiness` を実行できるロール（admin 以外）について、blocking の document すべてが `can` で読め、そのロールの行の制限が無く、業務日付と docstatus が隠されていないことを検査する。spec の未決事項（close_period のサーバー側検査）からこの前提へ言及した。
- [nit・safety] 会計期間を 500 件で打ち切って読み、打切りを無視していた。修正: 既定の規則ごと（未締めで今日より前に終わる最古、今日を含む、今日より前に終わる最後、最初）と直前の期間を `limit 1` の問合せで読み、`defaultClosePeriod` / `previousPeriod` はその候補から選ぶ（各規則の答えが候補に入るので全件から選ぶのと同じ）。DB 試験に「過去の期間をすべて締めると今日を含む期間」を足した。
- [minor・spec/ux（重複）] 会計期間の無い会社は読込失敗（英語のサーバーメッセージ）になっていた。修正: サーバーの `StateError` に `details.reason = 'no_fiscal_period'` を付け、画面は期間の一覧が空か、この理由のときに「会計年度がまだありません」と `accounting.open_fiscal_year` への導線（実行できる利用者だけ）を出す。DB 試験（会計期間の無い会社で `StateError` と `reason`）、Web unit（判定）、ブラウザ試験（応答を差し替えて表示）を追加。
- [minor・spec] URL を直接開いた権限の無い利用者の説明に試験が無かった。修正: sales だけの利用者でブラウザ試験を追加。
- [minor・ux] 締める直前の点検で止められると、開き元のボタンが無効なため焦点が `<body>` に落ちた。修正: 期間の見出しへ焦点を移す（点検が読めた後）。ブラウザ試験に焦点の確認を追加。
- [minor・ux] 再点検の失敗が分からず、前回の結果のまま締められるように見えた。修正: `role="alert"` の通知と「点検をやり直す」を出し、成功するまで締め・再開を無効にする。ブラウザ試験で点検を 503 にして確認。
- [minor・ux] 再点検の結果が読み上げられなかった。修正: 利用者が押した再点検が終わったら polite なライブ領域（busy 領域の外）に状態と理由を入れる。ブラウザ試験でライブ領域の文言を確認（スクリーンリーダーでの実際の読み上げは未確認）。
- [minor・ux] すべてのリンクが「一覧を開く」だった。修正: 行き先で「銀行照合を開く」「その期間を開く」に変え、同じ画面の別の期間へのリンクでは読込後に見出しへ焦点を移す。ブラウザ試験で前の期間へのリンクの名前・移動・焦点を確認。
- [minor・ux] 0 件の blocking の種類が「確認事項（締めは止めません）」の中に並んでいた。修正: 「問題のない項目（n）」を独立した Card に移した。マニュアル 06 の手順 3 も直した。
- [nit] 前の期間の項目が件数（「…が締まっていない 0 件」）だった。修正: ラベルを中立（「前の会計期間（<コード>）の締め」）にし、画面は「未締め」/「締め済み」を出す（MCP からは従来どおり count 1/0）。英語の残件の件数も桁区切りにした。
- [nit] 既に締められていたときの拒否の toast が空だった。修正: 「この期間は既に締められています。」を出す（Web unit）。
- [nit（重複）] `reportHref` は試験からしか使われていなかった。修正: 関数とその assertion を削除した（画面は規約どおり `<Link to="/r/$action" params search>` で作り、ブラウザ試験が実際の href を確かめている。消した試験は消した関数のもので、画面の挙動の検証は減っていない）。
- [nit] spec AC-8 は `from` / `to` / `asOf` だけ、実装と UI 規約は `date` も受け取っていた。修正: spec を実装と規約に合わせた（日付型の期間項目で実在する日付だけなので、受け取る範囲は広がらない）。
- [nit] 画面の一覧（付録 N、マニュアル目次、program map）に月次締めが無かった。修正: 追記した。
- 自己判断の整理: `CloseGuide` が 389 行になり関数長の警告が出たため、表示だけの `CloseStatus`（期間の状態とボタン）と `CloseChecks`（項目とレポート）に分けた（状態と処理は `CloseGuide` に残した）。

検証（修正後）:

- [実測] unit: `modules/accounting/test/close-guide.test.ts` 9 件、`apps/api/test/close-readiness.test.ts` 1 件（新規）、Web の `close-guide.test.ts` 11 件（4 件追加、`reportHref` の assertion を削除）と `report.test.ts`・`navigation.test.ts`・`ui/token-usage.test.ts` を含む 6 ファイル 156 件成功。
- [実測] DB: `apps/api/test/close-readiness.db.test.ts` 13 件成功（daifuku_test_w13、15 秒。1 件追加、既定の期間の試験に 1 段追加、前の期間のラベルの期待値を新しいラベルへ変更）。
- [実測] ブラウザ: `e2e/close-guide.spec.ts`（slot 4、新しい fixture DB、`--project=chromium --no-deps`）4 件成功（最終版で 26 秒、途中の版を含めて 4 回成功）。初回は「既定の期間を開いたときの点検要求は `{}` 1 件」の assertion が 2 件で失敗した。Vite の開発サーバーの StrictMode が初回の取得を中止してやり直すためで（2 件とも `{}`）、主張したいのは「固定した期間を取り直さない」ことなので、`periodId` 付きの要求が無いことの検査に直した。
- [実測] `node scripts/gate.mjs --tier light --base ebc7574`（修正後、daifuku_test_w13、load average 約 6 の共有コンテナ、992 秒）: format・docs・assurance・typecheck（root / API / Web）・lint（警告 4 件はすべて既存の別画面の関数長、`CloseGuide` の警告は分割で解消）・unit 134 ファイル 1,230 件・DB 79/117 suite（780 秒、今回は lock 表不足の失敗なし）・deploy すべて成功。
- [未検証] `pnpm gate:full`（統合担当が実行する）、ブラウザ試験の全件、スクリーンリーダーでの実際の読み上げ、会計期間の無い実在の会社での画面（応答の差し替えと DB 試験でだけ確認）。gate:light の後に直したのはブラウザ試験の 1 ファイル（矢印キーの確認を強めた）と文書だけで、その後に close-guide のブラウザ試験を再実行した。

## 未実施（減らさない。完了したら「済」を付けて残す）

- C1（一覧の絞り込み）の後、下書きの `href` を `/e/<entity>?status=draft&from=&to=` 相当に変え、ブラウザ試験で絞り込み済み一覧を確かめる。
- マニュアル 06 の「月次締めガイド」節の画面画像（撮影していない）。
- 計画 C4 の「在庫期間の未締め」「未転記の原資料」の点検（spec の未決事項）。

## 判断待ち（利用者）

- 注意項目（未配分の入出金・未照合明細）を blocking にする会社設定を設けるか。
- `accounting.close_period` に blocking 件数の検査を足すか（API・MCP からの締めも止めるか）。

## 次のセッションへ

- 統合時に `apps/web/src/router.tsx`（`closeRoute`）と `apps/web/src/lib/navigation-data.ts`（`/finance/close` の項目）を他の項目の追加と合わせる。`apps/web/src/pages/report-page.tsx` と `lib/report.ts` にも小さな変更がある（URL の期間を初期値に）。
