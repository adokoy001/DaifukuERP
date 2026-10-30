# Spec: cash-forecast（資金繰り表と入出金予定）

- 状態: draft
- モジュール: `modules/banking`（`banking.cash_forecast`、`banking.cash_schedule`、集計の純粋関数）、`modules/contract`（契約請求予定の入金見込みを返す関数）、`modules/workforce`（給与の支払予定を返す関数）、`apps/web`（`/finance/cash-forecast`） ／ 依存: 既存の sales・purchase・payment・accounting・partner・tax、banking の依存に contract と workforce を追加、[ui-kit](ui-kit.md)（D1）
- ADR: 不要（kernel・DSL・port の変更なし、新しい書込経路なし）。この項目に予約された ADR-0036 は使わない。module 間の依存の追加は [商流・銀行・申告準備の構造](../architecture/commerce-finance.md) の責任分担に記録する
- 作成: 2026-10-30 ／ 作成者: agent（spec writer、`wip/cash-forecast`）。設計の元は [完成度向上の実装計画](../completion-plan.md) §5 E3、完了の定義は同 §7

## 目的（1段落）

経理担当者は今、売掛金年齢表・買掛金年齢表・契約の請求予定・銀行の支払資料・給与を別々の画面で見て、資金が足りるかを手で突き合わせている。指定した期間について、帳簿に記帳済みの資金の動きと、確定済みの請求・支払資料・契約・給与から見込まれる入出金を日別に並べ、期首残高から残高の推移と最低残高を示す。あわせて、その内訳を 1 件ずつの入出金予定（支払予定）として一覧にする。読取専用で、既存の `Repository` と呼出者の `Context` だけで読み、閲覧できない業務（給与など）は含めずにその旨を示す。

## 定義（受入基準で使う用語）

- D-1 **今日** `today`: `todayLocal(ctx.now())`（日本時間の日付）。
- D-2 **資金科目**: 会社設定 `payment.accounts` の `cash` と `bank` のコードに一致する勘定科目と、すべての `bank_account`（有効・無効を問わない）の `ledgerAccountId` の和集合。
- D-3 **記帳済みの入出金**（posted）: 転記済み（`posted = true`）の仕訳明細のうち資金科目の行を、仕訳（`entryId`）ごとに Σ借方 − Σ貸方 で合計した値。正なら入金、負なら出金（絶対値）、0 は資金科目間の振替として入出金に数えない。日付は `entryDate`。
- D-4 **予定**（scheduled）: 次の 5 種類。金額はすべて `Decimal`。
  - `sales_invoice`（売上請求の入金予定）: 確定済み（docstatus 1）で `balance ≠ 0` の `sales_invoice`。金額は `balance`（入金済み・一部入金を差し引いた現在の残高）、予定日は `dueDate`（空なら `date`）。
  - `purchase_invoice`（仕入請求の支払予定）: 確定済みで `balance ≠ 0` の `purchase_invoice` のうち、次の振込予定に当たらないもの。金額は `balance`、予定日は `dueDate`（空なら `date`）。
  - `bank_transfer`（振込予定）: 上の仕入請求のうち、有効な（`active = true`）`bank_transfer_reservation` があり、その `bank_transfer.state` が `prepared` か `exported` のもの。予定日は `bank_transfer.transferDate`、金額は請求書の現在の `balance`（保存済み snapshot の額ではない）。仕入請求の支払予定とは重ねない。
  - `contract`（契約請求の入金予定）: 確定済みの契約（`active`、または `endDate` が対象月の開始日以後の `ended`）の対象月のうち、計画の状態が `due`（請求書が未作成）のもの。`contract.schedule` と `contract.generate_invoices` が使う `planPeriod` の明細から、`taxSummaryFor`（日付 = 請求日、税抜入力）で求めた税込合計を金額とし、予定日は `computeDueDate(請求日, 取引先の締め日, 支払月, 支払日)`。請求書が作成済み（`generated`）の対象月は売上請求として数えるので含めない。調べる対象月は、請求日が「`min(from, today)` の 4 か月前の月初」から `to` までに入るもの。
  - `payroll`（給与の支払予定）: 確定済み（docstatus 1）の `workforce_payroll` のうち `workforce_payroll_tax_evidence` があるもの。金額は `netPay`（差引支給額）、予定日は証跡の `paymentDate`。**支払日ごとに合算し、従業員ごとの行・氏名を出さない。**
- D-5 **配置規則**: 予定日 `d` の予定を次の順に扱う。(1) `d > to` は含めない。(2) `d ≥ today` は `d` の日に置く。(3) `d < today`（期日超過）のうち、給与は支払済みとみなして含めない。それ以外は期日超過として `meta.overdue` に数え、`includeOverdue = true` かつ `today ≤ to` のときだけ `today` の日に置く。
- D-6 **残高**: `ledgerBalance` = 資金科目の記帳済み残高（`entryDate < from` の転記済み明細の Σ借方 − Σ貸方）。**期首残高** `openingBalance` = `ledgerBalance` ＋（`today ≤` 置いた日 `< from` の予定の入金 − 出金）。`from ≤ today` のとき後ろの項は 0（`openingBasis = 'ledger'`）、`from > today` のときは今日から前日までの予定を足した見込み（`openingBasis = 'projected'`）。各日の `balance(d) = balance(d − 1) + inflow(d) − outflow(d)`、`balance(from − 1) = openingBalance`。
- D-7 **下書き**: `includeDrafts = true` のとき、下書き（docstatus 0）の `sales_invoice`（金額 `total`）と `purchase_invoice`（金額 `total`、予約は見ない）を D-5 と同じ規則で別の列に置き、`balance` には足さず `balanceWithDrafts` にだけ足す。下書きの入出金・給与・契約・振込予約は扱わない。

