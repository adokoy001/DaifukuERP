# Spec: pack-real-estate（導入テンプレート「不動産（賃貸管理・自主管理）」）

- 状態: approved ／ 層: packs/real-estate（`@daifuku/pack-real-estate`、pack name `real_estate`）／ 依存: partner, product, tax, accounting, sales, payment, contract, l10n_jp
- ADR: 0013, 0014, 0015 ／ 作成: 2026-09-11 ／ 作成者: orchestrator ／ 手本: `packs/example`、`docs/conventions/packs.md`
- 前提: **自主管理**（会社＝家主）。管理会社がオーナーに代わって集金する形（預り家賃・管理料精算）は Phase 3。

## 目的
小規模な賃貸オーナー（住居数戸＋事務所 1 戸＋駐車場）が、物件・部屋・賃貸借契約・毎月の家賃請求・敷金礼金・入金消込・滞納一覧・レントロールをコア無改変で扱える導入テンプレート。日本の消費税（住宅の貸付けは非課税、事務所・駐車場は課税）を正しく分ける。

## 受入基準（EARS）
- AC-1 Entities（pack 内）: `property`（物件: code unique, name, address, note）, `unit`（部屋/区画: propertyId ref required, code, name, usage enum `residential | office | store | parking`, floorArea decimal(scale 2) nullable, monthlyRent money, status enum vacant/occupied computed by hooks, note; unique (propertyId, code)）, `deposit`（敷金台帳: contractId ref contract required, partnerId ref, unitId ref, amount money, receivedDate date nullable, returnedDate date nullable, returnedAmount money default 0, journalEntryId ref nullable, returnJournalEntryId ref nullable）.
- AC-2 ext: `contract` に `unitId`（ref unit）, `keyMoney`（money 礼金, default 0）, `depositMonths`（decimal 敷金月数, default 0）, `renewalFee`（money, default 0; v1 では記録のみ）; `partner` に `tenantKind`（enum individual/corporate）, `emergencyContact`（text）.
- AC-3 税区分の規則（出典を `docs/domain/real-estate.md` に URL・確認日つきで書く。WebFetch で nta.go.jp が読めなければ【未確認】と明記して既知の内容を書く）: usage `residential` → 家賃・礼金・更新料は **非課税**（消費税法 別表第二 十三、国税庁タックスアンサー No.6226「住宅の貸付け」）; `office`/`store` → 課税（standard）; `parking` → 課税（No.6226: 駐車場は課税）; 敷金（返還するもの）→ **不課税**（`out_of_scope`; 売上ではないので請求書に載せず deposit 台帳＋仕訳）。契約明細の taxCategory は unit.usage から既定（hook: contract の before_validate で `ext.unitId` の unit を読み、明細に taxCategory が無ければ設定）。
- AC-4 Actions:
  - `real_estate.move_in { contractId, depositReceivedDate?, accountId? }`（permission sales; mutates）: 契約が submitted であること; unit.status → occupied; 契約の開始月の請求を `contract.generate_invoices { period: startMonth, contractId, submit: false }` で生成し、`keyMoney > 0` なら同じ請求書に「礼金」行（taxCategory: residential → non_taxable, else standard, unitPrice = keyMoney, quantity 1）を追加して再計算（sales の recalc がフックで走ることを確認）、その後 submit; `depositMonths > 0` なら deposit 行を作り、`depositReceivedDate` があれば `real_estate.receive_deposit` を呼ぶ。返り値 `{ invoiceId, number, total, depositId? }`.
  - `real_estate.receive_deposit { depositId, date, accountId? }`: Dr 現金/普通預金（accountId、既定 `payment.accounts.bank`）/ Cr 2500 預り金 の journal_entry を `postFromSource` で作成・確定し、deposit に記録。
  - `real_estate.return_deposit { depositId, date, amount, deductionAccountId?, deductionAmount? }`: Dr 預り金 amount / Cr 普通預金 (amount − deduction) / Cr 4100 雑収入 or given account (deduction, 原状回復費の控除); deposit に記録; 契約を `contract.end` していることを要求しない（順序は自由）.
  - `real_estate.move_out { contractId, endDate }`: `contract.end` を呼び、unit.status → vacant（終了日が過ぎていれば）.
  - `real_estate.rent_roll { asOf }` → TableResult per unit: 物件, 部屋, 用途, 面積, 月額賃料, 入居者, 契約開始, 契約終了, 状態, 税区分; totals 月額賃料（課税/非課税別）.
  - `real_estate.arrears { asOf }` → TableResult: 期日を過ぎて未消込の sales_invoice（契約由来のもの: sales_invoice の note or `ext.contractId` — contract モジュールが請求書にどう契約を結び付けているか読んで使う。無ければ contract_billing から引く）per 入居者×部屋: 請求番号, 期日, 延滞日数, 残高; totals.
