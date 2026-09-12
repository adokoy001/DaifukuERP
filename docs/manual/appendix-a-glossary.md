# 付録 A 用語集

前半は開発資料の用語集（`docs/domain/glossary.md`）から、この文書に出てくるものを抜き出したものです。後半はこの文書で補った用語です。「識別子」は API や AI から使うときの名前です。

## 用語集からの抜粋

| 日本語 | 英語 | 識別子 | 説明 |
|---|---|---|---|
| テナント | tenant | `tenant` | システムの契約者の単位。データはテナントごとに分離される |
| 会社 | company | `company` | 法人・事業者。会計・採番・締めの単位。1 テナントに複数持てる |
| 取引先 | partner | `partner` | 顧客・仕入先・その他を一つの台帳で扱う（チェックで区別） |
| 品目 | product | `product` | 物品・サービス |
| 単位 | unit of measure | `uom` | 個、式、時間など |
| 税率（税コード） | tax code | `tax_rate` | 税区分ごとの率と適用期間 |
| 勘定科目 | account | `account` | |
| 会計年度 / 会計期間 | fiscal year / period | `fiscal_year` / `fiscal_period` | 開始月は任意。期間は月ごと |
| 仕訳 | journal entry | `journal_entry` | 追記のみ。訂正は逆仕訳 |
| 請求書 | invoice | `sales_invoice` | 売上請求書 |
| 適格請求書 | qualified invoice | — | インボイス制度の記載事項を満たす請求書 |
| 仕入請求書 | supplier invoice / bill | `purchase_invoice` | 受け取った請求書（経費を含む） |
| 締め日 / 支払サイト | closing day / payment terms | `closingDay` など | 「月末締め翌月末払い」など |
| 伝票状態 | docstatus | `docstatus` | 下書き 0 / 確定 1 / 取消 2 |
| 訂正（再発行） | amend | `amend` | 取消した伝票から新しい版を作る |
| 採番 | numbering | — | 確定時に欠番なしで番号を付ける（`INV-2026-000001` など） |
| 監査ログ | audit log | `audit_log` | 追記のみ |
| 拡張フィールド（追加項目） | extension field | `ext` | テンプレートなどが足した項目 |
| 業種パック（導入テンプレート） | industry pack | `pack` | `packs/` |
| 国パック | country pack | `l10n` | 日本向けの勘定科目・税率・帳票など（`l10n/jp`） |

## この文書で補った用語

| 日本語 | 識別子 | 説明 |
|---|---|---|
| 伝票 | document | 状態（下書き・確定・取消）を持つ記録。請求書、入出金、仕訳、入出庫、棚卸、契約、レジ締め |
| 明細 | lines | 伝票の行。例: `sales_invoice_line` |
| 確定 | submit | 伝票を帳簿に反映させる操作。確定後は変更・削除できない |
| 取消 | cancel | 確定した伝票を無効にする操作。記録と逆仕訳が残る |
| 逆仕訳 | `accounting.reverse_entry` | 貸借を入れ替えた仕訳で元の仕訳を打ち消すこと |
| 入出金 | `payment` | 入金（receive）と支払（pay）を同じ伝票で扱う |
| 消込 | allocation（`payment_allocation`） | 入出金を請求書に割り当てて残高を減らすこと |
| 登録番号 | `invoiceRegistrationNo` | 適格請求書発行事業者の番号。`T` + 13 桁 |
| 課税区分（取引先） | `taxStatus` | 画面では「課税事業者 / 免税事業者」。仕入の控除計算に使う |
| 税区分（明細） | `taxCategory` | 課税（標準）standard、課税（軽減）reduced、免税 exempt、非課税 non_taxable、不課税 out_of_scope |
| 経過措置（控除率） | `creditRatio` | 免税事業者からの仕入で控除できる割合。2026-09-30 まで 80%、2026-10-01 から 70% |
| 控除対象外消費税 | `nonDeductibleTax` | 控除できない消費税。費用に含めて計上 |
| 端数処理（税率ごとに 1 回） | `tax.rounding` | 1 枚の請求書につき、税率ごとに合計してから 1 回丸める |
| 年齢表 | `sales.ar_aging` / `purchase.ap_aging` | 未入金・未払の残高を期日からの経過日数で区分した表 |
| 消費税集計表 | `accounting.tax_period_summary` | 仕訳の税区分・税率ごとに税抜金額と税額を集計した表 |
| 移動平均法 | — | 入庫のたびに平均単価を改定する在庫の評価方法 |
| 棚卸 | `stock_count` | 実地の数量を数えて帳簿の在庫に合わせること |
| 三分法 | — | 仕入高・売上高・繰越商品（大福帳では商品・期首/期末商品棚卸高）で売上原価を出す方法 |
| レジ締め | `retail_closing` | 小売テンプレートの 1 日分の売上をまとめる伝票 |
| レントロール | `real_estate.rent_roll` | 部屋ごとの賃料・入居者・契約の一覧 |
| 敷金 / 礼金 | `real_estate_deposit` / `ext.keyMoney` | 敷金は返還するので預り金（不課税）、礼金は返還しないので売上 |
| 日割り | `prorationRule` | 月の途中の入居・退去で、当月の実日数で賃料を按分すること |
| アクション | action | 名前付きの業務操作。REST と MCP の両方から呼べる |
| MCP | Model Context Protocol | AI エージェントがツールを呼ぶための標準的な接続方式 |

---

検証: 用語は開発資料からの抜粋・補足で、操作を伴わない。経過措置の率・税区分の識別子・伝票状態の値は 2026-09-11 実機（API の応答）と一致することを確認。
