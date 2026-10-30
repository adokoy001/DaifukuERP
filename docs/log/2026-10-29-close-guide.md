# 作業記録: 2026-10-29 月次締めガイド（C4）

- セッション: 完成度向上計画 C4（workflow の作業項目、worktree `wip/close-guide`、統合 head `ebc7574` から）／ 担当: agent ／ 対象: [docs/specs/close-guide.md](../specs/close-guide.md)
- 計測: tokens=null（未計測）, agent_minutes=約90, human_minutes=0, rework_lines=約45（ブラウザ試験 1 回目の失敗で直したリンクの名前、英語ラベルの言い回し、期間選択の幅、再点検ボタン、pack 適用の DB 試験の追加）, gate_failures=1（gate:light の DB 1 suite が共有 PostgreSQL の lock 表不足で失敗。環境要因、単独再実行で成功）

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
- [実測] `pnpm gate:quick`（統合 head の差分を含む既定の基準 `431dda5` で実行）: format・docs・assurance・eslint・boundaries・typecheck・API/Web typecheck・unit 全件・deploy すべて成功（3 分 5 秒）。
- [実測] `node scripts/check-assurance.mjs --changed ebc7574`: 再確認が必要な前提なし。`node scripts/check-doc-links.mjs`: 118 文書・1,111 リンク成功。
- [レビュー] modules から drizzle / postgres / fastify / node:fs を import していない（`pnpm lint:boundaries` 成功）。金額の比較は文字列の `'0'` を DB の numeric と比べるだけで JS の number にしていない。UI 文言はすべて `{ ja, en }`。
- [未検証] `pnpm gate:full`（統合担当が実行する）。ブラウザ試験の全件（industry project を含む）は実行していない。業種 pack を適用した会社での画面（項目が多い場合の見え方）は見ていない。
- [未検証] 店舗・拠点範囲の利用者（`accessScope` が all 以外）。action は `storeAccess` を宣言していないので kernel が拒否する（コードで確認、試験なし）。
- [未検証] URL を直接開いた権限の無い利用者への説明表示（navigation の非表示は Web unit で確認）。MCP からの呼出し（action は自動で tool になるが、MCP 経由では試していない）。大量データ（明細数千件以上）での所要時間。スクリーンリーダーでの読み上げ。

## 見つけた問題と修正（発見経路つき）

- 一覧リンクの名前を `一覧を開く` + sr-only の `: 仕訳の下書き` で作ったところ、accessible name が「一覧を開く : 仕訳の下書き」（要素の境界で空白が入る）になり、ブラウザ試験の期待値と一致しなかった — 発見: E2E（error-context の aria スナップショット）、修正: `aria-label`「一覧を開く（仕訳の下書き）」（見えている文字で始まる名前）。
- 期間の選択欄が flex の縦並びで全幅に伸びた — 発見: デスクトップのスクリーンショット（目視）、修正: `sm:max-w-md`。
- 「再点検」ボタンを取得中は無効にしていたため、押すとキーボードの焦点がボタンから外れうる — 発見: 自己レビュー、修正: 締め・再開の処理中だけ無効にし、取得中は `aria-busy`（押し直すと react-query が取得をやり直す）。
- DB 試験に「pack を適用すると項目に出る」場合が無かった — 発見: 自己レビュー（AC-7 の逆側）、修正: farm pack を適用する試験をファイルの最後に追加（会社の設定を変えるため最後に置いた）。

## 未実施（減らさない。完了したら「済」を付けて残す）

- C1（一覧の絞り込み）の後、下書きの `href` を `/e/<entity>?status=draft&from=&to=` 相当に変え、ブラウザ試験で絞り込み済み一覧を確かめる。
- マニュアル 06 の「月次締めガイド」節の画面画像（撮影していない）。
- 計画 C4 の「在庫期間の未締め」「未転記の原資料」の点検（spec の未決事項）。

## 判断待ち（利用者）

- 注意項目（未配分の入出金・未照合明細）を blocking にする会社設定を設けるか。
- `accounting.close_period` に blocking 件数の検査を足すか（API・MCP からの締めも止めるか）。

## 次のセッションへ

- 統合時に `apps/web/src/router.tsx`（`closeRoute`）と `apps/web/src/lib/navigation-data.ts`（`/finance/close` の項目）を他の項目の追加と合わせる。`apps/web/src/pages/report-page.tsx` と `lib/report.ts` にも小さな変更がある（URL の期間を初期値に）。
