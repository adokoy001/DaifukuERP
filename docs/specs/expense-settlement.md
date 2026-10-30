# Spec: expense-settlement（経費精算の一般化）

- 状態: draft
- モジュール: `modules/expense`（新規 `@daifuku/mod-expense`。精算書・仮払・受信箱・候補の読取）、`modules/workforce`（経費の支払方法、精算書からの精算記録）、`modules/payment`（相手科目付きの入出金）、`l10n/jp`（勘定科目 仮払金）、`apps/web`（`/finance/expenses`、`/me` と `/workforce` の経費） ／ 依存: workforce、partner、tax、accounting、purchase、payment。画面は [ui-kit](ui-kit.md)、[inbox](inbox.md)、[document-links](document-links.md)、[form-ergonomics](form-ergonomics.md)、[list-workbench](list-workbench.md)、[settings-console](settings-console.md)、[setup-health](setup-health.md)、[navigation-assist](navigation-assist.md) の規約に従う
- ADR: **ADR-0039（新規。この項目に予約された番号）**「経費精算の転記と相手科目付き入出金」。入出金（payment）が他 module の伝票から作られる契約（`counterAccountId`、作成関数、取消の順序）を決める。kernel・DSL は拡張しない
- 作成: 2026-10-30 ／ 作成者: agent（spec writer、`wip/expense-settlement`）。設計の元は [完成度向上の実装計画](../completion-plan.md) E5

## 目的（1段落）

従業員経費は今、本人申請 → 拠点の承認 → 給与・精算本部の「精算記録」（精算日と参照番号の手入力）で終わり、支払・仕訳は会計側で別に手入力している（[workforce-platform](workforce-platform.md) AC-5、[マニュアル付録F](../manual/appendix-f-workforce.md)「この操作による銀行送信・会計仕訳の自動作成はありません」）。また、法人カードで払った経費や仮払金で払った経費を区別できない。本項目では、本人が経費ごとに支払方法（立替・法人カード・仮払金）を示し、承認は既存の workforce の確認待ちのまま、経理担当者が承認済みの経費から精算書を作って確定すると、仕訳（費用・仮払消費税と未払金・仮払金）と支払（入出金）を同じトランザクションで作る。仮払金は精算書で消し込み、差額を支払うか返金を受ける。経理担当者と給与・精算本部（多くの中小企業では同じ人）が使う。

## 決めたこと（計画が選択を残した点）