## 受入基準（EARS）

### action の出力

- AC-1 WHEN `banking.cash_forecast { from, to, includeDrafts?, includeOverdue? }` が全社範囲の accounting または admin から呼ばれた THE SYSTEM SHALL `from`〜`to` の各日（動きのない日を含む）を日付の昇順で 1 行とする `TableResult`（[report 規約](../conventions/reports.md)）を返す。列は `date`、`postedIn`（記帳済み入金）、`postedOut`（記帳済み出金）、`receivables`（売上請求）、`contracts`（契約請求）、`payables`（仕入請求）、`transfers`（振込予定）、`payroll`（給与）、`inflow`、`outflow`、`net`、`balance`、`includeDrafts` のときだけ `draftInflow`、`draftOutflow`、`balanceWithDrafts`。`inflow = postedIn + receivables + contracts`、`outflow = postedOut + payables + transfers + payroll`、`net = inflow − outflow`、`balance` は D-6。金額は十進文字列、出金も正の値。action は `mutates: false`、`tx: 'none'`。`includeDrafts` と `includeOverdue` の既定は false。
- AC-2 THE SYSTEM SHALL `banking.cash_forecast` の `totals` に入出金の列の合計、`balance` = 期末残高、`balanceWithDrafts` = 下書きを含む期末残高、列にないキー `openingBalance`（下書き表示時は `openingBalanceWithDrafts` も）を入れ、`meta` に `from`、`to`、`today`、`includeDrafts`、`includeOverdue`、`openingBalance`、`openingBasis`、`ledgerBalance`、`closingBalance`、`minBalance { date, balance }`（最低残高と、その値を最初に取った日）、`cashAccounts [{ accountId, code, name, balance }]`（資金科目ごとの `entryDate < from` の記帳済み残高）、`missingAccountCodes`、`sources`（AC-14）、`overdue { count, inflow, outflow, draftInflow, draftOutflow }`、給与を含むときは `unscheduledPayroll { count, netPay }`（AC-8）、`truncated: false` を入れる。`title` は期間を含む（「資金繰り表 2026-11-01〜2026-11-30」/「Cash forecast 2026-11-01..2026-11-30」）。
- AC-3 WHEN `banking.cash_schedule`（入力は AC-1 と同じ）が呼ばれた THE SYSTEM SHALL 予定を 1 件 1 行で返す。列は `date`（置いた日。期日超過で置かないものは元の予定日）、`dueDate`（元の予定日）、`direction`（`in` / `out`）、`source`（D-4 の 5 種類）、`state`（`submitted` / `draft`）、`overdue`、`inBalance`（`balance` に含まれるか）、`number`、`partnerName`、`count`（給与は合算した件数、他は 1）、`amount`、`partnerId`（ref `partner`）、`salesInvoiceId`（ref `sales_invoice`）、`purchaseInvoiceId`（ref `purchase_invoice`）、`contractId`（ref `contract`）。行は `from`〜`to` に置いた予定と、すべての期日超過の予定（`inBalance` は `includeOverdue` に従う）で、`from` より前に置いて期首残高に繰り入れた予定は行にせず `meta.beforeFrom { count, inflow, outflow }` に数える。給与の行は支払日ごとに 1 行で `number` と `partnerName` は空。並びは日付 → 方向（入金が先）→ 種類（売上請求、契約請求、仕入請求、振込予定、給与）→ 状態（確定が先）→ 番号。行数が 10,000（`MAX_REPORT_ROWS`）を超えたら先頭 10,000 行にして `meta.truncated = true` とし、`totals { inflow, outflow, draftInflow, draftOutflow, overdueInflow, overdueOutflow }` は打ち切る前の全件で計算する。記帳済みの入出金は行にしない（総勘定元帳で見る）。
- AC-4 THE SYSTEM SHALL 2 つの action を同じ読取・同じ配置規則から作り、各日について `banking.cash_schedule` の `inBalance = true` かつ `state = submitted` の行の合計が、`banking.cash_forecast` のその日の `receivables + contracts`（入金）と `payables + transfers + payroll`（出金）に種類ごとに一致する。

### 予定の内訳

