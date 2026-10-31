# 作業記録: 2026-10-30 権限マトリクスと監査の横断検索（F3）

- セッション: 完成度向上計画 F3（workflow の実装担当、worktree `wip/access-insight`、基点 `ffc2f42`）／ 担当: agent ／ 対象: [docs/specs/access-insight.md](../specs/access-insight.md)
- 計測: tokens=null（未計測）, agent_minutes=約 75（15:19〜16:34、gate とブラウザ試験の待ちを含む）, human_minutes=0, rework_lines=約 40（試験の期待値の直し、spec の 366 日の例、markdown の整形の戻し、e2e の型）, gate_failures=1（1 回目の gate:light が e2e の型の誤りで typecheck:web に失敗。直して再実行し成功）
- レビュー後の修正（fixer）: agent_minutes=約 75（18:02〜19:15、gate・ブラウザ試験・計測の待ちを含む）, rework_lines=約 110（kernel の DB 試験の期待値の改め、試験の entity の宣言を含む）, gate_failures=2（gate:light の unit と DB の時間切れ・固定ポートの衝突。いずれもこの変更と無関係で、単独の再実行で成功）

## 決めたこと（と理由）

- **spec 批評の 16 件はすべて受け入れた**（spec の判断 16 に要約）。うち 1 件は例が誤っていた: 「2025-01-01〜2026-01-01 は 367 日」は数え違いで、実際は両端を含めて 366 日。拒否の例を閏年をまたぐ 2024-01-01〜2025-01-01（367 日）に替え、kernel・Web・API の試験で同じ例を使った。
- **権限表は kernel の純粋関数で導出し、試験でエンジンとセルごとに突き合わせる。** `derivePermissionMatrix(input)` は registry の中身を引数で受け取るので、単体試験は自分の試験用 registry（行ルールの自分・条件・`$or`・`$ne`・`docstatus`、項目の制限、店舗・親・共有閲覧・拠点の方針、`registerStoreAccess`、店舗端末、名前付き遷移、document と非 document、pack の entity と action、`audit: 'none'`、module の roles 宣言）で全セルを `can()`・`canRunAction()`・`transitionDocument` の判定と比べる。API の DB 試験は全 runtime で同じ比較をする（約 5,000 セル以上。店舗・拠点・店舗端末の比較はレビュー後に足した。名前付き遷移を宣言する module がまだ無いので、遷移の比較は単体試験だけ）。
- **行ルールの要約は kernel で作る**（field と enum のラベル、`$ctx` の語、`docstatus` の状態名）。知らない演算子は元の JSON。`self` は最上位の AND の等号か token だけの `$in` に限った（`$or` の中、`$ne` は「条件付き」）。行ルールは作成を制限しないので、ロールごとの `restrictedOps`（`create` を除く）を返し、凡例に書いた。
- **kernel の機能のロールを定数にした**（`kernel-capabilities.ts` の `SETTINGS_ROLES`・`HEALTH_ROLES`・`ACCESS_INSIGHT_ROLES`）。`settings.ts`・`health.ts` の判定をその定数に置き換え、権限表の凡例も同じ定数から作る。手書きの一覧が判定とずれない。
- **監査の検索の入口は人の資格情報だけ。** `actor.type` が `user`、または `onBehalfOf` のある `agent`（利用者の JWT ＋ `x-agent-id`）を許し、`relay`・`system`・F2 の `machine` は拒む。route は querystring を検証せずに kernel へ渡し、kernel が 403（ロール・範囲・actor）→ 400（条件）→ 403（テナント範囲）→ 409（会社なし）の順に判定する。admin でない人に条件の形を知らせない。
- **cursor は `at` をマイクロ秒まで残す。** JS の `Date` はミリ秒で切れるので、SQL の `to_char(at at time zone 'UTC', …US…)` を cursor に入れ、`(at, id) < ($1::timestamptz, $2::uuid)` の行値の比較で続きを取る。計測で索引の範囲走査のままであることを確かめた（S2）。
- **読めない entity の行は SQL の WHERE で除く**（実装時は `entity NOT IN (…)`。レビュー後に「見てよい対象だけ」の `entity IN (…)` に替えた。下の「レビュー後の修正」）。JS で除くとページが欠ける。全 runtime で会社にパックが無いとき 33 個の名前になり、計測もこの条件込みで行った。
- **利用者の候補は今の所属者・テナント管理者・元の所属者（`company_membership` の監査の `record_id`）。** 会社範囲ではメールを返さない（会社の管理者は利用者の一覧を見られない既存の境界を広げない）。候補に無い id（system・端末・AI）は画面で直接入力できる。
- **監査の対象と操作の一覧（`AUDIT_SUBJECTS`・`AUDIT_OP_LABELS`）の漏れは走査で検出する。** 単体試験が `kernel/src`・`modules/*/src`・`l10n/*/src`・`packs/*/src` の `writeAccessAudit`・`writeAudit`・`authAudit` の文字列の引数を読み、一覧に無い対象・操作があれば失敗する。同じ回の F2・F1 が監査の書込を足すと統合時にこの試験が失敗するので、一覧に足してもらう（integrationNotes）。
- **新しい ADR は作らず ADR-0007 に追補した**（予約の ADR-0038 は使っていない）。
- **ブラウザ試験の準備は API で行った。** 第 2 の利用者の取引先の作成と 55 回の更新はその利用者自身の資格情報で API から、CSV 出力は一覧の CSV と同じ action `partner.export_rows` を管理者の API 呼出しで行った（spec の「実装時の確認と変更」に記録）。画面の検証は画面で行った。

