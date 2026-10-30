# Spec: close-guide（月次締めガイド）

- 状態: implemented
- モジュール: `modules/accounting`（`accounting.close_readiness`）、`apps/web`（`/finance/close`、レポート画面の期間引継ぎ） ／ 依存: [ui-kit](ui-kit.md)（D1）
- ADR: 不要（既存 action と読取権限の組合せ。新しい書込経路・kernel port・依存なし）
- 作成: 2026-10-29 ／ 作成者: agent（計画セッションが draft、実装セッション `wip/close-guide` が確定）。設計の元は [完成度向上の実装計画](../completion-plan.md) C4

## 目的（1段落）

月次の締めは [マニュアル 06](../manual/06-monthly.md) の手順（下書きの確認 → 消込 → 試算表 → 消費税集計表 → 年齢表 → 在庫評価 → 期間の締め）を人が順に確かめる運用で、未確定の下書きが残ったまま期間を締めると、その伝票は後から確定できなくなる。経理担当者が、締める前に残っている作業を件数で把握し、該当の一覧へ移動し、条件を満たしたときだけ締められる画面を用意する。

## 受入基準（EARS）

- AC-1 WHEN `accounting.close_readiness { periodId? }` が accounting または admin ロールから呼ばれた THE SYSTEM SHALL 期間（id・コード・開始日・終了日・締め状態）、会計年度（id・コード・締め状態）、点検項目の配列、blocking 件数の合計、`ready`、関連レポートを返す。点検項目は `{ id, kind, label: Label, count, blocking, href?, entity?, filter? }` で、action は読取専用（`mutates: false`、`tx: 'none'`）とする。それ以外のロールには PermissionDenied を返す。
- AC-2 THE SYSTEM SHALL 登録済みの document entity のうち、要求者が read でき（ロール・店舗/拠点の範囲・pack の適用を `can` で判定）、日付と docstatus の field が要求者に隠されておらず、業務日付の field（`date` / `postingDate` / `documentDate` / `transactionDate` の最初に存在する date 型のもの）を持つものについて、期間内の日付の下書き（docstatus 0）の件数を entity ごとの点検項目として返す。件数は `Repository.count` を通し、行の権限と会社・拠点の境界を適用する。
- AC-3 THE SYSTEM SHALL `journalEntryId` field を持つ document と `journal_entry` 自身の下書きを `blocking: true`、それ以外の document の下書きを `blocking: false`（注意）とする。
- AC-4 THE SYSTEM SHALL 期間終了日までに確定した入出金のうち未配分額が 0 より大きいものの件数を注意として返す（`payment` が登録され、要求者が読める場合）。`bank_statement` と `bank_reconciliation` が登録され読める場合は、期間内に記帳された銀行明細のうち有効な照合（`state = active`）が無いものの件数を注意として返す。
- AC-5 IF 直前の会計期間（年度をまたいで、開始日より前に終わる最後の期間）が締まっていない THEN THE SYSTEM SHALL その旨を件数 1 の注意として返す。締まっていれば件数 0、直前の期間が無ければ項目を返さない。この項目の件数は状態（1 = 未締め、0 = 締め済み）なので、ラベルは中立（「前の会計期間（<コード>）の締め」）とし、画面は件数の代わりに「未締め」/「締め済み」を示す。
- AC-6 THE SYSTEM SHALL `ready` を「期間が未締め、かつ blocking 項目の件数がすべて 0」のときだけ true にする。
- AC-7 IF 要求者が読めない entity（pack 由来で会社に未適用のものを含む） THEN THE SYSTEM SHALL その entity を点検項目に含めず、件数も返さない（存在を漏らさない）。
- AC-8 WHEN `/finance/close` を開いた THE SYSTEM SHALL 会計期間を選ばせ（既定は終了日が今日より前の最も古い未締め期間、無ければ今日を含む期間。どちらも無ければ今日より前に終わった最後の期間、それも無ければ最初の期間）、点検項目と、関連レポート（試算表・総勘定元帳・消費税集計表・売掛金/買掛金年齢表・在庫評価のうち要求者が実行できるもの）への期間指定付きリンクを表示する。既定の選び方はサーバーが持ち、`periodId` を省略した `accounting.close_readiness` が同じ規則で期間を決める（期間の件数によらず、規則ごとの絞った問合せで決める）。画面は既定で決まった期間を URL（`?periodId=`、履歴を増やさない置換）に固定し、締め・再開・再点検・再読み込みの後も同じ期間を表示する（固定のために点検をやり直さない）。期間の選択欄の値は URL の期間に従い、次の期間を読込中でも矢印キーは URL の期間から動く。会計期間が 1 つも無い会社では、`accounting.close_readiness` が `StateError`（`details.reason = 'no_fiscal_period'`）を返し、画面は読込失敗ではなく「会計年度がまだありません」と、実行できる利用者には `accounting.open_fiscal_year` への導線を示す。レポート画面は URL の `from` / `to` / `asOf` / `date` を、その名前の日付型の期間項目に限って初期値として受け取る（実行は利用者が押す。[UI 規約](../conventions/ui.md)と同じ）。
- AC-9 WHEN 点検項目に `href` がある THE SYSTEM SHALL 該当の画面へ移動できるリンクを、行き先を表す文言で表示する（下書き・未配分の入出金は「一覧を開く」、未照合の銀行明細は「銀行照合を開く」、前の期間は「その期間を開く」）。一覧が絞り込みを解釈できない現段階では、下書き件数の項目は entity の一覧（`/e/<entity>`）を指し、件数と対象期間（「<開始日>〜<終了日>の下書き」）を表示する。点検項目の `filter`（`{ status: 'draft', field, from, to }`）が絞り込み条件を表す。同じ画面の別の期間へのリンクをたどったときは、その期間の点検が読めた後に期間の見出しへ焦点を移す。件数 0 の項目は blocking の種類を含めて、締めを止める項目・確認事項のどちらにも入れず、独立した「問題のない項目（n）」に畳む。
- AC-10 WHILE `ready` が false WHEN 利用者が締めを実行しようとした THE SYSTEM SHALL ボタンを無効にし、残っている blocking 項目を名前と件数で示す（ボタンの説明としても読み上げる）。WHEN `ready` が true で kit の `Dialog` による確認を承認した THE SYSTEM SHALL 直前にもう一度 `accounting.close_readiness` を実行し、締められる状態のときだけ既存の `accounting.close_period` を実行し、結果を表示して点検をやり直す。締められない状態に変わっていたら実行せず、理由（残件、または既に締められていること）を示し、確認の開き元が無効になるため期間の見出しへ焦点を移す。利用者が押した再点検が終わったら、結果（状態と、止まっていれば理由）を polite なライブ領域で知らせる。再点検が失敗したときは前回の結果を残したまま失敗を `role="alert"` で示し、点検が成功するまで締め・再開のボタンを無効にする。
- AC-11 WHEN 締め済みの期間を選んだ THE SYSTEM SHALL 締め済みであることと、訂正日による取消の案内、再開（既存 `accounting.reopen_period`、kit の `Dialog` による確認付き）を表示する。
- AC-12 THE SYSTEM SHALL 画面を「会計・資金」分野の専用画面として画面検索・分野一覧に表示し、`accounting.close_readiness` を呼べない利用者には表示しない（URL を直接開いたときは権限が無いことを説明する）。
- AC-13 THE SYSTEM SHALL 画面の文言を日本語と英語で持ち、390px 幅で横にはみ出さず操作できる。

