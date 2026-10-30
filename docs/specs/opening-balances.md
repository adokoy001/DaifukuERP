# Spec: opening-balances（期首残高の取込）

- 状態: implemented（2026-10-30。実装と検証は [作業記録](../log/2026-10-30-opening-balances.md)）
- モジュール: `modules/accounting`（期首残高日の規則、開始仕訳の取込・取消・状況、期首残高仮勘定の設定）、`modules/sales`（期首売掛金）、`modules/purchase`（期首買掛金）、`modules/inventory`（期首在庫）、`l10n/jp`（科目 3900）、`kernel`（取込のセル変換の公開だけ）、`apps/web`（`/finance/opening`） ／ 依存: [csv-import](csv-import.md)（B5、事前確認と行ごとの結果の型、CSV の読込）、[ui-kit](ui-kit.md)（D1）、[list-workbench](list-workbench.md)（C1、期首伝票の一括取消に使う）
- ADR: **ADR-0030（新規。実装時に作成。0027〜0029 は使用・予約済みのため。統合時に番号が衝突したら振り直す）**「期首残高は期首日の前日付で、期首残高仮勘定を介して開始仕訳と module 所有の期首伝票に分ける」。関連: [ADR-0005](../adr/0005-append-only-ledger.md)（取消は逆仕訳）、[ADR-0006](../adr/0006-docstatus-lifecycle.md)、[ADR-0007](../adr/0007-authorization.md)、[ADR-0010](../adr/0010-money-decimal.md)、[ADR-0013](../adr/0013-hexagonal-ports.md)、[ADR-0016](../adr/0016-foundation-invariants.md)（module 内部の書込権限）、[ADR-0028](../adr/0028-import-port.md)（取込 port）
- 作成: 2026-10-30 ／ 作成者: agent（spec 作成セッション、ブランチ `wip/opening-balances`）。設計の元は [完成度向上の実装計画](../completion-plan.md) B6
- 作業記録: [docs/log/2026-10-30-opening-balances.md](../log/2026-10-30-opening-balances.md)
- 制度事実: [docs/domain/opening-balances.md](../domain/opening-balances.md)（この spec と同時に追加。一部【未確認】）

## 目的（1段落）

他システムや手書きの帳簿から移るとき、利用開始の会計年度の期首時点の残高（試算表の貸借対照表科目、得意先別の未入金・仕入先別の未払、品目別の在庫数量と単価）を入れないと、試算表・年齢表・在庫評価が実態と合わない。現在は仕訳を 1 本ずつ手入力するしかなく、売掛金・買掛金を仕訳で入れると取引先別の消込と年齢表に使えず、在庫は移動平均の初期値を正しく作る手順が無い。経理担当者（または管理者）が、CSV を 3 区分（開始仕訳・売掛金/買掛金・在庫）で事前確認 → 行ごとの結果 → 実行の順に取り込み、取消と再取込で直せるようにする。新しい閲覧・書込の経路は作らず、既存の `Repository`・伝票の確定・転記・逆仕訳を要求者の権限で呼ぶ。

## 用語

| 用語                        | 意味                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 期首日                      | 対象の会計年度の開始日（`fiscal_year.startDate`）                                                                                                                         |
| 期首残高日（`openingDate`） | 期首日の前日。すべての期首伝票の日付。どの会計期間にも入らない（AC-1、AC-2）                                                                                              |
| 開始仕訳                    | 期首残高日付の 1 本の仕訳。`sourceEntity = 'fiscal_year'`、`sourceId = <会計年度 id>`                                                                                     |
| 期首残高仮勘定              | 開始仕訳の取引先なしの売掛金・買掛金の行の受け皿。期首請求書で取引先別の売掛金・買掛金へ振り替える。全区分の取込が一致すれば残高 0（ERP 一般の Temporary Opening に相当） |
| 期首請求書                  | `openingBalance = true` の売上請求書・仕入請求書。不課税の明細 1 行。消込・年齢表の対象                                                                                   |
| 期首在庫の入庫              | 期首残高日付・`sourceEntity = 'fiscal_year'` の入出庫伝票（入庫）                                                                                                         |

## 決定事項（計画が選択を残していた点。理由付き）