## やったこと

- kernel: `kernel-capabilities.ts`（新規）、`permission-matrix.ts`（新規。`derivePermissionMatrix`・`permissionMatrix`・`describeRowRule`・`isSelfRule`）、`audit-search.ts`（新規。`auditSearchQuery`・`searchAudit`・`auditSearchOptions`・`auditSearchStatement`・`unreadableEntities`・期間と cursor・`AUDIT_SUBJECTS`・`AUDIT_OP_LABELS`）、`audit.ts`（`auditSnapshotFilter` を切り出して `auditTrail` と共有。振る舞いは同じ）、`settings.ts`・`health.ts`（ロール定数）、`db/system-tables.ts`（索引 3 本）、`index.ts`
- migration: `apps/api/drizzle/migrations/0018_audit_search_indexes.sql` と `meta/`（`pnpm db:schema` → `pnpm db:generate audit_search_indexes` の生成物。手で直していない）
- api: `routes/access-insight.ts`（新規。`GET /admin/permissions`・`/admin/audit`・`/admin/audit/options`、読取専用のトランザクション）、`server.ts`
- web: `pages/permissions-page.tsx`・`pages/audit-page.tsx`・`components/permission-notes.tsx`（新規、UI キット）、`api/access-insight.ts`・`lib/permission-matrix.ts`・`lib/audit-search.ts`（新規）、`lib/format.ts`（`formatTimestamp` に時間帯）、`router.tsx`（2 route）、`lib/navigation-data.ts`・`lib/navigation.ts`（条件 `admin`）、`lib/help.ts`（08 章の 2 節）、`ui/token-usage.test.ts` の `CONVERTED`
- tests: `kernel/test/permission-matrix.test.ts`（20 件）、`kernel/test/audit-search.test.ts`（13 件）、`kernel/test/audit-search.db.test.ts`（12 件）、`apps/api/test/access-insight.db.test.ts`（14 件）、`apps/web/src/lib/permission-matrix.test.ts`（6 件）、`apps/web/src/lib/audit-search.test.ts`（9 件）、`navigation.test.ts`・`help.test.ts` に追加、`apps/web/e2e/access-insight.spec.ts`（3 件）
- 文書: spec（批評への対応、implemented、実装時の確認と計測）、ADR-0007 追補、マニュアル 08（「権限マトリクス」「監査ログの検索」）と付録 E §2、`docs/operations/setup.md`（0018 の適用の注意）

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] 単体: `kernel/test/permission-matrix.test.ts` 20 件（全セルの `can()`、店舗・拠点の範囲での `can()`、店舗端末の actor での `can()`、全 action・全ロールの `canRunAction()`、遷移の `runnableRoles` と `submitVia`、要約文の日英、`self`、`restrictedOps`、kernel の機能、actor ごとの拒否、会社なしの `applied: false`）、`kernel/test/audit-search.test.ts` 13 件（AC-15 の各 400、日本時間の範囲、cursor の往復と改ざん、403 が 400 より先、409、共通の変更前後の絞り込み、監査の書込の走査）、Web の 2 ファイル 15 件と `navigation.test.ts`・`help.test.ts`・`token-usage.test.ts`・`format.test.ts` 成功。
- [実測] DB（`daifuku_test_f3ai`）: `kernel/test/audit-search.db.test.ts` 12 件（マイクロ秒だけ違う `at` と同じ `at` の行を owner で入れてページの境界の両側に置き、`limit` 1・2・4 で重複・欠落なし、途中の追記でずれない、会社・テナント範囲・別 tenant の分離、会社の管理者のテナント範囲の 403、409、利用者の絞り込みに代理元、元の所属者の候補と絞り込み、未適用のパックの行の除外で `limit=2` のページが 2 件・1 件、その entity の 403、記録後に `outputHidden` になった項目と ext を含む旧い行、`export_rows` の監査と伏せ字、検索の前後で件数が変わらない）、`apps/api/test/access-insight.db.test.ts` 14 件（全 runtime の HTTP。上の比較と、sales・店舗限定の admin・別会社の会社管理者の 403、`x-agent-id` の 200、期間・利用者・代理・対象・操作・記録 id、cursor で全ページ、会社 A・B の分離、テナント範囲、400 の項目、366 日の境界、`workforce_receipt` の `storageKey` が返らない、未適用のパックの行の除外と 403、メールの無い候補と元の所属者、件数が変わらない、`pg_indexes` の 3 本）。
- [実測] ブラウザ（`e2e-run.sh … 22`、新しい fixture DB、`--project=chromium --no-deps`）: `access-insight.spec.ts` 3 件成功（39.3 秒）。権限表で取引先 × sales のセルが API の `grants.sales` と同じ、業務とロールの絞り込みが再読込で残る、ロール別表示、入出金の詳細で sales の行ルールの要約「区分 = 入金」、アクションのタブ、英語 1280px、390px（ロールを 1 つ選んだ表示が既定、ページの横スクロールなし）、axe。監査で利用者を第 2 の利用者に絞ると 50 件すべてがその人、次へ（6 件、2 ページ目、次へが無効）・前へ・最初へ、記録へのリンクで取引先の画面、戻るで条件が戻る、`op=export` で CSV 出力の要約（列）、再読込で条件が残る、開始 > 終了で終了日の欄に理由と焦点、読めない URL の条件の通知、英語、390px、axe。sales だけの利用者に画面検索の項目が無く直接開くと説明、API は 3 経路とも 403。会社の管理者には範囲の切替が無い。スクリーンショット（権限表のデスクトップ・390px、監査のデスクトップ）を目視で確認した。
- [実測] 索引の計測（AC-18、検証手順 4）: 自分で作った使い捨ての DB に migration 0000〜0018 で schema を作り、80 万行を入れて計測（spec の「実装時の確認と変更」の表）。S1〜S7 は索引を足した後 Seq Scan なしで 5.1 ms 以下、S8 は 192 ms・S9 は 42 ms（基準 500 ms 以下）。索引の大きさ 59 MB・65 MB・3.4 MB、作成 3.0〜3.3 秒、1 万件の挿入は中央値でおよそ 1.30 秒 → 1.54 秒。計測の後に DB を消した。最初の投入では乱数が全行で同じになる SQL の誤り（相関の無い `lateral` が 1 回だけ評価された）に気付き、外側の列を参照する形に直して入れ直してから計った。
- [実測] `pnpm gate:light`（`GATE_DB_SHARDS=1`、`daifuku_test_f3ai`）: 1 回目は typecheck:web で失敗（`e2e/access-insight.spec.ts` の axe の補助関数の幅を `number` にしていて `A11yRun` の `390 | 1280` に合わない。ブラウザの実行は tsx の型無視で通っていた）。型を直して再実行し成功（1,240.1 秒＝20.7 分）: format・docs・assurance・typecheck（root / api / web）・lint・unit 166 ファイル 1,750 件（101.6 秒）・DB 136 ファイル 909 件（1,238.8 秒、kernel の変更で全件。テンプレートは「DB に再作成で消える物がある」として使われず schema を作り直す経路）・test:deploy（22.6 秒）。負荷平均 4〜7 の共有コンテナ。比較の基点は gate が選んだ `origin/main` との merge-base（`431dda5`）。
- [実測] 最終状態でブラウザ試験を再実行（slot 22）: `access-insight.spec.ts` 3 件、`navigation-assist.spec.ts` 12 件（help と navigation の変更）、`setup-health.spec.ts` 4 件（`health.ts` の判定をロール定数に替えたため）の計 19 件成功（2.7 分）。
- [実測] 終了時に `pnpm test:db:templates -- --drop`（テンプレート 66 個・747.9 MB を削除、シャードなし）、自分で作った `daifuku_test_f3ai` と計測用 DB も削除した。
- [実測、レビュー後の修正（fixer）] 単体: `kernel/test/audit-search.test.ts` 16 件（2000-01-01 の下限、日を繰り上げる cursor と 0 年の cursor の拒否、見てよい対象）、`kernel/test/permission-matrix.test.ts` 20 件（`pmx_approver_lite`・`retract` を足した遷移の判定）。fixer が `update` の要件を消す変異と `!t.roles` の分岐を変える変異を当て、どちらも AC-3(f) の試験が失敗することを確かめてから戻した。Web の `audit-search.test.ts`・`permission-matrix.test.ts` 17 件（`isAuditCursor`、`conditionsOf`、数の URL 値、下限日、「続きのページ」、`*` の印、admin の札）。
- [実測、fixer] DB（`daifuku_test_w45`）: `kernel/test/audit-search.db.test.ts` と `apps/api/test/access-insight.db.test.ts` の計 28 件（registry に無い名前の行が返らず指定は 403、kernel の監査対象は保存された値のまま、2026-02-30・0 年の cursor と 0001-01-01 の期間が 400、9999-12-31 は 200、全 runtime の店舗・拠点・店舗端末の比較 1 万セル超）。
- [実測、fixer] 索引の計り直し（使い捨ての DB、80 万 4 千行、S1〜S9 を新旧の文で 3 回ずつ）: 計画は新旧同じで Seq Scan なし、S1〜S7 は 7.1 ms 以下、S8 143 ms・S9 27 ms（spec の「レビュー後の修正」の表）。負荷平均 12〜13。計測の後に DB を消した。
- [実測、fixer] ブラウザ（`e2e-run.sh … 22`、新しい fixture DB、`--project=chromium --no-deps`）: `access-insight.spec.ts` 4 件（追加した回帰試験: cursor 付きの URL は「続きのページ」で最後のページの「次へ」が不透明度 0.5、条件を変えた検索で URL から cursor が消え先頭行が API の 1 ページ目と同じで「1 ページ目」、同じ条件の検索で要求が出る、`?cursor=abc&user=123` は読めない条件の通知でエラーなし、未適用のパックの entity は対象の欄に理由が出てフォームが残る、範囲を「テナントの管理操作」にすると検索前に対象の候補が `access_user` になり `partner` が消える）、kit の `aria-disabled` の見た目を変えたので `setup-health.spec.ts` 4 件と `company-admin.spec.ts` 4 件も実行し、計 12 件成功（4.6 分）。権限表と監査のスクリーンショットで行見出しと「JST」の見た目を確かめた。
- [実測、fixer] `pnpm gate:light`（`GATE_DB_SHARDS=1`、`daifuku_test_w45`）: 1 回目は unit の 2 件が負荷と固定ポートで失敗（`password-hash.test.ts` の 5 秒の時間切れ、`identity-runner.test.ts` の 127.0.0.1:3109 が他の実行に使われていて EADDRINUSE）。どちらもこの変更と無関係で、`password-hash` は単独で成功。`--keep-going` で再実行: format・docs・assurance・typecheck（root / api / web）・lint・unit 166 ファイル 1,755 件・test:deploy は成功、DB は 136 ファイル中 134 成功（906 件）で、`apps/edge/test/actual-api.db.test.ts`（合成 API の起動の時間切れ）と `kernel/test/test-template.db.test.ts` の 1 件（30 秒の時間切れ）が負荷平均 14〜25 の中で失敗。この 2 ファイルを負荷平均 7.8 で単独に再実行して 18 件成功。どちらもこの変更が触れていない試験。テンプレートは「DB に再作成で消える物がある」として使われず、schema を作り直す経路だった。
- [レビュー] 読取専用の route（`readOnlySnapshot`）、監査表の権限と trigger を変えていないこと、module・pack・app が DB に直接触れていないこと（kernel の関数だけを呼ぶ）。
- [未検証] `pnpm gate:full`（統合担当）。fixer の変更後の全ブラウザ試験（実行したのは上の 3 spec だけ。kit の `aria-disabled` の見た目と表の行見出しの CSS は他の画面にも当たる）。`settings-console.spec.ts` などの設定画面のブラウザ試験（`settings.ts` の判定の置換えは同じ真理値で、DB 試験 `settings-console.db.test.ts` で確認）。本番相当の分布・同時実行の負荷での検索時間（1 台・1 回の計測）。F2 の `machine` actor での 403 は F2 の統合後（この branch には `machine` の型が無いので、型を偽った Context の単体試験だけ）。全ブラウザ試験（自分の spec だけ実行）。

