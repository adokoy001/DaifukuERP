# 作業記録: 2026-10-30 固定資産台帳と減価償却（E1）

- セッション: 完成度向上の計画 E1 の実装（spec 作成セッションの worktree `wip/fixed-assets`、基点 `ffc2f42`。統合担当が中断した実装セッションを再開したもの） ／ 担当: agent ／ 対象: [docs/specs/fixed-assets.md](../specs/fixed-assets.md)
- 計測: tokens=null, agent_minutes=150（うち gate:light の待ち約 70）, human_minutes=0, rework_lines=90, gate_failures=3（環境要因の 1 回を除く）。修正セッション: agent_minutes=65（うち gate:light の待ち約 20）, rework_lines=420, gate_failures=0

## 決めたこと（と理由）

- 中断した実装セッションの未コミットの編集（`modules/fixed-assets` の entity・規則の契約・償却計算・履歴・仕訳・申告集計・設定・書込 capability）は、spec と照らして妥当だったため残し、そのまま続けた。計算（`services/schedule.ts`）は golden G1〜G9・D1〜D6 の単体試験を最初に書いて全件一致を確認してから上に積んだ。
- 渡された批評の指摘は 0 件。spec の「批評への対応」にその旨を追記した（コミット `86b70e9`）。
- 実装で spec に足した決定を D23〜D25 として spec に記録した: 設定 `fixed_assets.accounts` に `outputTax`（仮受消費税 2200）を追加（D23）、`depreciation_run` と明細の汎用作成の拒否を before_validate でも行う（全項目が serverOwned のため、before_create の前に必須検査で落ちて `use_depreciation_screen` が届かない。D24）、科目コードの重なりの試験を新しいファイル `apps/runtime/test/chart-codes.test.ts` に置く（D25）。
- 一次資料（`www.nta.go.jp`、`laws.e-gov.go.jp`）は今回もプロキシの CONNECT 403 で開けなかった。spec D11・AC-35 のとおり、`l10n/jp` の規則集合 `jp-2026-10-30` は domain 文書の表を転記して `verifiedOn: null` で出荷し、会社の照合記録（設定 `fixed_assets.rules_confirmation`）が無い限り償却の実行と除却・売却の確定を `rules_unverified` で止める。定率法 21 年以上の行は入れていない。
- ADR は追加していない（予約の ADR-0040 は未使用）。kernel・DSL・kernel port を変えず、module の override 点に国別パックが期間付きデータを登録する既存の形（ADR-0008・0011・0013、前例 `purchase.exempt_supplier_credit_ratio`）で足りたため。
- E2（定期仕訳）は基点に無いため依存しない（spec D16）。C5（帳票の共通化）・B4（導入ウィザード）にも依存していない。

## やったこと

