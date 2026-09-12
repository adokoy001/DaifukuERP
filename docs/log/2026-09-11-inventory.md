# 作業記録: 2026-09-11 inventory モジュール（倉庫・入出庫・在庫台帳・棚卸・移動平均）

- セッション: 実装エージェント（Claude）1 ラン ／ 担当: agent ／ 対象: docs/specs/inventory.md
- 計測: tokens=null, agent_minutes=45, human_minutes=0, rework_lines=35（src 19: −0 の符号判定 6、自動伝票の明細作成を saveLines から直接作成へ 5、受入明細の amount 4、値引明細の除外 2、棚卸フックの 0 生成の書き直し 2。test 16: AC-2 の最後の期待値 3、その他の整形 13。kernel・他モジュール・apps は未編集）, gate_failures=2（vitest unit 1、vitest db 1。内訳は下記）

## 決めたこと（と理由）
- **移動平均は「金額を累積、単価は受入時に導出」**（services/moving-average.ts、純粋関数）。状態 = 品目×倉庫の (qty, value, avgCost)。受入: costDelta = round6(数量 × 単価)、avg = round6(value ÷ qty)。払出: costDelta = −min(value, round6(数量 × avg))、avg 不変、**最後の 1 単位は残額を全部持ち出す**（qty 0 ⇒ value 0）。すべての行で costDelta = 行後 value − 行前 value なので **value = Σ costDelta が構成上つねに成立**（AC-10 の性質）。spec の `stock_balance.value = qty × avgCost` は丸め（avg 6 桁）の分だけずれるので採らず、value を真とした（avg を真にすると Σ costDelta と value が 1e-6 単位でずれ、性質テストが成り立たない）。法令の定義（取得のたびに平均単価を改定、docs/domain/inventory.md#moving-average）とも形が一致。
- **取消（AC-4）は元行の原価を戻す**: 受入行の取消 = 出庫扱いで「その行の costDelta」を取り戻し avg を再計算、出庫行の取消 = 入庫扱いで「その行の原価」を戻す（同じ移動平均式）。同じ品目×倉庫の行は seq の逆順に戻すので、全部取り消すと数量・金額が各時点の値に正確に戻る（性質テストで LIFO 復元を検査）。取消した受入より後の払出単価は再計算しない（golden 第 3 シナリオ: 平均 90 になる）。逆行の日付は元行と同じ（as-of 集計で取消伝票が両方消える）。取消でマイナスになる場合は設定が false なら INVALID_STATE（details に available / requested / reversal）。
- **マイナス在庫**（設定 true のときだけ）: マイナスの間は avg 固定・value = round6(qty × avg)、プラスに戻す受入は残数量を受入単価で評価し直す、受入実績なしの払出は単価 0。これで avg ≥ 0、qty 0 ⇒ value 0 が設定 true でも保たれる（性質テスト 2 本目）。**受入はマイナスを「作らない」ので拒否しない**（設定を後から false にしても受入でマイナスを埋められる）。
- **移動（transfer）** は移動元から移動平均で払い出し、**払い出した金額そのもの**を移動先の受入原価にする（単価 × 数量で再計算しない）。倉庫合計の金額が 1e-6 も増減しない。
- **明細の unitCost / amount**: 入庫・調整増は入力単価と数量 × 単価。出庫・移動・調整減は draft では unitCost を null にし（入力されても捨てる）、submit 時に「払出時の移動平均」と「計上額 |costDelta|」を書く。台帳の `unitCost` は spec どおり「行後の移動平均」。
- **台帳・残高への書き込み経路は src/ledger.ts だけ**。`asModule(ctx, fn)`（Context ごとの WeakMap、index.ts から export しない）の中でだけ `stock_ledger` の create と `stock_balance` の create/update を通し、hooks/guard.ts が before_validate で他の全経路を INVALID_STATE（hint = LEDGER_WRITE_HINT）にする。台帳の update/delete と残高の delete は module 内でも拒否。attachments の「before_delete で admin も含めて拒否」と同じ考え方で、「作成も module コードだけ」に広げた。ロール表は submit する人の Context で転記するために inventory / sales / purchasing に `create`（残高は `update` も）を付けている（ADR-0007: バイパスなし）。
- **ロール（AC-9）はロール表 + フックの 2 層**（payment の方向×ロールと同じ形）。stock_entry: inventory = 全 op、purchasing = read/create/update/submit/cancel、sales = read/create/submit/cancel、accounting / viewer = read。フック（hooks/entry.ts `assertEntryRole`、明細・submit・cancel でも同じ）で **purchasing は receipt だけ**、**sales は module コード経由（売上請求書の自動出庫）だけ**に絞る（PERMISSION_DENIED の op は `create:issue` のように `<op>:<type>`）。spec の「sales read」「purchasing create/submit receipt」をそのまま表に書くと、sales だけのユーザーが物品の請求書を submit できない（自動出庫は submit したユーザーの Context で動く）ので、表は広げてフックで狭めた。stock_count は inventory のみ（accounting / viewer は read）。warehouse は inventory 全 op、他は read。
- **sourceEntity / sourceId はシステム所有**: create では module コード以外の値を null に戻し（amend の複製もリンクが外れる）、update のパッチからは削除。submit 時、リンクがあれば「source が submitted の文書」であることを確認（`purchase_invoice` / `sales_invoice` / `stock_count` のみ）。そのため自動伝票は元文書の **after_submit** で作る（before_submit では元文書がまだ draft）。
- **自動入出庫（AC-5）**: 対象は「品目が goods・数量 > 0・単価 ≥ 0」の明細。サービス品目、経費行（productId なし）、返品（数量 ≤ 0）、値引（単価 < 0）は対象外（負の単価を入庫単価にすると VALIDATION で請求書 submit ごと止まるため）。受入単価は税抜: 税抜入力なら単価そのもの、税込入力なら `unitPrice ÷ (1 + 税率)` を 6 桁四捨五入。税率は請求書自身の `taxSummary`（purchase が日付で解決した率）から取る。取消は after_cancel で、リンクされた submitted の伝票を（設定の現在値に関係なく）取り消す。
- **自動伝票の明細は `saveLines` を使わず 1 行ずつ create**: kernel の saveLines は親を `rawGet(id, 'update')` で読むため、親の update 権限が要る。sales に stock_entry の update を足す代わりに、明細の create（sales に付与済み）で作る（DB テストで発見、下記）。
- **棚卸（AC-6）**: 明細の systemQty は draft 保存のたびに残高から、submit で再読込（保存後に在庫が動いても submit 時点の差異で調整する。DB テストで確認）。同一品目 2 行は submit で VALIDATION。差異 ≠ 0 の行だけで `adjustment` 伝票（増は現在の平均単価、減は移動平均で払出）を after_submit で作成・submit し、`stock_count.adjustmentEntryId`（ref、allowOnSubmit）でリンク。ref なので **棚卸が submitted の間は調整伝票単独の取消が kernel の依存チェックで HAS_DEPENDENTS**。棚卸の取消は after_cancel で調整伝票を取り消す（before_cancel だと自分がまだ submitted で依存チェックに掛かる）。
- **レポート（AC-7）**: `stock_on_hand` は asOf なしなら stock_balance、asOf ありなら台帳を `date ≤ asOf` で Σ（aggregate ポート）。`valuation { asOf }` は品目ごとに倉庫合計（avg = Σ金額 ÷ Σ数量）、合計 = 期末商品棚卸高の元。`ledger` は前残行（type `opening`）＋日付・作成時刻・id 順の行と累計。`count_variance` は draft なら現在の残高、submitted なら確定した数量と調整伝票の金額。数量も金額も 0 の残高行は出さない。品目名は呼び出し側に product の read が無ければ id を出す（accounting でも評価表が見られる）。
- **設定（AC-8）**: `inventory.allow_negative_stock`（false）、`inventory.auto_receipt_on_purchase`（true）、`inventory.auto_issue_on_sales`（true）、`inventory.default_warehouse`（'MAIN'）。既定倉庫はコード → 無ければ isDefault の倉庫 → どちらも無ければ INVALID_STATE（請求書の submit ごと失敗、請求書は draft のまま）。isDefault は 1 倉庫だけ（保存時に他を false にする）。
- **シード**: `MAIN`「本店（主倉庫）」isDefault=true（コードが既にあれば何もしない）。
- **ファイル配置の spec との差**: DB に触る転記は `services/ledger.ts` ではなく `src/ledger.ts`（layers.md で services/ は純粋関数。sales の `src/recalculate.ts`、payment の `src/invoices.ts` と同じ扱い）。純粋な伝票ルールを `services/entry-rules.ts` に、フックを `entry.ts`（ヘッダ）/ `lines.ts`（明細）/ `guard.ts`（台帳・残高）/ `warehouse.ts` にも分けた。棚卸→調整明細の純粋関数は `services/from-invoice.ts` に同居。
- **spec に無い列**: `stock_ledger.reversal`（取消行の区別。取消時に元行だけを選ぶのに要る）、`stock_balance.lastSeq`（seq の採番）、`stock_count.adjustmentEntryId`。

