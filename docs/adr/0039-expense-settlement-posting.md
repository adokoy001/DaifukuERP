# ADR-0039: 経費精算書は経費の仕訳を accounting の転記入口で、支払を payment の相手科目付き入出金で同じトランザクションに作る

- 状態: 採択
- 日付: 2026-10-30
- 関連: [append-only の元帳](0005-append-only-ledger.md)、[伝票の確定・取消・訂正](0006-docstatus-lifecycle.md)、[認可](0007-authorization.md)、[ポートとカスタマイズ層](0013-hexagonal-ports.md)、[基盤の不変条件と module 所有の書込](0016-foundation-invariants.md)、[会社と店舗・拠点の権限](0018-company-and-store-access.md)、[受入基準](../specs/expense-settlement.md)

## 背景

従業員経費（`workforce_expense`）は本人の申請 → 拠点の承認 → 給与・精算本部の「精算記録」（精算日と参照番号の手入力）で終わり、仕訳と支払は会計側で別に手入力していた。計画（[完成度向上の実装計画](../completion-plan.md) E5）は、精算書の確定で支払と仕訳を同じトランザクションで作り、payment と accounting の転記を公開入口から再利用し、accounting の規則を迂回する新しい転記経路を作らないことを求めた。次を決める必要があった。

- 精算書をどの module に置くか（workforce は `depends: []` の業界非依存 module で、会計・入出金に依存させられない）。
- 現行の payment は消込のない支払を前払金（`payment.accounts.advancePaid`、JP 1900）に、消込のない入金を前受金（2400）に転記する。立替経費の支払は「未払金の決済」、仮払の支払と返金は「仮払金の増減」であり、この形では表せない。
- 入出金を他 module の伝票から作るとき、誰の権限で、どの順序で、取消・訂正をどう扱うか。

## 確認した事実（2026-10-30、コードと DB 試験）

- 伝票の確定 hook の中で別の伝票を作成・確定・取消できる。前例は payment の `before_submit` が `postFromSource` 経由で `journal_entry` を確定していること。kernel の `submitDocument` / `cancelDocument` は呼出し元の `Context` とトランザクションのまま動く。
- kernel の `findDependents`（`kernel/src/document.ts`）は、確定済み document の `ref` 項目が対象を指していれば取消を `DependencyError`（`HAS_DEPENDENTS`）で拒否する。取消済みの参照元は数えない。
- kernel の訂正（`amendDocument`）は server-owned の項目を写さない。
- `payment.todo` の `unallocated_payments` と締めガイドの `unallocated_payments` は `unallocatedAmount > 0` で数える。
- banking は payment の `before_cancel` で、有効な銀行照合のある入出金の取消を `StateError` で拒否する。

## 決定

1. **新しい module `expense`**（`modules/expense`、`@daifuku/mod-expense`、depends: workforce・partner・tax・accounting・purchase・payment）に精算書 `expense_settlement`（明細 `expense_settlement_line`）と仮払 `expense_advance` を置く。workforce は精算書を知らず、精算書が workforce の公開関数 `settleExpensesForSource` / `reopenExpensesForSource` / `lockEmployeeForSettlement`（従業員のロック。手動の `workforce.settle_expense` と同じキー）を呼ぶ。
2. **相手科目付きの入出金**: `payment.counterAccountId`（`account` への参照、server-owned）を足す。値を書けるのは payment の公開関数 `createClearingPayment(ctx, { direction, partnerId, date, amount, method, accountId?, counterAccountId, note? })` だけで、payment 内の write capability（ADR-0016。`counterAccountId` の create だけを所有）で作成し、同じ `Context` で `submitDocument` する。payment 自身の規則（direction とロール、JPY、入出金口座の既定、`postFromSource`）がそのまま働く。相手科目は会社の資産または負債で、税の役割を持たず、入出金口座と違うこと（違反は `ValidationError`）。
   - 転記: 支払は 借方 相手科目 / 貸方 入出金口座、入金は 借方 入出金口座 / 貸方 相手科目（いずれも取引先付き、摘要「精算」）。前払金・前受金は使わない。
   - `allocatedAmount = unallocatedAmount = 0`。配分を待たないので `payment.todo` と締めガイドの未配分の件数から、条件を変えずに外れる。
   - 消込明細は保存（明細の hook）と確定（`before_submit`）で `ValidationError`。
   - 相手科目付きの入出金を訂正した下書きは、相手科目が写らず前払金の支払になるため、更新と確定を `StateError` で拒否する（訂正は精算書・仮払の取消・訂正で行う）。
   - 相手科目が空の入出金の転記・検査は変えない。
3. **精算書の確定**（すべて確定者の `Context`、同じトランザクション）:
   1. `before_submit`: 権限（下記 6）と自己精算の拒否、従業員のロック、全明細の再検査（承認済み・同じ従業員と拠点・支払方法が種類に対応・他の精算書に入っていない）、税の再計算、accounting の `postFromSource`（`sourceEntity = 'expense_settlement'`）で経費の仕訳（借方 費用・仮払消費税・控除対象外消費税 / 貸方 未払金・仮払金）。明細 0 行の仮払精算は仕訳を作らない。
   2. `after_submit`（番号の確定後）: 仕訳の摘要に番号、`settleExpensesForSource`（経費を `settled`、参照番号 = 精算書番号）、仮払を `settled`、種類と金額から決まる入出金を `createClearingPayment` で作成・確定（立替: 支払・未払金、仮払: 差額の支払・未払金または差額の入金・仮払金、法人カード: なし）。`paymentId` を記録する。
   3. どこかが失敗すれば全体が巻き戻る（精算書は下書き、経費は `approved`、仮払は `open`）。
