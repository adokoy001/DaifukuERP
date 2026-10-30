# ADR-0030: 期首残高は期首日の前日付で、期首残高仮勘定を介して開始仕訳と module 所有の期首伝票に分ける

- 状態: 採択
- 日付: 2026-10-30
- 番号: 0027〜0029 は使用・予約済みのため 0030。統合時に番号が衝突したら振り直す。
- 関連: [ADR-0005](0005-append-only-ledger.md)（取消は逆仕訳）、[ADR-0006](0006-docstatus-lifecycle.md)、[ADR-0007](0007-authorization.md)、[ADR-0010](0010-money-decimal.md)、[ADR-0013](0013-hexagonal-ports.md)、[ADR-0016](0016-foundation-invariants.md)（module 内部の書込権限）、[ADR-0028](0028-import-port.md)（取込 port）、[受入基準](../specs/opening-balances.md)

## 背景

他システムから移るとき、最初の会計年度の期首時点の残高（貸借対照表の科目、取引先別の未入金・未払、品目別の在庫）を入れないと、試算表・年齢表・在庫評価が実態と合わない。売掛金・買掛金を仕訳の取引先付き明細で入れると、消込（`payment`）・年齢表・銀行照合・受信箱の期日超過は請求書を対象にしているため使えない。在庫は移動平均の初期値を作る手順が無い。仕訳の確定は「日付が開いている会計期間に入ること」を要求し（accounting AC-4）、期首残高をどの日付で入れるかで試算表の期首欄に出るかどうかが変わる。

## 決定

1. **期首残高日 = 最初の会計年度の開始日の前日。** 試算表の期首欄は「`from` より前の転記済み明細」の合計なので、前日付にすれば試算表・総勘定元帳・年齢表のコードを変えずに期首欄へ出る。入力は `fiscalYearId` だけで日付は受け付けない。期首残高は会社の最初の会計年度にだけ取り込める（前の年度があればその残高が自動で繰り越されるため）。
2. **期首残高日はどの会計期間にも入らないので、accounting に限定した例外を足す。** module 内部の書込権限 `accounting.opening`（entity `journal_entry`、operation `opening-date`、field なし。`defineWriteCapability`、ロールを広げない）を持つ文脈だけが、最初の会計年度の期首残高日の仕訳を、その年度と最初の会計期間が締まっていない間に限って確定できる。判定は journal_entry の `before_submit` から呼ぶ内部の `assertPostingDate` に置き、公開している `assertOpenPeriod` の契約は変えない。この権限は `postOpeningFromSource` / `reverseOpeningSourceEntry`（`postFromSource` / `reverseSourceEntry` に付けたもの）だけが付ける。前年度の会計期間を自動で作る案は採らない（使わない期間が締めガイド・申告準備に現れるため）。
3. **開始仕訳は会計年度を起票元とする 1 本の仕訳。** `sourceEntity = 'fiscal_year'`・`sourceId = <年度 id>` を既存の serverOwned の field に入れ、二重取込の判定は既存の `liveEntriesForSource` とロック `accounting-source:fiscal_year:<id>` を使う（要求は行の処理より前にこのロックを取る）。直すときは `accounting.reverse_opening_balances`（期首残高日付の逆仕訳）と再取込で、編集はしない。
4. **売掛金・買掛金は取引先別の期首請求書で持ち、期首残高仮勘定で開始仕訳とつなぐ。** 開始仕訳の取引先なしの `partnerRequired` 科目の行（試算表どおりの売掛金・買掛金の合計）は期首残高仮勘定（会社設定 `accounting.opening_balances`、既定 `3900`）に計上する。期首請求書（`sales_invoice` / `purchase_invoice` の `openingBalance = true`、serverOwned・immutable、module 内部の書込権限 `sales.opening` / `purchase.opening` でだけ書ける）は不課税の明細 1 行で、「売掛金 ／ 仮勘定」「仮勘定 ／ 買掛金」を期首残高日付で転記する。総勘定元帳の売掛金・買掛金は期首請求書の分だけになり二重にならず、全区分が一致すれば仮勘定は 0 になる。一致しない額は仮勘定の残高として状況に見える。期首請求書は適格請求書として描画しない（記載事項②取引年月日が事実と合わないため）。期中の日付で取り消した期首請求書がある取引先は取り込み直さない（期中の逆仕訳と新しい期首請求書の両方が残り、期首欄が二重になるため）。
5. **区分ごとに所有する module の action にする。** accounting は sales・purchase・inventory に依存できない。開始仕訳・取消・状況・期首残高日の規則・仮勘定・共通の結果の型・売掛金/買掛金の取込の共通部分（`importOpeningInvoices`）は accounting が持ち、請求書の作成は sales / purchase が `create` のコールバックで、期首在庫は inventory が行う。どの取込も accounting / admin ロールだけに許し、伝票の作成は要求者自身の権限で行う（取込のためにロールを広げない）。
6. **期首在庫は会計年度に紐づく入庫。** 入出庫伝票（type `receipt`、日付 = 期首残高日、`sourceEntity = 'fiscal_year'`）を倉庫ごと・500 明細ごとに作り、各明細を移動平均の最初の取得として転記する。入出庫伝票の確定は、`fiscal_year` の起票元を「type が receipt で日付がその年度の期首残高日」の場合に限って認める。`asModule` は伝票と明細の作成だけに使い、確定は要求者の文脈で行う（確定時の入庫のロールの検査が二重の防御になる）。既に在庫か期首残高日より後の移動がある品目 × 倉庫は取り込まない（後から過去日付で入庫しても既存の払出の単価は再計算されないため）。
7. **B5 の取込 port は使わず、手順と型を再利用する。** B5 は document を対象外にしている（ADR-0028）。dry-run は外側の savepoint の中で実行と同じ作成・確定を行って巻き戻し、行ごとの savepoint で kernel のエラーと SQL のデータ・制約のエラーだけを行のエラーにし、全件か無かで実行する。行の結果は B5 の `ImportMessage` と同じ形。kernel の `import-values.ts` の純粋関数 `decimalCell`・`dateCell`・`isContextToken` を `@daifuku/kernel` から公開した（振る舞いは変えない。kernel の公開面の追加）。コード・名称のセルが `$ctx.` で始まるときは照会せずに `invalid_value` にする（ADR-0028 決定 7 と同じ）。要求の大きさは HTTP の `inputBytes`（2 MB、413）と、MCP・in-process の JSON の UTF-8 長の検査で同じにした。
8. **最初の年度より前の年度の開設の制限。** 開設しようとする年度の範囲に、科目ごとの純額が 0 でない転記済みの明細があれば拒否する（期首伝票が期中の取引に変わるため）。開始仕訳と期首請求書をすべて期首残高日付で取り消して純額が 0 になれば開設できる（会計年度の日付は変更・削除できないので、最初の年度の選択の誤りから戻れるようにする）。