## golden（AC-11、test/golden/moving-average.json）の導出
単価・金額は小数 6 桁で四捨五入。各行 = (数量増減, 金額増減, 行後平均, 行後数量, 行後金額)。
1. **spec の例**
   - 受入 10 @100: 10×100 = 1,000 → (10, 1000, 1000÷10 = **100**, 10, 1000)
   - 受入 10 @120: 10×120 = 1,200、金額 2,200、数量 20 → (10, 1200, 2200÷20 = **110**, 20, 2200)
   - 払出 5: 5×110 = 550 ≤ 2,200 → (−5, −550, 110, 15, **1,650**)
   - 受入 5 @130: 5×130 = 650、金額 1,650 + 650 = 2,300、数量 20 → (5, 650, **2,300 ÷ 20 = 115**, 20, 2300)。**spec の「avg 120」は誤りで 115**（(15×110 + 5×130) ÷ 20 = (1,650 + 650) ÷ 20 = 2,300 ÷ 20 = 115。spec 自身が「自分で計算せよ」としていた箇所）
   - 払出 20（全量）: 残額 2,300 を全部 → (−20, −2300, 115, 0, 0)
2. **丸め**: 受入 1 @100 → (1, 100, 100, 1, 100)。受入 2 @100.01 → 200.02、金額 300.02、300.02 ÷ 3 = 100.00666… → **100.006667** → (2, 200.02, 100.006667, 3, 300.02)。払出 1 → round6(1 × 100.006667) = 100.006667 → (−1, −100.006667, 100.006667, 2, 200.013333)。払出 2（全量）→ 2 × 100.006667 = 200.013334 ではなく**残額 200.013333** → (−2, −200.013333, 100.006667, 0, 0)
3. **取消（逆順）**: 受入 10 @100 (10, 1000, 100, 10, 1000) → 受入 10 @120 (10, 1200, 110, 20, 2200) → 払出 5 (−5, −550, 110, 15, 1650) → 2 回目の受入を取消: 原価 1,200 を戻す、1,650 − 1,200 = 450、数量 5、450 ÷ 5 = **90** → (−10, −1200, 90, 5, 450) → 払出を取消: 原価 550 を戻す、450 + 550 = 1,000、数量 10、1000 ÷ 10 = 100 → (5, 550, 100, 10, 1000) → 1 回目の受入を取消: 数量 0 なので残額 1,000 → (−10, −1000, 100, 0, 0)
4. **マイナス在庫（設定 true）**: 受入 5 @100 (5, 500, 100, 5, 500) → 払出 8: 数量 −3、金額 = −3 × 100 = −300、増減 −300 − 500 = −800 → (−8, −800, 100, −3, −300) → 受入 10 @120: 数量 7 > 0 なので 7 × 120 = 840 に再評価、増減 840 − (−300) = **1,140**（= 10×120 − 3×(120 − 100)、不足 3 個の単価差 60 は在庫金額に残らない）→ (10, 1140, 120, 7, 840) → 払出 7（全量）→ (−7, −840, 120, 0, 0)。Σ増減 = 500 − 800 + 1140 − 840 = 0