## 見つけた問題と修正（発見経路つき）

- 計測の投入 SQL で全行が同じ値になっていた — 発見: 実測（索引の大きさが 5 MB と小さすぎた）、修正: 計測スクリプト（コミットしない）。
- zod 4 は項目の誤りがあっても `superRefine` を続けるので、実在しない日付でも「開始 > 終了」が重ねて出た — 発見: 単体試験、修正: 両端が実在する日付のときだけ期間を比べる。
- markdown を Prettier で整形して既存の表まで変えていた（`format` の対象は markdown を含まない）— 発見: レビュー（diff）、修正: 追加部分だけを残して戻した。
- 以下はレビュー（workflow のレビュー担当、spec・安全・UX の観点）の指摘を fixer がコードと実行で確かめて直したもの。詳細は spec の「レビュー後の修正」。
- 新しい検索が前のページの cursor を持ち越し、1 ページ目と表示しながら途中から始まっていた — 発見: レビュー（ブラウザでの再現）、修正: フォームは条件だけ（`conditionsOf`）を持ち、検索で cursor を外す。回帰試験: 単体（`audit-search.test.ts`）とブラウザ（cursor 付きの URL から条件を変えて検索し、URL に cursor が無く先頭行が API の 1 ページ目の先頭と同じ）。
- 壊れた cursor（`?cursor=abc`）が読めない条件として無視されず、API の 400 で再試行も失敗した — 発見: レビュー、修正: 画面で `decodeAuditCursor` と同じ形を確かめる `isAuditCursor`。router が数として読む `?user=123` も黙って捨てずに「読めない条件」に出す（`validateSearch` を型で絞らない）。
- 400 にすべき入力が Postgres の誤りで 500 になった（日を繰り上げる cursor、0 年の cursor、0001-01-01 からの期間）— 発見: レビュー（HTTP の試し打ち）、修正: cursor の `at` は往復する実在の時刻（0001 年以降）、期間は 2000-01-01 以降（kernel と画面）。kernel の単体試験と API の DB 試験に各 400 を足した。
- registry に無い名前（`DAIFUKU_PACKS` で外したパックの entity など）の行が保存された値のまま返っていた — 発見: レビュー（安全）、修正: fail closed（`entity IN (読める entity ∪ kernel の監査対象)`、外の名前の指定は 403）。**試験の変更**: kernel の DB 試験は「registry に無い名前は保存された値のまま返る」を期待していたので、「返らず、指定は 403」に改めた（振る舞いの変更に合わせた強化で、弱めてはいない）。同じ試験の page の行は registry に無い `asd_page` だったので、試験の entity として宣言した。
- 公開 index が access の判定の無い `auditSearchStatement`・`unreadableEntities` を export していた — 発見: レビュー、修正: index から外した（`audit-search.ts` からは試験・計測用に export）。
- 権限表の単体試験で、遷移の `update` の要件と `roles` の無い遷移の分岐を消す変異が生き残った — 発見: レビュー（変異試験）、修正: `pmx_approver_lite`（遷移のロールと `submit`、`update` なし）と `retract`（`roles` なし）を足し、`runnableRoles` を明示して確かめた。fixer が同じ 2 つの変異を当て、どちらも失敗することを確かめた。
- ADR-0007 追補と作業記録が「全 runtime の DB 試験も店舗・拠点・店舗端末・遷移をセルごとに比べる」と書いていたが、DB 試験は `accessScope: 'all'` と action だけだった — 発見: レビュー、修正: DB 試験に店舗・拠点・店舗端末の比較を足し、遷移は単体試験だけと追補を直した（名前付き遷移を宣言する module はまだ無い）。
- 画面: `entity` 付きの 403 で画面全体が「管理者だけ」になる、範囲を切り替えても候補が前の範囲のまま、`aria-disabled` の Button が無効に見えない、URL から開いた後のページを「1 ページ目」と言う、同じ条件の「検索」が読み直さない、表に行見出しが無い、ロールを並べた表で遷移経由の「確」に印が無い、admin の表示で「項目の制限」の札、結果の行のリンク・ボタンの名前が行ごとに同じで時刻に時間帯が無い — 発見: レビュー（UX）、修正: spec の「レビュー後の修正」のとおり。
- マニュアル 08 が「制限項目は出ない」「店舗・拠点に限定された所属には画面が表示されない」と実際と違うことを書いていた — 発見: レビュー、修正: admin には制限項目も出る（`outputHidden` はだれにも出ない）、店舗・拠点に限定された admin には項目が出て開くと「管理者だけ」と直した。