- AC-5 Settings applied by pack: `sales.accounts.revenue = '4200'`（pack が seed する 賃貸料収入）、`contract.default_proration = 'daily'`、`contract.auto_submit = false`、`tax.price_includes_tax = false`。pack 自身の `real_estate.accounts = { deposit: '2500', rentRevenue: '4200', bank: '1100' }`.
- AC-6 seed（冪等）: accounts `4200 賃貸料収入`（revenue）、`4210 礼金・更新料収入`（revenue; v1 では礼金も 4200 に乗るので**使わない**が科目は用意し、台本に制限として書く）; product `RENT 家賃`（service, taxCategory non_taxable）, `RENT_TAXABLE 家賃（課税）`（service, standard）, `KEY_MONEY 礼金`（service）. sample: 物件 1、部屋 4、入居者 4、契約 4（台本のもの）.
- AC-7 Labels: `contract` → 「賃貸借契約」, `sales_invoice` → 「家賃請求書」, `partner` → 「入居者/取引先」. Menus: 賃貸管理（物件、部屋、賃貸借契約、敷金台帳、レントロール、滞納一覧）.
- AC-8 台本 `docs/domain/scenario-real-estate.md`（2026-11、架空「サンプルハイツ」）: 部屋 101（residential 60,000）, 102（residential 65,000）, 201（office 100,000 税抜）, P1（parking 8,000 税抜）; 入居者 T1（101、契約 2026-04-01〜、敷金なし）, T2（102、**2026-11-11 入居**、礼金 65,000、敷金 1 か月 65,000、11-10 に敷金受領）, T3（201、2026-11-01〜、礼金 100,000、敷金 2 か月 200,000、11-01 受領）, T4（P1、2026-11-01〜）; 期首 11-01 元入金 500,000; 11 月分請求（advance、billingDay 1）: T1 60,000 非課税; T2 move_in → 日割り 20/30 日 = 43,333（切捨て）非課税 ＋ 礼金 65,000 非課税 = 108,333; T3 100,000 + 税 10,000 = 110,000 ＋ 礼金 100,000 + 10,000 = 220,000（1 枚の請求書、税率ごと丸め）; T4 8,000 + 800 = 8,800; 入金: T1 11-05 60,000、T2 11-10 108,333、T3 11-01 220,000、**T4 未入金**; 敷金: T2 65,000（11-10）、T3 200,000（11-01）→ 預り金 265,000; 12 月分請求も 11-25 に生成（T1 60,000, T2 65,000, T3 110,000, T4 8,800）→ 12 月分は期日前で滞納ではない; `real_estate.arrears { asOf: '2026-12-05' }` → T4 の 11 月分 8,800 のみ（延滞日数は 11 月分の期日から）; レントロール asOf 11-30: 4 戸 occupied、月額合計 課税 108,000 / 非課税 125,000; 消費税集計 11 月: 課税売上 100,000+100,000+8,000 = 208,000 → 税 20,800（12 月分請求は 11-25 発行なので 11 月の集計に入る: T3 100,000 + T4 8,000 → 課税売上は合計 316,000, 税 31,600 — **どちらが正しいか（発行日基準）を台本で明記し、エージェントが決めて根拠を書く**）。期待値（試算表・売掛・預り金・消費税集計・滞納・レントロール）はエージェントが手計算で導出して台本に書く。
- AC-9 `packs/real-estate/test/scenario-real-estate.db.test.ts`（DB `daifuku_test_real_estate`）で台本を全項目アサート（pack apply から）。unit テスト: 税区分の既定規則、日割りは contract のものを信頼（再テスト不要）。
- AC-10 比較用ひっかけ（台本の節）: 1) 住宅非課税/事務所課税/駐車場課税の混在, 2) 月途中入居の日割り, 3) 敷金（不課税・預り金）と礼金（売上）の区別, 4) 同一入居者の家賃＋礼金を 1 枚の請求書で税率ごと丸め, 5) 滞納一覧と期日前請求の区別, 6) 更新料（未対応）.

## 関係するファイル
packs/real-estate/src/{index.ts, pack.ts, settings.ts, entities/{property,unit,deposit}.ts, services/{tax-rule.ts (pure), rent-roll.ts (pure shaping)}, hooks/{contract-defaults.ts, unit-status.ts}, actions/{move-in,receive-deposit,return-deposit,move-out,rent-roll,arrears}.ts, seed.ts, sample.ts}, test/{tax-rule.test.ts, scenario-real-estate.db.test.ts}; docs/domain/{real-estate.md, scenario-real-estate.md}; docs/log/2026-09-11-pack-real-estate.md。**Migration・apps 配線は本体。**

## スコープ外
管理会社モード（オーナー精算）、更新料の自動請求、家賃保証会社、火災保険、修繕履歴、内見・募集。