- **D-1 日付は期首日の前日、入力は `fiscalYearId` だけ。** 試算表の期首残高は「`from` より前の転記済み明細」の合計（`accounting.trial_balance`、`services/ledger.ts`）なので、期首日の前日付にすれば試算表・総勘定元帳・年齢表のコードを変えずに期首欄へ出る。期首日付にすると期間欄に出てしまい、試算表に「期首残高仕訳」を特別扱いする分岐が要る。日付を入力で受けると、会計期間の中の日付や年度とずれた日付で取り込めてしまい、年度ごとの二重取込の判定もできないので受け付けない。
- **D-2 期首残高日はどの会計期間にも入らないので、accounting に限定した例外を足す（ADR-0030）。** 仕訳の確定は「日付が開いている会計期間に入ること」を要求する（[accounting](accounting.md) AC-4）。期首残高日だけを、accounting の期首残高の経路（module 内部の書込権限 `accounting.opening`。`defineWriteCapability`、ロールを広げない）から、会社の最初の会計年度について、その年度と最初の会計期間が締まっていない間に限って許す（AC-3）。前年度の会計期間を自動で作る案は採らない: 使わない 12 の期間と年度が締めガイド・申告準備に現れ、締めの順序の点検（[close-guide](close-guide.md) AC-5）も変わるため。
- **D-3 期首残高は会社の最初の会計年度にだけ取り込める（AC-2(b)）。** 前の年度がシステムにあれば、その残高は試算表の期首欄にそのまま繰り越されるので、取り込むと二重になる。逆に期首残高を取り込んだ後に前の年度を開くと期首伝票が期中の取引に変わるので、確定済みの仕訳がある期間を含む会計年度の開設を拒否する（AC-4）。
- **D-4 売掛金・買掛金は取引先別の期首請求書で持ち、開始仕訳からは外して期首残高仮勘定で受ける（計画の推奨案を採用）。** 開始仕訳の取引先付き明細だけで持つ案は消込（`payment`）・年齢表・銀行照合・受信箱の期日超過がすべて請求書を対象にしているため使えない。開始仕訳には利用者の試算表どおり売掛金・買掛金の合計行を入れてよく、取引先が空の `partnerRequired` 科目の行は自動的に仮勘定へ計上する（AC-10）。期首請求書は「借方 売掛金 ／ 貸方 仮勘定」「借方 仮勘定 ／ 貸方 買掛金」を転記するので、総勘定元帳の売掛金・買掛金は期首請求書の分だけになり二重にならない。合計が一致すれば仮勘定は 0 になり、一致しない額は仮勘定の残高として画面・試算表に見える（AC-27〜AC-28、AC-32）。開始仕訳の行に取引先を書けば、その科目に取引先付きで直接計上する（請求書で持たない部分。消込はできない旨を notice で示す）。
- **D-5 期首請求書の明細は品目を使わず、不課税の 1 行にする。** 消費税は元の取引の課税期間で処理済みで、期首残高は新しい資産の譲渡等ではない（[domain](../domain/opening-balances.md)、一部【未確認】）。品目を使うと在庫の自動出庫・入庫（`modules/inventory/src/hooks/invoices.ts`）が動き、会社ごとの品目の種まきも要る。売上の転記科目は設定 `sales.accounts.revenue` しか持たないため、`openingBalance` の請求書だけ貸方を仮勘定に替える分岐を sales の確定 hook に足す。仕入は明細の `accountId` に仮勘定を入れれば既存の転記がそのまま使える。
- **D-6 期首請求書は採番は通常の連番、発行（印刷）はしない。** DSL の採番は entity 単位で、行ごとに別の接頭辞を持てない。適格請求書の記載事項に番号は含まれない【未確認】。期首請求書は取引先へ交付しない社内の記録で、日付が元の取引年月日ではないため、`sales.render_invoice_html` は拒否する（AC-20）。
- **D-7 印は既存の field と新しい bool 1 つ。** 開始仕訳と期首在庫の入庫は既存の `sourceEntity`/`sourceId`（serverOwned または module 書込だけ）に `fiscal_year` を入れる。C2 の関連伝票（`kernel/src/related.ts` の `<x>Entity` + `<x>Id` の組）で会計年度の画面から辿れる。請求書は自身が起票元なので、`sales_invoice` と `purchase_invoice` に `openingBalance`（`f.bool`、serverOwned、immutable、既定 false）を足す（module の DSL 宣言と生成した migration。DSL 自体の拡張は無い）。
- **D-8 二重取込の単位。** 開始仕訳は年度に 1 本（既存の `liveEntriesForSource` と `accounting-source:<entity>:<id>` のロック。逆仕訳の後は取り直せる）。期首請求書は取引先ごと（未取消の期首請求書がある取引先の行は `exists`。足りない取引先だけを後から追加できる）。**期首残高日以外の日付で取り消した（`cancelledDate` ≠ 期首残高日。期中に入金・消込の後で消込を外して取り消した場合など）期首請求書がある取引先も取り込み直さない（行のエラー `cancelled_in_year`）**: その取消の逆仕訳は期中の日付なので、取り込み直すと試算表の期首欄に旧・新の両方の売掛金（買掛金）が残り、期首日を基準とする年齢表にも両方が出る。この場合の残高の訂正は期中の通常の請求書か仕訳で行う。取り込み直せるのは、その取引先・種類の過去の期首請求書がすべて期首残高日付で取り消されているときだけ。期首在庫は品目 × 倉庫ごと（在庫の移動があれば `stock_exists`。期中の日付で取り消した期首在庫は期中の日付の台帳の行を残すので、その品目 × 倉庫は以後取り込めない）。直すときは取消 + 再取込で、確定済みの期首伝票は編集しない（CLAUDE.md 規約 4）。
- **D-9 取込はどれも全件か無か。** 期首残高は仮勘定と合計で突き合わせるので、一部だけ入った状態を作らない。各行を savepoint で処理してすべての行の結果を集め、1 行でも誤りがあれば全体を巻き戻す（B5 の `atomic: true` と同じ）。
- **D-10 権限: action は accounting / admin に限り、伝票の作成は要求者自身の権限で行う。** 期首残高は帳簿の出発点なので、営業・購買の担当者には取り込ませない（action の `{ roles: ['accounting', 'admin'] }`）。一方、売上請求書・仕入請求書・入出庫伝票を accounting ロールは作れない（`permissions.roles`）。取込のためにロールを広げる・抜け道を作ることはせず（CLAUDE.md 規約 2）、売掛金・買掛金・在庫の取込は、その伝票を作れる権限も持つ利用者（通常は管理者、または一時的に営業・購買・在庫のロールも付けた経理担当者）が行う（AC-6）。未決事項 Q-1。
- **D-11 区分ごとに所有する module の action にする。** accounting は sales・purchase・inventory に依存できない（依存は sales → accounting の向き）。開始仕訳・取消・状況・期首残高日の規則は accounting、期首請求書は sales / purchase、期首在庫は inventory が持ち、共通の結果の型と年度の検査は accounting が公開する。画面が 4 つの action を順に呼ぶ。
- **D-12 B5 の取込 port は使わず、型と手順を再利用する。** B5 は document を対象外にしている（ADR-0028）。dry-run を savepoint で巻き戻す手順、行の結果 `{ line, status, messages }` と `messages` の形（kernel の `ImportMessage`）、Web の `lib/csv-parse.ts`・`headerKey`・数式対策、セルの変換規則を再利用する。セルの変換（カンマ・全角・符号の正規化、`YYYY/M/D`）を module から同じ規則で使うため、kernel の `import-values.ts` の既存の純粋関数 `decimalCell`・`dateCell`・`isContextToken` を `@daifuku/kernel` から公開する（振る舞いは変えない。kernel の公開面の追加なので ADR-0030 に記録する）。コード・名称のセルが `$ctx.` で始まるときは照会せずに行のエラー `invalid_value` にする（ADR-0028 決定 7 と同じ。`Repository` の `where` は `$ctx.` で始まる文字列を文脈の値に置き換え、未知の鍵は要求全体の VALIDATION にするため）。
- **D-13 MCP / REST にも公開する。** 4 つの取込と開始仕訳の取消は通常の module action（`internal` ではない、`mutates: true`、`inputBytes` 2 MB）として `POST /actions/<name>` と MCP ツールになる。B5 と同じく、エージェントには dry-run を先に使うようマニュアル 09 に書く。
- **D-14 同時実行の直列化の順序。** 開始仕訳の取込は、行の処理と AC-13 の二重取込の判定より前に `accounting-source:fiscal_year:<id>` のロックを取る（`postFromSource` の中のロックと同じ鍵なので、後から来た要求は先の要求の確定を待ってから判定し、行のエラーではなく CONFLICT 409 を受ける）。売掛金・買掛金は AC-18 の照会より前に `opening:sales_invoice:<fiscalYearId>`（仕入は `opening:purchase_invoice:<fiscalYearId>`）のロックを取る。在庫は `stock_exists` の照会より前に `INVENTORY_SERIES_LOCK`（`assertInventoryDate` が取る在庫の直列化のロック）を取る。区分ごとに 2 本の接続で同時に実行する DB 試験を置く。
- **D-15 1 つの伝票に多くの行を集める区分の失敗の報告。** 開始仕訳は行の検査（純粋な関数と読取）を行ごとに行い、受け付けた行から 1 本の仕訳を作る。仕訳の作成・確定が kernel のエラーで失敗したときは、行のエラーではなく `issues` の `submit_failed`（kernel のエラーのコードと文言）として `committed: false` を返す。在庫も行の検査を先に済ませ、倉庫ごと・500 明細ごとの伝票の作成・確定の失敗は `issues` の `submit_failed`（倉庫コードと何番目の伝票か）にする。売掛金・買掛金は 1 行 = 1 伝票なので、伝票の失敗はその行のエラーになる（AC-26）。kernel のエラーでも SQL のデータ・制約のエラー（SQLSTATE 22 / 23）でもない失敗は、どの区分でも要求全体を失敗させる。
- **D-16 要求全体の前提の検査を増やす。** 同じ理由で全行が同じエラーになる前提（売上・仕入の転記科目 `sales.accounts` / `purchase.accounts` の科目が無い、倉庫コードが空の行があるのに既定の倉庫が無い）は、行を処理する前に要求全体の StateError（409）にする（AC-26）。
- **D-17 期首残高日の例外は `assertOpenPeriod` の外に置く。** 公開している `assertOpenPeriod`（会計期間を返す）の契約は変えず、journal_entry の `before_submit` から呼ぶ内部の `assertPostingDate` が、AC-3 の例外に当たるときだけ `assertOpenPeriod` を呼ばずに通す。
- **D-18 支払期日が空のときの基準日。** 期首請求書の `dueDate` が空なら、`originalDate` があればそれを、無ければ期首残高日を基準に取引先の締め日・支払条件から計算する（期首残高日を基準にすると、前期の古い売掛金がすべて「期日前」になり年齢表が実態と合わないため）。
- **D-19 誤って最初にした年度から戻れるようにする（AC-4 の緩和）。** 会計年度の日付は変更・削除できないので、AC-4 を「確定済みの仕訳がある」だけで判定すると、最初の年度の選択を誤ったときに戻せない。開設しようとする年度の範囲の転記済みの仕訳明細の科目ごとの純額がすべて 0（開始仕訳と期首請求書がすべて期首残高日付で取り消し済み）なら開設を許し、0 でない科目があるときだけ拒否する。
- **D-20 小売パック（三分法の月次締め）との関係は制約として記録する。** `packs/retail` の最初の月次締めは前回の締めが無いため期首の在庫額を 0 とし、開始仕訳で入れた在庫科目（1400 商品）の期首残高を「期首商品棚卸高 ／ 商品」で振り戻さない。この項目ではパックのコードを変えず、マニュアル 03・10 に「小売パックの会社は、最初の月次締めの後に期首商品棚卸高 ／ 商品を手で仕訳するか、開始仕訳に在庫科目を入れない」と書く。パック側の対応（開始仕訳の在庫科目の残高を最初の「前回の締め」とみなす）は今後の作業として作業記録に残す。

### spec 批評への対応（2026-10-30、実装セッション）