## 対象外と理由

- 前年度がシステムにある会社の期首残高、期中導入の残高日付、外貨: spec のスコープ外を参照。
- 小売パック（三分法の月次締め）の最初の締めでの期首在庫の振戻し: パックは前回の締めが無いと期首の在庫額を 0 とする。パックのコードは変えず、マニュアル 03・10 で手順を示す（今後の作業）。
- 期首在庫の評価額と開始仕訳の在庫科目の自動照合（在庫科目の設定が無い）。

## 結果

- 良い点: 試算表・年齢表・在庫評価・消込のコードを変えずに期首残高が正しく出る。期首請求書は通常の請求書と同じく入金の消込・年齢表・受信箱の対象になる。取込のための権限の抜け道は無い。
- 注意: accounting ロールだけの利用者は開始仕訳しか取り込めない（売掛金・買掛金・在庫は伝票を作れる役割も要る）。期首請求書は通常の連番（`INV-` / `BILL-`）を使う。
- 注意: 売掛金・買掛金の取込は期首請求書ごとに起票元のロック（`pg_advisory_xact_lock`）を 1 つ取り、トランザクションの終わりまで持つ。1,000 行の取込はロック表を約 1,000 件使う（作業記録の計測）。サーバーのロックの上限が既定のときはファイルを分ける。
- 注意: 期首請求書・開始仕訳の確定は会社全体の業務ロック `accounting-periods` を要求の終わりまで持つ（事前確認も同じ）。取込中はその会社の他の仕訳・請求書の確定が待つ。

## 検証

`modules/accounting/test/opening-balances.test.ts`（純粋な規則）、`modules/accounting/test/opening-balances.db.test.ts`、`modules/sales/test/opening-receivables.db.test.ts`、`modules/purchase/test/opening-payables.db.test.ts`、`modules/inventory/test/opening-stock.db.test.ts`、`apps/api/test/opening-balances.db.test.ts`（golden）、`apps/mcp/test/opening-balances-tools.db.test.ts`、`apps/web/e2e/opening-balances.spec.ts`。詳細は [作業記録](../log/2026-10-30-opening-balances.md)。