| # | 決定 | 理由 |
|---|---|---|
| D1 | 新しい module `expense`（`modules/expense`、package `@daifuku/mod-expense`）を作り、workforce には精算書を置かない | workforce は `depends: []` の業界非依存 module で、会計・入出金に依存させると層が崩れる。既存の `workforce_evidence` と同じく、橋渡しの module を上に置く |
| D2 | 申請の単位は既存の `workforce_expense`（1 経費 = 1 領収書）のまま。精算書は経理が承認済みの経費から作る。精算書自体に新しい承認状態は持たない | 計画の「承認は既存の workforce の確認待ちに載せる」をそのまま満たす（承認 = `workforce.review_expense`、受信箱 `workforce.todo` の `expense_review`）。申請画面を二重に作らない |
| D3 | 区分は 2 か所に持つ。本人が経費に付ける支払方法 `workforce_expense.paymentMethod`（`personal` 立替 / `corporate_card` 法人カード / `advance` 仮払金から支払）と、精算書の種類 `expense_settlement.kind`（`reimbursement` 立替精算 / `corporate_card` 法人カード精算 / `advance` 仮払精算）。1 枚の精算書は 1 種類で、対応する支払方法の経費だけを含む | 経理は誰がどう払ったかを申請から知る必要がある。種類ごとに仕訳と支払の形が違う |
| D4 | 入出金に server-owned の `counterAccountId`（相手科目）を足し、payment が公開する `createClearingPayment` だけが設定できる。設定された入出金は消込明細を持たず、未消込額を前払金・前受金でなく相手科目に転記する。精算書は経費の仕訳を accounting の `postFromSource` で、支払を payment の確定（payment 自身の転記）で作る。ADR-0039 に記録する | 計画の「payment と accounting の転記を公開入口から再利用し、accounting の規則を迂回する新しい転記経路を作らない」。現行の payment は消込なしの支払を前払金（1900）に転記するため、未払金・仮払金の決済を表せない |
| D5 | 仕訳は 2 本にする。精算書の仕訳（Dr 費用・仮払消費税 / Cr 未払金・仮払金）と入出金の仕訳（Dr 未払金 / Cr 預金 など）。1 本にまとめない | 入出金の転記規則（direction・ロール・口座の既定）を payment に残し、未払金の取引先別残高で「計上 → 支払」を追える |
| D6 | 従業員への支払・未払金の相手は取引先（`partner`）で表す。精算書と仮払に `partnerId`（従業員用の取引先、法人カードではカード会社）を持たせ、初版は従業員と取引先の対応表を作らない。下書き作成時は、その従業員の直近の確定済み精算書・仮払の取引先を初期値にする | `payment.partnerId` と仕訳明細の `partnerId` は取引先の参照で、従業員を参照できない。対応表は運用を見てから（未決事項） |
| D7 | 税額は経費（領収書）1 件 × 税率ごとに 1 回、会社設定 `tax.rounding` の方法で税込金額から割り戻して丸める。税率は経費の利用日で `tax_rate` から引く。1 件を複数行に分けた場合は丸めた税額を行の金額比で配分し、端数は最後の行に寄せる。金額は常に税込（`priceIncludesTax` は固定で true）。控除率は明細の請求書区分で決め、免税事業者等からの仕入れは purchase の上書き点 `purchase.exempt_supplier_credit_ratio`（l10n/jp の経過措置の期間付きデータ）を `resolveCreditRatio` で使う。控除対象外の税額は費用科目に含める | 既存の税規則（「1 適格請求書につき税率ごとに 1 回」[japan-tax.md#rounding](../domain/japan-tax.md#rounding)、purchase の控除率・控除対象外の扱い [purchase](purchase.md) AC-2/AC-3）をそのまま使う。精算書全体を 1 請求書として丸めると、店ごとに発行された領収書の税額と合わない |
| D8 | 精算書と仮払の作成・更新・確定・取消・訂正は、`accounting` と `workforce_payroll` の両方のロール（または admin）を持つ利用者だけ。従業員本人は自分の精算書・仮払を読むだけ、拠点管理者は担当拠点の分を読むだけ、人事・給与本部は読める | 確定で入出金・仕訳（accounting の権限）と経費の精算記録（既存の `workforce.settle_expense` と同じ workforce_payroll）を同時に書くため。どちらかだけの利用者には途中で失敗させず、最初に理由付きで拒否する |
| D9 | 本人の領収書は既存の `workforce_receipt`（本人・拠点の境界を継承する非公開の証憑）のまま。精算書・仮払そのものの証憑（カード利用明細、仮払の受領書、経理が取り込んだ書類）は attachments module の `attachment` を `linkedEntity = expense_settlement / expense_advance` で結ぶ（汎用画面の証憑パネル）。本人の領収書を `attachment` へ複製しない | `attachment` には行の権限がなく、読めるロール（accounting・sales・purchasing・viewer）に全従業員の領収書が見えてしまう。[従業員の構造](../architecture/workforce.md)「他人の領収書を汎用添付機能へ複製して権限を迂回しません」 |
| D10 | 仮払（`expense_advance`）は経理が支払時に記録する。初版に本人の仮払申請・承認の流れは作らない。1 件の仮払は 1 枚の精算書で全額を消し込む（差額は同じ確定で支払うか返金を受ける） | 計画の範囲（精算書による消込と差額）を満たす最小の形。申請・部分消込は未決事項 |
| D11 | 法人カード精算は仕訳だけを作り（Cr 未払金、取引先はカード会社）、入出金は作らない。カード会社への引落しの支払は範囲外 | 精算の時点では会社から現金が動かない。引落しの支払は現行の payment では未払金を消せない（未決事項） |
| D12 | 既存の `workforce.settle_expense`（会計連携なしの精算記録）は残す。受信箱は `workforce.todo` を変えず、`expense.todo` を新設して「確定待ちの精算書」「未精算の仮払」を数える | 会計を使わない会社の手順を壊さない。承認待ち・精算待ちの経費は既存の項目が数えており、同じ経費を 2 つの提供元で二重に数えない |
| D13 | 勘定科目は会社設定 `expense.accounts`（`advance` 仮払金、`payable` 未払金、`defaultExpense` 明細の既定の費用科目）で持つ。仮払消費税は既存の `purchase.accounts.taxReceivable` を使う。l10n/jp の勘定科目表に `1950 仮払金`（資産、その他流動資産）を足す。導入チェックに `expense.accounts` を足す | 既存の payment・purchase と同じ「科目はコードで設定」の方式。既存の会社には seed が再実行されないため、不足を導入チェックで知らせる |
| D14 | 専用画面は `/finance/expenses`（精算待ちの経費を従業員 × 支払方法 × 拠点でまとめ、精算書の下書きを作る）だけ。精算書・仮払の編集・確定・取消・訂正、一覧・絞り込み・一括確定、関連記録、証憑は汎用画面（`/e/expense_settlement`、`/e/expense_advance`） | 汎用画面では「承認済みの経費を従業員ごとにまとめて 1 枚にする」操作ができない。それ以外は DSL から派生する画面で足りる |
| D15 | 入出金は精算書の `after_submit` で作って確定し（番号が決まった後なので入出金の備考と仕訳の摘要に精算書番号を入れられる）、取消では `after_cancel` で入出金を取り消す。どちらも精算書の確定・取消と同じトランザクション | kernel の取消は確定済みの参照元（`expense_settlement.paymentId` が入出金を参照）があると `DependencyError` にする。精算書が取消済みになった後でないと入出金を取り消せない。逆にこの検査が「精算書を残したまま入出金だけを取り消す」操作を止める |
| D16 | 精算書と仮払は CSV 取込の対象外（`import: false`） | 明細は承認済み経費から作るもので、行の内容と経費の対応を取込で作らせない |
| D17 | 1 件の経費は取消されていない精算書 1 枚にだけ入る。下書きの保存時に他の下書きにある経費を拒否し、確定時は経費の状態（`approved`）を従業員のロックの中で検査する | 二重精算の防止（[workforce-platform](workforce-platform.md) AC-5） |
| D18 | 精算日は今日（日本時間）以前で、含む経費の利用日以降。従業員の在籍は問わない（退職後の精算を許す） | 精算は実際に行った日で記録する（既存 `settle_expense` と同じ）。在籍は経費の保存時に検査済み |
| D19 | マニュアルは `docs/manual/expense-settlement.md`（付録の文字を付けない章。前例 `edge-service-setup.md`）に置き、付録F・05・00-index から結ぶ | 同じ回の他項目と付録の文字が衝突しない |

## 受入基準（EARS）

### 申請と承認（workforce）

- AC-1 WHEN 従業員が `workforce.save_expense` で経費を保存した THE SYSTEM SHALL 入力 `paymentMethod`（`personal` / `corporate_card` / `advance`、省略時 `personal`）を `workforce_expense.paymentMethod` に保存し、`my_portal` / `management_portal` の経費（`expenseSummary`）に返す。支払方法は他の項目と同じく下書き・差戻し中だけ変更でき、提出後は凍結される。既存の経費は追加 migration で `personal` になる。
- AC-2 THE SYSTEM SHALL 精算書に入れられる経費を `approved` のものに限る（承認は既存の `workforce.review_expense`。本人以外が承認）。WHEN 精算書が確定した THE SYSTEM SHALL 含む経費を `settled` にし、`paidOn` = 精算日、`paymentReference` = 精算書番号、`settledBy` = 確定した利用者を記録する。その経費は `workforce.todo` の `expense_settlement`（精算待ち）から外れ、本人の `/me` に精算済みと精算書番号が出る。`workforce.todo` の項目・件数の規則は変えない。

### 精算書の作成（下書き）

- AC-3 WHEN `expense.draft_settlement { employeeId, kind, expenseIds?, advanceId?, partnerId?, date? }` が呼ばれた THE SYSTEM SHALL 指定の経費（省略時はその従業員の、種類に対応する支払方法の、他の取消されていない精算書に入っていない承認済み経費の全部。最大 200 件）から精算書の下書きを 1 枚作り、`{ id, version }` を返す。明細は経費 1 件につき 1 行で、勘定科目は `expense.accounts.defaultExpense` の科目、税区分はその科目の `taxCategoryDefault`（無ければ `standard`）、支払先名・請求書区分は空にする。`date` の省略時は今日（日本時間）、`partnerId` の省略時はその従業員の直近の確定済み精算書・仮払の取引先（無ければ空）。経費の拠点が複数にまたがる指定は拒否する（拠点ごとに 1 枚）。
- AC-4 WHEN 精算書の明細が保存された THE SYSTEM SHALL 明細の経費が存在し要求者から読め、精算書と同じ従業員・同じ拠点で、`approved` で、支払方法が種類に対応することを検査し、満たさなければ `ValidationError`（`details.issues` に行と理由）を返す。IF 経費が取消されていない別の精算書に入っている THEN THE SYSTEM SHALL `Conflict`（その精算書の id を `details` に含める）を返す。明細の利用日・内容は経費から写し（server-owned）、要求者は変更できない。
- AC-5 WHEN 精算書の下書きが保存された（明細の保存を含む）THE SYSTEM SHALL D7 の規則で明細ごとの税率・税額・控除対象税額・控除対象外税額・控除率（server-owned）と、ヘッダの税抜合計・税額合計・控除対象税額・控除対象外税額・合計・税率別集計（`taxSummary`）を再計算する。請求書区分 `invoiceKind` は課税の税区分（`standard` / `reduced`）の明細で使い、`qualified`（適格請求書等あり。登録番号 `T`+13 桁が必須、控除率 1）、`not_qualified`（なし。控除率は経過措置の率）、`books_only`（帳簿のみ保存の特例。理由 `booksOnlyReason` が必須、控除率 1）のいずれか。税区分が `exempt` / `non_taxable` / `out_of_scope` の明細では請求書区分・理由・登録番号を空として扱い、税額 0 とする。金額は `Decimal`（JPY は 1 円単位、0 より大きい）。
- AC-6 IF 確定時に次のいずれかを満たさない THEN THE SYSTEM SHALL `ValidationError`（項目と理由）を返し、何も書かない: 明細が 1 行以上、経費ごとの明細金額の合計が経費の金額と等しい、課税明細の請求書区分・必要な登録番号・理由・支払先名がそろっている、同じ経費の明細の請求書区分・登録番号が同じ、取引先 `partnerId` がある、精算日が今日（日本時間）以前で含む経費の利用日以降、支払が生じる場合（AC-7）に支払方法 `method` と入出金口座 `paymentAccountId`（省略時は `payment.accounts` の方法別の既定）がある、会社の通貨が JPY。種類 `advance` では `advanceId` が同じ従業員の確定済み・未精算（`open`）の仮払で、仮払の支払日が精算日以前。

### 確定（submit）

- AC-7 WHEN 精算書を確定した THE SYSTEM SHALL 同じトランザクションで、(1) accounting の `postFromSource`（`sourceEntity = 'expense_settlement'`）で精算書の仕訳を作って確定し、(2) 種類と金額から決まる入出金を payment の `createClearingPayment` で作って確定し（立替精算: 支払・合計額・相手科目 未払金。仮払精算: 合計 > 仮払額なら差額の支払・相手科目 未払金、合計 < 仮払額なら差額の入金・相手科目 仮払金、等しければ作らない。法人カード精算: 作らない）、(3) 含む経費を精算済みにし（AC-2）、(4) 仮払を `settled` にし、(5) `journalEntryId` / `paymentId` と番号（`EXP-<年>-<連番>`、ADR-0006）を記録する。仕訳の摘要と入出金の備考には精算書番号と従業員名を入れる。
- AC-8 THE SYSTEM SHALL 精算書の仕訳を次の形で作る（ゼロの行は作らない。golden で固定）: 借方 費用科目（明細の科目 × 税区分 × 税率ごとに税抜額。税区分・税率を付ける）、借方 仮払消費税（税率ごとに控除対象税額。税区分・税率と摘要「仮払消費税 <税率名>」）、借方 費用科目（科目ごとに控除対象外税額。摘要「控除対象外消費税」）、貸方 未払金（立替精算・法人カード精算は合計、仮払精算は合計が仮払額を超える部分）、貸方 仮払金（仮払精算の min(合計, 仮払額)）。貸方の行には取引先を付ける。借方合計 = 貸方合計 = 合計。入出金の仕訳は payment の規則で作り、相手科目付きの支払は 借方 相手科目 / 貸方 入出金口座、入金は 借方 入出金口座 / 貸方 相手科目（いずれも取引先付き）とする。

  例（golden の 1 件目。JP 勘定科目表、`tax.rounding` 既定の切捨て、標準 10%・軽減 8%）: 立替精算で、経費 A 2026-10-05 3,300 円（旅費交通費 6500、標準、`qualified`）、経費 B 2026-10-06 1,080 円（雑費 6900、軽減、`not_qualified`、経過措置 0.7）、経費 C 2026-10-07 550 円（旅費交通費 6500、標準、`books_only` / `public_transport`）。税額 A 300・B 80・C 50、控除対象 A 300・B 56（80 × 0.7 の切捨て）・C 50、控除対象外 B 24、合計 4,930 円。精算書の仕訳: 借方 6500 3,500（標準 10%）/ 借方 6900 1,000（軽減 8%）/ 借方 1500 350（標準 10%）/ 借方 1500 56（軽減 8%）/ 借方 6900 24（控除対象外消費税）/ 貸方 2150 4,930（従業員の取引先）。入出金（支払 4,930、相手科目 2150）の仕訳: 借方 2150 4,930 / 貸方 1100 4,930。同じ内容の経費（支払方法は種類に対応するもの）で、仮払 10,000 円の仮払精算なら 貸方 1950 4,930 と入金 5,070（借方 1100 / 貸方 1950）、仮払 3,000 円なら 貸方 1950 3,000・貸方 2150 1,930 と支払 1,930（借方 2150 / 貸方 1100）。法人カード精算なら 貸方 2150 4,930（カード会社）で入出金なし。
- AC-9 IF 確定の途中のどこかが失敗した（入出金の拒否、会計期間が締め済み、勘定科目が存在しない、経費が並行して精算された、仮払が並行して消し込まれた、など）THEN THE SYSTEM SHALL すべてを巻き戻し、精算書の仕訳・入出金・入出金の仕訳を残さず、経費を `approved`、仮払を `open`、精算書を下書きのままにする。
- AC-10 WHEN 同じ経費を含む 2 枚の精算書（下書きの検査を通った後の並行操作を含む）や、手動の `workforce.settle_expense` と精算書の確定が競合した THE SYSTEM SHALL 1 つだけを成功させ、他方を `StateError` または `Conflict` で失敗させる（AC-9 の巻戻しを伴う）。同じ仮払を 2 枚の精算書で消し込むことも同様に 1 つだけ成功させる。

### 確定後の不変・取消・訂正

- AC-11 WHILE 精算書が確定済み THE SYSTEM SHALL ヘッダ（`journalEntryId` / `paymentId` を除く）・明細の変更と削除を拒否し、変更は取消 + 訂正だけとする。WHEN 確定済みの精算書を取り消した（任意の訂正日 `correctionDate` 付き）THE SYSTEM SHALL 同じトランザクションで精算書の仕訳を逆仕訳し（`reverseSourceEntry`、訂正日または元の日付）、入出金を取り消し（入出金の仕訳も逆仕訳される）、`paymentReference` がその精算書番号の経費だけを `approved` に戻し（`paidOn` / `paymentReference` / `settledBy` を空にする）、仮払を `open` に戻す。WHEN 取消済みの精算書を訂正（amend）した THE SYSTEM SHALL 明細の入力項目を写した新しい下書きを作り、確定すると新しい仕訳・入出金を作る。
- AC-12 IF 確定済みの精算書・仮払が参照している入出金を入出金の画面・API から直接取り消そうとした、または確定済みの精算書が参照している仮払を取り消そうとした THEN THE SYSTEM SHALL kernel の `DependencyError` で拒否する（取消は精算書・仮払の取消から行う）。

### 仮払

- AC-13 WHEN 仮払 `expense_advance`（従業員、取引先、支払日、金額、目的、支払方法、入出金口座）を確定した THE SYSTEM SHALL 同じトランザクションで `createClearingPayment`（支払・相手科目 仮払金）を作って確定し（仕訳は入出金の転記: 借方 仮払金 / 貸方 入出金口座）、`paymentId` と状態 `open` を記録する。番号は `ADV-<年>-<連番>`。WHEN `open` の仮払を取り消した THE SYSTEM SHALL 入出金を取り消す。IF 仮払が `settled` THEN THE SYSTEM SHALL 取消を拒否する（精算書を先に取り消す）。金額は 0 より大きい 1 円単位、支払日は今日以前。

### 入出金の拡張（payment）

- AC-14 THE SYSTEM SHALL `payment.counterAccountId`（相手科目、`account` への参照）を server-owned とし、汎用の作成・更新（REST・MCP・画面）で送られたら `PERMISSION_DENIED` を返す。`createClearingPayment(ctx, { direction, partnerId, date, amount, method, accountId?, counterAccountId, note? })` は要求者の `Context` のまま入出金を作って確定し（direction とロールの既存の検査、`payment` の create / submit 権限が必要）、相手科目が資産または負債の科目であることを検査する。IF 相手科目付きの入出金に消込明細がある THEN THE SYSTEM SHALL 保存と確定を `ValidationError` で拒否する。相手科目が空の入出金の転記（前払金・前受金）・検査・既存の試験の期待は変えない。

### 権限と境界

- AC-15 IF 精算書・仮払の作成・更新・確定・取消・訂正、または `expense.draft_settlement` / `expense.settlement_candidates` を、`accounting` と `workforce_payroll` の両方（または admin）を持たない利用者が行った THEN THE SYSTEM SHALL 書き込む前（読取 action では読む前）に `PERMISSION_DENIED`（`details` に不足しているロール）を返す。action の `permission` はロールの OR しか表せないため、action と entity の権限は `accounting` に与え、`workforce_payroll` は hook・handler の冒頭で検査する。IF 精算書・仮払の従業員が要求者本人（admin を含む）THEN THE SYSTEM SHALL 作成・確定・取消を `PERMISSION_DENIED`（自己精算）で拒否する。
- AC-16 THE SYSTEM SHALL `workforce_employee` には自分の精算書・明細・仮払だけを読ませ（行の権限 `userId = $ctx.userId`）、他人の記録は一覧・取得・関連記録のいずれにも現れない（取得は NOT_FOUND。従業員には export 権限を与えないので CSV 出力もできない）。拠点を限定された `workforce_manager` には担当拠点の精算書・仮払だけを読ませる（`siteAccess`）。拠点を限定された文脈から他拠点の従業員の精算書を作ることはできない。
- AC-17 THE SYSTEM SHALL 会社をまたいで精算書・仮払・明細を読ませず、他社の経費・仮払・取引先・勘定科目を明細やヘッダから参照させない（NOT_FOUND または検証エラー）。他社の仕訳・入出金・経費は変化しない。

### 受信箱・設定・導入チェック

- AC-18 THE SYSTEM SHALL 受信箱の提供元 `expense.todo`（[inbox](inbox.md) AC-1 の規約、`mutates: false`、`tx: 'none'`）で、`draft_settlements`（warn: 下書きの精算書で従業員が要求者でないもの。href `/e/expense_settlement?status=draft`）と `open_advances`（info: 確定済み・`open` の仮払。href `/finance/expenses`）を、要求者の `Context` の `Repository` で数えて返す。提供元を実行できるのは精算書の `submit` 権限を持つ利用者（`permission: { entity: 'expense_settlement', op: 'submit' }`、つまり accounting と admin）で、`workforce_payroll` を持たない要求者には項目を返さない（`{ items: [] }`。処理できない項目は数えない [inbox](inbox.md) AC-1。提供元の失敗にはしない）。
- AC-19 THE SYSTEM SHALL 会社設定 `expense.accounts`（`advance` 既定 `1950`、`payable` 既定 `2150`、`defaultExpense` 既定 `6900`）を設定画面の「会計」に勘定科目コードの入力欄付きで表示する（[ADR-0027](../adr/0027-setting-presentation.md) の表示属性）。導入チェック `expense.accounts`（id 固定）は、設定のコードの科目が会社に無いとき `warn` と設定画面への href を返し、そろっていれば `ok` を返す。l10n/jp の勘定科目表は新しい会社に `1950 仮払金` を作る。

### 画面

- AC-20 WHEN `expense.settlement_candidates` を実行できる利用者が `/finance/expenses` を開いた THE SYSTEM SHALL 承認済みで精算書に入っていない経費を従業員 × 支払方法 × 拠点でまとめ、件数・合計・最も古い利用日と、下書きの精算書に入っている経費の件数、従業員ごとの未精算の仮払を表示する。各まとまりの「精算書を作成」で `expense.draft_settlement` を呼び、作られた精算書の画面（`/e/expense_settlement/<id>`）へ移動する。失敗は ui-kit の失敗表示（メッセージ・技術情報・再試行）で示す。画面は「会計・資金」分野の専用画面として、meta に `expense.settlement_candidates` がある利用者（accounting と admin）の画面検索・分野一覧に出す。IF サーバーが `workforce_payroll` の不足で拒否した、または URL を直接開いた利用者に権限が無い THEN THE SYSTEM SHALL 読込失敗ではなく、必要なロール（accounting と workforce_payroll）を説明する。「この画面の説明」はマニュアルの章を開く。
- AC-21 THE SYSTEM SHALL 精算書・仮払の汎用画面で、ラベル付きの節（基本・支払・金額・転記・備考）、明細の表（経費・利用日・内容・支払先名・勘定科目・税区分・金額・請求書区分・理由・登録番号と、計算された税額・控除対象税額は読取専用）、確定・取消・訂正の操作、関連記録（仕訳・入出金・仮払・経費・訂正の連鎖）と証憑パネル（attachments）を表示する。
- AC-22 WHEN 従業員が `/me` で経費を記録・編集した THE SYSTEM SHALL 支払方法（立替・法人カード・仮払金から支払）を選ばせ、一覧と詳細に支払方法を表示する。精算済みの経費には精算日と精算書番号を表示する。`/workforce` の経費の承認済みの行には、`expense.settlement_candidates` を実行できる利用者に `/finance/expenses` への移動を表示する。
- AC-23 THE SYSTEM SHALL 追加・変更した画面の文言を日本語と英語で持ち、390px 幅で横スクロールなしに操作でき、`/finance/expenses` に axe の serious / critical の違反を出さない。

## 関係するファイル・インターフェース（名指し）

### 新規 module `modules/expense`（`@daifuku/mod-expense`）

- `src/module.ts`: `ExpenseModule = defineModule({ name: 'expense', depends: ['workforce', 'partner', 'tax', 'accounting', 'purchase', 'payment'], entities, actions, hooks, menus })`。menus は `/finance/expenses`（order 62）と 2 つの entity。
- `src/entities/settlement.ts`: `ExpenseSettlement = defineDocument({ name: 'expense_settlement', naming: { type: 'sequence', prefix: 'EXP-', period: 'year' }, lines: [{ entity: 'expense_settlement_line', parentField: 'settlementId' }], siteAccess: { kind: 'store', field: 'siteId' }, import: false, allowOnSubmit: ['journalEntryId', 'paymentId'] })`。項目: `employeeId`（ref `workforce_employee`、必須、作成後不変）、`userId` / `siteId`（server-owned。従業員と経費から）、`kind`（enum）、`date`、`partnerId`（ref `partner`）、`advanceId`（ref `expense_advance`）、`method`（payment の `PAYMENT_METHODS`、既定 `bank_transfer`）、`paymentAccountId`（ref `account`）、server-owned の `subtotal` / `taxTotal` / `deductibleTax` / `nonDeductibleTax` / `total` / `advanceAmount` / `payAmount` / `refundAmount`（money）、`taxSummary`（json）、`journalEntryId`（ref `journal_entry`）、`paymentId`（ref `payment`）、`note`。権限: `accounting` read/create/update/delete/submit/cancel/amend/export、`workforce_payroll` / `workforce_hr` read/export、`workforce_manager` read、`workforce_employee` read（rowRule `userId = $ctx.userId`）。delete は下書きだけ（kernel の規則）で、明細の全置換保存にも要る。
- `src/entities/settlement-line.ts`: `ExpenseSettlementLine = defineEntity({ name: 'expense_settlement_line', siteAccess: { kind: 'parent', field: 'settlementId', entity: 'expense_settlement' } })`。項目: `settlementId`（ref、cascade）、`seq`、`expenseId`（ref `workforce_expense`）、server-owned の `userId`・`expenseDate`・`description`、`payeeName`、`accountId`（ref `account`）、`taxCategory`（mod-tax の `TAX_CATEGORIES`）、`amount`（money、税込）、`invoiceKind`（enum `qualified` / `not_qualified` / `books_only`）、`booksOnlyReason`（enum `public_transport` / `business_travel` / `small_amount`）、`invoiceRegistrationNo`（`/^T\d{13}$/`）、server-owned の `taxRate` / `taxableAmount` / `taxAmount` / `deductibleTax` / `nonDeductibleTax` / `creditRatio`。権限は親と同じロール（employee は rowRule）。
- `src/entities/advance.ts`: `ExpenseAdvance = defineDocument({ name: 'expense_advance', naming: { prefix: 'ADV-', period: 'year' }, siteAccess: { kind: 'store', field: 'siteId' }, import: false, allowOnSubmit: ['paymentId', 'status'] })`。項目: `employeeId`、`userId` / `siteId`（server-owned）、`partnerId`、`date`、`amount`、`purpose`、`method`、`paymentAccountId`、`status`（server-owned enum `open` / `settled` / `cancelled`）、`paymentId`（ref `payment`、server-owned）、`note`。権限は精算書と同じ。`journalEntryId` は持たない（転記は入出金が行う。締めガイドでは注意扱いの下書きになる）。
- `src/contract.ts`: `EXPENSE_SETTLEMENT_KINDS`、`INVOICE_KINDS`、`BOOKS_ONLY_REASONS`、`KIND_PAYMENT_METHOD`（種類 → 支払方法）、action の入出力 zod。
- `src/settings.ts`: `EXPENSE_ACCOUNTS_KEY = 'expense.accounts'`、`expenseAccountsSchema`、`EXPENSE_SETTING_DEFS`（`category: 'accounting'`、各項目 `widget: 'account-code'`）、`resolveExpenseAccounts(ctx)`（不足コードを列挙した `StateError`）。
- `src/services/tax.ts`（純粋）: 明細の税計算（mod-tax の `resolveRate` / `summarizeTax` / `taxScaleForCurrency`、mod-purchase の `splitTax` / `resolveCreditRatio`）。
- `src/services/posting.ts`（純粋）: `settlementJournalLines(input)`（AC-8）と `clearingPlan(kind, total, advance)`（AC-7 の入出金の向きと額）。
- `src/hooks/`: 下書きの検査と再計算（ヘッダ `before_validate`、明細の `before_validate` / `after_lines_saved`）、`before_submit`（権限・自己精算・検査・再計算・`postFromSource`）、`after_submit`（仕訳の摘要、`createClearingPayment`、`settleExpensesForSource`、仮払の状態、`paymentId`）、`before_cancel`（逆仕訳・経費を戻す）、`after_cancel`（入出金の `cancelDocument`、仮払を戻す）。仮払も同じ構成。
- `src/internal.ts`: module 内だけの write capability（ADR-0016。`userId` / `siteId` / 計算値 / `paymentId` / `status` を所有）。
- `src/actions/candidates.ts`: `expense.settlement_candidates`（読取専用。承認済み経費を `Repository.list` で最大 2,000 件、超えたら `truncated: true`）。`src/actions/draft.ts`: `expense.draft_settlement`。`src/actions/todo.ts`: `expense.todo`。
- `src/health.ts`: `expenseAccountsHealthCheck`（id `expense.accounts`）。
- `src/index.ts`: 上の公開物と型。

### 既存 module の変更

- `modules/workforce/src/contract.ts`: `EXPENSE_PAYMENT_METHODS`、`expenseSaveInput.paymentMethod`、`expenseSummary.paymentMethod`。`src/entities/expense.ts`: `paymentMethod`（server-owned、必須、既定 `personal`、ラベル付き）。`src/actions/expenses.ts`: 保存で書く。`src/expense-settlement.ts`（新規）: `settleExpensesForSource(ctx, { employeeId, expenseIds, paidOn, reference })` と `reopenExpensesForSource(ctx, { employeeId, expenseIds, reference })`（従業員ロック、`requireOther`、`workforce_payroll` か admin、状態の検査、`internalWrite`）。`src/index.ts` から公開する。
- `modules/payment/src/entities/payment.ts`: `counterAccountId`（ref `account`、server-owned、フォームの「備考・仕訳」節）。`src/clearing.ts`（新規）: `createClearingPayment` / `ClearingPaymentInput`。`src/services/posting.ts`: `PostingInput.counterAccountId`、`MEMO.clearing`。`src/hooks/validate.ts`・`lines.ts`・`submit.ts`: 相手科目付きの消込明細の拒否と転記。`src/index.ts` から公開する。
- `modules/accounting`: 変更なし（`postFromSource`、`reverseSourceEntry`、`assertJpySettlement`、`postingDimensions` を公開入口から使う）。`modules/purchase`: 変更なし（`resolveCreditRatio`、`splitTax`、`resolvePostingAccounts` の `taxReceivable`）。`modules/tax`: 変更なし（`loadTaxRates`、`loadTaxSettings`、`resolveRate`、`summarizeTax`、`taxScaleForCurrency`、`TAX_CATEGORIES`）。
- `l10n/jp/src/seeds/chart-of-accounts.ts`: `asset('1950', '仮払金', 'その他流動資産')`。
- migration（`pnpm db:schema && pnpm db:generate`）: 新しい 3 表、`workforce_expense.payment_method`（既定 `personal`）、`payment.counter_account_id`。番号は実装時点の次の空き番号（第5・6回の統合で `0018` 以降が使われている可能性がある）。

### apps

- `apps/runtime/src/catalog.ts`: `ExpenseModule` を `WorkforceEvidenceModule` の後に足す。
- `apps/web/src/pages/expense-settlement-page.tsx`（新規。UI キット）、`apps/web/src/api/expense.ts`（新規）、`apps/web/src/lib/expense-settlement.ts`（新規。まとまりの表示・文言）、`apps/web/src/router.tsx`（`/finance/expenses`）、`apps/web/src/lib/navigation-data.ts`（専用画面の定義 `action: 'expense.settlement_candidates'`、`MODULE_WORKSPACES.expense = 'finance'`）、`apps/web/src/lib/help.ts`（`/finance/expenses` → `expense-settlement.md`）、`apps/web/src/ui/token-usage.test.ts`（`CONVERTED`）、`apps/web/src/components/workforce-expenses.tsx`（支払方法の選択と表示）、`apps/web/src/components/workforce-reviews.tsx`（承認済みの行の移動）。
- 文書: `docs/adr/0039-expense-settlement-posting.md`（新規）、`docs/manual/expense-settlement.md`（新規）、`docs/manual/appendix-f-workforce.md`（精算記録の説明の更新）、`docs/manual/05-daily.md`、`docs/manual/00-index.md`、`docs/architecture/workforce.md`（構成表・経費の状態図に settled → approved（精算書の取消））、`docs/conventions/ui.md`（受信箱の提供元の表に `expense.todo`）、`docs/specs/payment.md`（相手科目の追記）、`docs/verification/invariants.md`（必要なら精算の不変条件）。

## データ・業務ルール（出典）

- 端数処理は 1 適格請求書（ここでは 1 経費 = 1 領収書）につき税率ごとに 1 回 — [japan-tax.md#rounding](../domain/japan-tax.md#rounding)（国税庁 Q&A 問57、確認 2026-09-10）。税率は期間付きの `tax_rate`（ADR-0011）。
- 適格請求書・適格簡易請求書と登録番号（`T` + 13 桁）— [japan-tax.md#インボイス制度](../domain/japan-tax.md#インボイス制度)（タックスアンサー No.6625、Q&A 問24-2・問58、確認 2026-09-10）。登録番号の公表サイトでの照合はしない。
- 免税事業者等からの課税仕入れの経過措置（2026-10-01〜2028-09-30 は 70%）— 同上（令和8年度改正、Q&A 問113、再確認 2026-09-10）。率は `l10n/jp/src/services/transitional-credit.ts` の期間付きデータを purchase の上書き点経由で使う。1 億円/年の上限は purchase と同じく範囲外。
- 帳簿のみの保存で控除できる取引（公共交通機関・出張旅費等・少額特例）— [japan-tax.md#books-only](../domain/japan-tax.md#books-only)、[#small-amount-relief](../domain/japan-tax.md#small-amount-relief) **【未確認】**（2026-10-30、一次資料に接続できず）。システムは判定せず、経理担当者が選んだ区分と理由を記録し、控除率 1 とする。理由の名前・説明文は一次資料で確認するまで「未確認」の扱いを manual に明記する。
- 帳簿の記載事項（相手方・年月日・内容・軽減の旨・税率ごとの金額）— [japan-tax.md#input-tax-books](../domain/japan-tax.md#input-tax-books) **【未確認】**。
- 控除対象外の税額を費用科目に含める・仮払消費税の科目 — [purchase](purchase.md) AC-2/AC-3 と同じ。
- 仮払金・未払金の処理は簿記の慣行 **【未確認: 一次出典なし】**（[japan-tax.md#expense-settlement](../domain/japan-tax.md#expense-settlement)）。
- 確定済み伝票の不変・取消 + 訂正 — ADR-0006。仕訳の追記専用 — ADR-0005。module 所有の書込 — ADR-0016。

## スコープ外（明記）

- 本人の仮払申請と承認の流れ、仮払の部分消込・複数の精算書での消込（D10）。
- 法人カード会社への引落しの支払、カード利用明細の取込・自動突合（D11）。
- 全銀の振込ファイルの作成・送金（banking の振込は仕入請求書を対象とし、経費精算の入出金は含めない）、給与と合算した精算。
- 日当・通勤手当の所得税の非課税判定、外貨の経費、税込経理、登録番号の公表サイトでの照合。
- 帳簿のみ特例・少額特例の対象かどうかの自動判定（3 万円・1 万円・対象事業者・期間）。
- 電子帳簿保存法のスキャナ保存要件（解像度・タイムスタンプ・入力期限）への適合の主張。本人の領収書は既存の `workforce_receipt` の範囲のまま。
- 精算書の印刷。C5（帳票の共通化）の統合後に `expense.render_expense_settlement_html` を足す（実装では該当箇所に `// C5 hook:` の注記を残す）。
- 多段の承認経路、承認者の金額別の振り分け。
- 分析データセット（`apps/api/src/analytics/catalog.ts` の従業員経費）への支払方法の追加。
- 費目（`workforce_expense.category` の文字列）から勘定科目への自動対応（未決事項）。

## 検証手順（実行して記録する）

### 受入基準と試験の対応

| AC | 水準 | 試験（テスト名に `AC-n` を入れる） |
|---|---|---|
| AC-1 | DB・単体（Web） | `modules/workforce/test/leave-expense.db.test.ts`（保存・既定・提出後の凍結・portal の出力）、`apps/web/src/lib/workforce.test.ts`（支払方法の表示名・既定値） |
| AC-2 | DB | `modules/expense/test/settlement.db.test.ts`（承認前の経費を拒否、確定で settled と番号、`workforce.todo` の `expense_settlement` の件数が減る） |
| AC-3 | DB | `modules/expense/test/draft.db.test.ts` |
| AC-4 | DB | 同上（別従業員・別拠点・未承認・支払方法違い・他の下書きにある経費） |
| AC-5 | 単体・DB | `modules/expense/test/tax.test.ts`（丸め単位・配分・控除率・区分ごとの必須項目）、`draft.db.test.ts`（保存時の再計算） |
| AC-6 | DB | `settlement.db.test.ts`（各検証エラー） |
| AC-7 | DB | `settlement.db.test.ts`（3 種類 × 仮払の差額 3 通りで仕訳・入出金・経費・仮払・リンク） |
| AC-8 | 単体（golden）・DB | `modules/expense/test/golden/settlement.json` と `modules/expense/test/posting.test.ts`、DB で実際に転記された仕訳明細を同じ golden と照合 |
| AC-9 | DB | `settlement.db.test.ts`（試験内で入出金の `before_submit` に失敗する hook を登録して確定 → 仕訳・入出金なし、経費 approved、仮払 open、下書きのまま。締め済み期間、科目の欠落も） |
| AC-10 | DB | `settlement.db.test.ts`（同じ経費の 2 枚、手動精算との競合、同じ仮払の 2 枚。`Promise.allSettled` の並行確定を含む） |
| AC-11 | DB | `settlement.db.test.ts`（確定後の更新・明細保存・削除の拒否、取消で逆仕訳・入出金取消・経費と仮払の復帰、訂正 → 再確定） |
| AC-12 | DB | `settlement.db.test.ts`、`modules/expense/test/advance.db.test.ts` |
| AC-13 | DB | `advance.db.test.ts` |
| AC-14 | 単体・DB | `modules/payment/test/allocate.test.ts` または新しい `posting.test.ts`（相手科目の転記）、`modules/payment/test/clearing.db.test.ts`（server-owned の拒否、科目の種類、消込明細の拒否、既存の転記が不変） |
| AC-15 | DB | `modules/expense/test/access.db.test.ts`（accounting だけ・workforce_payroll だけ・本人・admin 本人） |
| AC-16 | DB | `access.db.test.ts`（本人 2 人、拠点限定の管理者、`<entity>.related` と `<entity>.export_rows` の action） |
| AC-17 | DB | `access.db.test.ts`（2 社） |
| AC-18 | DB | `modules/expense/test/todo.db.test.ts` |
| AC-19 | DB・単体 | `modules/expense/test/health.db.test.ts`、`l10n/jp/test/l10n-jp.db.test.ts`（表の件数は定数から導出されるため期待は自動で追従。1950 の存在を足す）、設定定義の表示属性の検査（`kernel` の既存の setting presentation 検査が module 登録時に走る） |
| AC-20 | 単体・ブラウザ | `apps/web/src/lib/expense-settlement.test.ts`、`apps/web/src/lib/help.test.ts`（章の実在）、`apps/web/e2e/expense-settlement.spec.ts` |
| AC-21 | ブラウザ | `expense-settlement.spec.ts`（下書きの明細を編集 → 確定 → 関連記録に仕訳と入出金 → 取消 → 訂正。API で用意した仮払の記録画面で関連記録に入出金） |
| AC-22 | ブラウザ | `expense-settlement.spec.ts`（本人が法人カードの経費を記録、`/me` で精算済みと番号）、既存 `workforce.spec.ts` は変えずに通す |
| AC-23 | ブラウザ | `expense-settlement.spec.ts`（日英、390px で `scrollWidth <= clientWidth`、`a11y-policy.ts` の `judge()`） |

### 手順

1. 編集中は `pnpm gate:quick`。コミット前に `export TEST_DATABASE_URL_OWNER=… TEST_DATABASE_URL=…` と `GATE_DB_SHARDS=1 pnpm gate:light`。
2. DB: 上表の `modules/expense/test/*.db.test.ts`、`modules/payment/test/clearing.db.test.ts`、`modules/workforce/test/leave-expense.db.test.ts`、`l10n/jp/test/l10n-jp.db.test.ts` を個別にも実行し、件数と所要時間を log に残す（他の作業者と共有のサーバーで `out of shared memory` が出たらその suite だけ再実行）。
3. 単体: `modules/expense/test/tax.test.ts`・`posting.test.ts`（golden）、payment の転記、Web の lib。
4. API で一連を確かめる: 経費の保存（`POST /actions/workforce.save_expense`、`paymentMethod` 付き）→ 提出 → 承認 → `POST /actions/expense.draft_settlement` → `PATCH /api/expense_settlement/:id`（`{ patch: { partnerId, lines: { expense_settlement_line: [...] } }, expectedVersion }`）→ `POST /api/expense_settlement/:id/submit` → `GET /api/expense_settlement/:id/related`（仕訳・入出金）→ `POST /actions/accounting.trial_balance` で未払金・仮払金・仮払消費税の残高を確認 → `POST /api/expense_settlement/:id/cancel` → `POST /api/expense_settlement/:id/amend`。結果を log に貼る。
5. ブラウザ（`expense-settlement.spec.ts` の筋書き）: 従業員が `/me` で立替と法人カードの経費を 1 件ずつ記録・提出 → 拠点管理者が `/workforce` で承認 → accounting と workforce_payroll を持つ経理担当が `/finance/expenses` で立替のまとまりから精算書を作成 → 汎用画面で取引先・支払先名・請求書区分を入れて確定 → 関連記録に仕訳と入出金 → 従業員の `/me` に精算済みと番号 → 経理担当が取消 → 訂正。日英・390px・axe。実行は `/tmp/claude-0/-home-user-DaifukuERP/8a7541e3-ab40-5f9c-ac08-5679d2bd0af8/scratchpad/tools/e2e-run.sh <worktree> <slot 19〜30> apps/web/e2e/expense-settlement.spec.ts --project=chromium --no-deps`。既存の `workforce.spec.ts`、`inbox.spec.ts`、`payment.spec.ts`、`a11y.spec.ts` も同じ方法で通す。
6. 最後に `pnpm test:db:templates -- --drop` で自分の試験 DB のテンプレートと shard を消す。
7. `pnpm gate:full` は統合担当が実行する。

## 実装時に確かめる前提（コードを読んで置いた推定。結果をこの spec に書き戻す）

- 伝票の確定 hook の中で別の伝票を確定・取消できる（入れ子の lifecycle）。前例: payment の `before_submit` が `postFromSource` 経由で `journal_entry` を確定している。精算書の `after_submit` から入出金の `submitDocument`、`after_cancel` から入出金の `cancelDocument` を呼ぶ。
- kernel の `findDependents`（`kernel/src/document.ts`）は確定済み document の `ref` だけを数える。精算書の `paymentId`・`advanceId` と仮払の `paymentId` が AC-12 の拒否を生み、取消済みの精算書は入出金の取消を止めない。仮払から精算書への `ref` は持たない（持つと精算書の取消が止まる）。
- `siteAccess: { kind: 'store' }` の document で、hook が導いた server-owned の `siteId` が作成時に要求者の拠点の範囲で検査される（AC-16 の最後の文）。検査されない場合は hook で明示的に検査する。
- 明細の `before_validate` は全置換保存で行ごとに走り、ヘッダの再計算は `after_lines_saved` で 1 回行う（payment の `hooks/validate.ts` と同じ）。経費ごとの合計の検査は途中の状態を見るため確定時だけにする（AC-6）。
- 入出金の確定時の `assertDirectionRole` と `postFromSource` は、精算書の確定者（accounting）の `Context` のまま通る。

## 未決事項（利用者の判断待ち。括弧内は初版の既定）

- 従業員と取引先の対応表（作らない。下書き作成時に直近の取引先を初期値にする。従業員ごとの取引先を自動作成もしない）。
- 費目（自由記述の `category`）から勘定科目への対応表（作らない。既定科目 `defaultExpense` から明細で変える）。
- 本人の仮払申請と承認（作らない。必要になれば workforce に申請を足し、`workforce.todo` に `advance_review` を足す）。仮払の部分消込（しない）。
- 法人カードの引落しの支払（現行の手動仕訳 借方 未払金 / 貸方 普通預金。将来は accounting ロールに限り手動の入出金で相手科目を選べるようにする案）。
- 領収書に記載された税額と再計算の 1 円差（店の端数処理が会社設定と違う場合。初版は会社の `tax.rounding` で再計算し、記載額の入力欄は作らない）。
- 帳簿のみ特例・少額特例の判定（しない。区分と理由を記録するだけ。domain の【未確認】を一次資料で確かめた後、l10n/jp に期間付きの検査（1 万円未満・2029-09-30 まで・会社が対象者か）を足すかを決める）。
- 汎用の記録画面の分野（`expense` module の記録は「会計・資金」。本人だけのロールの利用者にも自分の精算書・仮払がこの分野に出る。従業員向けには `/me` の精算済み表示で足りるとして、分野を「従業員・労務」にするかは利用後に判断）。
- 精算待ちの経費を受信箱でどちらの画面へ案内するか（`workforce.todo` の `expense_settlement` は従来どおり `/workforce` へ。そこから `/finance/expenses` へ移動できるようにする。`workforce.todo` の href は変えない）。