批評の 16 件はすべて妥当と判断して取り込んだ（却下なし）。主な対応: 期中の日付で取り消した期首請求書の再取込の拒否（D-8、AC-18 `cancelled_in_year`）、`$ctx.` のセルの拒否と `isContextToken` の公開（D-12、AC-9・AC-15・AC-23）、読めないセルと範囲外の値のコード（AC-9・AC-15・AC-23）、在庫の段の有効化をロールの規則に合わせる・`asModule` は作成だけ（AC-24・AC-38）、ロックの順序と同時実行の試験（D-14）、伝票単位の失敗の報告（D-15）、小売パックの制約（D-20）、期中導入をスコープ外に明記、課税期間の記述の訂正（domain・AC-22）、ロック数の計測（検証手順 5）、試験できない文言の削除（AC-21・AC-22）、要求全体の前提の検査（D-16）、支払期日の基準日と在庫金額の丸め（D-18・AC-30）、`assertOpenPeriod` を変えない（D-17）、仮勘定の無効・流用の検査と仮勘定へ回した科目の一覧（AC-10・AC-28）、AC-4 の緩和（D-19。利用者の判断事項にする案より、純額 0 の判定のほうが単純で戻り道を残せるため）。

## 受入基準（EARS）

### 共通: 対象年度・期首残高日・権限・境界

- AC-1 THE SYSTEM SHALL 期首残高日 `openingDate` を対象の会計年度の開始日の前日（暦日。例: 2026-04-01 → 2026-03-31、2026-01-01 → 2025-12-31、2024-03-01 → 2024-02-29）とし、開始仕訳・期首請求書・期首在庫の入庫と、それらを訂正日なしで取り消したときの逆仕訳・逆行の日付をすべてこの日にする。取込・取消の入力は日付を受け付けず `fiscalYearId` だけを受け取る。
- AC-2 WHEN 期首残高の取込・取消が `fiscalYearId` を受け取った THE SYSTEM SHALL 次をすべて満たすときだけ処理する: (a) 要求者の会社の、要求者が読める会計年度である（他社・読めない id は NOT_FOUND 404、存在を漏らさない）、(b) 開始日がそれより前の会計年度が会社に無い（最初の年度）、(c) 年度が締め済みでない、(d) 年度の開始日に始まる会計期間（最初の期間）があり締め済みでない。満たさないときは何も書かずに StateError（409、`details.reason` = `not_earliest` / `year_closed` / `first_period_closed` / `no_first_period`、hint は締め済みなら `accounting.reopen_period`）を返す。
- AC-3 WHEN 仕訳が確定され（journal_entry の `before_submit` から呼ぶ内部の `assertPostingDate`。D-17）、日付を含む会計期間が無い THE SYSTEM SHALL 要求の文脈が accounting の期首残高の経路（module 内部の書込権限 `accounting.opening`。開始仕訳の取込・取消、期首請求書の確定・取消だけが付与する）を持ち、日付が会社の最初の会計年度の期首残高日に等しく、AC-2 の (c)(d) を満たすときに限り確定を許す。IF それ以外（汎用の仕訳の作成・確定、`accounting.reverse_entry`、期首残高日以外の日付、最初の期間か年度が締め済み）THEN THE SYSTEM SHALL 従来どおり StateError（会計期間が無い／締め済み）で拒否する。期首残高の経路で日付が期首残高日に等しく、最初の期間か年度が締め済みのときは StateError（`details.reason` = `first_period_closed` / `year_closed`、hint は `accounting.reopen_period`）にする。日付を含む会計期間がある場合の規則は変えない。
- AC-4 IF 開設しようとする会計年度（`accounting.open_fiscal_year` と `fiscal_year` の汎用の作成の両方）の開始日〜終了日に、科目ごとの純額（借方 − 貸方）が 0 でない転記済みの仕訳明細がある THEN THE SYSTEM SHALL 409（`details.reason = 'opening_entries_exist'`、純額が 0 でない科目のコード）で拒否する。期首残高日より前の年度を後から開いて期首伝票が期中の取引に変わることを防ぐ（D-3）。開始仕訳と期首請求書がすべて期首残高日付で取り消され、範囲内の純額がすべての科目で 0 なら開設を許す（D-19）。
- AC-5 THE SYSTEM SHALL `accounting.import_opening_balances`・`accounting.reverse_opening_balances`・`accounting.opening_balance_status` を accounting または admin ロールだけに許し（`permission: { roles: ['accounting', 'admin'] }`）、それ以外のロール（sales・purchasing・inventory・viewer など）には PERMISSION_DENIED（403）を返す。仕訳の作成・確定は要求者の文脈の `Repository` と既存の posting 権限（`withPosting`）で行う。
- AC-6 THE SYSTEM SHALL `sales.import_opening_receivables`・`purchase.import_opening_payables`・`inventory.import_opening_stock` を accounting または admin ロールだけに許し、さらに要求者自身が作る伝票の操作を持つことを行の処理の前に確かめる: 売上請求書は `sales_invoice` の create・submit と `sales_invoice_line` の create、仕入請求書は `purchase_invoice` の create・submit と `purchase_invoice_line` の create、在庫は `stock_entry` の create・submit と入庫の種類の許可（`roleAllowsEntry(roles, 'receipt', false)`）と `stock_entry_line` の create、請求書の転記のための `journal_entry` の create・submit。どれかが無ければ要求全体を PERMISSION_DENIED（403。`details` に不足する entity と操作）とし、何も書かない。取込のための権限の抜け道やロールの付与はしない（accounting ロールだけの利用者は開始仕訳だけを取り込める）。
- AC-7 THE SYSTEM SHALL 科目・取引先・品目・倉庫のコード解決、既存の期首伝票と在庫の照会、伝票の作成をすべて要求者の会社の中で `Repository`（読取権限・行規則）を通して行い、他社の記録を解決・参照・変更しない（他社にだけあるコードは `ref_not_found`）。店舗・拠点に限定された文脈と relay の文脈からの呼出しは、action が `storeAccess`・`siteAccess`・`relayAccess` を宣言しないため kernel が 403 で拒否する。
- AC-8 THE SYSTEM SHALL 4 つの取込と取消を `POST /actions/<name>` と MCP ツール（`accounting_import_opening_balances` など）から呼べる通常の action（`mutates: true`、`inputBytes` 2 MB）とし、`accounting.opening_balance_status` は `mutates: false`・`tx: 'none'` とする。2 MB を超える HTTP 本文は既存の規則で 413 と `VALIDATION` の本文、MCP と in-process の呼出しは JSON の UTF-8 長で同じ 2 MB を検査する。

### 開始仕訳