4. **取消の順序**: `before_cancel` で経費の仕訳を逆仕訳し（`reverseSourceEntry`、訂正日または元の日付）、参照番号がその精算書番号の経費だけを `approved` に戻し、仮払を `open` に戻す。kernel が精算書を取消済みにした後の `after_cancel` で入出金を同じ訂正日で `cancelDocument` する（取消済みの参照元は `findDependents` に数えられない）。銀行照合済みなら banking が `StateError` を投げ、全体が巻き戻る。逆に、確定済みの精算書・仮払が参照している入出金を単独で取り消す操作、確定済みの精算書が参照している仮払を取り消す操作は、kernel の `DependencyError` になる。
5. **仮払**: `expense_advance` の確定で `createClearingPayment`（支払・相手科目 仮払金）を作る。仮払自体は仕訳を持たない（転記は入出金が行う）。1 件の仮払は 1 枚の仮払精算で全額を消し込む。
6. **権限**: 作成・更新・確定・取消・訂正は `accounting` と `workforce_payroll` の両方（または admin）。action と entity の権限はロールの OR しか表せないため、entity と action は `accounting` に与え、`workforce_payroll` は hook・handler の冒頭で検査する。拒否は kernel の `PermissionDenied` で、`details.op` に理由（`<op>:requires-workforce_payroll`、`<op>:self-settlement`）を入れる。自己精算の拒否は、精算書・仮払の作成・確定・取消だけでなく、別の担当者が作った下書きのヘッダ・明細・仮払の更新と削除にも掛ける（2026-10-30 のレビュー指摘で追加。下書きの取引先・金額を本人が変えてから同僚が確定すると、本人が決めた支払になるため）。kernel・DSL は拡張しない。
7. **経費の内容の写し**: 精算明細は経費の利用日・内容を server-owned で写す。accounting だけの利用者はこれを読めるが、`workforce_expense` と本人の領収書（`workforce_receipt`）は読めない。仕入税額控除の帳簿の記載事項（取引年月日・内容）として仕訳の根拠に要るため（[japan-tax.md#input-tax-books](../domain/japan-tax.md#input-tax-books) 【未確認】）。

## 却下した案

- **精算書を workforce に置く**: workforce が accounting・payment に依存し、業界非依存の層が崩れる。
- **仕訳を 1 本にまとめる（費用と支払を同じ仕訳）**: 入出金の転記規則（direction・ロール・口座の既定・銀行照合の対象）を payment から外すことになり、未払金の取引先別残高で「計上 → 支払」を追えない。
- **精算書が直接 `journal_entry` に支払の行を書く**: accounting の規則は通るが、payment の検査と銀行照合の対象から外れ、計画の「新しい転記経路を作らない」に反する。
- **payment に汎用の「相手科目」入力を開放する**: 手入力の入出金で任意の科目を選べると、売掛・買掛の消込規則を迂回できる。初版は他 module の伝票が作るものに限る（法人カードの引落しの支払は未決事項）。
- **`payment.unallocatedAmount = amount` のまま件数の条件を変える**: `payment.todo` と締めガイドの 2 か所の条件を変えることになる。0 にすれば条件を変えずに済む。

## 帰結

- payment は「他 module の伝票が作る入出金」の契約（`counterAccountId`、`createClearingPayment`、取消は所有する伝票から）を持つ。同じ形で将来の伝票（法人カードの引落し、給与の支払など）も入出金を作れる。
- 精算書の amend は、従業員が別拠点へ異動した後だと、ヘッダの拠点が従業員の現在の拠点になり明細の検査で失敗する（作業記録に記録。`/finance/expenses` から新しい下書きを作れば元の拠点で作られる）。
- 精算書の印刷は C5（帳票の共通化）の統合後に `expense.render_expense_settlement_html` を足す（`hooks/settlement.ts` に `// C5 hook:` の注記）。
- 精算書・仮払に添付した証憑（`attachment`、`linkedEntity` = `expense_settlement` / `expense_advance`）の読取は attachments module の既存の規則のまま（`accounting`・`sales`・`purchasing`・`viewer` が読め、行の規則は無い）で、精算書の読取規則（本人・拠点管理者・人事・給与・精算本部）とは一致しない。初版はマニュアルに読める役割と「従業員の個人的な書類を添付しない」ことを書き、証憑の読取を添付先の記録の読取に合わせる変更は attachments の別項目とする（作業記録の「次のセッションへ」）。
- 相手科目付きの入出金の取消後の「訂正」は kernel の `amendDocument` が作成時に訂正元を知らせないため止められず、相手科目の無い下書きができる（保存・確定は上の決定 2 で拒否）。初版はマニュアルで「削除する」と案内する。訂正自体を拒否するには kernel に訂正前の hook（ADR）が要る。
