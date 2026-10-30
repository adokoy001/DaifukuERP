# Spec: fixed-assets（固定資産台帳と減価償却）

- 状態: implemented（2026-10-30。償却率表の一次資料との照合は含まない: 未決事項 Q1）
- モジュール: 新 `modules/fixed-assets`（package `@daifuku/mod-fixed-assets`、module 名 `fixed_assets`）、`l10n/jp`（日本の償却規則データ・勘定科目）、`apps/web`（`/finance/depreciation`）、`apps/runtime`（カタログ） ／ 依存: accounting（`postFromSource`・`reverseSourceEntry`・会計年度/期間・`assertOpenPeriod`）、tax（`taxSummaryFor`）、partner、[settings-console](settings-console.md)（B1）、[setup-health](setup-health.md)（B3）、[csv-import](csv-import.md)（B5）、[list-workbench](list-workbench.md)（C1）、[inbox](inbox.md)（C3）、[close-guide](close-guide.md)（C4）、[navigation-assist](navigation-assist.md)（D2）、[form-ergonomics](form-ergonomics.md)（D3）
- ADR: 不要。kernel・DSL・kernel port を追加しない。module が定義する override 点に国別パックが期間付きデータを登録する形は ADR-0008（override）・ADR-0011（国パック）・ADR-0013（port と層）の既存の形で、前例は `purchase.exempt_supplier_credit_ratio`（l10n/jp `transitional-credit.ts`）。この項目に予約された ADR-0040 は使わない（実装中に DSL で表せないことが見つかった場合に限り使う）
- 作成: 2026-10-30 ／ 作成者: agent（spec 作成セッション、ブランチ `wip/fixed-assets`、基点 `ffc2f42`）。設計の元は [完成度向上の実装計画](../completion-plan.md) E1 ／ 作業記録: `docs/log/2026-10-30-fixed-assets.md`
- 制度の出典: [日本の固定資産・減価償却](../domain/japan-fixed-assets.md)（**作成時は一次資料に接続できず全項目【未確認】**。下の「データ・業務ルール」と未決事項 Q1）

## 目的（1段落）

中小企業の決算と月次では、固定資産を台帳で管理し、定額法・定率法で毎月（または年 1 回）の減価償却を仕訳し、除却・売却を記帳し、1 月には償却資産（固定資産税）の申告の準備をする。現在は資産台帳も償却もなく、経理担当者が表計算で計算して手で仕訳している。経理担当者が資産を台帳に登録し（表計算からの CSV 取込を含む）、会計期間を選んで償却を試算・実行すると、日本の税法の計算（月割・残存 1 円・償却保証額による改定償却率への切替え）どおりの仕訳が期間ごとに 1 本、会計の転記経路で作られ、二重計上や締め済み期間への計上が起きないようにする。除却・売却は伝票として当年分の償却・売却損益・消費税まで 1 本の仕訳にし、償却資産申告は種類別の取得価額の集計 CSV までを用意する。

## 前提（既存の仕組みから決まること）

- 経理は税抜経理だけ（消費税は `tax` module、仮受/仮払消費税は `account.taxRole`）。通貨は JPY、金額は円単位（`assertJpySettlement`）。
- 会計年度は月初に始まる 12 か月、会計期間は暦月（`accounting.open_fiscal_year`、`monthlyPeriods`）。締めは期間単位で、締め済み期間・年度へは転記できない（`assertOpenPeriod`）。
- 取得の仕訳は既存の経路で作る（仕入請求の明細の勘定科目に資産科目を指定する、または手入力の仕訳）。台帳への登録は仕訳を作らない。

## 受入基準（EARS）

各基準は下の「検証手順」の表のテストに対応させ、テスト名に `AC-n` を含める。

### 台帳（`fixed_asset`）

- AC-1 WHEN accounting または admin が `fixed_asset` を作成・更新した THE SYSTEM SHALL 会社 scope の entity（`defineEntity`。document ではない）として次の field を保存する: `code`（資産番号。一意・変更不可）、`name`、`assetClass`（building 建物 / building_equipment 建物附属設備 / structure 構築物 / machinery 機械及び装置 / vehicle 車両及び運搬具 / tools_furniture 工具、器具及び備品 / software ソフトウエア）、`acquisitionDate`、`inServiceDate`、`cost`（取得価額・税抜）、`method`（straight_line 定額法 / declining_200 定率法）、`usefulLife`（整数年）、`assetAccountId`・`accumulatedAccountId`・`expenseAccountId`（`account` 参照）、`location`（設置場所）、`municipality`（所在市区町村）、`propertyTaxClass`（structure / machinery / vessel / aircraft / vehicle / tools / excluded）、`openingDate`・`openingAccumulatedDepreciation`・`openingYearDepreciation`・`openingRevisedBase`（移行時の償却累計、AC-3）、`memo`、serverOwned の `status`（active / disposed）・`depreciationStart`・`disposedOn`。必須は `code`・`name`・`assetClass`・`acquisitionDate`・`cost`・`method`・`usefulLife`・`assetAccountId`（`accumulatedAccountId`・`expenseAccountId` は補完の後に必須）。`inServiceDate` は空を許し、空の資産は未供用（AC-11 の not_in_service）として償却しない。保存時に、空の `accumulatedAccountId`・`expenseAccountId` を設定 `fixed_assets.accounts`（AC-28）の科目コードから補い（ソフトウエアの累計額科目は資産科目そのもの = 直接法）、空の `propertyTaxClass` を規則データ（AC-10 の `propertyTax.defaultClass`。日本は building・building_equipment・vehicle・software → excluded、structure → structure、machinery → machinery、tools_furniture → tools）で資産の種類から補い、`depreciationStart` を「事業供用日と `openingDate` の遅い方の月の初日」（事業供用日が空なら空）にする。登録・更新は仕訳を作らない。
- AC-2 IF 作成・更新の値が次のいずれかに当たる THEN THE SYSTEM SHALL `ValidationError`（該当 field の `path` 付き）で保存を拒否する: (a) 取得日が事業供用日より後、(b) 取得価額が円単位でない、または備忘価額（AC-8）以下、(c) 規則データ（AC-10）に、取得日に適用される償却方法の率表が無い、またはその耐用年数の行が無い（2007-04-01 より前の取得、2012-04-01 より前の取得の定率法、未収録の耐用年数）、(d) 規則データの資産の種類ごとの制限で認められない償却方法（建物・2016-04-01 以後取得の建物附属設備と構築物・ソフトウエアの定率法）、(e) 資産科目・累計額科目の区分が `asset` でない、または償却費科目が `expense` でない。
- AC-3 WHEN `openingDate` が入力された THE SYSTEM SHALL それを会社の会計期間の初日に限って受け付け、`openingAccumulatedDepreciation`（`openingDate` の前日までの償却累計。0 以上、取得価額 − 備忘価額 以下）と `openingYearDepreciation`（そのうち `openingDate` を含む会計年度に計上した分。0 以上、累計以下。`openingDate` が年度の初日なら 0）を使い、移行年度の期首帳簿価額を「取得価額 − 累計 + 当年分」、移行年度の計上済み額に当年分を含めて計算する。`openingDate` は締まっていない会計年度の期間の初日に限る（会社に会計年度が無ければ `openingDate` は `ValidationError`）。IF 事業供用日の属する月が、締まっていない最も早い会計年度の開始日より前、または締め済みの会計年度に入り、`openingDate` が無い THEN THE SYSTEM SHALL `ValidationError`（path `openingDate`。締め済みの年度は償却を実行できないため移行時の値が要る）で拒否する。会社に会計年度が無く `openingDate` も無ければこの検査はしない。IF 定率法で、移行年度の期首帳簿価額 × 償却率 が償却保証額に満たず `openingRevisedBase` が無い THEN THE SYSTEM SHALL `ValidationError`（「移行前に切り替わっていれば改定取得価額を、この年度から切り替わるなら期首帳簿価額を入力」）で拒否する。`openingRevisedBase` は定率法にだけ受け付け、入力があれば移行年度以後の改定取得価額として使う。IF 移行年度の期首帳簿価額 × 償却率 が償却保証額以上（まだ切り替わらない）なのに `openingRevisedBase` がある THEN THE SYSTEM SHALL `ValidationError`（path `openingRevisedBase`）で拒否する。
- AC-4 WHILE 資産に有効な償却（確定済み `depreciation_run` の明細）か確定済みの除却・売却がある WHEN 更新された THE SYSTEM SHALL `name`・`location`・`municipality`・`propertyTaxClass`・`memo` 以外の変更を `StateError` で拒否する（除却・売却のフックが module の書込 capability で行う `status`・`disposedOn` の書込はこの固定の対象外）。IF 償却の明細か除却・売却の伝票（取消済みを含む）が資産を参照している THEN THE SYSTEM SHALL 削除を拒否する。どちらも無い資産はすべての項目を変更・削除できる。
- AC-5 THE SYSTEM SHALL `fixed_asset` を B5 の派生 action `fixed_asset.import`（REST `POST /api/fixed_asset/import`、MCP `fixed_asset_import`）で取り込めるようにする（`import: false` を宣言しない）。科目の参照は科目コードで解決し（B5 AC-3）、AC-1 の補完と AC-2・AC-3 の検証を行ごとに適用し、違反は行の `error` として返す。