## 関係するファイル・インターフェース（名指し）

- `modules/accounting/src/actions/close-readiness.ts`（新規: action、出力 schema）、`modules/accounting/src/services/close.ts`（新規: 既定期間・直前期間・業務日付 field・blocking 判定の純粋関数）、`modules/accounting/src/module.ts` / `index.ts`（登録・公開）
- `apps/web/src/pages/close-page.tsx`（新規）、`apps/web/src/api/close.ts`（新規）、`apps/web/src/lib/close-guide.ts`（新規）、`apps/web/src/router.tsx`、`apps/web/src/lib/navigation-data.ts`、`apps/web/src/ui/token-usage.test.ts`（`CONVERTED` に追加）
- `apps/web/src/lib/report.ts`（`reportSearchValues`）、`apps/web/src/pages/report-page.tsx`（URL の期間を初期値に）
- 試験: `modules/accounting/test/close-guide.test.ts`（unit）、`apps/api/test/close-readiness.test.ts`（unit、全 registry で blocking の document が数えられる前提を検査）、`apps/api/test/close-readiness.db.test.ts`（DB、全 module と pack を登録した runtime）、`apps/web/src/lib/close-guide.test.ts`（Web unit）、`apps/web/e2e/close-guide.spec.ts`（ブラウザ）
- `docs/manual/06-monthly.md`、`docs/conventions/ui.md`（レポートへの期間指定リンク）、画面の一覧（`docs/manual/00-index.md`、`docs/manual/appendix-n-navigation.md`、`docs/architecture/program-map.md`）