- 新 module `modules/fixed-assets`（`@daifuku/mod-fixed-assets`、module 名 `fixed_assets`）: entity `fixed_asset`、document `depreciation_run`（明細 `depreciation_run_line`、番号 DR-）、document `fixed_asset_disposal`（番号 FD-）。hooks（台帳の補完・検査・財務項目の固定・削除拒否、実行の確定時の再検査と `postFromSource`・取消の順序と訂正日の検査と `reverseSourceEntry`、除却・売却の下書きの計算・確定・取消と資産の状態）、actions（`preview_depreciation`・`run_depreciation`・`depreciation_schedule`・`property_tax_summary`・`depreciation_rules`・`todo`）、設定 2 件、導入チェック `fixed_assets.depreciation_rules`（order 60）、移行 `0018_fixed_assets.sql`（新しい 4 表だけ）。
- `l10n/jp`: 規則集合（定額法 2〜50 年、200% 定率法 2〜20 年、備忘価額、償却方法の制限、耐用年数の例 10 件、償却資産申告のデータ）を override 点に登録、科目表に 1910・1920〜1925・1929・1930・8100・8200・8300 を追加。`@daifuku/mod-fixed-assets` は型だけ import し、`JapanModule.depends` と登録順は変えていない。
- `apps/runtime` のカタログに `FixedAssetsModule` を `JapanModule` の前に追加。`apps/api`・`apps/runtime`・`l10n/jp` の依存に追加。
- Web: `/finance/depreciation`（`pages/depreciation-page.tsx`、`api/depreciation.ts`、`lib/depreciation.ts`）を UI キットで作成。router、`navigation-data.ts`（分野 finance、module `fixed_assets` も finance に割当て）、`help.ts`（画面・entity・帳票）、`token-usage.test.ts` の CONVERTED を更新。
- 文書: マニュアル新章 `docs/manual/appendix-o-fixed-assets.md`、`06-monthly.md`（月末の流れに償却）、`00-index.md`、`docs/architecture/program-map.md`、`docs/specs/l10n-jp.md` AC-1、`docs/verification/invariants.md`（`PV-FIXED-ASSETS-01`）、`docs/domain/japan-fixed-assets.md`（再試行の記録）。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] 単体: `modules/fixed-assets/test`（schedule・posting・property-tax・periods・rules）33 件、golden G1〜G9（切替えの年・最後の 1 円の年を含む）、D1〜D7、R1、PT1 と、fast-check の性質（全年度の合計 = 取得価額 − 備忘価額、帳簿価額 ≧ 備忘価額、配分の合計 = 年額、実行の順序・間隔に依らない。200 件）がすべて一致。性質の試験は最初、取得価額 2 円の反例で失敗した（年額が切捨てで 0 になり永遠に償却しない）。実務上ありえない大きさのため生成範囲を 10,000 円以上に絞り、理由を試験に書いた（計算の変更ではない）。
- [実測] 単体: `l10n/jp/test/fixed-assets-rules.test.ts`（日本の規則集合が module の schema に通る・JP/JPY だけで使える・`verifiedOn: null`・出典 URL・行の範囲・golden の率が表から引ける）、`apps/runtime/test/chart-codes.test.ts`（日本の科目表とパックの seed の科目コードが重ならない）、`apps/web/src/lib/depreciation.test.ts`（URL・実行の可否・日英の文言・合計・告知・分野と説明の対応）。
- [実測] DB（`daifuku_test_w61`）: `modules/fixed-assets/test` の asset 12 件・depreciation 18 件・disposal 10 件・reports 5 件・access 5 件・health 5 件・todo 4 件と、`apps/api/test/fixed-assets.db.test.ts` 2 件（全 module の runtime で日本の規則が使われ、照合記録までは `rules_unverified`、記録後は計上できる）、`l10n/jp/test/l10n-jp.db.test.ts`、`apps/api/test/setup-health.db.test.ts`（`STABLE_IDS` に `fixed_assets.depreciation_rules`、`KNOWN_HREFS` に `/finance/depreciation` を追加）がすべて通過。2 トランザクションの同時実行で明細が資産ごとに 1 つ、締め済みの期間・年度・未来の期間・後の年度の計上・途中の期間の取消・年度外の訂正日・除却済み資産を含む取消・汎用作成の拒否、売却の消費税集計表の売上の行（標準 450,000 / 45,000、非課税 450,000）を確認。
- [実測] ブラウザ（スロット 24、Chromium、`--no-deps`）: `apps/web/e2e/fixed-assets.spec.ts` 2 件通過（画面検索から開く、既定の期間の URL 固定、未照合の帯と実行の無効、率表の表示、汎用フォーム（ラベル付きの節）で資産を登録、設定画面で照合を記録、kit の Dialog で実行・告知・実行の一覧と仕訳リンク、2 回目は `created: false`、除却の確定で資産が disposed、閲覧者に実行ボタンが無い、英語表示、390px で横にはみ出さない、axe の serious / critical なし）。390px の撮影画像を目視で確認。
- [実測] 関連するブラウザ試験（同じスロット、`--no-deps`）: setup-health 4・settings-console 5・navigation-assist 12・inbox 3・close-guide 4・navigation 4 が通過、navigation の「店舗の従業員」1 件が失敗。この試験は業種（飲食チェーン）の fixture を前提とし、`--no-deps` では業種プロジェクトが走らない。業種プロジェクト付き（`--no-deps` なし）で navigation と fixed-assets を再実行し、業種 3・fixed-assets 2・navigation 5 の 10 件が通過。
- [実測] `GATE_DB_SHARDS=1 pnpm gate:light`: 1 回目は unit で `l10n/jp/test/services.test.ts` の請求書 golden が失敗（下の「見つけた問題」）。2 回目（1,320 秒、負荷 5〜10）は format・docs・assurance・typecheck 3 種・lint・unit（170 ファイル / 1,739 件）・deploy が通過し、DB は 142 ファイル中 3 ファイル（13 件）が失敗: `apps/api/test/scenario.db.test.ts`（module の登録順の期待値に `fixed_assets` が無い）と、`boolean-migration.db.test.ts`・`ext-index-migration.db.test.ts`（移行の前後で public の制約全体が同じことを期待しており、0018 が足す表の制約で差が出る）。いずれも試験側を直し（下の「見つけた問題」）、3 ファイルだけを再実行して 22 件通過。3 回目は API の typecheck が、追加した試験の補助関数の型（driver の行の型）で失敗し、型を直した。4 回目は unit の `apps/api/test/identity-runner.test.ts` が `EADDRINUSE 127.0.0.1:3109`（同じ機械の別の作業の API が固定の port を使っていた。環境要因）で失敗し、単独の再実行で 3 件通過。**5 回目で全段階が通過**（format・docs・assurance・typecheck 3 種・lint・unit 170 ファイル / 1,739 件・deploy・DB 142 ファイル / 944 件、1,821 秒、負荷 10〜15。基点との差分が大きく DB は全件が選ばれた）。
- [レビュー] modules が drizzle・postgres・fastify・node:fs を import しないこと、`systemContext()` を使っていないこと、すべての読み書きが呼び出し元の Context の Repository であること、serverOwned の書込が `defineWriteCapability` の中だけであることを、差分を読んで確認。lint:boundaries は gate の lint で通過。
- [未検証] 償却率表・保証率・改定償却率・備忘価額・償却方法の制限・償却資産申告のデータの一次資料との照合（ネットワークの許可外。spec Q1）。spec 検証手順 4 の API の手動確認（`pnpm dev:api` での操作）は行っていない。同じ流れは DB 試験とブラウザ試験で実行した。`pnpm gate:full`（統合担当が実行）。ブラウザの全 182 件は流していない（変更に関係する spec だけ）。