- AC-9 THE SYSTEM SHALL `accounting.import_opening_balances` の入力を `{ fiscalYearId, mode: 'dry-run' | 'execute', rows: [{ accountCode, partnerCode?, debit?, credit?, memo? }] }`（セルは文字列か null、行 1〜1,000）とし、金額を B5 と同じ変換（`decimalCell`: カンマ・全角・符号を正規化し Decimal 文字列のまま。浮動小数を経由しない）で読む。科目は `account.code` の完全一致、取引先はコード、無ければ名称の完全一致で、読取権限を通して解決する（0 件 `ref_not_found`、2 件以上 `ref_ambiguous`）。各行を次の順で分類する: 借方・貸方のどちらかが数として読めない（`decimalCell` が値を返さない）→ error `invalid_value`（field と column 付き）／借方・貸方がともに空か 0 → `skipped`（`zero_amount`）／負の金額 → error `negative_amount`／両方が正 → error `both_sides`／円未満の端数 → error `not_whole_yen`／科目コードか取引先のセルが `$ctx.` で始まる → error `invalid_value`（照会しない。D-12）／科目が無い → error `ref_not_found`／科目の区分が `revenue` か `expense` → error `pl_account`（期首残高は貸借対照表の科目だけ。前期の損益は繰越利益・元入金に含めた後の残高を入れる。[domain](../domain/opening-balances.md)）／期首残高仮勘定そのもの → error `clearing_account`／取引先が解決できない → error `ref_not_found`・`ref_ambiguous`／それ以外は受け付ける。
- AC-10 WHEN 受け付けた行の科目が `partnerRequired` で取引先が空 THE SYSTEM SHALL その金額を同じ側で期首残高仮勘定に計上し（行の状態 `clearing`、明細のメモに元の科目コードと名称「期首残高 1300 売掛金（取引先別は期首請求書）」）、取引先別の残高は期首請求書（AC-16〜AC-18）で仮勘定から振り替える。取引先がある行は、その科目に取引先付きで計上し（状態 `ok`）、科目が `partnerRequired` なら「この残高は消込・年齢表の対象になりません」の notice（`journal_only_open_item`）を返す。取引先が空で `partnerRequired` でない科目は、その科目にそのまま計上する（状態 `ok`）。結果の `clearingAccounts` に、仮勘定へ回した元の科目ごとの `{ code, name, debit, credit }` を返す（AC-32 の注意はこの一覧で科目を名指しする。売掛金・買掛金以外の `partnerRequired` 科目を仮勘定へ回した額は期首請求書で振り替わらないため）。
- AC-11 IF 受け付けた行の借方合計と貸方合計（Decimal で厳密に比較）が一致しない、または受け付けた行が 2 行未満 THEN THE SYSTEM SHALL 取り込まず、結果の `issues` に `unbalanced`（借方合計・貸方合計・差額）か `no_lines` を入れて `committed: false` を返す（execute でも何も書かない）。受け付けた行が 500 行（仕訳明細の上限）を超えるときは要求全体を VALIDATION（400）とする。
- AC-12 WHEN execute でエラー行と issue が無い THE SYSTEM SHALL 1 本の仕訳を作って確定する: 日付 = 期首残高日、摘要「期首残高 <年度コード>」、`sourceEntity = 'fiscal_year'`・`sourceId = <fiscalYearId>`、明細は受け付けた行の順（AC-10 の置換後。税区分・税率なし、メモは入力の `memo`。仮勘定へ回した行は AC-10 の既定のメモ（元の科目コードと名称）の後に入力の `memo` を続ける）。通常の確定の検査（明細ごとの借方 XOR 貸方、合計一致、取引先必須）、採番（`JE-`、期首残高日の暦年）、監査、`journal_entry.submitted` の event はそのまま働く。結果の `documents` に仕訳の id と番号を返す。
- AC-13 IF 同じ会計年度に未取消（確定済みで、確定済みの逆仕訳が無い）の開始仕訳がある THEN THE SYSTEM SHALL dry-run・execute とも CONFLICT（409、`details` に既存の仕訳の id と番号）で拒否する。要求は行の処理と二重取込の判定の前に既存の起票元ロック（`accounting-source:fiscal_year:<id>`）を取るので（D-14）、同時の 2 つの取込は直列になり、1 本だけが確定し、後の要求は CONFLICT 409 を受ける。
- AC-14 WHEN `accounting.reverse_opening_balances { fiscalYearId }` が呼ばれた THE SYSTEM SHALL AC-2 を満たすことを確かめ、その年度の未取消の開始仕訳を既存の逆仕訳の処理（`reverseSourceEntry`、期首残高日付、`journal_entry.reversed` の event）で取り消し、逆仕訳を返す。未取消の開始仕訳が無ければ StateError（409、`details.reason = 'no_opening_entry'`）。開始仕訳を汎用の `accounting.reverse_entry` や cancel で取り消すことは従来どおり拒否される（起票元のある仕訳）。期首請求書と期首在庫はこの操作では取り消さない（AC-19、AC-24）。

### 売掛金・買掛金（期首請求書）

- AC-15 THE SYSTEM SHALL `sales.import_opening_receivables` と `purchase.import_opening_payables` の入力を `{ fiscalYearId, mode, rows: [{ partnerCode, amount, dueDate?, reference?, originalDate?, memo? }] }`（行 1〜200。検証手順 5 の計測で 1,000 行の実行が 60 秒を超えたため 1,000 から下げた）とし、1 行につき 1 件の期首請求書を作る（同じ取引先の複数行は支払期日ごとの残高として別の請求書）。取引先は AC-9 と同じ規則で解決する。金額は AC-9 と同じ変換で正の円単位（0・空 → error `zero_amount`、負 → error `negative_amount`、端数 → error `not_whole_yen`）。金額が数として読めない、日付が `dateCell`（`YYYY-MM-DD` か `YYYY/M/D`）で読めない → error `invalid_value`（field と column 付き）。`originalDate` が期首残高日より後、`dueDate` が `originalDate` より前 → error `invalid_value`。取引先のセルが `$ctx.` で始まる → error `invalid_value`（照会しない。D-12）。
- AC-16 WHEN execute（または dry-run）で行を受け付けた THE SYSTEM SHALL 要求者の文脈の `Repository` で次の請求書を作って確定する: 日付 = 期首残高日、`openingBalance = true`（module 内部の書込権限でだけ書ける）、支払期日 = `dueDate`（空なら取引先の締め日・支払条件から、`originalDate` があればそれを、無ければ期首残高日を基準に計算。D-18）、税込入力 false、明細 1 行（品目なし、摘要「期首残高」、数量 1、単価 = 金額、税区分 `out_of_scope`。仕入は勘定科目 = 期首残高仮勘定）。売上は備考に「期首残高 元請求書 <reference>（<originalDate>）<memo>」、仕入は先方請求書番号に `reference`、備考に `originalDate` と `memo` を入れる。採番は通常の連番（`INV-` / `BILL-`、年は期首残高日の暦年）。
- AC-17 WHEN `openingBalance` の請求書が確定される THE SYSTEM SHALL 売上は「借方 売掛金（`sales.accounts.receivable`、取引先付き）／貸方 期首残高仮勘定（不課税）」、仕入は「借方 期首残高仮勘定（不課税）／貸方 買掛金（`purchase.accounts.payable`、取引先付き）」を期首残高日付で accounting の期首残高の経路（AC-3）を通して転記し、税額・控除対象外消費税を 0、`controlAccountId`・`journalEntryId`・`status = 'open'`・`balance = total` を通常の請求書と同じに設定する。IF `openingBalance` の請求書の明細が 1 行でない、税区分が `out_of_scope` でない、品目がある、（仕入）明細の勘定科目が期首残高仮勘定でない、または日付が会社の最初の会計年度の期首残高日でない THEN THE SYSTEM SHALL 確定を拒否する（VALIDATION）。
- AC-18 IF 行の取引先に、同じ会計年度の未取消（確定済み）の期首請求書が同じ種類（売上／仕入）で既にある THEN THE SYSTEM SHALL その行を error `exists`（既存の請求書番号付き）とする。IF その取引先・種類の期首請求書に、期首残高日以外の日付で取り消したもの（`cancelledDate` ≠ 期首残高日）がある THEN THE SYSTEM SHALL その行を error `cancelled_in_year`（請求書番号付き。hint: 期中の通常の請求書か仕訳で残高を訂正する）とする（D-8）。期首残高日付で取り消した期首請求書だけの取引先は取り込み直せる。同じファイル内の同じ取引先の複数行は許す。照会より前に年度・種類ごとの業務ロック（`withLock(ctx, 'opening:sales_invoice:<fiscalYearId>')` など）を取り（D-14）、同時の取込が同じ取引先に二重に作らない。
- AC-19 WHEN 期首請求書が通常の取消（cancel）で取り消された THE SYSTEM SHALL 通常の取消の検査（入金・支払の消込があれば拒否など）をしたうえで、逆仕訳を訂正日なしなら期首残高日付で accounting の期首残高の経路を通して作り（AC-3 の条件。最初の期間が締め済みなら拒否）、訂正日を指定したときはその日付で通常の規則で作る（その取引先・種類は以後取り込み直せない。AC-18 の `cancelled_in_year`）。IF 取り消した期首請求書から訂正（amend）で作った下書きを確定しようとした THEN THE SYSTEM SHALL VALIDATION（`opening_amend`、hint: 期首残高の取込で作り直す）で拒否する（amend は serverOwned の `openingBalance` を写さないため、そのままでは通常の請求書として売上・仕入に計上されてしまう）。
- AC-20 IF 期首請求書を `sales.render_invoice_html` で描画しようとした THEN THE SYSTEM SHALL StateError（409、`details.reason = 'opening_balance'`）を返し、適格請求書として印刷・再発行しない。期首請求書の確定では発行時データ（`issuedSnapshot`）を作らない。
- AC-21 IF 汎用の作成・更新（REST・`/actions`・MCP）で `openingBalance` を指定した THEN THE SYSTEM SHALL 既存の serverOwned の規則で拒否する（PERMISSION_DENIED `server-owned:openingBalance`）。
- AC-22 THE SYSTEM SHALL 期首請求書を通常の請求書と同じく、入金・支払の消込（`payment`、`sales.record_payment`、`purchase.record_payment`、銀行照合）、年齢表（`sales.ar_aging` / `purchase.ap_aging`。支払期日で区分）、受信箱の期日超過、関連伝票の対象にする。期首請求書の行は不課税・期首残高日付（このシステムに設定したどの会計期間にも入らない日。法的には前の課税期間の末日で、元の取引はそれぞれの課税期間で課税済み）なので、会計期間ごとの消費税集計表（`accounting.tax_period_summary`）に入らない。

### 在庫（期首在庫の入庫）