- AC-5 THE SYSTEM SHALL 売上請求・仕入請求の予定に確定済みの伝票だけを含め、下書き（AC-11 の列を除く）・取消・残高 0（入金済・支払済）を含めない。一部入金・一部支払の伝票は残高だけを予定にし、入金・支払の分は記帳済みの入出金として記帳日に現れる（二重に数えない）。残高が負の伝票は符号のまま合計に入れる。
- AC-6 WHEN 確定済みの仕入請求が準備済みまたは出力済みの支払ファイルに予約されている THE SYSTEM SHALL その請求を振込予定として振込指定日に置き、支払期日の仕入請求には置かない。WHEN 支払ファイルが取り消され予約が無効になった THE SYSTEM SHALL 支払期日の仕入請求に戻す。金額は請求書の現在の残高とする。
- AC-7 THE SYSTEM SHALL 契約請求の予定を D-4 の規則で作り、金額と予定日を、その対象月を `contract.generate_invoices` で請求した場合に作られる売上請求書の `total` と `dueDate` に一致させる。請求書の作成後はその対象月を契約請求に含めない（作成された請求書は下書きなので `includeDrafts` のときだけ下書きの列に現れ、確定後は売上請求に現れる）。
- AC-8 THE SYSTEM SHALL 給与の予定を D-4 の規則で作り、取消済み・下書きの給与と、支払日が今日より前の給与を含めない。確定済みで支払日の証跡が無い給与のうち、対象月が「今日の前月」から「`to` の月」までのものは残高に含めず、件数と差引支給額の合計を `meta.unscheduledPayroll` に返す。
- AC-9 THE SYSTEM SHALL 期首残高と記帳済みの入出金を資金科目の転記済み仕訳明細から D-3・D-6 のとおり求め、下書きの仕訳、資金科目以外の科目、資金科目間の振替を入出金に数えない。未来日付で記帳済みの入出金もその日の記帳済みの入出金に含める。
- AC-10 THE SYSTEM SHALL 予定を D-5 の配置規則で置く。期間の全体が今日より前（`to < today`）のときは予定を置かず、記帳済みの入出金だけの表を返す。`from > today` のときは今日から `from` の前日までに置いた予定を期首残高に繰り入れる（D-6）。
- AC-11 WHILE `includeDrafts` が false THE SYSTEM SHALL 下書きの列・行・合計を出さず、下書きの金額をどこにも含めない。WHEN `includeDrafts` が true THE SYSTEM SHALL 下書きを D-7 のとおり別の列と `balanceWithDrafts` に置き、`balance` を変えない。`banking.cash_schedule` の下書きの行は `state = draft`、`inBalance = false` とする。
- AC-12 THE SYSTEM SHALL すべての金額を `Decimal` で計算し（JS の `number` で金額を計算しない）、契約請求の税額（`taxSummaryFor` の会社の端数処理）以外で丸めない。任意の入力について `closingBalance = openingBalance + Σinflow − Σoutflow`、各日の `balance(d) = balance(d − 1) + net(d)`、下書きを含む残高でも同じ関係が成り立つ。

### 権限と会社・拠点の境界

- AC-13 IF 呼出者が accounting も admin も持たない、利用範囲が店舗・拠点に限定されている（`accessScope` が `all` でない）、relay の機械主体である、または会社が選ばれていない THEN THE SYSTEM SHALL 2 つの action とも `PERMISSION_DENIED` を返し、何も読まない（banking の [AC-1](bank-integration.md) と同じ境界。sales・purchasing・viewer・従業員系ロールだけの利用者も拒否する）。
- AC-14 THE SYSTEM SHALL すべての読取を呼出者の `Context` の `Repository`（`list` / `aggregate` / `get`）で行い、`systemContext()` や権限を広げた文脈を使わない。予定の種類（売上請求: `sales_invoice`。仕入請求: `purchase_invoice`。振込予定: `bank_transfer` と `bank_transfer_reservation`。契約請求: `contract`、`contract_line`、`contract_billing`。給与: `workforce_payroll` と `workforce_payroll_tax_evidence`）は、呼出者がその種類のすべての entity を read でき、行の制限を受けず（admin か、`rowRules` の対象でないロールで read を得ている。kernel の `rowFilter(ctx, entity, 'read') === undefined` と同じ判定）、使う項目が隠されていない（`maskedFields` と `outputHidden` に無い）ときだけ含める。給与はさらに 2 つの entity の `export` を要件とする（CSV に給与を出せない利用者の画面にも給与を出さない）。条件を満たさない種類は、列を結果から除き、金額を合計・残高・明細の行・`meta` のどこにも含めず、`meta.sources` に `{ source, included: false, reason: 'permission' }` を返す。含めた種類は `{ source, included: true }`。記帳済みの入出金と期首残高（`journal_line`、`account`、`bank_account`）と取引先名（`partner`）は必須で、読めなければ `Repository` の `PERMISSION_DENIED` をそのまま返す。給与を閲覧できない利用者に給与を集計値で見せることはしない（権限を広げずには集計できないため）。
- AC-15 THE SYSTEM SHALL 結果を呼出者の会社のデータだけから作る。同じ tenant の別会社の伝票・仕訳・支払ファイル・契約・給与・銀行口座・会社設定は、合計・残高・明細・`meta` のどれにも影響しない。
- AC-16 THE SYSTEM SHALL 2 つの action の `exportEntities` を `journal_line`、`account`、`bank_account`、`partner`、`sales_invoice`、`purchase_invoice`、`bank_transfer`、`bank_transfer_reservation`、`contract`、`contract_line`、`contract_billing` とし（給与の entity は AC-14 の条件で別に守る）、CSV は既存の `POST /actions/<name>/export`（repeatable read の 1 スナップショット）だけで出す。CSV の行・合計は同じ入力の action の結果と同じとする。`/meta` の `canExport` はこの定義から決まる（現在のロール定義では accounting は `sales_invoice` などの `export` を持たないため admin だけが true。下の未決事項）。

