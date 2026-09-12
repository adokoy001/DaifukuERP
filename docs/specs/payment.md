# Spec: payment（入金・支払と消込）

- 状態: approved ／ モジュール: modules/payment ／ 依存: partner, accounting, sales, purchase
- ADR: 0006, 0010, 0013 ／ 作成: 2026-09-11

## 受入基準（EARS）
- AC-1 THE SYSTEM SHALL provide document `payment` (naming `{ prefix: 'PAY-', period: 'year' }`): `direction` (enum receive/pay, required), `partnerId` (ref partner required), `date` (date required default today), `amount` (money required, > 0), `method` (enum cash/bank_transfer/other, default bank_transfer), `accountId` (ref account required — 現金 or 普通預金; default from setting `payment.accounts = { cash: '1000', bank: '1100', receivable: '1300', payable: '2100', advanceReceived: '2400', advancePaid: '1900' }`), `allocatedAmount` (money computed), `unallocatedAmount` (money computed), `note`, `journalEntryId` (ref nullable, allowOnSubmit). Lines = `payment_allocation`: `paymentId` (ref cascade), `seq`, `invoiceEntity` (enum sales_invoice/purchase_invoice), `invoiceId` (uuid required), `amount` (money > 0).
- AC-2 WHEN validated THE SYSTEM SHALL check every allocation targets a submitted, open invoice of the same partner and direction (receive → sales_invoice, pay → purchase_invoice), that each amount ≤ that invoice's balance, and Σallocations ≤ amount; compute allocated/unallocated.
- AC-3 WHEN submitted THE SYSTEM SHALL apply allocations through `applyPayment` of sales/purchase (updating paidAmount/balance/status) and post: receive → Dr 現金/預金 (amount) / Cr 売掛金 (allocated) / Cr 前受金 (unallocated); pay → Dr 買掛金 (allocated) / Dr 前払金 (unallocated) / Cr 現金/預金 (amount).
- AC-4 WHEN cancelled THE SYSTEM SHALL un-apply the allocations (negative applyPayment) and reverse the entry.
- AC-5 `payment.outstanding { partnerId?, direction }` → TableResult of open invoices with balances (for the UI to pick allocations).
- AC-6 Permissions: `accounting` all ops; `sales` read/create/update/submit on receive; `purchasing` same on pay (enforced by a hook: role vs direction); `viewer` read.
- AC-7 DB tests: full cycle receive (partial then final payment → invoice paid), pay, over-allocation rejected, cancel restores balances, trial balance consistency.

## 関係するファイル
modules/payment/src/{index.ts, module.ts, entities/{payment,payment-allocation}.ts, services/{allocate.ts, posting.ts}, hooks/{validate.ts, submit.ts, cancel.ts}, actions/outstanding.ts, settings.ts}, test/{allocate.test.ts, payment.db.test.ts}. deps: kernel, mod-partner, mod-accounting, mod-sales, mod-purchase, zod. テスト DB: `daifuku_test_payment`。

## スコープ外
銀行明細取込・自動消込、全銀振込ファイル、手形・でんさい。