### 償却の計算（純粋関数、率は引数）

- AC-6 THE SYSTEM SHALL 定額法の各事業年度の償却額を「取得価額 × 定額法の償却率 × 供用月数 ÷ 12 の円未満切捨て」とし、「期首帳簿価額 − 備忘価額」を上限とする。供用月数は、事業供用日の属する事業年度では事業供用日の属する月から年度末の月までの月数（1 か月未満の端数は 1 か月）、それ以外の年度は 12 とする。golden G1・G6・G8 に一致する。
- AC-7 THE SYSTEM SHALL 200% 定率法の各事業年度の償却額を次で決める: 調整前償却額 = 期首帳簿価額 × 償却率、償却保証額 = 取得価額 × 保証率（どちらも丸めない）。調整前償却額が償却保証額**未満**になった最初の事業年度の期首帳簿価額を改定取得価額とし、その年度以後は「改定取得価額 × 改定償却率」を 1 年分の額とする（等しいときは切り替えない）。比較は 12 か月分の額で行い、1 年分の額 × 供用月数 ÷ 12 の円未満切捨てを「期首帳簿価額 − 備忘価額」で上限する。保証率の無い耐用年数（2 年）は切り替えない。golden G2・G3・G4・G5・G7・G9 に一致する。
- AC-8 THE SYSTEM SHALL 償却累計を「取得価額 − 備忘価額」（規則データの値。日本は有形 1 円、無形 0 円）で止め、最後の年度は残りの額だけを計上し、以後の年度は 0 とする。golden G1 の FY2031、G2 の 10 年目、G3 の FY2030、G4 の 4 年目、G6 の FY2031 に一致する。
- AC-9 THE SYSTEM SHALL 各事業年度の期首帳簿価額を実際の計上額（移行時の値、確定済みの償却明細、確定済みの除却・売却の当年償却）から求め、その年度の償却額を年度内の供用月に配分する（月額 = 年額 ÷ 供用月数 の円未満切捨て、端数は年度内の最後の供用月）。期間 P の計上額は「その年度の P までの配分の合計 − その年度の計上済み額」（負なら 0）とし、同じ年度の前の期間が未実行でも P でまとめて計上する。前の事業年度の未計上分は後の年度へ繰り越さない（後の年度は実際の期首帳簿価額で計算する）。次の性質を満たす: 全年度の合計 = 取得価額 − 備忘価額、帳簿価額が備忘価額を下回らない、年度内の配分の合計 = その年度の償却額、同じ年度の期間をどの順・どの間隔で実行しても年度の合計は同じ。
- AC-10 THE SYSTEM SHALL 国別の規則を、module が定義する override 点 `fixed_assets.depreciation_rules`（`() => DepreciationRuleSet | null`）から読み、zod の schema で検査する。規則集合は `id`、`country`、`currency`、`verifiedOn`（一次資料と照合した日。未照合は `null`）、`sources`（URL の配列）、資産区分（tangible / intangible）ごとの備忘価額（取得日の適用期間 `acquiredFrom` / `acquiredTo` 付き）、償却方法ごとの率表（取得日の適用期間 `acquiredFrom` / `acquiredTo` と、耐用年数ごとの `rate`・`revisedRate`・`guaranteeRate`。十進文字列）、資産の種類ごとの償却方法の制限（取得日の適用期間付き）、耐用年数の例（ラベル `{ ja, en }`・資産の種類・年数・出典の別表）、償却資産申告のデータ `propertyTax`（賦課期日の月日、申告書の種類の番号とラベル、資産の種類ごとの既定の種類。出典付き）を持つ。IF 規則が登録されていない、schema に合わない、`country` が会社の国と違う、または `currency` が会社の通貨と違う THEN THE SYSTEM SHALL 資産の保存・試算・実行・除却を `StateError`（理由と、国別パックを入れる案内）で拒否する。`l10n/jp` が日本の規則集合を登録し、値は [japan-fixed-assets](../domain/japan-fixed-assets.md#rate-tables) を一次資料と照合して転記する。照合していない間は `verifiedOn: null` のまま出荷し、AC-11・AC-30・AC-32 がそれを表示し、AC-35 が転記を止める。

### 償却の試算と実行

- AC-11 WHEN `fixed_assets.preview_depreciation { periodId? }` が呼ばれた THE SYSTEM SHALL データを変更せずに（`mutates: false`、`tx: 'none'`）、期間（id・コード・開始日・終了日・締め状態）、会計年度（id・コード・締め状態）、`defaulted`、規則の `id`・`verifiedOn`・`confirmedOn`（AC-35 の会社の照合記録）・`usable`（転記できるか）、計上予定の明細（資産ごとに id・code・name・償却方法・耐用年数・期首帳簿価額・年額・年度の計上済み額・今回の額・償却費科目・累計額科目・改定償却率へ切替え済みか）と合計、この期間の確定済みの実行（id・番号・仕訳 id・合計）、計上しない資産の理由別の件数（disposed 除却済み / not_in_service 未供用 / fully_depreciated 償却済み / already_booked この期間に計上済み / nothing_due 計上額 0）、`priorYearPending`（直前の会計年度が締まっておらず、その最終期間までの未計上額がある資産の件数・合計・その最終期間の id。無ければ null）を返す。`periodId` を省略したときは「今日（日本時間）より前に終わった最後の会計期間、無ければ今日を含む期間、それも無ければ最も早い期間（未来）」を使い、`defaulted: true` とする。試算は有効な資産を 500 件ずつすべて読み、計上予定が 500 件を超えるときは `overLimit: true` を返す（明細は先頭 500 件。実行は AC-15 で拒否）。会計期間が 1 つも無い会社には `StateError`（`details.reason = 'no_fiscal_period'`）を返す。
- AC-12 WHEN `fixed_assets.run_depreciation { periodId }` が accounting または admin から呼ばれた THE SYSTEM SHALL AC-11 と同じ計算で計上額が 0 より大きい資産について、`depreciation_run`（document、番号 `DR-`）1 件と資産ごとの明細 `depreciation_run_line`（資産・期間・会計年度・期間の終了日・額・年額・償却費科目・累計額科目・計算根拠）を作って確定し、確定時に `postFromSource`（`sourceEntity: 'depreciation_run'`）で仕訳を 1 本、期間の終了日の日付で作り、`journalEntryId` を run に記録する。仕訳は償却費科目ごとの借方（税区分 `out_of_scope`・税率 0。日本の 6700 減価償却費の既定の税区分と同じ不課税）と累計額科目ごとの貸方（税区分なし）に集約する。作成・確定・転記は 1 つのトランザクションで行い、どれかが失敗すれば何も残さない。応答は `{ created: true, run: { id, number, journalEntryId, journalEntryNumber, totalAmount, assetCount }, rulesVerified }`。
- AC-13 THE SYSTEM SHALL 償却を資産と会計期間の組ごとに 1 回に限る: 実行は会社単位の排他ロック（`withLock`、除却・取消・台帳の財務項目の更新と同じキー）の下で、その期間に確定済みの明細を持つ資産を除いて計算し、計上する資産が無ければ何も作らず `{ created: false, existingRuns }` を返す（エラーにしない）。同じ期間を 2 回実行しても仕訳は 1 本のままで、後から登録した資産があればその資産だけの実行を同じ期間に 1 件追加する。2 つのトランザクションから同時に実行しても、同じ資産・期間の明細は 1 つしか確定しない。`depreciation_run` の確定時のフックも同じ条件を再検査する。
- AC-14 IF 実行の対象期間かその会計年度が締め済み、期間が存在しない、会計年度が 12 か月の暦月でない、または期間の開始日が今日（日本時間）より後（`details.reason = 'future_period'`。まだ発生していない償却を計上し、後の除却を妨げるため）THEN THE SYSTEM SHALL 実行を `StateError`（締め済みは会計の `assertOpenPeriod` と同じ文言で、期間コードと再開の案内付き）で拒否し、run・明細・仕訳を作らない。試算（AC-11）は締め済み・未来の期間でも額を返し、`period.isClosed`・`period.isFuture` で示す。
- AC-15 IF 計上する資産が 500 件を超える THEN THE SYSTEM SHALL 実行を `ValidationError`（明細 500 件の上限と、未対応である旨）で拒否する。IF 計上額が 0 より大きい資産が、対象期間より後の会計年度に確定済みの明細を持つ THEN THE SYSTEM SHALL 実行を `StateError`（資産コードの一覧と、後の年度の実行を先に取り消す案内）で拒否する。
- AC-16 WHEN 確定済みの `depreciation_run` を取り消した THE SYSTEM SHALL `reverseSourceEntry` で仕訳を逆仕訳し（訂正日があればその日付、無ければ元の日付。その期間が締め済みなら会計の `StateError` で取消全体を拒否）、その明細を有効な償却から外す。次の実行はその分を AC-9 で再計算する。IF 明細の資産に確定済みの除却・売却がある THEN THE SYSTEM SHALL 取消を `StateError`（先に除却・売却を取り消す案内）で拒否する。IF run のいずれかの資産が、run の期間より後の期間（同じ年度か後の年度）に確定済みの明細を持つ THEN THE SYSTEM SHALL 取消を `StateError`（後の run の番号の一覧と、新しい順に取り消す案内）で拒否する（途中の期間だけを取り消すと、同じ年度の再実行で不足分を計上できないため）。IF 訂正日が run の期間の属する会計年度の外 THEN THE SYSTEM SHALL `ValidationError`（path `correctionDate`）で拒否する（台帳は計上済み額を run の期間の年度で数えるため、逆仕訳を別の年度に置くと元帳と台帳がずれる）。`depreciation_run` と明細の field はすべて serverOwned とし、訂正（amend の権限を付けない）・CSV 取込（`import: false`）を提供しない。汎用の作成と複製は before_create のフックで、module の書込 capability の無い作成を `StateError`（`details.reason = 'use_depreciation_screen'`、`/finance/depreciation` から実行する案内）で拒否する。

### 除却・売却（`fixed_asset_disposal`）

- AC-17 THE SYSTEM SHALL `fixed_asset_disposal`（document、番号 `FD-`）に `assetId`（変更不可）、`date`、`kind`（retirement 除却 / sale 売却）、`proceeds`（売却価額・税抜）、`taxCategory`（売却の既定 standard）、`proceedsAccountId`（売却の既定は設定の proceeds の科目）、`partnerId`（任意）、`memo` と、serverOwned の `taxRate`・`taxAmount`・`disposalYearDepreciation`・`accumulatedDepreciation`・`bookValue`・`gain`・`loss`・`journalEntryId` を持たせ、下書きの保存ごとに計算できる serverOwned の値を更新する（計算できないときは空のまま保存する）。確定時に値を計算し直す。IF 確定時に、資産に別の確定済みの除却・売却がある、日付が取得日より前、日付の属する月より後の会計期間に資産の確定済み償却明細がある、売却で `proceeds` が 0 以下か `proceedsAccountId` が無い、売却代金の科目が取引先必須（`partnerRequired`）なのに `partnerId` が無い（`ValidationError` path `partnerId`）、除却で `proceeds` が 0 でない、または金額が円単位でない THEN THE SYSTEM SHALL 確定を `ValidationError` / `StateError` で拒否する。
- AC-18 WHEN 除却を確定した THE SYSTEM SHALL `postFromSource`（`sourceEntity: 'fixed_asset_disposal'`）で仕訳を 1 本、除却日の日付で、次の順に作る（0 円の行は作らない）: 当年償却（借方 償却費科目 / 貸方 累計額科目）、借方 累計額科目（除却時の償却累計）、貸方 資産科目（取得価額）、借方 固定資産除却損（帳簿価額）。当年償却は「min（その事業年度の 12 か月分の額 × 保有月数 ÷ 12 の円未満切捨て、期首帳簿価額 − 備忘価額）− 年度の計上済み額」（負なら 0）。保有月数は期首（事業供用の年度は供用月）から除却日の属する月までの月数。12 か月分の額は AC-6・AC-7 の年額の月割前の値（定率法は切替えの判定を含む）。これは法令の限度額で、AC-9 の月の配分の合計とは一致しないことがある（例: 上限で止まる最終年度）。累計額科目が資産科目と同じ（直接法。ソフトウエア）ときは、累計額と資産の 2 行の代わりに 貸方 資産科目（取得価額 − 除却時の償却累計）の 1 行にする。償却費の借方と除却損・売却損の借方は税区分 `out_of_scope`（税率 0）を付ける。golden D1・D4・D5・D6 に一致する。
- AC-19 WHEN 売却を確定した THE SYSTEM SHALL 消費税を `taxSummaryFor`（会社の端数処理、税抜、伝票の日付の税率）で売却価額から求め、AC-18 と同じ当年償却・累計額・資産の行に続けて、借方 `proceedsAccountId`（売却価額 + 消費税）、貸方 仮受消費税（税額。taxCategory・taxRate 付き）、貸方 固定資産売却益の科目 = 売却価額（taxCategory・taxRate 付き。課税売上の基礎）、借方 固定資産売却益の科目 = min(売却価額, 帳簿価額)（税区分なし）、売却価額 < 帳簿価額 なら借方 固定資産売却損 = 差額 の仕訳を 1 本作る。売却益の科目には差益だけが残り、`accounting.tax_period_summary` の売上の行に売却価額と消費税が載る。golden D2・D3・D7 に一致する。税額が 0 になる税区分（不課税・非課税・免税）の売却は仮受消費税の行を作らない。対の借方は税区分を付けない（付けると課税標準を打ち消す）ため、売却のあった年度は `tax_filing` の申告準備に `tax_category_missing` の注意が出る（既知。マニュアルの章に書き、Q8 で解消する）。
- AC-20 WHEN 除却・売却を確定した THE SYSTEM SHALL 資産の `status` を disposed、`disposedOn` を伝票の日付にし（module の書込 capability）、以後の試算・実行から除く。WHEN 取り消した THE SYSTEM SHALL `reverseSourceEntry` で逆仕訳し、資産を active・`disposedOn` 空に戻す。IF 仕訳・逆仕訳の日付の期間が締め済み THEN THE SYSTEM SHALL 確定・取消を会計の `StateError` で拒否する。IF 取消の訂正日が伝票の日付の属する会計年度の外 THEN THE SYSTEM SHALL `ValidationError`（path `correctionDate`）で拒否する（AC-16 と同じ理由）。取消後の訂正（amend）は通常の document と同じ。

### 帳票と申告の準備

- AC-21 WHEN `fixed_assets.depreciation_schedule { fiscalYearId? }` を実行した THE SYSTEM SHALL その会計年度に保有した資産ごとに code・name・資産の種類・取得日・事業供用日・償却方法・耐用年数・取得価額・期首帳簿価額・当期増加（年度中の取得）・当期償却（移行年度は `openingYearDepreciation` を含む）・当期減少（除却・売却時の帳簿価額）・期末帳簿価額・期末償却累計・状態を TableResult（[report 規約](../conventions/reports.md)）で返し、金額列の合計を付ける（期末 = 期首 + 増加 − 償却 − 減少）。省略時は今日を含む会計年度、無ければ最後の会計年度。CSV は既存のレポート出力で出せる。`exportEntities` は出力に値が載る `fixed_asset`・`depreciation_run_line`・`fixed_asset_disposal` とする（会計年度は範囲を決めるために読むだけで、出力に載せないため名指ししない）。
- AC-22 WHEN `fixed_assets.property_tax_summary { year? }` を実行した THE SYSTEM SHALL 賦課期日 A = `year` 年の規則データの賦課期日（日本は 1 月 1 日。省略時は今日の属する年）、前年の賦課期日 B = `year` − 1 年の同じ月日として、`propertyTaxClass` が excluded でない資産を所在市区町村 × 種類で集計し、前年前（B に保有）・前年中減少（B より後 A 以前に除却・売却）・前年中取得（B より後 A 以前に取得）・計（A に保有）の取得価額の合計と件数を TableResult で返す。「D に保有」は「取得日 ≦ D かつ（`disposedOn` が空または > D）」とし、計 = 前年前 − 前年中減少 + 前年中取得 が常に成り立つ。市区町村が空の資産は「（未設定）」の行にまとめる。種類の列は規則データの番号とラベル（例「2 機械及び装置」）を出す。`exportEntities` は `fixed_asset`。golden PT1 に一致する。評価額・税額は計算しない。
- AC-23 WHEN `fixed_assets.depreciation_rules {}` を呼んだ THE SYSTEM SHALL 登録された規則集合の `id`・`country`・`verifiedOn`・`sources`・備忘価額・率表・償却方法の制限・耐用年数の例・償却資産申告のデータと、会社の照合記録（AC-35）を返す（読取専用）。規則が無ければ `StateError`。

### 権限と境界

- AC-24 THE SYSTEM SHALL 権限を次のとおりにする（admin は暗黙にすべて）: accounting は `fixed_asset` の read / create / update / delete / export、`depreciation_run` の read / create / update / submit / cancel / export（delete・amend なし）、`depreciation_run_line` の read / create / update / delete / export、`fixed_asset_disposal` の read / create / update / delete / submit / cancel / amend / export と、すべての action。viewer は 4 entity の read（export なし）と、試算・帳票・規則の action（画面での表示はできるが、帳票の CSV 出力は `PERMISSION_DENIED`。会計の仕訳の viewer と同じく出力を持たない）。それ以外のロール（sales・purchasing・workforce 系など）には entity の読取と action の実行を含めて `PERMISSION_DENIED` を返す。実行・除却の転記は呼び出した利用者の Context のまま、その利用者の `journal_entry` の権限で行う。
- AC-25 THE SYSTEM SHALL 4 entity を会社 scope にし、別会社の資産・実行・除却を一覧・取得・試算・実行・帳票・受信箱のどれにも含めない。会社 A での実行は会社 B の資産を計上せず、B の利用者が A の資産・期間の id を指定しても `NOT_FOUND` になる。
- AC-26 THE SYSTEM SHALL 4 entity に `storeAccess` / `siteAccess` を宣言せず、action にも付けない。店舗・拠点限定の Context からの読取・書込・action の実行は、accounting ロールを持っていても `PERMISSION_DENIED` とする（固定資産は本部の業務）。
- AC-27 THE SYSTEM SHALL すべての読み書きを呼び出し元の Context の `Repository` で行い、仕訳は `postFromSource` / `reverseSourceEntry` だけで作り、serverOwned の field は module 内の書込 capability（`defineWriteCapability`）でだけ書く。`systemContext()` を使わず、作成・確定・取消の監査記録の actor は呼び出した利用者になる。

### 設定・国別データ・導入チェック・受信箱

- AC-28 THE SYSTEM SHALL 会社設定 `fixed_assets.accounts`（`registerSetting`、category `accounting`、各項目は `account-code` の widget、ラベルは日英）を登録し、既定値を `accumulated` 1929・`expense` 6700・`gainOnSale` 8100・`lossOnSale` 8200・`lossOnRetirement` 8300・`proceeds` 1910 とする。IF 補完・転記に使う科目コードが会社に無い THEN THE SYSTEM SHALL 保存・確定を `StateError`（設定キー・項目・コードと、科目を作るか設定を変える案内。`purchase.accounts` と同じ形）で拒否する。科目の seed は会社の作成・初期設定のときだけ走るため、既存の会社は AC-29 の科目を作るか、設定を既存の科目コードに向ける（マニュアルの章に科目の一覧と手順を書く）。
- AC-29 THE SYSTEM SHALL `l10n/jp` の勘定科目の seed に次を加え（既存のコードは上書きしない）、[l10n-jp](l10n-jp.md) AC-1 の一覧を同じ PR で改める: 1910 未収入金（asset、その他流動資産）、1920 建物・1921 建物附属設備・1922 構築物・1923 機械装置・1924 車両運搬具・1925 工具器具備品・1929 減価償却累計額（asset、有形固定資産）、1930 ソフトウエア（asset、無形固定資産）、8100 固定資産売却益（revenue、特別利益）、8200 固定資産売却損・8300 固定資産除却損（expense、特別損失、taxCategoryDefault out_of_scope）。THE SYSTEM SHALL 日本の科目表のコードがどの業種パックの seed の科目コード（real-estate の 4200・4210、retail の 5050・5100・6990）とも重ならないことを単体テストで検査する（パックの seed は既存のコードを飛ばすため、重なるとパックの科目が別の名前・区分のまま使われる）。あわせて日本の規則集合を `fixed_assets.depreciation_rules` に登録する（`registerJapanOverrides`）。`l10n/jp` は `@daifuku/mod-fixed-assets` を型だけ import し（`import type`。override のキーは module が公開する文字列リテラル型で検査）、`JapanModule.depends` と module の登録順を変えない。
- AC-30 THE SYSTEM SHALL 導入チェックの項目 `fixed_assets.depreciation_rules`（order 60、ラベル日英）を登録し、規則が無い・schema に合わない・会社の国か通貨と違う場合は warn（国別パックの案内）、`verifiedOn` があるか会社の照合記録（AC-35）が現在の規則を指していれば ok、どちらも無い場合は、会社に `fixed_asset` が 0 件なら ok（「固定資産は未登録」）、1 件以上か件数を読めない（呼び出し元に `fixed_asset` の読取権限が無い）なら warn（「償却率表が一次資料と未照合です。照合して設定に記録するまで償却の転記はできません」）を返す。件数を読めない場合を warn にするのは、照合の記録は設定（settings ロールが変更できる）であり、warn が対処できる案内になるため。href は `/finance/depreciation`。
- AC-31 THE SYSTEM SHALL 受信箱の提供元 `fixed_assets.todo`（[inbox](inbox.md) AC-1 の入出力。accounting・admin、全社の文脈のみ）に次の項目を返す（件数 0 の項目は返さない）: `depreciation_not_run`（warn。今日より前に終わった最後の会計期間が締まっておらず、その期間の試算（AC-11 と同じ計算）で計上額が 0 より大きい資産がある場合に、その資産の件数。償却済み・計上済み・計上額 0 の資産は数えず、実行の後に登録した資産は数える。規則が使えない場合は返さない（導入チェックが示す）。href `/finance/depreciation?periodId=<id>`）、`disposal_drafts`（info。除却・売却の下書きの件数、href `/e/fixed_asset_disposal`）。

### 画面

- AC-32 WHEN `/finance/depreciation` を開いた THE SYSTEM SHALL 会計期間の選択（既定は AC-11 の既定。決まった期間を URL `?periodId=` に履歴を増やさない置換で固定）、試算の表（資産・償却方法・期首帳簿価額・年額・今回の額・科目）と合計、この期間の確定済みの実行（番号・合計・仕訳へのリンク）を表示する。規則が未照合なら注意の帯を（会社の照合記録も無く転記できない場合は、実行の操作を無効にし、規則の表示と設定への案内を出す）、未来の期間なら実行できない理由を、`priorYearPending` があれば件数・合計とその年度の最終期間へのリンクを、締め済みの期間なら締め済みであることと実行できない理由を、計上額が無ければ「この期間に計上する償却はありません」を表示する。WHEN 実行を押した THE SYSTEM SHALL kit の `Dialog` で期間・件数・合計を確認させ、承認後に `fixed_assets.run_depreciation` を呼び、結果（仕訳番号へのリンク）を polite なライブ領域で知らせ、試算を取り直す。失敗は `role="alert"` で示し、表示中の試算を残す。`run_depreciation` を実行できない利用者（viewer）には実行の操作を出さず試算だけを表示する。
- AC-33 THE SYSTEM SHALL `/finance/depreciation` を「会計・資金」分野の専用画面として画面検索・分野一覧に表示し（`fixed_assets.preview_depreciation` を呼べない利用者には出さない。URL を直接開いたときは権限が無いことを説明する）、ヘルプの対応表（`apps/web/src/lib/help.ts`）でマニュアルの章へつなぐ。module のメニューに 固定資産台帳（`/e/fixed_asset`）、除却・売却（`/e/fixed_asset_disposal`）、償却の実行（`/finance/depreciation`）、減価償却明細表（`/r/fixed_assets.depreciation_schedule`）、償却資産申告の集計（`/r/fixed_assets.property_tax_summary`）を出す。`fixed_asset` と `fixed_asset_disposal` の汎用フォームはラベル付きの group（D3 の `views.form`）で、基本・償却・勘定科目・所在と申告・移行・状態（除却・売却は 基本・売却・計算結果）に分ける。
- AC-34 THE SYSTEM SHALL 画面と entity・field・action・設定・導入チェック・受信箱の文言を日本語と英語で持ち、`/finance/depreciation` を 390px 幅で横にはみ出さずに操作でき（表は kit の表の狭い幅の表示に従う）、axe の serious / critical の違反が無い（[e2e-a11y](e2e-a11y.md) の `judge()`）。

### 未照合の制度値での転記の停止

- AC-35 THE SYSTEM SHALL 会社設定 `fixed_assets.rules_confirmation`（`ruleSetId`・`confirmedOn`。category `accounting`、ラベル日英）を登録する。IF 規則の `verifiedOn` が null で、かつ会社の照合記録が現在の規則の `id` と日付（YYYY-MM-DD）を持たない THEN THE SYSTEM SHALL `fixed_assets.run_depreciation` と `fixed_asset_disposal` の確定を `StateError`（`details.reason = 'rules_unverified'`、規則の id、「`fixed_assets.depreciation_rules` の率表を耐用年数省令の別表第八・第十と照合し、設定に規則の id と照合日を記録する、または照合済みの国別パックを入れる」案内）で拒否し、仕訳を作らない。資産の登録・試算・帳票・規則の表示・受信箱は止めない。照合記録の変更は設定の変更履歴（変更者・日時）に残る。理由: 一次資料と照合していない法定の値から仕訳を作らない（CLAUDE.md 規約 10・11、計画 7 の 3）。照合した人の記録があれば、その人の照合を出典として転記できる。

## golden（手計算。単体テストと DB テストの期待値）

率は [japan-fixed-assets](../domain/japan-fixed-assets.md#rate-tables) の値（【未確認】）。計算ロジックの検査として、単体テストはこの率を引数で渡す（l10n のデータの照合とは別）。FY は会計年度、金額は円。

| id | 条件 | 期待値 |
| --- | --- | --- |
| G1 | 定額法・5 年（0.200）、取得価額 600,000、FY 4 月〜3 月、事業供用 2026-10-15 | FY2026: 6 か月 60,000（月 10,000）。FY2027〜FY2030: 各 120,000（月 10,000）、FY2030 末の帳簿価額 60,000。FY2031: 上限 59,999（4 月〜2 月 各 4,999、3 月 5,010）、帳簿価額 1。FY2032 以後 0 |
| G2 | 定率法・10 年（0.200 / 0.250 / 0.06552、償却保証額 65,520）、取得価額 1,000,000、FY 1 月〜12 月、事業供用 2026-01-01 | 200,000（1 月〜11 月 各 16,666、12 月 16,674）、160,000、128,000、102,400、81,920、65,536（調整前 65,536 ≧ 65,520 で切替えなし）、7 年目に切替え（改定取得価額 262,144）65,536、65,536、65,536、10 年目 65,535。合計 999,999 |
| G3 | 定率法・5 年（0.400 / 0.500 / 0.10800、保証額 108,000）、取得価額 1,000,000、FY 1 月〜12 月、事業供用 2026-04-10 | FY2026: 9 か月 300,000（4 月〜11 月 各 33,333、12 月 33,336）。FY2027: 280,000。FY2028: 168,000（帳簿価額 252,000）。FY2029: 調整前 100,800 < 108,000 で切替え、252,000 × 0.500 = 126,000。FY2030: 上限 125,999（1 月〜11 月 各 10,499、12 月 10,510）、帳簿価額 1 |
| G4 | 定率法・4 年（0.500 / 1.000 / 0.12499、保証額 49,996）、取得価額 400,000、12 か月供用から | 200,000、100,000、50,000（調整前 50,000 ≧ 49,996）、4 年目に切替え 50,000 × 1.000 を上限 49,999、帳簿価額 1 |
| G5 | 合成の率（償却率 0.5、改定償却率 1.0、保証率 0.125）、取得価額 1,000,000 | 500,000、250,000、3 年目の調整前 125,000 = 保証額 125,000 は切り替えず 125,000、4 年目に切替え 124,999 |
| G6 | ソフトウエア（無形、備忘価額 0）、定額法・5 年、取得価額 300,000、FY 1 月〜12 月、事業供用 2026-07-01、累計額科目 = 資産科目 | FY2026: 30,000。FY2027〜FY2030: 各 60,000。FY2031: 30,000、帳簿価額 0 |
| G7 | G2 の資産を FY 4 月〜3 月・事業供用 2020-04-01 として、2026-04-01 に移行（累計 737,856、当年分 0、期首帳簿価額 262,144） | 調整前 52,428.8 < 65,520 のため `openingRevisedBase` が無いと `ValidationError`。262,144 を入れると FY2026〜FY2028 各 65,536、FY2029 65,535 |
| G8 | 定額法・5 年、取得価額 600,000、FY 1 月〜12 月、事業供用 2026-01-10、2026-07-01 に移行（累計 60,000、当年分 60,000） | 2026-07 の実行 10,000。8 月を飛ばして 2026-09 を実行すると 20,000 |
| G9 | 定率法・2 年（償却率 1.000、改定償却率・保証率なし）、取得価額 1,000,000、FY 1 月〜12 月、事業供用 2026-07-01 | FY2026: 6 か月 500,000（調整前 1,000,000 × 6 / 12）。FY2027: 上限 499,999、帳簿価額 1。切替えなし |
| D1 | G1 の資産（資産 1925、累計 1929、償却費 6700）を 2027-06 まで実行済み（累計 90,000）、2027-08-20 に除却 | 当年償却 = 120,000 × 5 / 12 − 30,000 = 20,000。借方 6700 20,000 / 貸方 1929 20,000、借方 1929 110,000、貸方 1925 600,000、借方 8300 490,000（8300 は不課税） |
| D2 | D1 と同じ資産を同じ日に 450,000（税抜、標準 10%）で売却、代金 1910 | D1 の当年償却・1929・1925 の行に続けて 借方 1910 495,000、貸方 2200 45,000（standard 0.10）、貸方 8100 450,000（standard 0.10）、借方 8100 450,000（税区分なし）、借方 8200 40,000（不課税）。2027-08 の消費税集計表の売上 標準 10%: 課税標準 450,000・税額 45,000 |
| D3 | D2 を 500,000 で売却 | 借方 1910 550,000、貸方 2200 50,000、貸方 8100 500,000（standard 0.10）、借方 8100 490,000。8100 の純額は貸方 10,000（売却益）、売却損の行なし |
| D4 | G1 の資産を FY2031 の 4 月〜7 月まで実行済み（年度の計上済み 4 × 4,999 = 19,996、期首帳簿価額 60,000）、2031-08-20 に除却 | 当年償却 = min(120,000 × 5 / 12 = 50,000, 60,000 − 1) − 19,996 = 30,004（月の配分の合計 5 × 4,999 − 19,996 = 4,999 とは違う）。借方 6700 30,004 / 貸方 1929 30,004、借方 1929 590,000、貸方 1925 600,000、借方 8300 10,000 |
| D5 | G3 の資産（1925・1929・6700）を FY2029 の 1 月〜5 月まで実行済み（切替えの年度、年額 126,000、月 10,500、計上済み 52,500）、2029-06-15 に除却 | 当年償却 = min(126,000 × 6 / 12 = 63,000, 252,000 − 1) − 52,500 = 10,500。借方 6700 10,500 / 貸方 1929 10,500、借方 1929 811,000、貸方 1925 1,000,000、借方 8300 189,000 |
| D6 | G6 のソフトウエア（資産 = 累計額科目 1930、備忘価額 0）を FY2027 の 1 月〜2 月まで実行済み（計上済み 10,000）、2027-03-10 に除却 | 当年償却 = min(60,000 × 3 / 12 = 15,000, 270,000 − 0) − 10,000 = 5,000。借方 6700 5,000 / 貸方 1930 5,000、貸方 1930 255,000（直接法の 1 行）、借方 8300 255,000 |
| D7 | D2 を税区分 non_taxable で売却（450,000） | 借方 1910 450,000、貸方 8100 450,000（non_taxable 0）、借方 8100 450,000、借方 8200 40,000。2200 の行なし。2027-08 の消費税集計表に 売上 非課税 450,000 の行 |
| R1 | 実行の仕訳の集約: 2026-10（FY 4 月〜3 月）に G1 の資産と、G6 の条件で事業供用 2026-10-01・FY 4 月〜3 月のソフトウエア（月 5,000、累計額科目 1930） | 借方 6700 15,000 / 貸方 1929 10,000 / 貸方 1930 5,000 の仕訳 1 本、明細 2 行 |
| PT1 | year 2027、市区町村「渋谷区」: X 工具器具備品 取得 2025-05-01 500,000、Y 機械装置 取得 2026-06-01 1,200,000、Z 工具器具備品 取得 2024-01-10 300,000・2026-09-30 除却、W 車両（excluded）、V 工具器具備品 取得 2027-02-01 | 渋谷区 × 2 機械及び装置: 前年前 0、減少 0、取得 1,200,000、計 1,200,000。渋谷区 × 6 工具、器具及び備品: 前年前 800,000（2 件）、減少 300,000、取得 0、計 500,000。W・V は出ない |

## 関係するファイル・インターフェース（名指し）

新規 `modules/fixed-assets`（`package.json` は `@daifuku/kernel`・`@daifuku/mod-accounting`・`@daifuku/mod-tax`・`@daifuku/mod-partner`・`zod` に依存）:

- `src/module.ts`（`FixedAssetsModule = defineModule({ name: 'fixed_assets', depends: ['accounting', 'tax', 'partner'], ... })`、hooks で設定・health・hook を登録、menus、roles は既存の `accounting` を使い新設しない）、`src/index.ts`（公開 API: module、entity、`FIXED_ASSET_RULES_OVERRIDE` と規則の型・schema、計算の純粋関数）
- `src/entities/fixed-asset.ts`、`src/entities/depreciation-run.ts`、`src/entities/depreciation-run-line.ts`、`src/entities/disposal.ts`
- `src/rules.ts`（override 点 `fixed_assets.depreciation_rules`、`DepreciationRuleSet` の型と zod schema、取得日・耐用年数・償却方法による率の選択、備忘価額）
- `src/services/schedule.ts`（純粋: 事業年度ごとの償却額、改定取得価額の決定、供用月数、月の配分、期間の計上額。`Decimal` のみ）、`src/services/history.ts`（確定済みの run と明細・除却を `Repository` で読み、資産 × 会計年度の計上済み額にする）、`src/services/posting.ts`（純粋: 実行と除却・売却の仕訳明細）、`src/services/property-tax.ts`（純粋: 賦課期日の集計）、`src/services/periods.ts`（純粋: 既定期間）
- `src/hooks/asset.ts`（補完・検証・財務項目の固定・削除の拒否）、`src/hooks/run.ts`（before_submit: 再検査と `postFromSource`、before_cancel: `reverseSourceEntry`）、`src/hooks/disposal.ts`（下書きの計算、before_submit: 転記と資産の状態、before_cancel: 逆仕訳と状態の復元）
- `src/actions/preview.ts`・`run.ts`・`schedule-report.ts`・`property-tax.ts`・`rules.ts`・`todo.ts`、`src/settings.ts`（`fixed_assets.accounts`）、`src/health.ts`（`fixed_assets.depreciation_rules`）、`src/domain-write.ts`（serverOwned の書込 capability）
- 使う既存の公開 API: `@daifuku/mod-accounting` の `postFromSource`・`reverseSourceEntry`・`Account`・`FiscalYear`・`FiscalPeriod`・`assertOpenPeriod`・`assertJpySettlement`、`@daifuku/mod-tax` の `taxSummaryFor`、`@daifuku/kernel` の `defineEntity`・`defineDocument`・`defineAction`・`repo`・`saveLines`・`submitDocument`・`withLock`・`defineWriteCapability`/`withWriteCapability`・`registry.registerOverride`/`override`・`registry.registerSetting`・`registry.registerHealthCheck`・`tableResult`・`todoInput`/`todoResult`/`todoItems`・`getSetting`・`todayLocal`
- `l10n/jp/src/fixed-assets/rules.ts`（新規: 日本の規則集合。`verifiedOn`・`sources` 付き）、`l10n/jp/src/module.ts`（`registerJapanOverrides` に登録を追加）、`l10n/jp/src/seeds/chart-of-accounts.ts`（AC-29 の科目）、`l10n/jp/src/index.ts`、`l10n/jp/package.json`（型のための依存）
- `apps/runtime/src/catalog.ts` と `apps/runtime/package.json`、`apps/api/package.json`（module の追加。`JapanModule` より前）、`apps/api/drizzle/migrations/`（`pnpm db:schema && pnpm db:generate` で生成する新しい表だけの移行）
- `apps/web/src/pages/depreciation-page.tsx`・`apps/web/src/api/depreciation.ts`・`apps/web/src/lib/depreciation.ts`（新規）、`apps/web/src/router.tsx`（`/finance/depreciation`、`validateSearch` で `periodId`）、`apps/web/src/lib/navigation-data.ts`（分野 finance、module `fixed_assets`、action `fixed_assets.preview_depreciation`）、`apps/web/src/lib/help.ts`（画面・entity・帳票の章）、`apps/web/src/ui/token-usage.test.ts`（`CONVERTED` に新しい画面を追加）
- 試験: 下の表のファイル。既存の更新は `l10n/jp/test/l10n-jp.db.test.ts`（科目数と区分ごとの件数）、`apps/api/test/setup-health.db.test.ts`（`STABLE_IDS` と `KNOWN_HREFS` に追加）。どちらも仕様の変更に合わせた期待値の更新で、検査を弱めない（作業記録に書く）
- 文書: `docs/manual/appendix-o-fixed-assets.md`（新規の章）、`docs/manual/06-monthly.md`（月次の手順に償却の実行を追加）、`docs/manual/00-index.md`、`docs/architecture/program-map.md`（module の一覧）、`docs/specs/l10n-jp.md`（AC-1）、`docs/verification/invariants.md`（`PV-FIXED-ASSETS-01`: 償却の合計・備忘価額・配分の性質）、`docs/domain/japan-fixed-assets.md`（照合の結果）

## データ・業務ルール（出典）

- 定額法・200% 定率法・償却保証額と改定償却率・月割・備忘価額・資産の種類による償却方法の制限 — [japan-fixed-assets](../domain/japan-fixed-assets.md)（#methods、#declining、#memorandum、#proration、#method-restrictions。耐用年数省令 別表第八・第十、法人税法施行令 第48条の2・第59条・第61条。**【未確認】**）
- 円未満の切捨て — 同 #rounding（一次資料の箇所は未確認。切捨ては限度額を超えないための選択）
- 除却・売却の年の月割償却、事業用資産の売却の消費税 — 同 #disposal（消費税法 第4条・第28条、国税庁 No.6105。**【未確認】**）、消費税集計表の作り方は [japan-tax.md#tax-period-summary](../domain/japan-tax.md#tax-period-summary)
- 償却資産申告（賦課期日 1 月 1 日、1 月 31 日まで、所在の市町村、種類 1〜6、前年前・減少・取得・計）— 同 #property-tax（地方税法 第341条・第359条・第383条。**【未確認】**）
- 勘定科目の体系 — [l10n-jp](l10n-jp.md) AC-1（青色申告決算書・中小会計要領に寄せた既存の体系に、有形・無形固定資産と特別損益の科目を足す）

確認日: 2026-10-30 に一次資料（`www.nta.go.jp`、`laws.e-gov.go.jp`）への接続を試みたが、ネットワークの許可外で開けなかった。実装は domain 文書の「照合の手順」を行い、照合できた項目だけを「確認」にする。

## 決定（計画が選択を残した点と、その理由）

- D1 `fixed_asset` は document ではなく entity（マスタ）にする。理由: 計画が document と明示したのは除却・売却で、台帳は移行時に表計算から一括で入れる必要がある（B5 の CSV 取込は document を対象にしない）。確定済み伝票の不変性の代わりに、償却・除却の履歴ができた後は財務項目を固定する（AC-4）。
- D2 計算式（定額法、保証額による切替えを含む定率法、月割、備忘価額で止める）は module の純粋関数に置き、率・備忘価額・資産の種類ごとの制限・取得日の適用期間は `l10n/jp` の規則データに置く。理由: 計算の形は国に依らない部品として試験でき、法定の値だけが国と日付で変わる（規約 10）。`l10n/jp` は型だけ import し、`JapanModule` の依存と登録順を変えない（`purchase.exempt_supplier_credit_ratio` と同じく契約を module 側が持つ）。
- D3 償却額は事業年度単位で、実際の期首帳簿価額から求める（法人税の償却限度額の考え方）。月次の実行は「その年度の当期間までの配分 − 計上済み」を計上する。理由: 未実行の月があっても同じ年度内なら後でまとめて正しく計上でき、実行の順序に依らない。前年度の未計上分を後の年度に足すと限度額を超えるため繰り越さない（`priorYearPending` で知らせ、逆順の実行は AC-15 で止める）。
- D4 年額は円未満切捨て、保証額との比較は丸めない十進で行う。理由: 切捨ては限度額を超えない。端数の一次資料の箇所は未確認（Q6）。
- D5 実行 1 回 = `depreciation_run` 1 件 = 仕訳 1 本（科目ごとに集約）、資産ごとの額は run の明細に持つ。資産数は 1 回 500 件まで（kernel の明細上限）。理由: 計画の「期間ごとに 1 本」と、仕訳の明細上限（500 行）を両立する。
- D6 冪等性は会社単位のロックと「資産 × 期間に確定済みの明細が無いこと」の再検査で保つ（`postFromSource` の起票元ロックと同じ形）。再実行は不足分だけを追加し、無ければ何も作らない。理由: DSL の一意制約は取消済みの行を除外できず、取消後の再実行を妨げる。
- D7 取得の仕訳は作らない（仕入請求の明細の科目か手入力の仕訳）。理由: 取得の消費税（課税仕入）は仕入の経路が既に正しく扱い、二重計上を避ける。台帳と総勘定元帳の突合は Q3。
- D8 除却・売却の伝票は当年の月割償却を含めて 1 本の仕訳にする。売却の課税売上は、売却益の科目に「貸方 売却価額（税区分付き）／借方 min(売却価額, 帳簿価額)（税区分なし）」の対を置いて表す。理由: 既存の消費税集計表は収益科目の税区分付きの行を売上の基礎として集計し、資産の売却の課税標準は差益ではなく売却価額であるため。会計 module を変えずに損益（純額）と消費税集計表の両方が正しくなる。会計側に行ごとの売上/仕入の区分を足す案は Q8。
- D9 科目の既定は設定 `fixed_assets.accounts`（コード）で持ち、日本の科目体系に AC-29 の 12 科目を足す。特別損益は 8xxx の帯（8100 売却益・8200 売却損・8300 除却損）に置く（spec 作成時の 4200 は real-estate パックの 4200 賃貸料収入と重なるため変えた。パックの seed は既存のコードを飛ばすので、重なるとパックの売上が売却益の科目に載る）。既存の会社には seed が再実行されないため、科目を作るか設定を既存のコードに向ける（AC-28、マニュアル）。減価償却累計額は有形固定資産で 1 科目（1929）。理由: `purchase.accounts` と同じ形で、科目別の累計額を使う会社は資産ごとに科目を選べる。ソフトウエアは直接法（累計額科目 = 資産科目）を既定にする。
- D10 店舗・拠点の境界を宣言しない（本部だけ）。理由: ADR-0018 のとおり、店舗限定の文脈は未宣言の台帳を拒否し、確定は本部の業務。所在は自由入力の `location` と `municipality` にし、`workforce_site` を参照しない（accounting ロールに拠点の読取権限が無く、依存も増えるため）。
- D11 一次資料と未照合の率は、domain 文書の【未確認】の値（別表第八・第十の行と、出典の URL）を転記して出荷するが、`verifiedOn: null` とし、照合されるまで転記（償却の実行・除却と売却の確定）を止める（AC-35）。会社の担当者が率表を別表と照合して設定 `fixed_assets.rules_confirmation` に記録すれば、その会社では転記できる。試算・登録・帳票は止めない。理由: 課題の「出典を示せる率だけを入れる」と規約 10 に対し、作成・実装のどちらのセッションも一次資料に接続できなかった。止めないと未照合の値から仕訳ができる。率表を空にすると試算と画面も検証できない。照合した人の記録を出典として扱えば、本番での利用と較正（規約 11）を両立する。照合できない行（定率法の 21 年以上など）は入れない。
- D12 償却資産申告の準備は、賦課期日現在の取得価額を市区町村 × 種類で「前年前・減少・取得・計」に集計する TableResult（CSV）まで。種類（`propertyTaxClass`）は資産ごとに持ち、既定は資産の種類から決める。賦課期日・申告書の種類の番号とラベル・資産の種類ごとの既定の種類は規則データ（`l10n/jp`、出典付き）に置き、entity の enum の値（structure 〜 tools・excluded）だけを module に置く（DSL の enum は静的な値を要るため）。理由: 申告は市町村ごとで、申告書の種類別の欄に転記できる形が要る。車両（自動車税の対象）・建物（家屋）・ソフトウエア（無形）を既定で対象外にし、例外は利用者が直す。計画の文言は「B/S 科目別の集計」だが、課題の指示「aggregate by asset class」と申告書の種類別の欄に合わせて種類別にした（計画からの逸脱。資産科目別の残高は減価償却明細表の資産ごとの行と元帳で見られる）。
- D13 会計年度が 12 か月の暦月でない場合は実行を拒否する。理由: 既存の会計は 12 か月の年度しか作らず、1 年未満の事業年度の率の調整は範囲外。
- D14 試算の既定期間は「今日より前に終わった最後の会計期間（無ければ今日を含む期間）」。理由: 月次の償却は前月分を当月に実行するのが通常で、同じ年度の未実行月は D3 でまとめて計上される。締めガイドの既定（最も古い未締め期間）を流用すると、締めない会社では常に年度の最初の月になる。
- D15 売却価額は税抜で入力する。理由: システムは税抜経理だけで、`tax.price_includes_tax` は売上・仕入の明細の入力方式の設定であり、資産の売却には適用しない。
- D16 E2（定期仕訳）は基点 `ffc2f42` に無いため、その仕組みに依存しない。償却は台帳から計算するため定期仕訳のテンプレートは使わない。E2 の統合後、ナビゲーションで `/finance/recurring` と並べる（統合担当が調整）。C5（帳票の共通化）の統合後に台帳の印刷（`fixed_assets.render_register_html`）を足せるよう、帳票は TableResult に留める。
- D17 マニュアルは新しい章 `docs/manual/appendix-o-fixed-assets.md` とし、`06-monthly.md` の月次手順から参照する。同じ回の他の項目が `appendix-o` を使う場合は統合担当が文字を振り直す。
- D18 実行は期間ごとに 1 本を基本とし、実行の後に登録した資産があれば、その資産だけの run と仕訳を同じ期間に 1 件追加する（AC-13）。計画の「仕訳を期間ごとに 1 本」からの逸脱で、既に確定した仕訳を変えない（規約 4）ための選択。
- D19 償却費・除却損・売却損の借方は税区分 `out_of_scope` を付ける（6700 と 8200・8300 の科目の既定の税区分と同じ）。消費税集計表に 仕入 不課税 の行が増えるが、`tax_filing` の `tax_category_missing` の注意を出さない。売却の対の借方だけは税区分を付けない（AC-19 に既知の注意として書く）。
- D20 取消の訂正日は元の伝票（run は期間、除却・売却は日付）の会計年度の中に限る（AC-16・AC-20）。台帳の計上済み額を年度で数える計算と元帳を一致させるため。
- D21 run の取消は新しい順に限る（AC-16）。途中の期間を取り消すと同じ年度の再実行（AC-9）で不足分を計上できないため。
- D22 除却・売却の年の当年償却は 12 か月分の額の月割を限度額とし、月の配分（AC-9）とは独立に計算する（AC-18）。法令の限度額に合わせ、上限の年度でも過小にならない。

- D23 設定 `fixed_assets.accounts` に、AC-28 の 6 項目に加えて `outputTax`（仮受消費税、既定 2200）を持つ。理由: 売却の消費税の貸方（AC-19、golden D2）の科目を、日本の科目表の固定コードではなく設定で変えられるようにするため。`purchase.accounts` の `taxReceivable` と同じ形（実装時の追加）。
- D24 `depreciation_run` と明細の汎用作成の拒否（AC-16）は before_create に加えて before_validate（作成時のみ）でも行う。理由: 全項目が serverOwned のため、汎用の作成・複製の入力は schema の必須検査で before_create の前に `VALIDATION` になり、`use_depreciation_screen` の案内が届かない（実装時の補足）。
- D25 科目表とパックの seed の重なりの単体テスト（AC-29）は `apps/runtime/test/runtime.test.ts` ではなく新しい `apps/runtime/test/chart-codes.test.ts` に置く。理由: 既存のファイルは子プロセスでカタログを読み込む試験で、パックを import すると試験の前提（未登録の状態）を変えるため。

## 批評への対応（2026-10-30、実装セッションの冒頭）

spec の批評の指摘 18 件への対応。採用は本文（AC・golden・決定・検証）に反映済み。

実装の再開時（2026-10-30、統合担当が中断した実装セッションの再開）に渡された批評の指摘は 0 件で、追加の変更はない。

| # | 指摘 | 対応 |
| --- | --- | --- |
| 1 | 4200 が real-estate パックの賃貸料収入と重なる（blocker） | 採用。特別損益を 8100・8200・8300 に移し（D9）、科目表とパックの seed の重なりを単体テストで検査（AC-29）、回帰に real-estate のシナリオを追加 |
| 2 | 未照合の率で転記できる | 採用（形を変えて）。`verifiedOn` が null の間は転記を `rules_unverified` で止める（AC-35）。ただし会社の照合記録で解除できるようにした: 規則の上書きだけで解除すると、本番で人が照合しても利用できず、ブラウザ試験も実行を検証できないため（D11） |
| 3 | CSV 出力の権限 | 採用。`depreciation_run_line` に export、帳票ごとの `exportEntities` を明記、viewer は出力なし（AC-21・AC-22・AC-24） |
| 4 | 除却の年の当年償却の基礎が曖昧 | 採用。12 か月分の額の月割と上限による法令の限度額（AC-18、D22）、golden D4・D5 |
| 5 | 途中の期間の run の取消 | 採用。後の期間に確定済みの明細があれば取消を拒否（AC-16、D21） |
| 6 | 締め済みの年度に供用した資産の移行値 | 採用（AC-3） |
| 7 | 年度外の訂正日 | 採用。訂正日を元の年度の中に限る（AC-16・AC-20、D20） |
| 8 | `tax_category_missing` の注意 | 採用。償却費・除却損・売却損に `out_of_scope` を付け、売却の対の借方だけは既知の注意として残す（AC-12・AC-18・AC-19、D19） |
| 9 | 導入チェックが資産の無い会社にも warn | 一部採用。資産 0 件は ok、国・通貨の違いは warn。件数を読めない場合は ok でなく warn にする（照合の記録は settings ロールが設定できるため、warn が対処できる案内になる。ok にすると未照合を隠す）（AC-30） |
| 10 | `depreciation_not_run` の誤検知・見落とし | 採用。試算の計上額が 0 より大きい資産の件数にする（AC-31） |
| 11 | 規則の国を検査しない | 採用（AC-10） |
| 12 | 未来の期間の実行 | 採用（AC-14） |
| 13 | 償却資産申告の日本固有の値が module にある | 一部採用。賦課期日・種類の番号とラベル・既定の対応を規則データに移した。entity の enum の値は DSL が静的な値を要るため module に残す。計画の「B/S 科目別」からの逸脱を D12 に記録 |
| 14 | 汎用の作成・複製が入力の検証で失敗する | 採用。before_create で書込 capability の無い作成を `use_depreciation_screen` で拒否（AC-16） |
| 15 | AC-1・AC-3・AC-4 の未定義の点 | 採用（必須項目、`inServiceDate` は空を許す、`openingRevisedBase` の拒否、capability の書込の除外、会計年度の無い会社と未来の期間しか無い会社の既定期間） |
| 16 | 既存の会社に科目が無い | 採用（文書のみ）。AC-28・D9・マニュアルに手順を書く。科目を追加する action は作らない（科目の作成は既存の勘定科目の画面でできる） |
| 17 | golden の不足 | 採用。G9・D6・D7、`priorYearPending` の DB 試験 |
| 18 | 細かな点（備忘価額の期間、相互参照、取引先必須、記録と計測、追加の run、500 件超の試算） | 採用（AC-10・AC-11・AC-17、domain 文書、検証手順 7、D18） |

## スコープ外（明記）

- 旧定額法・旧定率法（2007-03-31 以前の取得）、250% 定率法（2007-04-01〜2012-03-31 の取得）、生産高比例法、リース期間定額法、取替法、増加償却、定率法の 21 年以上の耐用年数（照合できるまで）
- 特別償却・割増償却、少額減価償却資産の特例（30 万円未満）、一括償却資産（20 万円未満の 3 年均等）、10 万円未満の即時費用化の判定、圧縮記帳、減損、資産除去債務、資本的支出と修繕費の区分、中古資産の耐用年数の見積り（利用者が年数を入力する）
- 1 年未満の事業年度、期中の耐用年数・償却方法の変更、一部除却・一部売却、資産の移動（拠点間）、休止資産
- 法人税申告書 別表十六の作成、償却資産申告書そのもの（eLTAX）、固定資産税の評価額・税額の計算、個人事業者の事業専用割合
- 部門・分析軸（ext）の償却仕訳への引継ぎ、外貨、税込経理
- 取得の仕訳の自動作成、仕入請求との参照、台帳と総勘定元帳の突合帳票（Q3）
- 償却の自動実行（スケジューラ）、締めガイドの点検項目への追加（Q5。受信箱の項目で代える）、帳票の印刷（C5 の後）、役割別ホーム（C6）への専用表示

## 検証手順（実行して記録する）

1. 編集中は `pnpm gate:quick`、コミット前に `GATE_DB_SHARDS=1 pnpm gate:light`（`TEST_DATABASE_URL_*` を設定）。
2. 単体・DB・ブラウザの各テストを下の表のとおり追加して実行する。DB の対象を絞った実行: `pnpm vitest run --project db modules/fixed-assets l10n/jp/test/l10n-jp.db.test.ts apps/api/test/fixed-assets.db.test.ts apps/api/test/setup-health.db.test.ts packs/real-estate/test/scenario-real-estate.db.test.ts`（科目表の変更が業種パックの科目と重ならないことの回帰）。
3. ブラウザ: `/tmp/claude-0/-home-user-DaifukuERP/8a7541e3-ab40-5f9c-ac08-5679d2bd0af8/scratchpad/tools/e2e-run.sh <worktree> <slot> apps/web/e2e/fixed-assets.spec.ts --project=chromium --no-deps`。
4. API の手動確認（`pnpm dev:api`）: 資産を 2 件作成 → `POST /actions/fixed_assets.preview_depreciation` → `run_depreciation` を同じ期間で 2 回（2 回目が `created: false`）→ 試算表で 6700・1929 の残高を確認 → 期間を締めて `run_depreciation` が `INVALID_STATE` になること → 売却を確定して消費税集計表の売上の行を確認。応答を作業記録に要約する。
5. 一次資料の照合: domain 文書の「照合の手順」を試み、照合できた項目と `verifiedOn` の値、できなかった項目を作業記録に書く（できなければ「未検証」と明記）。
6. 終了時に `pnpm test:db:templates -- --drop`（`TEST_DATABASE_URL_*` を設定）で自分の DB のテンプレートと shard を消す。
7. 作業記録 `docs/log/2026-10-30-fixed-assets.md`（テンプレート `docs/log/_template.md`。測定と査読の区別、未検証の範囲、所要時間）を書き、`pnpm metrics:add -- --feature fixed-assets ...` で記録する（完成の定義 4）。
8. `pnpm gate:full`（統合担当が実行）。

| AC | 段階 | テスト（ファイル） |
| --- | --- | --- |
| AC-1〜AC-5 | DB | `modules/fixed-assets/test/asset.db.test.ts`（補完・検証・移行・固定・削除・CSV 取込の dry-run と実行） |
| AC-2、AC-3 | 単体 | `modules/fixed-assets/test/rules.test.ts`（率の選択・取得日・償却方法の制限）、`schedule.test.ts`（移行年度の期首帳簿価額、G7 の拒否条件） |
| AC-6〜AC-9 | 単体（golden・性質） | `modules/fixed-assets/test/schedule.test.ts`（G1〜G8、fast-check で合計・備忘価額・配分・実行順の性質） |
| AC-10、AC-23、AC-35 | 単体・DB | `modules/fixed-assets/test/rules.test.ts`（schema、未登録・不正・通貨違い・国違いの拒否、照合記録の判定）、`modules/fixed-assets/test/depreciation.db.test.ts`・`disposal.db.test.ts`（未照合で照合記録の無い会社の実行・確定が `rules_unverified`、記録の後は転記できる）、`l10n/jp/test/fixed-assets-rules.test.ts`（日本のデータが module の schema に通る、例の耐用年数に率がある、`verifiedOn` と `sources`）、`apps/api/test/fixed-assets.db.test.ts`（全 module の runtime で日本の規則が使われる） |
| AC-11〜AC-16 | DB・単体 | `modules/fixed-assets/test/depreciation.db.test.ts`（R1 の仕訳、2 回実行、後から登録した資産、2 トランザクションの同時実行、締め済み期間・年度、未来の期間、逆順の拒否、取消と再計算、途中の期間の取消の拒否（11 月を取り消すと 12 月が確定済みなら拒否し、年度の合計が変わらない）、年度外の訂正日の拒否、除却済み資産を含む取消の拒否、汎用作成・複製の `use_depreciation_screen`、`priorYearPending`、償却費の行の税区分 `out_of_scope`）、`modules/fixed-assets/test/posting.test.ts`（集約）、`periods.test.ts`（既定期間）、500 件の上限は計画の純粋関数で検査 |
| AC-17〜AC-20 | 単体・DB | `modules/fixed-assets/test/posting.test.ts`（D1〜D7 の明細）、`modules/fixed-assets/test/schedule.test.ts`（D4・D5 の当年償却）、`modules/fixed-assets/test/disposal.db.test.ts`（確定・取消・資産の状態・確定の拒否条件（取引先必須の科目を含む）・消費税集計表の売上の行（課税・非課税）・締め済み期間・年度外の訂正日・売却の対の借方は税区分なし） |
| AC-21、AC-22 | 単体・DB | `modules/fixed-assets/test/property-tax.test.ts`（PT1、計の恒等式）、`modules/fixed-assets/test/reports.db.test.ts`（明細表の各列と合計、accounting は 2 つの帳票の CSV を出力でき、viewer は `PERMISSION_DENIED`） |
| AC-24〜AC-27 | DB | `modules/fixed-assets/test/access.db.test.ts`（ロール別、別会社、店舗・拠点限定の文脈、監査の actor） |
| AC-28 | DB | `modules/fixed-assets/test/asset.db.test.ts`（科目コードが無い場合の `StateError`） |
| AC-29 | DB・単体 | `l10n/jp/test/l10n-jp.db.test.ts`（科目の件数と区分、既存コードの非上書き、override の登録）、`apps/runtime/test/chart-codes.test.ts`（日本の科目表とパックの seed の科目コードが重ならない。D25）、`packs/real-estate/test/scenario-real-estate.db.test.ts`（回帰） |
| AC-30 | DB | `apps/api/test/setup-health.db.test.ts`（項目 id・順序・href）、`modules/fixed-assets/test/health.db.test.ts`（資産 0 件は ok、資産ありで未照合は warn、照合記録で ok、国・通貨違いは warn、settings ロールは warn） |
| AC-31 | DB | `modules/fixed-assets/test/todo.db.test.ts`（未実行の資産の件数、償却済みの資産は数えない、実行の後に登録した資産は数える） |
| AC-32〜AC-34 | Web 単体・ブラウザ | `apps/web/src/lib/depreciation.test.ts`（表示の組立て、文言、既定期間の URL）、`apps/web/e2e/fixed-assets.spec.ts`（照合記録の無い会社で実行の操作が無効、設定に照合を記録、汎用フォームで資産を登録 → 試算 → 実行 → 2 回目は計上なし → 除却の確定、未照合の帯、viewer に実行なし、英語表示、390px、`judge()`） |

## 未決事項（利用者の判断待ち。括弧内は推奨の既定）

- Q1 償却率表などの制度値の照合: 作成時・実装時（2026-10-30）とも一次資料に接続できなかった（WebFetch は名前解決の失敗、curl はプロキシの 403）。（決定済みの扱い: AC-35 で転記を止め、会社の照合記録で解除する。推奨: 統合担当か利用者が `www.nta.go.jp` と `laws.e-gov.go.jp` への接続を許可して照合し、`l10n/jp` の `verifiedOn` を入れる。spec の状態 implemented はこの照合を含まない）
- Q2 1 回の実行で 500 件を超える資産（推奨: 初版は拒否。必要になったら 500 件ごとに run と仕訳を分ける）
- Q3 台帳（資産科目ごとの取得価額・累計）と総勘定元帳の残高の突合帳票（推奨: 初版は対象外。次の版で明細表に元帳の残高列を足す）
- Q4 少額減価償却資産の特例・一括償却資産・特別償却（推奨: 対象外。租税特別措置で期限付きのため、入れるときは規則データに期間付きで持つ）
- Q5 締めガイドの点検項目に「償却が未実行」を足すか（推奨: 初版は受信箱の項目だけ。会計 module に点検の拡張点を足すときに合わせる）
- Q6 保証額との比較と年額の端数（推奨: 比較は丸めない、年額は切捨て。一次資料で別の扱いが確認できたら規則データの属性にする）
- Q7 法人の除却・売却の年の償却を任意にするか（推奨: 常に月割で計上。選べるようにするなら伝票に項目を足す）
- Q8 売却の課税売上を、売却益の科目の対の行ではなく、会計の明細に売上/仕入の区分を持たせて表すか（推奨: 初版は対の行。会計の消費税集計表を拡張するときに置き換える）