## やったこと
- 読んだもの: CLAUDE.md、ADR-0005/0006/0010/0013/0014、conventions（layers / code-style / errors / testing / money-and-dates / reports）、spec（inventory / sales / purchase / payment）、modules/payment/src 全部、modules/sales（index / entities / hooks lines・recalc・submit・cancel / recalculate / settings）、modules/purchase（index / module / entities / hooks 全部 / services recalculate・posting）、modules/product（product entity / module / seeds / hooks）、modules/attachments（entity / integrity hooks）、modules/accounting（index / journal_line / freeze-lines / no-cancel）、modules/tax（index / summary / compute / tax_rate）、kernel（index / lines / document / registry / settings / table-result / context / permissions / repository / aggregate / query / rows / dsl fields・types・entity・defs・module・action / actions run・crud・crud-schemas / db zod / decimal / ids / errors / numbering / testing）、apps/api の modules.ts と scenario テスト（統合時の影響確認のため）、payment の作業記録。
- 新規ファイル（src 29 ファイル 1,873 行、test 5 ファイル 914 行 + golden JSON 48 行）:
  - entities: `warehouse.ts` `stock-ledger.ts` `stock-balance.ts` `stock-entry.ts`（document, STK-<年>-<n>）`stock-entry-line.ts` `stock-count.ts`（document, CNT-<年>-<n>）`stock-count-line.ts`
  - services（純粋）: `moving-average.ts`（inbound / outbound / replay / round6 / fitsScale）、`entry-rules.ts`（lineDirection / headIssues / lineIssues / entryIssues / roleAllowsEntry）、`from-invoice.ts`（stockLines / netUnitPrice / ratesFromTaxSummary / receiptLinesFromPurchase / issueLinesFromSales / adjustmentLinesFromCount）
  - `ledger.ts`（postMovement / reverseSource / loadBalance / listAll）、`system-write.ts`（asModule / isModuleWrite、非公開）、`settings.ts`（4 設定、resolveDefaultWarehouse）
  - hooks: `guard.ts` `warehouse.ts` `entry.ts` `lines.ts` `submit.ts` `cancel.ts` `invoices.ts`（purchase_invoice / sales_invoice の after_submit・after_cancel）`count.ts`
  - actions: `stock-on-hand.ts` `ledger.ts` `valuation.ts` `count-variance.ts` `helpers.ts`
  - `seeds/warehouses.ts`、`module.ts`、`index.ts`
  - test: `moving-average.test.ts`（unit 20 件: golden 4 シナリオ + spec 値の確認、規則 5、fast-check 性質 3 × 各 300 runs、伝票ルール 4、請求書・棚卸の写像 3）、`fixture.ts`、`golden.ts`、`inventory.db.test.ts`（Postgres 10 件）、`invoices.db.test.ts`（Postgres 7 件）、`golden/moving-average.json`
  - docs/domain/inventory.md（新設。法令の条文と確認日、設計上の決め）