## 見つけた問題と修正（発見経路つき）

- 汎用の `depreciation_run.create {}` が `use_depreciation_screen` でなく `VALIDATION` で落ちる — 発見: DB 試験（実測）、修正: before_validate（作成時のみ）でも拒否（D24、`e8ca603` に含む）。
- ブラウザ試験の登録で `getByLabel` が必須の印（*）付きのラベルに一致しない、利用者管理の API が会社の管理者では使えない — 発見: ブラウザ試験（実測）、修正: role と accessible name で探す、閲覧者の作成はテナントの管理者のセッションで行う（試験側の誤り）。
- `fixed_asset` の画面の現在位置が「その他」になる — 発見: ブラウザ試験の画面の記録（実測）、修正: `navigation-data.ts` の module と分野の対応に `fixed_assets: 'finance'` を追加。
- 自分が `l10n/jp/test` をディレクトリごと prettier にかけ、請求書の golden（HTML）と申告準備の fixture（JSON）を整形してしまった — 発見: gate:light の unit（実測）、修正: 両ファイルを基点の内容に戻した（`ad3d4c9`）。リポジトリの `pnpm format` は ts/tsx/js/css だけを対象にするため、以後は対象を絞って整形する。

- `apps/api/test/scenario.db.test.ts` の module の登録順の期待値に `fixed_assets` が無い — 発見: gate:light の DB（実測）、修正: カタログの変更（`JapanModule` の前に `FixedAssetsModule`）に合わせて期待値に `fixed_assets` を追加（仕様の変更に合わせた更新で、検査は弱めていない）。
- `apps/api/test/boolean-migration.db.test.ts`・`ext-index-migration.db.test.ts` が、古い移行（0016 / 0015）から最新まで流した後の public の制約一覧を移行前と丸ごと比べており、後の移行が新しい表を足すと必ず失敗する作りだった — 発見: gate:light の DB（実測）、修正: 比較を「移行前に存在した表の制約」に限る `onExistingRelations`（`boolean-migration-fixture.ts`）を両方の試験に入れた。既存の表の制約は従来どおり全部比べるため、0017 / 0016 が既存の表を変えないことの検査は残る。新しい表の制約は比べなくなる（0018 が足す表は移行の対象外のデータで、その制約は `0018_snapshot.json` と schema の差分が 0 であること（同じ試験の `pendingMigration` の検査）で確かめている）。同じ回で表を足す他の項目（F1・F2 など）も同じ失敗になるため、統合時に重複して直さないよう integrationNotes に書く。

