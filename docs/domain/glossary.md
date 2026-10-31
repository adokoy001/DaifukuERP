# 用語集（ja / en / 識別子）

| ja | en | identifier | 備考 |
|---|---|---|---|
| テナント | tenant | tenant | SaaS 契約者。RLS の単位 |
| 会社 | company | company | 法人。会計・採番・締めの単位 |
| 取引先 | partner | partner | 顧客・仕入先・その他を統合（フラグで区別） |
| 品目 | product | product | 物品・サービス |
| 単位 | unit of measure | uom | 換算あり |
| 価格表 | price list | price_list | |
| 税コード | tax code | tax_code | 率×有効期間、課税区分 |
| 勘定科目 | account | account | |
| 会計年度 / 期間 | fiscal year / period | fiscal_year / fiscal_period | 任意開始月 |
| 仕訳 | journal entry | journal_entry | append-only |
| 見積 | quotation | quotation | |
| 受注 | sales order | sales_order | |
| 納品書 | delivery note | delivery_note | 税額確定（丸め）の単位になりうる |
| 請求書 / 合計請求書 | invoice / summary invoice | sales_invoice | 締め請求 |
| 適格請求書 | qualified invoice | — | インボイス制度の要件を満たす請求書 |
| 発注 | purchase order | purchase_order | |
| 入荷 | goods receipt | goods_receipt | |
| 仕入請求 | supplier invoice / bill | purchase_invoice | |
| 締め日 / 支払サイト | closing day / payment terms | closing_day / payment_term | 「月末締め翌月末払い」 |
| 伝票状態 | docstatus | docstatus | draft / submitted / cancelled |
| 訂正（再発行） | amend | amend | cancelled から新版 |
| 採番 | numbering | numbering | no-gap（欠番なし） |
| 監査ログ | audit log | audit_log | append-only |
| 拡張フィールド | extension field | ext | JSONB |
| 業種パック | industry pack | pack | packs/ |
| 国パック | country pack | l10n | l10n/ |
| 固定資産 / 固定資産台帳 | fixed asset / fixed asset register | fixed_asset | 減価償却資産の台帳。出典と制度は [japan-fixed-assets](japan-fixed-assets.md) |
| 減価償却 / 償却の実行 | depreciation / depreciation run | depreciation_run | 実行 1 回 = document 1 件 = 仕訳 1 本（会計期間を指定） |
| 定額法 / 定率法（200%） | straight-line / 200% declining balance | straight_line / declining_200 | |
| 償却保証額 / 改定取得価額 / 改定償却率 | guarantee amount / revised base / revised rate | guaranteeRate / revisedBase / revisedRate | 定率法の切替え |
| 備忘価額 | memorandum value | memorandumValue | 有形 1 円、無形 0 円 |
| 除却 / 売却 | retirement / sale (disposal) | fixed_asset_disposal | kind = retirement / sale |
| 償却資産申告 | depreciable property tax return | property_tax_summary | 1 月 1 日現在、市町村ごと |