- kernel・他モジュール・apps は編集していない。`pnpm install` / `db:generate` / `db:reset` / `db:migrate` は実行していない。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）
- [実測] `npx tsc -p modules/inventory/tsconfig.json --noEmit`（src + test）: エラー 0。`pnpm typecheck`（リポジトリ全体、tsc7）: エラー 0（2026-09-11 11:43 時点。他エージェントの並行編集を含む）。
- [実測] `npx eslint modules/inventory --max-warnings 0`: 0。`pnpm lint`（eslint . + depcruise 全体）: エラー 0、`✔ no dependency violations found (403 modules, 1906 dependencies cruised)`。`npx depcruise … modules/inventory`: violations 0（177 modules, 869 dependencies）。
- [実測] `npx vitest run --project unit modules/inventory`: 1 file, 20 tests passed。`npx vitest run --project unit`（全体）: 36 files, 348 tests passed。
- [実測] `TEST_DATABASE_URL*=…/daifuku_test_inventory npx vitest run --project db modules/inventory`: **2 files, 17 tests passed**（7.4〜7.7 秒）を修正後に 4 回連続。unit + db 合わせて 3 files, 37 tests。
- [実測] DB テストで確認した事項:
  - AC-1/AC-8: 7 エンティティ、MAIN シード（2 回実行で 1 件）、コードの大文字化（`sub` → SUB）、重複コード CONFLICT、isDefault の排他（SUB を既定 → MAIN が false、戻す）、4 設定の登録と既定値、既定倉庫の解決。台帳・残高への直接書き込み（汎用 create/update/delete アクションと repo 直叩き、admin と inventory）が全部 INVALID_STATE（LEDGER_WRITE_HINT）、viewer の create は PERMISSION_DENIED。**全残高について qty・value・lastSeq が台帳の Σ数量・Σ金額・行数・max(seq) と一致**。
  - AC-2: 既定値（date = 2026-09-10 JST、MAIN、source は null に戻る）、amount = 10 × 100.5 = 1005、サービス品目は VALIDATION + SERVICE_HINT、数量 0 / 小数 7 桁、入庫の単価なし、入庫の sign、調整の sign なし、調整増の単価なし、出庫・調整減の単価は捨てる、受入の toWarehouseId、移動先 = 移動元、不正な type、明細なし submit、移動先なし submit、パッチでの source 変更は無視。
  - AC-3: 受入 2 行（10@100, 10@120）→ 台帳 2 行と残高 20/110/2200、STK-2026-nnnnnn、出庫 5 → 明細 110/550、移動 3 → MAIN 12/1320・SUB 3/330、調整（増 2@95、減 1）→ 107.857143 / 1402.142857、倉庫合計 = 2200 − 550 + 190 − 107.857143。マイナス在庫の拒否（hint「Available quantity is 0」、details、draft のまま、台帳・残高なし）、設定 true で −4 → 受入 10@50 で 6/50/300、2 行目で不足する伝票は 1 行目も含めてロールバック。
  - AC-11: golden 4 シナリオを入出庫伝票の submit / cancel で再生し、台帳行が JSON と一致。
  - AC-4: 取消で逆行追記（元行不変、reversal=true、元の日付）、払出後の受入取消は INVALID_STATE（available 2 / requested 10）で伝票・台帳とも不変、逆順の取消で 0/0、二重取消・取消後の update / delete・明細の直接 update / delete / create が INVALID_STATE（FROZEN_HINT）、amend → 明細複製・source なし・`<元番号>-1` で再 submit。
  - AC-6: 保存時 systemQty（10/5/0）、サービス品目・負数の拒否、draft の count_variance（−200）、保存後の出庫で submit 時に systemQty 9・差異 −1、調整伝票（減 1@100、増 3@0、source = stock_count、CNT-2026-nnnnnn）、残高、submitted の count_variance（accounting ロールで −100）、調整伝票単独の取消は HAS_DEPENDENTS、submitted 棚卸の明細は凍結、棚卸の取消で調整伝票も取消・残高復元、差異なしの棚卸は調整伝票なし、同一品目 2 行と明細なしの submit は VALIDATION。
  - AC-7: stock_on_hand（列、現在 13/115/1495 と 4/115/460、totals = 全残高の合計、0 行なし、sales で倉庫絞り込み、asOf 07-12 と 07-15 の再生）、ledger（前残 10/1000、累計、番号・type・entryId、totals、meta、倉庫指定なしの全倉庫累計 17/1955、from > to は VALIDATION）、valuation（17/115/1955、totals = 全残高の合計 = 台帳再生、asOf 06-30 は行なし、accounting は品目名が id）、sales の count_variance と権限なしは PERMISSION_DENIED、asOf なしの valuation は VALIDATION。
  - AC-9: purchasing が receipt を submit、issue の create / type 変更 / 明細 create / submit は PERMISSION_DENIED（op が `<op>:<type>`）、棚卸不可。sales の直接 create / submit と warehouse 更新は不可、list は可。accounting / viewer は read のみ。ロールなしは不可。**inventory 単独ロールは明細保存で product read の PERMISSION_DENIED**（gap の記録として固定）。
  - AC-5（invoices.db.test.ts）: 物品 1 + サービス 1 + 経費 1 行の仕入請求書を purchasing で submit → 入庫伝票 1 件・明細 1 行（100 / 1000、MAIN、取引先、日付、摘要に請求書番号）。税込入力で 1100 → 1000、1000（8%）→ 925.925926 / 1851.851852。物品なし・設定 false では伝票なし。sales で売上請求書 submit → 出庫 1 行 100 / 400。在庫不足は請求書 submit ごと INVALID_STATE（請求書 draft、仕訳 0 件、出庫なし）、設定 false なら出庫なしで submit。売れた分がある仕入請求書の取消は INVALID_STATE（請求書は submitted のまま）→ 売上請求書の取消で出庫取消・在庫戻り → 仕入請求書の取消で入庫取消 → amend して再 submit で新しい入庫。既定倉庫: 設定 SUB → SUB、存在しないコード → isDefault の MAIN、isDefault もなし → INVALID_STATE + DEFAULT_WAREHOUSE_HINT（請求書 draft）。