## 修正セッション（2026-10-30、実装レビューへの対応）

実装レビュー（spec・安全性・UX）の指摘 23 件を、コードと照らして確かめてから直した。対応の一覧は spec の「実装レビューへの対応」。22 件を採用（うち 2 件は文書だけ・1 件は一部採用）、AI_INDEX.md の 1 件は「この回は AI_INDEX.md を編集しない」決まりのため不採用（案は下の「次のセッションへ」）。

### 決めたこと（と理由）

- ロックの順序（D26）: 除却・売却の確定と取消で、先に資産の状態を書込 capability で書いて資産の行を `FOR NO KEY UPDATE` で押さえ、その後に会社のロックを取る。台帳の更新（kernel が行を押さえてからフックが会社のロック）と同じ順になる。kernel の `Repository.lock` に弱いロックの型を足す案は kernel の変更（全 DB 試験の再実行と ADR-0020 の追記）になるため採らなかった。名称・メモなどだけの更新は会社のロックを取らない。
- 計上済み額の集計（D27）: 会計年度ごとに集計し、kernel の集計の上限（10,000 組、超えても誤りにならない）に届いたら `history_too_large` で止める（部分的な合計で続けると二重計上になる）。
- 最初の会計年度より前に供用し移行値の無い資産は `opening_required` として計上せず、除却・売却は拒否する（AC-3）。停止（実行全体の拒否）にしなかったのは、1 件の設定漏れで会社全体の償却が止まるため。件数は試算の画面に出す。
- 照合記録の対象（AC-35）: 率表だけでなく、表を適用する取得日・備忘価額と取得日・償却方法の制限・円未満の切捨てとした。切捨ての出典は依然として未確認（Q6）で、切捨てを規則データの属性にはしていない（一次資料で別の扱いが分かったら属性にする）。
- 極端に小さい取得価額（年額が切捨てで 0）は AC-2 で拒否せず、AC-9 と PV-FIXED-ASSETS-01 に性質の成り立つ条件を書いた（拒否の条件が一次資料に無いため）。
- 規則の表の横スクロールの枠は、中に焦点を受ける要素が無いため枠自体を焦点可能にした（docs/conventions/ui.md の規則）。kit の `DataTableShell` には属性が無く、kit の変更を避けて画面側の枠（`analytics-result.tsx` と同じ形）にした。

### やったこと

- module: `services/run-checks.ts`（試算の `blockers` と実行の拒否の共通の純粋関数）、`plan.ts` の `needsOpening` と `opening_required`、`history.ts` の年度ごとの集計と上限の検査、`hooks/disposal.ts` のロックの順序、`hooks/asset.ts` の会社のロックの位置、`actions/depreciation.ts` の科目コード、`actions/reports.ts` の行数の上限・閲覧者の言語・別会社の年度の `NOT_FOUND`、`services/property-tax.ts` の未設定の市区町村（null とラベル）、案内・設定の説明・項目の説明の文言。
- Web: 試算の表の科目の列、実行の後の焦点、会計期間の無い会社の空の状態、取り直しの失敗の表示と実行の無効化、表の更新中の表示、読み込み中のライブ領域の位置、規則の表示（常に置く。出典のリンク、償却方法の名前と取得日、備忘価額、償却方法の制限、端数処理、耐用年数の例）、設定へのリンクを router の Link に、償却方法の文言を台帳に揃える。
- 文書: spec（AC-3・AC-9・AC-11・AC-14・AC-21・AC-22・AC-32・AC-35、golden G10・D8、D26〜D28、検証の表、対応の表）、マニュアル付録 O（照合の対象、耐用年数の例の場所、科目の列、移行値の無い資産、帳票の行数と言語）、10 制限事項（固定資産の節）、domain 文書（切捨てと照合の手順）、invariants（PV-FIXED-ASSETS-01 の条件）。

### 検証（何を・どう確認したか）