- AC-23 THE SYSTEM SHALL `inventory.import_opening_stock` の入力を `{ fiscalYearId, mode, rows: [{ warehouseCode?, productCode, quantity, unitCost }] }`（行 1〜2,000。計測で 5,000 行が約 90 秒かかったため下げた）とし、倉庫はコード（空なら既定の倉庫 `resolveDefaultWarehouse`）、品目はコード、無ければ名称の完全一致で解決する。数量は 0 より大きく小数 6 桁まで、単価は 0 以上で小数 6 桁まで（`decimalCell`、Decimal）。数量・単価が数として読めない → error `invalid_value`（field と column 付き）、数量が 0 以下 → error `non_positive_quantity`、単価が負 → error `negative_amount`、小数 7 桁以上 → error `scale_exceeded`。品目・倉庫のセルが `$ctx.` で始まる → error `invalid_value`（照会しない。D-12）。サービス品目 → error `service_product`、同じファイル内の同じ品目 × 倉庫の 2 行目以降 → error `duplicate`。IF 品目 × 倉庫に期首残高日より後の日付の在庫台帳の行がある、または現在の在庫数量か金額が 0 でない THEN THE SYSTEM SHALL その行を error `stock_exists` とする（後から過去日付で入庫しても既存の払出の単価は再計算されないため。[domain](../domain/opening-balances.md)）。この照会の前に `INVENTORY_SERIES_LOCK` を取る（D-14）。在庫評価が期首残高日まで締められていれば（`assertInventoryDate`）要求全体を既存の StateError で拒否する。
- AC-24 WHEN execute でエラー行が無い THE SYSTEM SHALL 倉庫ごとに入庫の入出庫伝票（type `receipt`、日付 = 期首残高日、備考「期首在庫 <年度コード>」、`sourceEntity = 'fiscal_year'`・`sourceId = <fiscalYearId>`（inventory の module 書込でだけ設定。`asModule` は伝票と明細の作成だけに使い、確定は `asModule` の外で要求者の文脈のまま行うので、確定時の入出庫の種類のロールの検査 `assertEntryRole(ctx, type, 'submit')` が二重の防御として働く））を明細 500 行ごとに作って確定し、各明細を CSV の単価で移動平均の最初の取得として転記する（平均単価 = 単価）。在庫は仕訳を作らない（在庫科目の期首残高は開始仕訳で入れる）。入出庫伝票の確定は、`sourceEntity = 'fiscal_year'` を、type が `receipt`、会計年度が存在し、日付がその期首残高日である場合に限り発生元として認め、それ以外の `fiscal_year` の発生元は従来どおり拒否する。期首在庫の入庫は通常の取消（cancel。訂正日なしなら期首残高日付の逆行）で取り消し、同じ品目 × 倉庫を取り込み直せる。期中の日付で取り消したときは期中の台帳の行が残るので、その品目 × 倉庫は以後 `stock_exists` になる（D-8。マニュアル 03）。

### 事前確認・結果の形・期首残高仮勘定・状況

- AC-25 WHEN `mode` が `dry-run` THE SYSTEM SHALL execute と同じ作成・確定（権限・hook・採番・転記・在庫の転記・監査）を savepoint の中で実行して巻き戻し、DB（記録・連番・監査・outbox）を変えずに execute と同じ結果を返す（`committed: false`）。
- AC-26 THE SYSTEM SHALL execute を全件か無かで行う: 各行を savepoint で処理してすべての行の結果を集め、1 行でも error があるか issue があれば外側の savepoint ごと巻き戻して `committed: false` を返す。要求全体の問題（権限、AC-2 の年度の条件、AC-13 の二重取込、期首残高仮勘定が無い・不適切、売上・仕入の転記科目が無い、倉庫コードが空の行があるのに既定の倉庫が無い（D-16）、行数・明細数・大きさの上限、会社の通貨が JPY でない）は行を処理する前に例外（400 / 403 / 404 / 409）にする。開始仕訳と在庫の伝票の作成・確定の失敗は `issues` の `submit_failed` にする（D-15）。行のエラーにするのは kernel のエラー（`DaifukuError`）とデータ・制約の SQL エラー（SQLSTATE 22 / 23）だけで、それ以外の失敗は要求全体を失敗させる（ADR-0028 と同じ）。
- AC-27 THE SYSTEM SHALL 4 つの取込の結果を同じ形 `{ mode, committed, fiscalYear: { id, code, startDate }, openingDate, summary: { rows, accepted, clearing, skipped, errors }, totals, clearingBalance?, issues, notices, rows: [{ line, status, messages? }], documents }` で返す。`line` は要求の 1 始まりの行番号、`status` は `ok` / `clearing` / `skipped` / `error`、`messages` と `notices` の要素は B5 の `ImportMessage`（`{ code, message, field?, column?, hint? }`）。`totals` は開始仕訳が `{ debit, credit, difference }`、売掛金・買掛金が `{ amount }`、在庫が `{ quantity, value }`（Decimal 文字列）。開始仕訳の結果は AC-10 の `clearingAccounts` も持つ。`clearingBalance` は開始仕訳と売掛金・買掛金の取込で、期首残高仮勘定の期首残高日時点の残高（借方 +）の `{ before, after }`（dry-run では巻き戻す前に測る）。`documents` は確定した伝票の `{ entity, id, number }` で、`committed` のときだけ入る。
- AC-28 THE SYSTEM SHALL 期首残高仮勘定を会社設定 `accounting.opening_balances`（`{ clearingAccount: string }`、既定 `{ clearingAccount: '3900' }`、設定画面の「会計」タブ、`widget: 'account-code'`、日英のラベル）の科目コードで決め、l10n/jp の科目表に `3900 期首残高仮勘定`（区分 `equity`、小区分「期首残高仮勘定」、取引先必須なし、税の役割 `none`）を追加する。IF その科目が無い、または無効（`isActive = false`）・区分が `revenue` / `expense`・取引先必須・税の役割が `none` でない THEN THE SYSTEM SHALL 開始仕訳・売掛金・買掛金の取込を要求全体の StateError（409、`details.reason = 'clearing_account_missing'` / `'clearing_account_invalid'`、設定キーと科目コード）とする。状況（AC-29）は例外にせず、同じ理由を返す。仮勘定に期首残高日以外の日付の転記済みの明細があるとき（期首残高の伝票以外で使われている）は、取込と状況に notice `clearing_account_used`（件数）を返す。
- AC-29 WHEN `accounting.opening_balance_status { fiscalYearId? }` が呼ばれた THE SYSTEM SHALL 会社の会計年度の一覧（各年度の `openingDate` と、取込できるか・できない理由 AC-2）、選んだ年度（省略時は最初の年度。会計年度が無ければ StateError `details.reason = 'no_fiscal_year'`）について、未取消の開始仕訳（id・番号・借方合計・貸方合計）と取り消した開始仕訳の件数、期首残高仮勘定（コード・名称・期首残高日時点の残高、未取消の開始仕訳の仮勘定の明細 `clearingLines: [{ memo, debit, credit }]`、期首残高日以外の日付の明細の件数、または無い・不適切の理由）を返す。
- AC-30 WHEN 開始仕訳（売掛金・買掛金を取引先なしの合計行で含む）、売掛金、買掛金、在庫の 4 つを取り込んだ THE SYSTEM SHALL `accounting.trial_balance { from: 期首日, to: 年度末 }` の各科目の期首借方・期首貸方が、開始仕訳の CSV の科目ごとの純額（借方 − 貸方を片側に表示）と一致し、期首残高仮勘定の期首残高が 0 で、`sales.ar_aging` / `purchase.ap_aging`（`asOf` = 期首日）の取引先ごとの残高と期日区分が売掛金・買掛金の CSV と一致し、`inventory.valuation { asOf: 期首残高日 }` の品目ごとの数量・金額が在庫の CSV（金額 = round6(数量 × 単価)、`moving-average.ts` の丸め）と一致する（golden。年齢表の期日区分は D-18 の支払期日の規則で決まる）。

### 画面（`/finance/opening`）