- [実測] ミューテーション 2 件（手で入れて戻した）: 払出の「残額を上限にする」を外す → unit の AC-3 issue テストが失敗。取消の受入戻しを「原価」から「移動平均」に変える → DB の AC-11 golden 再生が失敗。どちらも元に戻して再実行で green。
- [レビュー] spec のフィールド・設定・アクション名との対応、ラベル ja/en、services/ が DB に触れないこと、Decimal のみ、ファイル ≤ 400 行・関数 ≤ 80 行（eslint、警告 0）、`any`・非 null アサーションなし。
- [未検証] 並行 submit 時の Conflict（残高の expectedVersion と一意キーで検出する設計。テストなし）。
- [未検証] `apps/api/src/modules.ts` への組み込み、`pnpm db:generate`（マイグレーション）、REST / MCP / web からの操作、`pnpm gate` 一括（他モジュールの db テストは共有 DB を使うので未実行）。

## 見つけた問題と修正（発見経路つき）
- **−0 を負数と判定**: decimal.js は 0 × 負数 = −0 で、`isNegative()` が true。単価 0 の払出（costDelta 0）を取り消すと「totalCost 0 must not be negative」— 発見: 実測（fast-check の性質テスト、反例 `[in 0.001 @0, out 0.001]`）。修正: 符号判定を `lt(0)` に、状態の 0 を正の 0 に正規化（src 6 行）。gate_failures 1（unit）。
- **kernel の saveLines が親の update 権限を要求**: 売上請求書の自動出庫で sales ロールが `update on stock_entry` の PERMISSION_DENIED — 発見: 実測（invoices.db.test.ts、3 件失敗。うち 2 件は連鎖）。修正: 自動伝票の明細を repo の create で 1 行ずつ作る（src 5 行）。gate_failures 1（db）。
- 受入明細の amount を台帳の costDelta にしていた（マイナス在庫からの受入で数量 × 単価と異なる）— 発見: レビュー。修正: 明細は数量 × 単価のまま、台帳が評価額の増減を持つ。
- 値引明細（単価 < 0 の物品行）が入庫単価 < 0 で請求書 submit を止める — 発見: レビュー。修正: 自動入出庫の対象外にし、unit テストに追加。
- テスト側: AC-2 の最後で「検証 issue なし」を期待していたが、実際には在庫不足の INVALID_STATE になる（品目 A に在庫がない）— 発見: レビュー（実行前）。修正: 期待値を StateError に。