- [実測] 単体 `modules/fixed-assets/test`: 6 ファイル 39 件通過（G10・D8 と run-checks の 4 件を追加）。切捨ての検査の効き目: `schedule.ts` の年額の `roundDown` を `roundUp` に変えると G10 が、除却の限度額の `roundDown` を `roundUp` に変えると D8 が失敗することを、変更して実行し、元に戻して確かめた。
- [実測] DB（`daifuku_test_w61`）: `modules/fixed-assets` の 8 ファイルと `apps/api/test/fixed-assets.db.test.ts`、9 ファイル 69 件通過。追加: ロックの順序 2 件（会社のロックを押さえた状態で除却の確定と財務項目の更新を重ね、pg_locks で待ちを確かめてから放す。確定が通り、更新は `asset_frozen` で拒否、deadlock なし。メモの更新は会社のロックを待たない）、規模 3 件（10,001 件の資産で明細表と申告集計が先頭 10,000 行・`meta.truncated`・合計は全件、1 年度に 10,001 件の計上済み明細で試算が `history_too_large`）、`opening_required`、別会社・存在しない会計年度の `NOT_FOUND`、帳票の日英の文言。ロックの順序の試験は、hooks を修正前の版に戻して実行すると 2 件とも失敗した（更新が `pg_advisory_xact_lock` の deadlock で失敗、メモの更新が会社のロックを待つ）ことを確かめ、元に戻した。
- [実測] Web 単体 `apps/web/src/lib/depreciation.test.ts` 7 件通過。
- [実測] ブラウザ（スロット 24、Chromium、`--no-deps`）: `apps/web/e2e/fixed-assets.spec.ts` 2 件通過。追加の確認: 科目の列 `6700 / 1929`、規則の表示の見出し（償却方法の名前つき）と出典のリンク、計上のある試算を 390px で横にはみ出さず axe の serious / critical なし（表、規則の表示を開いた状態、確認の Dialog の 3 状態）、実行の後に焦点が期間の見出しにあり実行ボタンが無効。初回はこの 390px の axe で、規則の表の横スクロールの枠に焦点が無い違反（scrollable-region-focusable、serious）が見つかり、枠を焦点可能にして再実行で通過した。計上の無い試算の英語・390px・axe は従来の 2 件目の試験。
- [レビュー] 会計期間の無い会社の空の状態、取り直しの失敗の表示と実行の無効化、`opening_required` の画面の案内は、コードを読んで確認した（ブラウザでは作れていない。合成会社は会社の作成時に会計年度が入るため）。
- [実測] `GATE_DB_SHARDS=1 pnpm gate:light`（`daifuku_test_w61`）: 1 回で全段階が通過（format・docs・assurance・typecheck 3 種・lint・unit 171 ファイル / 1,747 件・deploy・DB 143 ファイル / 952 件。DB 1,125 秒、負荷 2〜11。基点との差分が大きく DB は全件が選ばれた）。その後に作業記録・spec を直したため、`pnpm docs:check` を単独で再実行して通過。
- [未検証] `pnpm gate:full`（統合担当が実行）。ブラウザの全 182 件は流していない（`fixed-assets.spec.ts` だけ）。

### 見つけた問題と修正（発見経路つき）

- 上の 23 件（発見: 実装レビュー。ロックの順序・集計の上限・行数の上限はレビューの実測、ほかはレビューのコード読み）。
- 規則の表の横スクロールの枠がキーボードで操作できない — 発見: 追加した 390px の axe（実測）、修正: 枠に `tabIndex=0`・`role="region"`・名前。

## 2 回目の修正セッション（2026-10-30、検証担当の指摘への対応）

### 決めたこと（と理由）

- 年額の切捨ての golden G11（G10 と同じ 3 年の定額法、事業供用 2026-05-01、334,000 × 8 / 12 = 222,666.67 → 222,666）を足した。G10 の端数 0.33 は 0.5 未満のため、四捨五入でも 194,833 となり切捨てと区別できない（検証担当が年額を `roundHalfUp` に変えて単体・DB が通ることを実測で示した）。G10 は切上げの検査として残し、D8 が G10 の資産を前提にしているため置き換えではなく追加にした。
- spec の G10 の行の「切上げ・四捨五入なら 194,834」は誤り（四捨五入では 194,833）だったため、「切上げなら 194,834。四捨五入との区別は G11」に改めた。対応の表の 1 行目も G11 と、変異の結果（どの変更でどの golden が失敗するか）に揃えた。