## 未実施（減らさない。完了したら「済」を付けて残す）

- 監査の検索の MCP の tool、全会社の一括検索、検索結果の CSV 出力、利用者を選んだ実効権限の表示（spec の未決事項 1〜4）。
- `audit_log_at_idx` の削除の判断（未決事項 5。計測した範囲では使う検索が無い）。

## 判断待ち（利用者）

- spec の未決事項 1〜7（推奨は spec のとおり）。

## 次のセッションへ

- 統合時: F2・F1 の監査の対象・操作を `AUDIT_SUBJECTS`・`AUDIT_OP_LABELS` に足す（走査の試験が失敗して知らせる）。fail closed にしたので、足さない対象の行は検索に出ない。migration の番号が衝突したら後の branch で `pnpm db:generate audit_search_indexes` を作り直す。`a11y.spec.ts` の画面一覧に 2 画面を足すか（この spec の中で axe を実行済み）。

## 統合時の修正（2026-10-30、統合担当）

- 第7波の統合で、API キー（F2）・Webhook の署名鍵とイベント配送（F1）の監査が加わり、AC-17 の走査試験が予定どおり失敗した。`AUDIT_SUBJECTS` に `machine_credential`・`webhook_secret`・`event_delivery`（いずれも会社範囲）を、`AUDIT_OP_LABELS` に `issue`・`revoke`・`use_denied`・`retry` を足した。
- F2 は監査の対象名を定数 `ENTITY = 'machine_credential'` で渡すため、文字列リテラルだけを見る走査では漏れ、閉じた許可リストにより API キーの監査が検索に出ないところだった。走査試験を、同じファイルの文字列定数（`const X = '...'`）も解決するよう強め、`machine_credential` が見つかることも検査に足した（`AUDIT_SUBJECTS` から外すと失敗することを確認）。
- 統合の独立レビューの指摘で、監査の検索で API キーの操作者（`actorType: 'machine'`）が「machine: <id>」と英語のまま出ていたので、画面の表示に「API キー」/「API key」を足した（単体試験の期待値は、仕様が未対応として残していた表示を固定していたため直した。知らない種類はそのまま出す検査を足した）。移行は統合で `0021_audit_search_indexes.sql` になった（`docs/operations/setup.md` と ADR-0007 の名前を直した）。