## kernel / 他モジュールへの要望（gap。本ランでは編集していない）
- **「module コードだけが書ける」エンティティを DSL で宣言できない**（spec の「declare `ops`」に当たるものが無い）。module 非公開の WeakMap 印 + before_validate / before_update / before_delete フックで代替した。欲しいポート: `defineEntity({ writes: 'module' })` のような宣言で (1) 汎用 `<entity>.create/update/delete` アクションを登録しない（今は `stock_ledger.create` などが REST / OpenAPI / MCP に出ていて、呼ぶと必ず INVALID_STATE）、(2) `/meta` の ops に create / update を出さない（今は inventory / sales / purchasing に create が見え、汎用 UI が「新規」ボタンを出しうる）、(3) Repository の書き込みに module が発行したトークンを要求する。ADR-0005 の「DB トリガーで UPDATE/DELETE 拒否」も台帳一般に効く形で kernel に欲しい（journal_line もフック頼み）。
- **`saveLines` / `after_lines_saved` が親を `rawGet(id, 'update')` で読む**: 明細の create 権限だけのロールが replace-all 保存を使えない。create 時の初回保存は `create` 権限で通す（または op を引数に取る）とよい。
- **product に `inventory` ロールの read が無い**（modules/product の権限表）。inventory 単独のユーザーは明細保存（物品チェック）で PERMISSION_DENIED。テストは `['inventory', 'viewer']` で運用。product / uom に `inventory: ['read']` を足してほしい。`accounting` にも product read が無いので、評価表の品目名は id になる。
- `PermissionDenied` に hint / 追加 details を渡せない（payment と同じ gap）。type×ロールの拒否理由は op 名とログで表現。
- aggregate ポートの行数上限（10,000）超過を検出できない（`truncated` は「ちょうど上限件数返った」で近似）。