### やったこと

- 試験: `modules/fixed-assets/test/schedule.test.ts` に G11（年額・月の配分の最初と最後・月次の実行の年度ごとの合計）。`fixture-rules.ts` と試験の冒頭の注記の golden の範囲。
- 文書: spec（golden G10 の文言、G11 の行、検証の表 G1〜G11、対応の表 1 行目）、マニュアル付録 O と invariants の golden の範囲。

### 検証（何を・どう確認したか）

- [実測] 単体 `modules/fixed-assets/test`: 6 ファイル 40 件通過。
- [実測] 変異: `schedule.ts` の年額（80 行目）の `roundDown(0)` を `roundHalfUp(0)` に変えると G11 だけが失敗、`roundUp(0)` に変えると G10・G11 が失敗することを、変更して実行し、元に戻して確かめた。除却の限度額（D8）は前回の検証で切上げ・四捨五入とも失敗を確認済み（検証担当の実測）。
- [実測] `GATE_DB_SHARDS=1 pnpm gate:light`（`daifuku_test_w61`）: 1 回で全段階が通過（format・docs・assurance・typecheck 3 種・lint・unit 171 ファイル / 1,748 件・deploy・DB 143 ファイル / 952 件、DB 931 秒）。その後に作業記録だけを直したため、`pnpm format:check` と `pnpm docs:check` を単独で再実行して通過。
- [実測] ブラウザ（スロット 24、Chromium、`--no-deps`）: `apps/web/e2e/fixed-assets.spec.ts` 2 件通過（今回は画面を変えていないが、指示どおり再実行）。
- [未検証] `pnpm gate:full`・ブラウザの全件（統合担当が実行）。

## 未実施（減らさない。完了したら「済」を付けて残す）

- 償却率表の一次資料との照合と `verifiedOn` の記入（spec Q1。ネットワークの許可が要る）。
- 1 回 500 件を超える実行（spec Q2）、台帳と元帳の突合帳票（Q3）、少額・一括・特別償却（Q4）、締めガイドの点検項目（Q5）、売却の課税売上の表し方の置き換え（Q8）。
- 帳票の印刷（C5 の `<module>.render_<document>_html` の形。統合後に `fixed_assets.render_register_html` を足せる）。
- 役割別ホーム（C6）・導入ウィザード（B4）への固定資産の表示。

## 判断待ち（利用者）

- spec の Q1〜Q8（推奨の既定は spec に記載）。特に Q1: `www.nta.go.jp`・`laws.e-gov.go.jp` への接続を許可して照合するか、会社ごとの照合記録で運用するか。

## 次のセッションへ

- 統合担当: `apps/web/src/router.tsx`・`lib/navigation-data.ts`・`lib/help.ts`・`ui/token-usage.test.ts` の CONVERTED の追加を、round 5〜6 の追加（`/finance/recurring`、`/finance/opening`、`/setup` など）と合わせる。マニュアルの章の記号 `appendix-o` が同じ回の他の項目と重なれば振り直す（spec D17）。移行の番号 `0018` が他の項目と重なれば振り直す（`pnpm db:generate` で作り直せる）。E2 の統合後、ナビゲーションで `/finance/recurring` と並べる。B4（導入ウィザード）の完了条件に `fixed_assets.depreciation_rules` を使うかは統合担当の判断。
- 照合が済んだら、`l10n/jp/src/fixed-assets/rules.ts` の `verifiedOn` に照合日を入れ、規則集合の id を新しくする（会社の照合記録は不要になる）。domain 文書の【未確認】を「確認 YYYY-MM-DD」に改める。円未満の扱いの出典が見つかったら domain 文書 #rounding に書き、切捨てと違えば規則データの属性にする。
- 統合担当（AI_INDEX.md、この回は編集しない決まり）: 読む順の表に「固定資産・減価償却 → docs/specs/fixed-assets.md、docs/domain/japan-fixed-assets.md、docs/manual/appendix-o-fixed-assets.md | modules/fixed-assets/src/services/schedule.ts、l10n/jp/src/fixed-assets/rules.ts、apps/web/src/pages/depreciation-page.tsx」の行を足す案。
