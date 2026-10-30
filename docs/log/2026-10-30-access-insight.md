# 作業記録: 2026-10-30 権限マトリクスと監査の横断検索（F3）

- セッション: 完成度向上計画 F3（workflow の実装担当、worktree `wip/access-insight`、基点 `ffc2f42`）／ 担当: agent ／ 対象: [docs/specs/access-insight.md](../specs/access-insight.md)
- 計測: tokens=null（未計測）, agent_minutes=約 75（15:19〜16:34、gate とブラウザ試験の待ちを含む）, human_minutes=0, rework_lines=約 40（試験の期待値の直し、spec の 366 日の例、markdown の整形の戻し、e2e の型）, gate_failures=1（1 回目の gate:light が e2e の型の誤りで typecheck:web に失敗。直して再実行し成功）

## 決めたこと（と理由）

- **spec 批評の 16 件はすべて受け入れた**（spec の判断 16 に要約）。うち 1 件は例が誤っていた: 「2025-01-01〜2026-01-01 は 367 日」は数え違いで、実際は両端を含めて 366 日。拒否の例を閏年をまたぐ 2024-01-01〜2025-01-01（367 日）に替え、kernel・Web・API の試験で同じ例を使った。
- **権限表は kernel の純粋関数で導出し、試験でエンジンとセルごとに突き合わせる。** `derivePermissionMatrix(input)` は registry の中身を引数で受け取るので、単体試験は自分の試験用 registry（行ルールの自分・条件・`$or`・`$ne`・`docstatus`、項目の制限、店舗・親・共有閲覧・拠点の方針、`registerStoreAccess`、店舗端末、名前付き遷移、document と非 document、pack の entity と action、`audit: 'none'`、module の roles 宣言）で全セルを `can()`・`canRunAction()`・`transitionDocument` の判定と比べる。API の DB 試験は全 runtime で同じ比較をする（約 5,000 セル以上）。
- **行ルールの要約は kernel で作る**（field と enum のラベル、`$ctx` の語、`docstatus` の状態名）。知らない演算子は元の JSON。`self` は最上位の AND の等号か token だけの `$in` に限った（`$or` の中、`$ne` は「条件付き」）。行ルールは作成を制限しないので、ロールごとの `restrictedOps`（`create` を除く）を返し、凡例に書いた。
- **kernel の機能のロールを定数にした**（`kernel-capabilities.ts` の `SETTINGS_ROLES`・`HEALTH_ROLES`・`ACCESS_INSIGHT_ROLES`）。`settings.ts`・`health.ts` の判定をその定数に置き換え、権限表の凡例も同じ定数から作る。手書きの一覧が判定とずれない。
- **監査の検索の入口は人の資格情報だけ。** `actor.type` が `user`、または `onBehalfOf` のある `agent`（利用者の JWT ＋ `x-agent-id`）を許し、`relay`・`system`・F2 の `machine` は拒む。route は querystring を検証せずに kernel へ渡し、kernel が 403（ロール・範囲・actor）→ 400（条件）→ 403（テナント範囲）→ 409（会社なし）の順に判定する。admin でない人に条件の形を知らせない。
- **cursor は `at` をマイクロ秒まで残す。** JS の `Date` はミリ秒で切れるので、SQL の `to_char(at at time zone 'UTC', …US…)` を cursor に入れ、`(at, id) < ($1::timestamptz, $2::uuid)` の行値の比較で続きを取る。計測で索引の範囲走査のままであることを確かめた（S2）。
- **読めない entity の行は SQL の WHERE で除く**（`entity NOT IN (…)`）。JS で除くとページが欠ける。全 runtime で会社にパックが無いとき 33 個の名前になり、計測もこの条件込みで行った。
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
- [レビュー] 読取専用の route（`readOnlySnapshot`）、監査表の権限と trigger を変えていないこと、module・pack・app が DB に直接触れていないこと（kernel の関数だけを呼ぶ）。
- [未検証] `pnpm gate:full`（統合担当）。`settings-console.spec.ts` などの設定画面のブラウザ試験（`settings.ts` の判定の置換えは同じ真理値で、DB 試験 `settings-console.db.test.ts` で確認）。本番相当の分布・同時実行の負荷での検索時間（1 台・1 回の計測）。F2 の `machine` actor での 403 は F2 の統合後（この branch には `machine` の型が無いので、型を偽った Context の単体試験だけ）。全ブラウザ試験（自分の spec だけ実行）。

## 見つけた問題と修正（発見経路つき）

- 計測の投入 SQL で全行が同じ値になっていた — 発見: 実測（索引の大きさが 5 MB と小さすぎた）、修正: 計測スクリプト（コミットしない）。
- zod 4 は項目の誤りがあっても `superRefine` を続けるので、実在しない日付でも「開始 > 終了」が重ねて出た — 発見: 単体試験、修正: 両端が実在する日付のときだけ期間を比べる。
- markdown を Prettier で整形して既存の表まで変えていた（`format` の対象は markdown を含まない）— 発見: レビュー（diff）、修正: 追加部分だけを残して戻した。

## 未実施（減らさない。完了したら「済」を付けて残す）

- 監査の検索の MCP の tool、全会社の一括検索、検索結果の CSV 出力、利用者を選んだ実効権限の表示（spec の未決事項 1〜4）。
- `audit_log_at_idx` の削除の判断（未決事項 5。計測した範囲では使う検索が無い）。

## 判断待ち（利用者）

- spec の未決事項 1〜7（推奨は spec のとおり）。

## 次のセッションへ

- 統合時: F2・F1 の監査の対象・操作を `AUDIT_SUBJECTS`・`AUDIT_OP_LABELS` に足す（走査の試験が失敗して知らせる）。migration の番号が衝突したら後の branch で `pnpm db:generate audit_search_indexes` を作り直す。`a11y.spec.ts` の画面一覧に 2 画面を足すか（この spec の中で axe を実行済み）。