- AC-31 THE SYSTEM SHALL 画面 `/finance/opening`「期首残高の取込」（英語 "Opening balances"）を「会計・資金」分野の専用画面として画面検索・分野一覧に表示し（`accounting.import_opening_balances` を実行できる利用者だけ。`navigation-data.ts` の `action`）、マニュアル 03 から案内する。実行できない利用者が URL を直接開いたときは権限が無いことを説明する（読込失敗にしない）。会計年度が 1 つも無い会社では「会計年度がまだありません」と `accounting.open_fiscal_year` の案内を示す。
- AC-32 WHEN 画面を開いた THE SYSTEM SHALL 会計年度を選ばせ（既定は最初の年度、選択は URL `?fiscalYearId=` に置換で残す）、`accounting.opening_balance_status` の結果から次を表示する: 期首残高日、取込できない理由（あれば。最初の期間が締め済みなら再開の案内）、開始仕訳の状態（未取込、または番号・借方合計・貸方合計と仕訳へのリンク）、期首残高仮勘定の残高（0 でなければ注意の表示で金額と「仮勘定へ回した科目の合計と、売掛金・買掛金の取込額が一致していません」、および状況の `clearingLines` で仮勘定へ回した科目を名指しする）、期首請求書（売上・仕入）と期首在庫の入庫の件数と、各一覧 `/e/<entity>?status=submitted&from=<期首残高日>&to=<期首残高日>` へのリンク（要求者が読める entity だけ。件数は汎用の一覧 API の `total`）。
- AC-33 THE SYSTEM SHALL 取込を 3 つの段（1 開始仕訳、2 売掛金・買掛金（売掛金と買掛金の 2 つのファイル）、3 在庫）に分けて縦に並べ、各ファイルに見出しだけの雛形 CSV（UTF-8 BOM、CRLF、表示言語の見出し）のダウンロードを置く。順番は案内するが強制しない（どの順でも仮勘定は合計で一致する）。
- AC-34 WHEN 各段でファイルを選んだ THE SYSTEM SHALL B5 と同じ方法（`lib/csv-parse.ts` の `decodeCsvBytes`・`parseCsv`・`csvTable`、見出しより多いセルのある行を含むファイルの拒否、`'` の数式対策の除去）で読み、判別した文字コードを表示し、見出しを段ごとの固定の列（日本語・英語の見出しか field 名を `headerKey` で正規化して照合）に対応させる。必須の列が無い、知らない列がある、同じ列に当たる見出しが 2 つあるファイルは、列名を示して読み込まない。行数・要求の大きさが上限を超えるファイルは送らずに理由を示す。空の行は送らず、結果の `line` をファイル上のデータ行番号に戻して表示する。
- AC-35 WHEN 「事前確認」を押した THE SYSTEM SHALL dry-run の結果を表示する: 件数（受付・仮勘定・スキップ・エラー）、合計（開始仕訳は借方合計・貸方合計・差額、売掛金・買掛金は金額と仮勘定の取込前 → 取込後、在庫は数量と金額）、issue（貸借不一致は差額）、notice、行ごとの結果（先頭 50 行、データ行番号・状態・理由の日英の説明）とエラー行だけの絞り込み、エラー行に行番号と理由を足した CSV（UTF-8 BOM、数式対策）のダウンロード。ファイル・年度を変えたら前の結果を消して事前確認をやり直させる。
- AC-36 WHILE その段の最新の事前確認が無い、またはエラー・issue がある THE SYSTEM SHALL 「取り込む」を無効にして理由を示す。WHEN エラーの無い事前確認の後に「取り込む」を押し kit の `Dialog` で確認した THE SYSTEM SHALL execute を呼び、結果（作成した伝票の番号とリンク）を表示して結果の見出しへ焦点を移し、状況（AC-32）を取り直す。IF execute が `committed: false` を返した（事前確認の後に状態が変わった）THEN THE SYSTEM SHALL 何も取り込んでいないことと理由を示す。
- AC-37 WHEN 開始仕訳が取込済みで「開始仕訳を取り消す」を押し `Dialog` で確認した THE SYSTEM SHALL `accounting.reverse_opening_balances` を呼んで状況を取り直し、状況の見出しへ焦点を移す。期首請求書と期首在庫の入庫は画面から一括で取り消さず、AC-32 の一覧（C1 の一括取消が使える）へ案内する。
- AC-38 THE SYSTEM SHALL 要求者が作れない伝票の段を無効にし、必要なロールを説明する: 売掛金は meta の `ops` に `sales_invoice` の create・submit が無いとき（営業か管理者が必要）、買掛金は `purchase_invoice` の create・submit が無いとき（購買か管理者が必要）、在庫は `stock_entry` の create・submit が無いか、ロールが在庫・購買・管理者のどれでもないとき（サーバーの `roleAllowsEntry(roles, 'receipt', false)` と同じ規則。営業ロールは `stock_entry` の操作を持つが入庫はできない）。
- AC-39 THE SYSTEM SHALL 画面の文言（行の理由コードと issue の説明を含む）を日本語と英語で持ち、390px 幅でページと `#screen-content` が横にはみ出さず操作できる（結果の表は枠の中で横に動き、長いファイル名は折り返す）。axe の serious / critical 違反が無い（A2 の検査の方法で、日本語・1280px と 390px）。

## 関係するファイル・インターフェース（名指し）

- kernel（公開の追加だけ）: `kernel/src/index.ts` に `decimalCell`・`dateCell`・`isContextToken`（`kernel/src/import-values.ts` の既存の純粋関数）を足す。DSL・Repository・registry は変えない。
- accounting:
  - `modules/accounting/src/domain-write.ts`: 書込権限 `accounting.opening`（entity `journal_entry`、operation `opening-date`、field なし）と `withOpening(ctx, work)`（module 内部）。
  - `modules/accounting/src/services/opening.ts`（新規、純粋）: `openingDateOf(startDate)`、開始仕訳の行の分類（AC-9〜AC-11）、合計、結果の組立て。
  - `modules/accounting/src/opening.ts`（新規、公開する部品）: `assertOpeningYear(ctx, fiscalYearId)`（AC-2。`{ fiscalYear, openingDate, firstPeriod }`）、`resolveOpeningClearingAccount(ctx)`（AC-28）、`clearingBalanceAt(ctx, accountId, date)`、`postOpeningFromSource(ctx, input)`（`postFromSource` に期首残高の権限を付けたもの。日付 = 期首残高日を検査）、`reverseOpeningSourceEntry(ctx, input)`（`reverseSourceEntry` に同じ権限）、`openingImportResult`（zod、AC-27）、`OPENING_ROLES`。
  - `modules/accounting/src/actions/opening-balances.ts`（新規）: `accounting.import_opening_balances`、`accounting.reverse_opening_balances`、`accounting.opening_balance_status`。
  - `modules/accounting/src/settings.ts`（新規）: `accounting.opening_balances`（`SettingDef`、category `accounting`）と登録。
  - `modules/accounting/src/hooks/validate-entry.ts`: 内部の `assertPostingDate`（AC-3 の例外。会計期間が無い日付で、文脈が `accounting.opening` を持つときだけ。`assertOpenPeriod` は変えない。D-17）。
  - `modules/accounting/src/hooks/fiscal-dates.ts`: `fiscal_year` の `before_create` に AC-4。
  - `modules/accounting/src/module.ts`・`index.ts`: action・設定・公開部品。
- sales: `modules/sales/src/entities/sales-invoice.ts`（`openingBalance`。`views.form` に表示）、`modules/sales/src/actions/import-opening-receivables.ts`（新規）、`modules/sales/src/hooks/submit.ts`（`openingBalance` の検査、貸方を仮勘定に、`postOpeningFromSource`、`issuedSnapshot` を作らない、`opening_amend`）、`modules/sales/src/hooks/cancel.ts`（`reverseOpeningSourceEntry`）、`modules/sales/src/actions/render-invoice-html.ts`（AC-20）、`module.ts`・`index.ts`。書込権限 `sales.opening`（field `openingBalance`、operation `create`）。
- purchase: `modules/purchase/src/entities/purchase-invoice.ts`（`openingBalance`）、`modules/purchase/src/actions/import-opening-payables.ts`（新規）、`modules/purchase/src/hooks/submit.ts`（`postInvoice` を期首残高の経路に、検査、`opening_amend`）、`modules/purchase/src/hooks/cancel.ts`、`module.ts`・`index.ts`。書込権限 `purchase.opening`。
- inventory: `modules/inventory/src/actions/import-opening-stock.ts`（新規。`asModule` は `sourceEntity`/`sourceId` を書く作成だけ。確定は要求者の文脈）、`modules/inventory/src/hooks/submit.ts`（`assertSourceLink` が AC-24 の `fiscal_year` を認める）、`module.ts`・`index.ts`。
- l10n/jp: `l10n/jp/src/seeds/chart-of-accounts.ts`（`3900 期首残高仮勘定`）。
- migration: `pnpm db:schema && pnpm db:generate` で `apps/api/drizzle/migrations/0018_*.sql`（`sales_invoice.opening_balance`・`purchase_invoice.opening_balance`、boolean not null default false）。番号は統合時に調整する。
- web:
  - `apps/web/src/pages/opening-balances-page.tsx`（新規。UI キットの `PageHeader`・`Card`・`FormSection`・`DataTableShell`・`Badge`・`Button`・`Dialog`・`EmptyState`）。
  - `apps/web/src/lib/opening-balances.ts`（新規、純粋: 段ごとの列定義と見出しの照合、要求の行の組立て、雛形 CSV、エラー CSV、理由コードの日英の説明）。`lib/csv-parse.ts`・`lib/import-map.ts` の `headerKey`・`guardCell`・`unguardCell` を再利用する。
  - `apps/web/src/api/opening-balances.ts`（新規。4 つの取込・取消・状況の呼出し）。
  - `apps/web/src/router.tsx`（`/finance/opening`、`validateSearch` で `fiscalYearId`）、`apps/web/src/lib/navigation-data.ts`（「会計・資金」の専用画面の項目）、`apps/web/src/components/screen-trail.tsx`（必要なら現在位置）、`apps/web/src/ui/token-usage.test.ts`（`CONVERTED` に追加）。