## データ・業務ルール（出典）

- 締めた期間の日付で仕訳を転記できないこと、取消の訂正日 — 既存の [accounting 仕様](accounting.md) AC-10 と [付録 C](../manual/appendix-c-ui-refresh.md)。新しい制度値はない。

## スコープ外（明記）

- 締めの自動実行、締め前の自動確定、在庫期間の締め（`inventory.close`）の自動連動
- 決算整理仕訳の提案、年度締め
- 一覧の絞り込み UI そのもの（[実装計画](../completion-plan.md) C1）
- `accounting.close_period` 自体に blocking 件数の検査を足すこと（API・MCP からの締めは従来どおり。下の未決事項）
- 計画の C4 にあった「在庫期間の未締め」「未転記の原資料」の点検（下の未決事項）

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`
2. DB（`apps/api/test/close-readiness.db.test.ts`）: 下書き売上請求書 1 件を期間内に作ると blocking 件数 1・`ready` false、確定後に 0・true。期間外の下書きは数えない。仕訳の下書きは blocking、入出庫伝票の下書きは注意。別会社の下書きは数えない。未配分の入出金と未照合の銀行明細の件数。直前期間未締めの注意と締め後の 0。`periodId` 省略時の既定期間。accounting ロールで読めない entity と未適用 pack の document が出ないこと、pack を適用するとその document が出ること。関連レポートの入力。締め済み期間は `ready` false（AC-1〜AC-8）
3. ブラウザ（`apps/web/e2e/close-guide.spec.ts`）: 画面検索から開く、既定期間、期間選択、下書きが残る状態で締めボタンが無効、レポートリンクの期間と試算表の初期値、確定後に締めを実行して締め済み表示、締める直前の再点検、再開の確認、390px、英語表示（AC-8〜AC-13）
4. 修正後の追加（2026-10-30、レビュー指摘）: unit `apps/api/test/close-readiness.test.ts`（blocking の document が accounting で読め、行の制限・field の隠しが無いことを全 registry で検査）、DB（既定の期間が今日を含む期間に落ちること、会計期間の無い会社の `StateError` と `reason`）、ブラウザ（URL への期間の固定と再取得しないこと、既定の期間のまま締めて同じ期間に留まる、矢印キーでの期間選択、締めを止められた後の焦点、再点検の通知と失敗表示、前の期間へのリンクと焦点、0 件の項目の置き場所、権限の無い利用者の説明、会計年度の無い会社の表示（応答を差し替え））
5. `pnpm gate:full`（統合担当が実行）

## 未決事項（利用者の判断待ち）

- 注意項目（未配分の入出金・未照合明細）を blocking にする会社設定を設けるか（初版は設けない）。
- `accounting.close_period` は従来どおり blocking 件数を検査しない（画面だけが止める）。API・MCP から締める利用者にも同じ止め方をするなら、close_period に検査を足すか、`force` 付きの別 action にするかを決める。関連する前提: `ready` は要求者が数えられる下書きだけで決まる（AC-7）ため、blocking の document が accounting ロールに読めない・行の制限がある・日付か docstatus が隠される状態になると、見えない下書きを残したまま `ready` が true になりうる。現在の定義ではどれも起きないことを `apps/api/test/close-readiness.test.ts` が全 registry で検査し、役割表の変更で破れたら CI で落ちる。サーバー側で close_period が検査するようになれば、この前提に頼らなくなる。
- 計画 C4 にあった「在庫期間の未締め」（`inventory_period_close`）と「未転記の原資料」（POS の受信待ちなど）は、draft の時点で受入基準から外れていたため実装していない。入れるなら注意項目として足せる（同じ `Repository.count` の形）。

実装時に draft から変えた点（コードを読んで決めたもの）:

- `periodId` を省略可能にし、AC-8 の既定期間の規則をサーバー（`defaultClosePeriod`）に置いた。画面と MCP・API の利用者が同じ既定を得るため。今日を含む期間も無いときの扱い（最後に終わった期間、無ければ最初の期間）を追加した。
- 出力に `fiscalYear`、`defaulted`、`asOf`、`blockingCount`、`reports`、項目の `kind` / `entity` / `filter` を足した。`reports` はサーバーが `canRunAction` で絞るので、画面はどの module が入っているかを知らなくてよい。
- payment と banking は accounting に依存する側なので import できない。registry から名前で探し、登録されていない・読めない・想定の field が無いときは項目を出さない。未照合の明細は「期間内の明細の件数 − その明細の有効な照合の件数」で数える（banking は 1 明細に有効な照合を 1 件しか許さない。`modules/banking/src/reconcile.ts`）。明細 id は 500 件ずつ読んで `$in` で数える。
- 「適用済み」は `can()` が判定する（pack 由来の entity は会社に未適用なら read できない）。日付・docstatus の field が要求者に隠されている entity も除く（where に使うと `assertReadableFields` が拒否するため）。
- レポートへのリンクを意味のあるものにするため、レポート画面が URL の `from` / `to` / `asOf` を初期値に使うようにした（期間の日付項目だけ。識別子や他の入力は URL から入れない）。
- 締めの確認を承認した直前に点検をやり直し、締められない状態に変わっていれば実行しない（画面を開いた後に別の利用者が下書きを作った場合）。
- 締め・再開の後は、確認ボタンが消えるため、点検の再取得が済んでから期間の見出しへ焦点を移す。

レビュー（spec・安全性・UX の 3 観点）を受けて変えた点（2026-10-30）:

- 既定の期間で開いたまま締めると、再取得が次の既定の期間を返して別の期間へ移っていた。既定で決まった期間を URL に固定し（`replace`）、固定前の答えを固定後の初期値に使う（`api/close.ts`、2 秒の staleTime はこの受け渡しだけのため。再点検・締め後の無効化・画面のフォーカス復帰は常に取り直す）。
- 期間の選択欄の値を読込済みの点検ではなく URL の期間から取るようにした（読込中に「読み込み中…」が選択値になり、2 回目の矢印キーが先頭へ飛んでいた）。
- サーバーの期間の読み方を、500 件で打ち切る一覧から、既定の規則ごとと直前の期間の `limit 1` の問合せに変えた。`defaultClosePeriod` / `previousPeriod` はその候補から選ぶ（候補に各規則の答えが入るので、全件から選ぶのと同じ結果）。
- 前の期間の項目のラベルを中立にし（「…の締め」）、画面は件数の代わりに状態を表示する。リンクの文言を行き先で変えた。英語の残件の件数も桁区切りにした。
- 0 件の項目を確認事項の節の中から独立した節へ移した（blocking の種類が「締めは止めません」の下に並んでいた）。
- 会計期間の無い会社は読込失敗ではなく案内の空状態にした（サーバーは `details.reason` を付ける）。
- 締めを止められたときの焦点、再点検の結果の通知、再点検の失敗表示と締めの無効化、既に締められていたときの理由を足した。
- AC-8 の URL の受け取りに `date` を明記した（実装と UI 規約は当初から `date` も受け取っていた）。