### 入力の誤りと準備不足

- AC-17 IF `from` / `to` が実在する `YYYY-MM-DD` でない、`from > to`、`from`〜`to` が 366 日を超える、または `to` が今日から 730 日より後 THEN THE SYSTEM SHALL `VALIDATION` エラー（`details.issues` の `path` は該当の項目）を返し、何も読まない。入力の未知のキーも拒否する（strict）。
- AC-18 IF 資金科目が 1 つも見つからない（`payment.accounts` の cash・bank のコードの勘定科目が無く、`bank_account` も無い） THEN THE SYSTEM SHALL `INVALID_STATE` を返し、hint で `payment.accounts` の設定か銀行口座の登録を案内する。WHEN 一部のコードだけが見つからない THE SYSTEM SHALL 見つかった科目で計算し、見つからないコードを `meta.missingAccountCodes` に返す。
- AC-19 IF 契約請求の請求日に有効な税率を tax module が解決できない THEN THE SYSTEM SHALL tax module のエラーをそのまま返し、その契約を 0 円や推測の税率で数えない（`contract.generate_invoices` が同じ日に失敗するのと同じ扱い）。

### 画面（`/finance/cash-forecast`）

- AC-20 WHEN `/finance/cash-forecast` を開いた THE SYSTEM SHALL 条件（開始日・終了日、簡単入力「今日から30日」「今日から90日」「今月」「来月」、「下書きを表示」、「期日超過を今日に含める」）を表示し、URL の `?from=&to=&drafts=1&overdue=1` が妥当ならその値、無ければ今日〜今日 + 89 日で 2 つの action を 1 回ずつ実行する。結果として、要約（期首残高・入金計・出金計・期末残高・最低残高とその日）、グラフ、日別の表、入出金予定を表示する。条件を変えて「表示」を押すと URL を置き換え（履歴を増やさない）、再実行する。条件が表示中の結果と違う間はその旨を示し CSV を止める（[UI 規約](../conventions/ui.md#レポートとピボットの入力表示)）。日付の実在・前後関係・期間の上限は送信前に検査し、サーバーの `VALIDATION` は該当の入力欄に示す。読込中は骨格、失敗は `MetaError`（再試行付き、0 件と表示しない）、予定も記帳済みの動きも無い期間は `EmptyState`。
- AC-21 THE SYSTEM SHALL 期間の全日の `balance` を折れ線で描くインライン SVG のグラフを表示する。0 の基準線を引き、残高が負の区間を意味トークンの別の色で区別し、下書きを表示するときは `balanceWithDrafts` を凡例付きの破線で重ねる。グラフは `role="img"` と、期首残高・期末残高・最低残高とその日を述べる `aria-label` を持ち、正確な値は表で読める（`components/operations-trend.tsx` と同じ方式）。
- AC-22 IF `minBalance.balance` が負 THEN THE SYSTEM SHALL 「残高がマイナスになる日があります（最初の日 YYYY-MM-DD、最低残高 ¥X）」を warning の表示で示す（live region にしない）。
- AC-23 THE SYSTEM SHALL 日別の表を既存の `ReportTable` で表示し（結果内検索・十進の並替え・ページ送り、合計は action の値のまま）、「動きのない日を隠す」（既定 on。グラフと合計は変えない）を持つ。記帳済み・予定・下書きの列を見出しで区別し、下書きの列は「下書き」のラベルと別の色で示す。各 action の CSV は既存の `ReportExport` で、`canExport` が true のときだけ出し、条件が古いか 0 行のときは無効にする。
- AC-24 THE SYSTEM SHALL 入出金予定を `Tabs` の 2 つ目のタブ（1 つ目は日別の表）で表示し、方向・種類・状態を日英の文言で示す。状態は `Badge`（確定と下書きで別の tone）、期日超過は warning の `Badge`、伝票番号は売上請求書・仕入請求書・契約の画面へのリンクにする。給与の行は「給与（N 件）」とだけ表示し、氏名・個人別の金額を出さない。
- AC-25 THE SYSTEM SHALL 結果に応じて次の案内を表示する: 含めなかった種類（`meta.sources` の `included: false`。例「給与は閲覧・出力の権限がないため含めていません」）、期日超過の件数と金額（「期日超過を今日に含める」への案内付き）、支払日が未登録の確定給与の件数と金額（給与画面で支払日の証跡を登録する案内付き）、見つからない資金科目のコード、計算に使った資金科目の一覧（コード・名称・残高。開閉できる領域）。
- AC-26 THE SYSTEM SHALL 画面を「会計・資金」分野の専用画面「資金繰り表」として画面検索・分野一覧・コマンドパレットに表示し（`lib/navigation-data.ts`）、`banking.cash_forecast` を実行できない利用者には表示しない。権限の無い利用者が URL を直接開いたときは action を呼ばずに権限が無いことを説明する。画面の説明リンクを `lib/help.ts` に登録する（[付録 L](../manual/appendix-l-commerce-bank-filing.md) の節「資金繰り表」）。
- AC-27 THE SYSTEM SHALL 画面の文言を日本語と英語で持ち、390px 幅でページ全体を横にスクロールさせずに操作できる（表は自分の枠の中だけで横に動き、要約は縦に並び、グラフは幅に合わせて縮む）。日英 × 1280px / 390px で axe（WCAG 2.1 A/AA の serious / critical）の違反が 0 件である（画面のブラウザ試験の中で `judge()` を使う。[e2e-a11y](e2e-a11y.md)）。

## 関係するファイル・インターフェース（名指し）

- `modules/banking/src/cash-plan.ts`（新規・純粋）: D-3〜D-7 の配置規則、日別の行、残高、最低残高、明細の並びと打ち切り。入力は「記帳済みの入出金（日付・入金・出金）」「予定（種類・方向・状態・予定日・金額・件数・参照）」「`ledgerBalance`」「`today` / `from` / `to` / 2 つの flag」、出力は 2 つの `TableResult` の材料。kernel の `Decimal` と `LocalDate` だけを使う
- `modules/banking/src/cash-sources.ts`（新規）: 種類ごとの利用可否（AC-14、kernel の `can`、`maskedFields`、`rowFilter`、`isAdmin`）と読取。資金科目は `@daifuku/mod-payment` の `loadPaymentAccountCodes` と `BankAccount`、期首残高は `@daifuku/mod-accounting` の `movementsByAccount`、記帳済みの入出金は `JournalLine` の `aggregate`（`groupBy: ['entryDate', 'entryId']`、資金科目と期間で絞る。1 回の上限 10,000 グループに達したら期間を分けて読む）、売上・仕入請求は `SalesInvoice` / `PurchaseInvoice` の `aggregate`（予定日ごとの合計。日別の action は伝票の件数に上限を設けない）と、明細の action・予約された請求だけ `list`、振込予定は `BankTransferReservation` と `BankTransfer`、取引先名は `Partner`
- `modules/banking/src/cash-forecast.ts`（新規）: 2 つの action（`defineAction`、入力 schema、列、`exportEntities`、`permission: { roles: ['accounting'] }`、handler の最初に既存の `assertBankContext`）。`modules/banking/src/actions.ts`（export に追加）、`index.ts`、`module.ts`（`depends` に `ContractModule.name`、`WorkforceModule.name`）、`package.json`（`@daifuku/mod-contract`、`@daifuku/mod-workforce` を追加）、`pnpm-lock.yaml`
- `modules/contract/src/cash-plan.ts`（新規）と `index.ts`: `plannedContractReceipts(ctx, { from, to, today })` が D-4 の契約請求の予定（契約 id・番号・取引先 id・対象月・請求日・予定日・税抜・税・税込）を返す。既存の `loadCandidates`、`billingsForPeriod`、`linesByContract`、`companyScale`、`termsOf`、`planPeriod`、`@daifuku/mod-tax` の `taxSummaryFor`、`@daifuku/mod-partner` の `computeDueDate` を再利用する
- `modules/workforce/src/payroll-cash.ts`（新規）と `index.ts`: `payrollCashSchedule(ctx, { today, to })` が D-4 の給与の予定（支払日ごとの件数と差引支給額の合計）と `unscheduled { count, netPay }` を返す。読取は `WorkforcePayroll`、`WorkforcePayrollTaxEvidence` の `Repository`
- `apps/web/src/pages/cash-forecast-page.tsx`（新規）、`apps/web/src/api/cash-forecast.ts`（新規、既存の action 呼出しを使う）、`apps/web/src/lib/cash-forecast.ts`（新規・純粋: URL の検査、簡単入力の日付、動きのない日の除外、グラフの座標、案内の文言の選択）、`apps/web/src/components/cash-forecast-chart.tsx`（新規）、既存の `components/report-table.tsx`、`components/report-export.tsx`、`ui/`（`PageHeader`、`Card`、`Toolbar`、`Tabs`、`Badge`、`EmptyState`、`Skeleton`）、`pages/status-views.tsx`（`MetaError`）
- `apps/web/src/router.tsx`（route と `validateSearch`）、`apps/web/src/lib/navigation-data.ts`、`apps/web/src/lib/help.ts`、`apps/web/src/ui/token-usage.test.ts`（`CONVERTED` に新しいページと部品を追加）
- 試験: `modules/banking/test/cash-forecast.test.ts`（unit・golden・property）、`modules/banking/test/golden/cash-forecast-basic.json`、`modules/banking/test/cash-sources.test.ts`（unit）、`modules/banking/test/cash-forecast.db.test.ts`（DB）、`modules/contract/test/cash-plan.db.test.ts`（DB）、`modules/workforce/test/payroll-cash.db.test.ts`（DB、既存の `fiscal-fixtures.ts` を使う）、`apps/web/src/lib/cash-forecast.test.ts`（Web unit）、`apps/web/e2e/cash-forecast.spec.ts`（ブラウザ）
- 文書: `docs/manual/appendix-l-commerce-bank-filing.md`（節「資金繰り表」）、`docs/architecture/commerce-finance.md`（責任分担と依存）、`docs/architecture/program-map.md`、`docs/manual/appendix-n-navigation.md`（画面の一覧）

## データ・業務ルール（出典）

- 支払期日は取引先ごとの締め日・支払月・支払日から求める — [日本の制度事実](../domain/japan-tax.md#商習慣)（既存の `computeDueDate`）。保存済みの `dueDate` をそのまま使い、この項目で新しい計算規則は作らない。
- 給与の支払日は所定支給日（契約・慣習で決まる日）として扱い、`workforce_payroll_tax_evidence.paymentDate` に登録済みの値だけを使う — [国内給与自動算定の一次資料](../domain/japan-payroll-automation.md#日付と製品対応期間の前提)（国税庁 年末調整 Q&A 問2、確認日 2026-09-12）。支払日を推測で補わない。
- 支払ファイルの作成・出力は送金ではない — [日本の銀行ファイル連携の根拠](../domain/japan-bank-integration.md)（確認日 2026-09-13）。このため振込予定は「予定」の列に置き、記帳済みの入出金にはしない。
- 新しい制度値・税率・法定の期限はない。契約請求の税額は既存の tax module の期間付き税率と端数処理を使う。
- 未検証（設計の根拠にしない）: 資金繰り表に法定の様式・区分があるか、賃金の毎月払い・一定期日払い（労働基準法第24条）、銀行の休業日（銀行法第15条）と支払期日の繰上げ・繰下げの商慣行。この作業環境から e-Gov（`laws.e-gov.go.jp`）と厚生労働省（`www.mhlw.go.jp`）に接続できず一次資料を確認できなかったため、`docs/domain/` には追加していない。上の仕様はどれにも依存しない（保存済みの期日・支払日をそのまま使い、日付をずらさない）。

### golden の例（`modules/banking/test/golden/cash-forecast-basic.json` の元）

`today = 2026-11-10`、`from = 2026-11-09`、`to = 2026-11-12`、`includeDrafts = true`、`includeOverdue = false`、`ledgerBalance = 1,000,000`。

- 11-09 記帳済み: 売上請求 A（税込 250,000）への一部入金 50,000（入金）、現金から普通預金への預入 30,000（資金科目間の振替なので数えない）
- 予定: A の残高 200,000（期日 11-11）、売上請求 B の残高 80,000（期日 11-05、期日超過）、仕入請求 C の残高 150,000（期日 11-12、支払ファイルの振込指定日 11-11）、仕入請求 D の残高 300,000（期日 11-12）、給与 2 件の差引支給 120,000 + 130,000（支払日 11-10）、契約 E の請求予定 税抜 100,000・標準税率 10%（予定日 11-12）、下書きの売上請求 F 40,000（期日 11-12）

| date | postedIn | receivables | contracts | payables | transfers | payroll | inflow | outflow | net | balance | draftInflow | balanceWithDrafts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 11-09 | 50,000 | 0 | 0 | 0 | 0 | 0 | 50,000 | 0 | 50,000 | 1,050,000 | 0 | 1,050,000 |
| 11-10 | 0 | 0 | 0 | 0 | 0 | 250,000 | 0 | 250,000 | −250,000 | 800,000 | 0 | 800,000 |
| 11-11 | 0 | 200,000 | 0 | 0 | 150,000 | 0 | 200,000 | 150,000 | 50,000 | 850,000 | 0 | 850,000 |
| 11-12 | 0 | 0 | 110,000 | 300,000 | 0 | 0 | 110,000 | 300,000 | −190,000 | 660,000 | 40,000 | 700,000 |

期首残高 1,000,000、期末残高 660,000、最低残高 660,000（11-12）、`overdue = { count: 1, inflow: 80,000, outflow: 0, … }`。`includeOverdue = true` なら B の 80,000 が 11-10 の `receivables` に入り、残高は 1,050,000 / 880,000 / 930,000 / 740,000。`banking.cash_schedule` の行は B（11-05、期日超過、`inBalance = false`）、給与（11-10、件数 2、250,000）、A（11-11）、C（11-11、振込予定、`dueDate` 11-12）、F（11-12、下書き）、E（11-12、契約請求）、D（11-12）の順。

## 決定事項（計画が選択を残した点）

1. **action の持ち主は banking**（`banking.cash_forecast`、`banking.cash_schedule`）。計画の `finance.*` に当たる module は無い。accounting は sales・purchase・contract から依存される側で、契約の計画計算（`planPeriod`）を import できない。banking は既に accounting・partner・payment・purchase・sales に依存し、振込予約を自分の entity として持ち、権限の境界（全社範囲の accounting / admin）も資金繰りに合う。contract（sales に依存）と workforce（kernel だけに依存）は banking に依存しないので、banking から両者への依存を足しても循環しない。
2. **日別と明細の 2 つの action**。どちらも列の固定された `TableResult` にし、汎用のレポート画面（`/r/`）、MCP、既存の CSV 経路にそのまま載せる。明細を `meta` に入れる方式は CSV に出ず行数の扱いも曖昧になるので採らない。
3. **記帳済みの入出金（帳簿）＋予定（未決済残高・予約・計画）**。期首残高を帳簿から取るだけだと、過去を含む期間（今月 1 日から等）で既に入金した額が帳簿にも未決済残高にも現れず残高がずれる。記帳済みの入出金を日付どおりに並べ、予定を今日以後にだけ置くことで、どの期間でも二重計上・計上漏れが起きない（入金・支払は請求書の残高を減らし、同時に資金科目へ転記されるため）。
4. **銀行明細を残高に使わない**。`bank_statement` は入出金の明細だけで残高欄が無く、照合前の明細は帳簿と重なりうる。残高の正は帳簿（総勘定元帳）とする。
5. **振込予約は日付だけを動かす**。予約された請求は振込指定日に置き、金額は請求書の現在の残高（保存済み snapshot の額は出力後の一部支払で古くなりうる）。
6. **契約請求は contract module の関数で作る**。`contract.schedule` と同じ `planPeriod` を使い、税込額は生成時と同じ `taxSummaryFor`、予定日は生成時と同じ `computeDueDate` で求める。生成済みの対象月は売上請求で数える。
7. **給与は workforce module の関数で作り、支払日ごとの合算だけを返す**。資金繰りに個人別の給与は不要で、明細の CSV が給与一覧にならないようにする。閲覧・出力の権限が無い利用者には給与を含めない（集計値でも見せない。集計には権限を広げた読取が必要になり、規則 2 に反する）。給与に `export` まで求めるのは、画面と CSV で結果を同じにしつつ、給与を出力できない利用者の CSV に給与が入らないようにするため（`<entity>.export_rows` が参照先の `export` を列ごとに確かめるのと同じ考え方）。
8. **期日超過は既定で残高に入れず、別に示す**。回収できるか分からない売掛金を見込みに入れないため。利用者が `includeOverdue` で今日に置ける。給与は支払済みの記録が無いので、支払日が過ぎたものは支払済みとみなす（実際の支払は帳簿の記帳済みの入出金に現れる）。
9. **下書きは売上・仕入請求だけを別の列で**。計画の「下書きは別色で任意表示」を、残高を変えない別の列・別の残高で満たす。
10. **ADR は不要**。kernel・DSL・port を変えず、新しい書込経路も作らない。予約済みの ADR-0036 は使わない（統合担当は欠番として扱う）。banking の依存の追加は lockfile の変更を伴い、light の昇格パターン（依存）に当たる。
11. **期間の上限は 366 日、終了日は今日から 730 日まで**。日別の行（最大 367 行）と、`from > today` のときの見込みの計算量を抑える。日別の行は動きのない日も返す（グラフと残高の連続性のため）。表で隠すかは画面が決める。
12. **新しい会社設定は作らない**。資金科目は既存の `payment.accounts` と銀行口座から決め、使った科目を `meta.cashAccounts` で見せる。
13. **画面の実行は既存の action 経路（read committed）**。複数の読取の間に入出金が確定すると、その 1 回の結果で二重計上・計上漏れが起こりうる（再実行で解消）。CSV は既存の export 経路が 1 つの repeatable read で実行する。action を repeatable read で実行する仕組みは DSL の拡張（ADR が必要）になるのでこの項目では作らない。

## スコープ外（明記）

- 督促状（`sales.render_reminder_html`）— [実装計画](../completion-plan.md) C5 の帳票規約で扱う。
- 請求書になっていない商流（見積・受注・発注、trade の分納・分割請求の計画）、定期仕訳（E2）、経費精算（E5）、固定資産（E1）からの予定。統合後に D-4 の種類として足せるよう、種類は列挙で持つ。
- 税金・社会保険料・源泉所得税・住民税の納付予定、借入の返済・利息、手形、外貨。
- 銀行休業日による期日の繰上げ・繰下げ（保存済みの期日をそのまま使う）、入金の確度・回収遅延の推定。
- 下書きの入出金伝票・給与・契約・振込予約の予定。
- 経常収支・経常外収支・財務収支などの区分、月別・週別の集計表示。
- 資金繰りの保存・版管理（毎回その時点のデータで計算する）、資金不足の自動通知（F1）、役割別ホーム（C6）へのカード、受信箱の項目。
- action を repeatable read で実行する DSL の拡張（決定事項 13）。
- accounting ロールへの `export` 付与など、ロール定義の変更（未決事項）。

## 検証手順（E2E、実行して記録する）

受入基準と試験の対応（試験名に `AC-n` を入れる）:

| AC | unit / golden / property | DB | ブラウザ |
|---|---|---|---|
| AC-1、AC-2 | `cash-forecast.test.ts`（golden の表と totals・meta） | `cash-forecast.db.test.ts`（列・totals・meta、`/r/` の入力 schema） | — |
| AC-3、AC-4 | 同（明細の並び・打ち切り・totals、日別との一致） | 同（売上・仕入・振込・契約の混在で日別と明細の一致） | — |
| AC-5 | — | 同（下書き・取消・入金済の除外、一部入金の残高、負の残高） | — |
| AC-6 | 同（振込予定の重複なし） | 同（支払ファイルの準備・出力・取消で列が移る） | — |
| AC-7 | — | `contract/test/cash-plan.db.test.ts`（予定 → `contract.generate_invoices` の `total` と `dueDate` が一致、生成後は契約請求から消える） | — |
| AC-8 | — | `workforce/test/payroll-cash.db.test.ts`（証跡の支払日・取消・下書き・過去日・未登録） | — |
| AC-9 | 同（仕訳ごとの相殺） | `cash-forecast.db.test.ts`（下書き仕訳・資金科目間の振替・未来日付の記帳） | — |
| AC-10 | 同（`to < today`、`from > today` の見込み期首残高、`includeOverdue`） | — | — |
| AC-11 | 同 | 同（下書きの列と `balance` 不変） | 下書きの表示 |
| AC-12 | property（fast-check で残高の関係） | — | — |
| AC-13 | — | 同（sales・purchasing・viewer・workforce_payroll だけ・店舗限定・会社なしの拒否） | — |
| AC-14 | `cash-sources.test.ts`（行の制限・隠し項目・export の判定） | 同（accounting では給与の列なし・`sources`、accounting + workforce_payroll と admin では給与あり）、`payroll-cash.db.test.ts` | 給与を除いた応答の案内（応答の差し替え） |
| AC-15 | — | 同（2 社のデータで影響なし） | — |
| AC-16 | — | 同（`canExportAction` が accounting で false・admin で true、export の結果が action と同じ） | admin で CSV を取得 |
| AC-17 | 同（入力 schema と期間の検査） | 同（何も読まずに拒否） | 送信前の検査 |
| AC-18 | — | 同（資金科目なしの `INVALID_STATE`、一部のコード欠落） | — |
| AC-19 | — | `cash-plan.db.test.ts`（税率の期間外） | — |
| AC-20〜AC-27 | `apps/web/src/lib/cash-forecast.test.ts`（URL・簡単入力・行の除外・グラフ座標・案内の選択） | — | `apps/web/e2e/cash-forecast.spec.ts` |

手順:

1. 編集中は `pnpm gate:quick`。コミット前に `export TEST_DATABASE_URL_OWNER=… TEST_DATABASE_URL=…` と `GATE_DB_SHARDS=1 pnpm gate:light`（banking の依存の追加で lockfile が変わるため DB は全件になる）。
2. unit: golden の例（上の表）を `cash-forecast-basic.json` と照合し、`includeOverdue` の切替、`to < today`、`from > today`、負の残高、仕訳ごとの相殺、明細の並びと 10,000 行の打ち切りを確かめる。property で AC-12 の関係を確かめる。
3. DB（banking）: accounting で売上請求（一部入金あり）・仕入請求・支払ファイル（準備 → 出力 → 取消）・契約・下書きを作り、日別と明細の値、`meta`、権限ごとの拒否と給与の除外、2 社の分離、資金科目の欠落、export の可否を確かめる。
4. DB（contract・workforce）: 契約の予定と生成された請求書の一致、税率の期間外のエラー。給与の証跡による支払日、取消・下書き・過去日・未登録の扱い、権限の無い文脈で何も読まないこと。
5. ブラウザ: `/tmp/claude-0/-home-user-DaifukuERP/8a7541e3-ab40-5f9c-ac08-5679d2bd0af8/scratchpad/tools/e2e-run.sh <worktree> <slot> apps/web/e2e/cash-forecast.spec.ts --project=chromium --no-deps`。画面検索から開く、既定の期間、API で作った確定済みの売上請求が明細と表に出ること、条件の変更と URL、下書きの表示、期日超過の切替、CSV（admin）、給与を除いた応答の案内、最低残高が負のときの警告、権限の無い利用者の説明、英語表示、390px で横にはみ出さないこと、日英 × 1280 / 390px の `judge()`。
6. API の目視: `pnpm dev:api` を起動し、admin のトークンで `POST /actions/banking.cash_forecast` と `POST /actions/banking.cash_forecast/export` に同じ入力を送り、行と合計が同じであることを確かめる（log に結果を残す）。
7. `pnpm gate:full`（統合担当が実行）。

## 未決事項（利用者の判断待ち）

- 期日超過の既定: 推奨は現状（既定は残高に入れず、`includeOverdue` で今日に置く）。支払側（仕入請求・振込予定）だけ既定で含める案もある。
- 資金科目の範囲: 推奨は現状（`payment.accounts` の cash・bank と銀行口座の帳簿科目）。入出金伝票の科目は自由に選べるため、別の科目（当座預金など）に転記した入出金は数えない。必要になったら、銀行口座として登録するか、資金科目の一覧を持つ会社設定を別項目で足す。
- CSV を出せる利用者: 現在のロール定義では accounting は `sales_invoice`・`purchase_invoice`・`contract` の `export` を持たず、資金繰りの CSV は admin だけが出せる（`sales.ar_aging` などの既存帳票と同じ）。推奨はこの項目ではロールを変えず、帳票の出力権限を見直す別項目にする。
- 画面の読取の一貫性（決定事項 13）: 推奨は現状。食い違いが実際に問題になったら、action を repeatable read で実行する DSL の拡張を ADR 付きで別項目にする。
- 支払日の証跡が無い確定給与: 推奨は現状（残高に含めず件数と金額を案内）。所定支給日の会社設定から補う案は workforce の設計判断なので別項目。
- 給与を支払日ごとの合算にすること: 決定事項 7 のとおり admin にも個人別を出さない。支払日に 1 件しか無いと合算でもその人の差引支給額が分かるが、給与を含めるのは給与の閲覧・出力の権限を持つ利用者だけなので、追加の秘匿はしない。