- docs: `docs/adr/0030-opening-balances.md`（新規）、`docs/manual/03-setup.md`（期首残高の取込の節: CSV の列、順番、仮勘定、取消と再取込、権限、事業主貸・借の注意）、`docs/manual/06-monthly.md`（試算表の期首欄に期首残高が出ること、仮勘定が 0 であることの確認）、`docs/manual/09-ai.md`（MCP では dry-run を先に）、`docs/manual/10-limitations.md`（スコープ外の要点）、画面の一覧（`docs/manual/00-index.md`、`docs/manual/appendix-n-navigation.md`、`docs/architecture/program-map.md`）、[domain](../domain/opening-balances.md)（【未確認】の解消）。

## データ・業務ルール（出典）

- 期首の売掛金・買掛金は新しい取引ではなく、明細は不課税・税額 0 — [domain: 消費税](../domain/opening-balances.md#consumption-tax)（課税区分は No.6201 で確認済み 2026-09-10。課税の対象の条文 消費税法4条1項・2条1項8号、No.6105 は【未確認】）。
- 期首請求書は適格請求書として交付しない。記載事項②取引年月日が事実と合わないため — [domain: 適格請求書](../domain/opening-balances.md#qualified-invoice)（記載事項 6 項目は No.6625 で確認済み 2026-09-10。項目の列挙と 57条の4・57条の5 は【未確認】）。
- 期首残高は貸借対照表の科目だけ（損益科目は繰り越さない）— [domain: 損益科目](../domain/opening-balances.md#no-pl-carry)（申告準備の「期首損益残高ゼロ」は確認済み 2026-09-13。簿記の慣行と個人事業者の元入金の計算は【未確認】）。
- 期首在庫は移動平均の当初の取得価額 — [inventory.md#moving-average](../domain/inventory.md#moving-average)（2026-09-11）。
- 金額・数量は `Decimal`、JPY は円単位（ADR-0010、`modules/accounting/src/money-contract.ts` の `assertJpySettlement`）。確定済みの伝票は編集せず、取消は逆仕訳・逆行（ADR-0005、ADR-0006、CLAUDE.md 規約 4）。
- 期首残高仮勘定の科目コードは会社設定（データ）で、コードに固定しない（CLAUDE.md 規約 10 の趣旨。制度値ではない）。

## スコープ外（明記）

- 会計年度の前年度がシステムにある会社の期首残高（残高は試算表が自動で繰り越す。年度締めの損益振替仕訳は未実装）。最初の年度の取込後にそれより前の年度を開くこと（AC-4 で拒否）。
- 外貨、JPY 以外の会社。
- 売掛金・買掛金以外の科目（前受金・前払金・未払金・預り金など）を取引先別の未消込残高（請求書）として持つこと。これらは開始仕訳の取引先付きの行で入れる（消込・年齢表の対象外）。得意先の貸方残高（過入金・前受）を期首請求書にすること（負の金額は `negative_amount`。前受金の行で入れる）。
- 過去の個々の取引（元の日付の請求書・入金）の取込。残高だけを入れる。
- 期首請求書・期首在庫の一括取消の専用操作（C1 の一覧の一括取消を使う）。開始仕訳・期首伝票の編集（取消と再取込だけ）。
- 在庫の評価額と開始仕訳の在庫科目（例: 1400 商品）の自動照合（在庫は仕訳を作らず、在庫科目の設定も無い。画面は在庫の合計額を表示するだけ）。在庫の単位換算・ロット・シリアル（数量は品目の基準単位）。
- 銀行口座の残高（banking の明細）、固定資産台帳（E1）、給与の年初からの累計（年末調整用。E6）、消費税の中間納付額。
- 分析（`/analytics` の `sales_invoice`・`purchase_invoice` の集計元）に `openingBalance` の軸を足すこと（期首請求書は年度の範囲外の日付なので、年度で絞った集計には入らない）。
- 締めガイド（`accounting.close_readiness`）に仮勘定の残高の点検を足すこと（未決事項 Q-6）。
- 申告準備（`tax_filing`）の科目分類への 3900 の追加（残高 0 なら出力に影響しない見込み。未決事項 Q-7）。
- 期中導入の残高日付（例: 4 月始まりの年度の 10 月から使い始める）。期首残高の取込は年度の期首時点の残高だけを扱う。期中導入では、期首時点の残高を取り込み、経過した月は開いている会計期間に月ごとの集約仕訳で入れ、経過した月に発生して導入時点で未決済の売掛金・買掛金は期中の通常の請求書（または取引先付きの集約仕訳）で入れる（マニュアル 03）。
- 小売パック（三分法の月次締め）の最初の締めでの期首在庫の振戻し（D-20。マニュアル 03・10 に手順を書く）。

## 検証手順（E2E、実行して記録する）

試験名には対応する `AC-n` を入れる。

1. 編集中は `pnpm gate:quick`、コミット前に `pnpm gate:light`（kernel の公開と migration に触れるため DB 全件に昇格する）。
2. unit:
   - `modules/accounting/test/opening-balances.test.ts`: `openingDateOf`（月初・年初・うるう年、AC-1）、行の分類（空・0・負・両側・端数・損益科目・仮勘定・`partnerRequired` の取引先なし → 仮勘定、取引先付きの notice、AC-9〜AC-10）、貸借一致と行数の issue（AC-11）、結果の形（AC-27）。
   - `apps/web/src/lib/opening-balances.test.ts`: 段ごとの見出しの照合（日英・field 名・全角半角、知らない列・重複・必須の欠落）、要求の行の組立て（空の行、数式対策の除去）、雛形 CSV、エラー CSV、理由コードの日英の説明（AC-33〜AC-35、AC-39 の文言）。
   - l10n/jp の既存の科目表の試験（`l10n/jp/test/l10n-jp.db.test.ts`）が 3900 を含めて通ること（AC-28）。
3. DB:
   - `modules/accounting/test/opening-balances.db.test.ts`: dry-run で仕訳・連番・監査・outbox が変わらない（AC-25）、execute で期首残高日付・`sourceEntity = 'fiscal_year'` の 1 本（AC-12）、貸借不一致・2 行未満で何も書かない（AC-11）、損益科目・仮勘定の行のエラー、取引先なしの売掛金の行が仮勘定へ（AC-9〜AC-10）、二重取込の CONFLICT と取消後の再取込（AC-13〜AC-14）、汎用の仕訳を期首残高日付で確定すると拒否・`accounting.reverse_entry` で開始仕訳を取り消すと拒否（AC-3、AC-14）、最初でない年度・年度の締め・最初の期間の締めで拒否し再開後に通る（AC-2）、期首残高日を含む年度の開設の拒否（AC-4）、accounting・admin は通り sales・purchasing・inventory・viewer は 403（AC-5）、他社の `fiscalYearId` は 404・他社のコードは `ref_not_found`（AC-7）、店舗限定の文脈の 403（AC-7）、仮勘定が無い・無効・不適切と `clearing_account_used`（AC-28）、状況（AC-29）、`$ctx.` のセルの `invalid_value`（AC-9）、2 本の接続での同時の取込で 1 本だけが確定し他方が 409（AC-13、D-14）、仕訳の確定の失敗が `submit_failed` の issue（D-15）、範囲の純額が 0 なら前の年度を開ける（AC-4、D-19）。
   - `modules/sales/test/opening-receivables.db.test.ts` と `modules/purchase/test/opening-payables.db.test.ts`: 入力の検査（金額 0・負・端数、日付の形、期首残高日より後の `originalDate`、取引先の 0 件・曖昧、AC-15）、期首請求書の形と転記（不課税、売掛金/買掛金 ↔ 仮勘定、期首残高日、採番、AC-16〜AC-17）、確定時の検査の拒否（明細 2 行・課税・品目付き・日付違い）、取引先ごとの `exists` と別の取引先の追加取込（AC-18）、取消の逆仕訳が期首残高日付・訂正日付き・最初の期間の締め後の拒否、`opening_amend`（AC-19）、印刷の拒否（AC-20）、汎用の作成で `openingBalance` を指定すると 403（AC-21）、入金の消込と年齢表（AC-22）、accounting だけの利用者は 403・accounting + sales（purchasing）と admin は通る・sales だけは 403（AC-6）、他社の取引先は `ref_not_found`（AC-7）、全件か無か（AC-26）、仮勘定の取込前・取込後（AC-27）、期首残高日付の取消の後の再取込は通り・期中の日付の取消の後は `cancelled_in_year`（AC-18、D-8）、`$ctx.` のセルと読めない金額・日付の `invalid_value`（AC-15）、2 本の接続での同時の取込で同じ取引先に 1 件だけ（AC-18、D-14）、転記科目が無いと要求全体の 409（D-16）。
   - `modules/inventory/test/opening-stock.db.test.ts`: 倉庫ごとの入庫と 500 行の分割、移動平均の初期値 = 単価、`inventory.valuation`（AC-24）、`stock_exists`（期首残高日より後の移動・残高あり）、`duplicate`・`service_product`、在庫評価の締めで拒否（AC-23）、取消後の再取込、汎用の入出庫伝票で `fiscal_year` の発生元を偽れないこと（AC-24）、accounting だけは 403・accounting + inventory と admin は通る・accounting + sales は 403（AC-6）、数量・単価の `invalid_value`・`non_positive_quantity`・`negative_amount`・`scale_exceeded`・`$ctx.`（AC-23）、2 本の接続での同時の取込で 1 回だけ入庫（AC-23、D-14）、伝票の確定の失敗が `submit_failed` の issue（D-15）。
   - `apps/api/test/opening-balances.db.test.ts`（全 module の runtime、`POST /actions/...` 経由）: golden（`apps/api/test/fixtures/opening-balances/{journal,receivables,payables,stock}.csv` を読んで 4 つを取り込み、試算表の期首欄・仮勘定 0・年齢表・在庫評価が CSV と一致、AC-30）、REST の 2 MB 超の 413（AC-8）、会社の分離（会社 B から見えない・会社 B の試算表が変わらない、AC-7）。fixture の CSV は引用符を使わない単純な形にし、試験側で分割する。
   - MCP のツール一覧に 5 つの mutating action と状況が出ること、MCP の 2 MB の検査（AC-8）。実装では既存の `apps/mcp/test/mcp.db.test.ts` は試験用の entity だけを登録しているため、業務 module を登録する別ファイル `apps/mcp/test/opening-balances-tools.db.test.ts` にした。
4. ブラウザ（`apps/web/e2e/opening-balances.spec.ts`、1 試験。`commerceFixture` の新しい合成会社。fixture が開く最初の年度の期首残高日を使い、3900 の科目・取引先・品目は API で作る）: 画面検索から開く → 開始仕訳の CSV（売掛金・買掛金の合計行を含む）を事前確認して合計と仮勘定の行を確認 → 貸借の合わないファイルで「取り込む」が無効 → 正しいファイルを取り込む → 売掛金・買掛金・在庫を取り込む → 状況の仮勘定が 0 → 試算表の期首欄 → 開始仕訳の取消と再取込 → 英語表示と 390px（文書と `#screen-content` の幅）→ axe（AC-31〜AC-39）。
5. 計測（作業記録に残す）: 売掛金 1,000 行の事前確認と実行、在庫 5,000 行、開始仕訳 500 行の所要時間（この開発コンテナ、Fastify の inject）。売掛金 1,000 行の実行が 60 秒を超えるなら行数の上限を下げて spec を直す。売掛金 1,000 行の実行中の `pg_locks` の件数の最大（勧告ロックは期首請求書ごとに 1 つ、トランザクションの終わりまで持つ）を記録し、既定の `max_locks_per_transaction`（64）× 接続数に対して行数の上限（Q-5）を見直す。マニュアルに「サーバーのロックの上限が既定のときはファイルを分ける」と書く。
6. マニュアル 03・06・09・10 と画面の一覧を更新し、[domain](../domain/opening-balances.md) の【未確認】を一次出典で確かめられたら置き換える（できなければ作業記録に未確認のまま残す）。
7. `pnpm gate:full`（統合担当が実行）。

## 注意（実装の前提）

- 期首請求書・開始仕訳の確定はどれも既存の `assertOpenPeriod` で会社全体の業務ロック `accounting-periods` を取り、要求の終わりまで持つ（dry-run も同じ。ADR-0028 の「事前確認は実行と同じロックを取る」）。売掛金 200 行の取込中（計測で約 30 秒）は、その会社の他の仕訳・請求書の確定が待つ。マニュアルで「利用開始前、または営業時間外に、分けたファイルで」と案内する。
- l10n/jp の科目の追加で、科目表の全行を固定している試験や golden があれば期待値を更新する（データの追加に伴う更新で弱体化ではない。作業記録に書く）。
- `postFromSource` / `reverseSourceEntry` の既存の利用者（売上・仕入・入出金・商流など）の振る舞いは変えない。期首残高の経路は別の関数（`postOpeningFromSource` / `reverseOpeningSourceEntry`）にし、`openingBalance` の請求書のときだけ呼ぶ。

## 他の作業項目との接点（未統合のもの。実装は依存しない）

- B4 セットアップウィザード: 「会計年度」の次に任意の「期首残高」ステップとして `/finance/opening` を開く導線を足せる（ウィザード側の作業）。
- B3 導入チェック: 「期首残高仮勘定の残高が 0 でない」を注意項目にできる（`accounting.opening_balance_status` を読む）。
- B2 会社の追加: 新しい会社は l10n/jp の種まきで 3900 を持つ。B2 側の追加作業は無い見込み。

## 未決事項（利用者の判断待ち。推奨する既定）

- Q-1 accounting ロールだけの利用者は売掛金・買掛金・在庫を取り込めない（D-10）。既定: このまま（ロールを広げない）。マニュアル 03 に「管理者が行うか、一時的に営業・購買・在庫のロールを付ける」と書く。代案は accounting ロールに請求書・入出庫伝票の create / submit を与えることだが、通常の請求書も作れるようになるため推奨しない。
- Q-2 期首残高日を期首日の前日とする（D-1）。既定: 計画どおり前日。期首日付にするなら試算表・総勘定元帳に開始仕訳の特別扱いが要る。
- Q-3 期首残高仮勘定の科目コード・名称・区分。既定: `3900 期首残高仮勘定`（純資産）。既存の会社は科目を作るか設定を変える（取込が理由付きで止まる）。
- Q-4 個人事業者の事業主貸・事業主借に期首残高がある行を拒否・注意するか。既定: システムは検査せず、マニュアルで注意する（l10n 固有の科目区分を accounting が知らないため）。
- Q-5 売掛金・買掛金 1,000 行、在庫 5,000 行、開始仕訳 1,000 行（明細 500）の上限。既定: この値で実装し、計測（検証手順 5）で見直す。→ 2026-10-30 計測の結果、売掛金・買掛金 200 行、在庫 2,000 行に下げた（開始仕訳は 1,000 行のまま。作業記録）。
- Q-6 締めガイドに「期首残高仮勘定の残高が 0 でない」の点検を足すか。既定: この項目では足さない（別項目）。
- Q-7 申告準備の科目分類で 3900 をどう扱うか。既定: 残高 0 なら出力に影響しないことを実装時に確かめ、分類が必須なら利益剰余金の下の独自科目として扱う案を作業記録に書く。
- Q-8 期首請求書を分析の集計元から分ける軸。既定: この項目では足さない（スコープ外）。