## 未実施（減らさない。完了したら「済」を付けて残す）
- `apps/api/src/modules.ts`（と apps/mcp）に `InventoryModule` を追加（PurchaseModule・SalesModule の後）→ `pnpm db:generate` → 統合テスト。**注意 2 点**: (1) `apps/api/test/scenario.db.test.ts` は物品 P3（書籍）・P4（菓子）を仕入なしで売上請求書にしている。組み込むと既定設定（自動出庫 true、マイナス在庫 false）で **INV2/INV3 の submit が INVALID_STATE になる**。シナリオ側で `inventory.allow_negative_stock = true` か `inventory.auto_issue_on_sales = false` を設定するか、仕入を先に入れる判断が要る。(2) 同テストの `seededModules` 期待値（`['partner', 'product', 'tax', 'accounting', 'l10n_jp']`）に `inventory` が増える。
- 並行 submit（同一品目×倉庫）の Conflict テスト。
- 付随費用（運賃・手数料）の取得価額への配賦、控除対象外消費税の扱い（docs/domain/inventory.md）。
- 最終仕入原価法（法定評価方法）の評価額レポート、総平均法、低価法、再評価（遡及計算・repost）。
- 期末商品棚卸高の決算整理仕訳を切るパックのアクション（spec スコープ外）。
- 棚卸の倉庫を draft 中に変えたとき明細の systemQty を即時再計算する（今は submit 時と count_variance で最新化）。
- ロット / シリアル、FIFO / 標準原価、発注点、複数倉庫の自動引当（spec スコープ外）。

## 判断待ち（利用者）
- AC-9 のロール: sales / purchasing にロール表で create / submit / cancel（台帳・残高の create / update）を付け、フックで「purchasing は入庫だけ」「sales は請求書経由だけ」に絞った。spec の文言（sales read）と表の見え方が違う。
- 平均単価の単位: spec どおり品目×倉庫。法令の「種類等ごと」（品目単位の単一平均）と一致しない（docs/domain/inventory.md）。税務の評価額として使うなら品目単位の平均が要るか。
- 取消時に後続払出の単価を再計算しない（golden 第 3 シナリオで平均 90）。repost を入れるか。
- 移動平均は submit 順。過去日付の伝票を許すか（締め済み期間の概念を在庫にも入れるか）。
- マイナス在庫からの受入の再評価ルール（不足分の単価差を在庫金額に残さない）。
- 自動入出庫の対象外（返品・値引明細）を手の入出庫伝票に任せてよいか。

## 次のセッションへ
- API/UI: 入出庫は `stock_entry.create { type, date?, warehouseId?, toWarehouseId?, partnerId?, note?, lines: { stock_entry_line: [{ productId, quantity, sign?, unitCost? }] } }` → `stock_entry.submit { id }`、取消は `stock_entry.cancel`。棚卸は `stock_count.create { warehouseId?, date?, lines: { stock_count_line: [{ productId, countedQty }] } }` → `stock_count.submit`。照会は `inventory.stock_on_hand { warehouseId?, asOf? }`、`inventory.ledger { productId, warehouseId?, from, to }`、`inventory.valuation { asOf }`、`inventory.count_variance { countId }`。
- 台帳・残高は伝票でしか動かない（直接書き込みは INVALID_STATE）。
