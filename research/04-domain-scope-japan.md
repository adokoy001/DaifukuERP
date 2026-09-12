# 調査ノート04: 多業種ERPの機能スコープと日本固有要件（2026-09-10時点）

調査日: 2026-09-10 ／ 調査者: Claude（リサーチ用サブエージェント）／ 統合: Claude（claude-fable-5-1）
凡例: 【確認済】=国税庁・デジタル庁・全銀協・公式製品ドキュメント等の一次情報、【二次情報】=解説サイト・ベンダー記事、【推測】=推論。法令事項は「2026年9月10日時点」。

## Part A — 機能ドメインマップ

### A1. 汎用ERPの標準機能領域（Odoo / ERPNext / SAP を基準）

Odooの公式アプリ一覧は Finance（Accounting, Invoicing, Expenses, Documents, Sign）、Sales（CRM, Sales, POS Shop, POS Restaurant, Subscriptions, Rental）、Supply Chain（Inventory, Manufacturing, PLM, Purchase, Maintenance, Quality）、HR（Employees, Recruitment, Time Off, Appraisals, Fleet）、Services（Project, Timesheets, Field Service, Helpdesk, Planning）、Websites（eCommerce 等）、Productivity（Approvals 等）に分類される（https://www.odoo.com/page/all-apps）【確認済】。ERPNextは Accounting / Procurement / Sales / CRM / Stock / Manufacturing / Projects / Point of Sale / Quality / Support / Assets をコアモジュールとし（https://frappe.io/erpnext/modules）【確認済】、v14以降 Hospitality・Non Profit・Agriculture 等の業種ドメインは本体から分離され別アプリ化された（https://discuss.frappe.io/t/separating-agriculture-hospitality-non-profit-domains-from-erpnext/84547/4）【二次情報】。SAPの伝統的モジュール区分は FI / CO / SD / MM / PP / QM / PM / PS / HCM（https://www.erpresearch.com/en-us/sap-s/4-hana-modules）【二次情報】。

「汎用コア」の領域と主要エンティティ/文書/プロセス【推測：3製品の共通部分の整理】:

| 領域 | 主要エンティティ・文書 | 主要プロセス |
|---|---|---|
| 総勘定元帳（GL） | 勘定科目表、会計期間、仕訳、補助元帳、部門/プロジェクト等の分析軸、通貨 | 仕訳起票・転記、期末締め、試算表/BS/PL |
| 債務（AP） | 仕入請求書、支払、前払、債務残高 | 三点照合（発注・入荷・請求）、支払サイト管理、支払消込 |
| 債権（AR） | 顧客請求書、入金、貸倒引当、督促 | 請求発行、入金消込、年齢表 |
| 固定資産 | 資産台帳、償却方法/耐用年数、償却仕訳 | 取得・償却・除却・売却 |
| 予算 | 予算（科目×期間×部門）、実績対比 | 予算編成、差異分析 |
| 販売/CRM | リード、商談、見積→受注→出荷/納品→請求、価格表 | Quote-to-Cash |
| 購買 | 購買依頼、見積依頼、発注、入荷、仕入請求 | Procure-to-Pay |
| 在庫/倉庫 | 品目、UoM、倉庫/ロケーション、ロット/シリアル、在庫移動、評価 | 入出庫、棚卸、ピッキング。評価方法は Odoo で Standard Price / AVCO / FIFO、払出戦略として FIFO/LIFO/FEFO（https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/inventory_valuation/cheat_sheet.html）【確認済】 |
| 製造 | BOM（多階層・キット・バリアント）、作業区、工程/ルーティング、製造指図、作業指図、MPS、副産物、廃棄、分解、外注、ECO/PLM（https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing.html）【確認済】 | MPS→MRP→製造指図→作業実績→原価計上 |
| 人事 | 従業員、組織、勤怠、休暇、給与基礎 | 入退社、勤怠集計、給与計算 |
| プロジェクト | プロジェクト/タスク、タイムシート、経費、請求 | 工数集計→請求（時間・マイルストーン・固定） |
| POS | セッション、レシート、決済手段、返品 | 会計・締め・在庫連動 |
| サブスクリプション | 契約、プラン、請求サイクル、更新/解約、日割 | 定期請求 |
| サービス/フィールドサービス | チケット、作業指示、訪問、部品消費、SLA | 受付→派遣→完了報告→請求 |
| eコマース | 商品カタログ、カート、注文、決済、配送 | 注文取込→受注/在庫連動 |
| 品質 | 検査計画、検査結果、不適合、是正 | 受入/工程/出荷検査 |
| 保全 | 設備台帳、保全計画、保全指図 | 予防/事後保全 |

### A2. 業種バーティカルが汎用コアに追加するもの

- **ホテル（PMS）**: 予約（個人/法人/団体）、部屋在庫と客室タイプ、レートプラン、フォリオ（宿泊者勘定への追加チャージ・分割）、ナイトオーディット（日次締めと営業日繰り越し）、ハウスキーピング状態、チャネルマネージャーによるOTA/GDS連携、稼働率・ADR・RevPAR（https://www.roommaster.com/blog/functions-of-property-management-system）【二次情報】。日本では「サイトコントローラー」（TL-リンカーン、ねっぱん！、手間いらず等）が楽天トラベル・じゃらん・Booking.com 等の在庫/料金/予約を同期し、PMSと併用するのが一般的（https://checkinn.jp/blog/sitecontroller/）【二次情報】。加えて旅館業法の宿泊者名簿（氏名・住所・連絡先・宿泊日、外国人は国籍・旅券番号、3年保存。令和5年12月13日施行の改正で「職業」が削除され「連絡先」が追加）（https://www.city.osaka.lg.jp/kenko/page/0000006422.html）【確認済】、宿泊税（東京都は1人1泊1万円以上1.5万円未満100円、1.5万円以上200円、ホテルが特別徴収義務者として月次申告納付。2027年度以降の制度変更を検討中）（https://www.tax.metro.tokyo.lg.jp/shitsumon/leisure/concern_a01）【確認済】、入湯税のモデル化が必要。
- **飲食店**: テーブル/フロア管理、キッチン伝票、レシピ・原価、シフト。日本固有では店内飲食10%とテイクアウト/出前8%の税率判定を提供時点で行う要件（https://www.yayoi-kk.co.jp/kaikei/oyakudachi/gaishoku-shohizei/）【二次情報】、および適格簡易請求書。
- **小売**: POS、適格簡易請求書形式のレシート、総額表示、ポイント・電子マネー、店舗別在庫、EC統合【確認済 総額表示: https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6902.htm】。
- **卸売/流通**: 価格表階層・数量割引、締め請求（合計請求書）、ロット/期限管理、EDI、ピッキング/配送計画【推測】。
- **製造**: 上記コア製造に加え、原価計算（標準/実際）、外注加工、トレーサビリティ、設備保全【推測】。
- **建設**: 工事台帳（工事ごとの原価集計）、建設業特有の勘定科目（完成工事高・完成工事原価・未成工事支出金・完成工事未収入金・工事未払金・未成工事受入金）、工事完成基準/工事進行基準、工事損失引当金・完成工事補償引当金（https://www.yayoi-kk.co.jp/kaikei/oyakudachi/point-industry-08/）【二次情報】、下請管理、出来高請求【推測】。
- **プロフェッショナルサービス**: タイムシート、案件別収支、請求（時間/固定/マイルストーン）、個人への報酬支払時の源泉徴収【推測】。
- **医療クリニック**: 診療録/電子カルテ、レセプトのオンライン請求を月次で審査支払機関へ提出、レセコン連携（https://digikar.m3.com/articles/rece-com/article28）【二次情報】。社会保険診療は消費税非課税、自由診療は課税（https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6201.htm）【確認済】。汎用ERPでの実装は極めて困難でスコープ外推奨【推測】。
- **教育**: 学籍、講座/クラス、授業料請求、成績、出欠。学校教育法上の学校の授業料は非課税（同上6201）【確認済】。
- **非営利**: 会費・寄付・助成金の受入、事業別区分、活動計算書・貸借対照表（NPO法人会計基準）（https://biz.moneyforward.com/accounting/basic/75612/）【二次情報】。
- **不動産/賃貸管理**: 物件・部屋、賃貸借契約（敷金・礼金・更新）、家賃入金消込（バーチャル口座）、滞納管理、オーナー送金精算・収支報告、退去精算、修繕履歴、ポータル連携（https://it-trend.jp/rental_management_software/article/615-6955）【二次情報】。住宅の貸付は非課税、土地の譲渡・貸付も非課税（6201）【確認済】。
- **物流/運送**: 荷主、配車/運行、運賃計算、送り状、WMS連携【推測】。2026年1月施行の取適法で「特定運送委託」が規制対象に加わった（https://www.jftc.go.jp/file/toriteki_leaflet.pdf）【確認済】。

### A3. 横断的関心事

マスタデータ（取引先＝顧客/仕入先/従業員の統合、品目、UoM換算、価格表/通貨）、採番（文書種別・年度別連番、和暦年度対応）、承認ワークフロー、添付/文書管理（電帳法上の証憑保存と連動）、通知、監査証跡（訂正削除履歴は電帳法「優良」要件と直結）、レポーティング、インポート/エクスポート（CSV/全銀固定長/Peppol XML）、統合（銀行明細取込、ZEDIによるEDI情報付き振込での売掛消込（https://www.zenginkyo.or.jp/abstract/efforts/smooth/xml/）【確認済】、Peppolアクセスポイント、郵便番号API、適格請求書発行事業者公表サイトWeb-API/全件・差分ダウンロード（https://www.invoice-kohyo.nta.go.jp/about-toroku/index.html）【確認済】）。

## Part B — 日本固有要件（2026-09-10時点）

### B1. 適格請求書等保存方式（インボイス制度）

- **記載事項**（6項目）: ①発行者の氏名/名称と登録番号、②取引年月日、③取引内容（軽減税率対象品目である旨）、④税率ごとに区分して合計した税込/税抜対価と適用税率、⑤税率ごとに区分した消費税額等、⑥交付を受ける事業者の氏名/名称（https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6625.htm）【確認済】。登録番号は「T＋13桁」（法人は法人番号、個人等は新規付番）（https://www.invoice-kohyo.nta.go.jp/about-toroku/index.html）【確認済】。
- **端数処理**: 「一の適格請求書につき、税率ごとに1回」。商品明細ごとに端数処理して合算する方式は不可。切上げ/切捨て/四捨五入は任意（https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/57.pdf）【確認済】。納品書＋合計請求書のように複数書類で要件を満たす場合、書類間の関連が明確なら、消費税額の端数処理は納品書単位で税率ごとに1回行い、請求書は合算でよい（https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/67.pdf）【確認済】。→ システムは「税額を丸める単位（納品書/請求書）」を設定可能にする必要がある【推測】。
- **適格簡易請求書**: 小売業・飲食店業・写真業・旅行業・タクシー業・駐車場業およびこれらに準ずる不特定多数向け事業（宿泊、航空、レンタカー等）が交付可能（https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/24-2.pdf）【確認済】。交付先氏名が不要、「税率ごとの消費税額等」または「適用税率」のいずれか一方でよい（https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/58.pdf）【確認済】。
- **免税事業者等からの仕入れの経過措置（令和8年度改正で見直し）**: 80%（〜令和8年9月30日）→ **70%（令和8年10月1日〜令和10年9月30日）→ 50%（〜令和12年9月30日）→ 30%（〜令和13年9月30日）→ 廃止**。さらに一の免税事業者等からの課税仕入れ合計（税込）が年/事業年度で1億円を超える部分は適用不可（https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice-review/index.htm、Q&A令和8年4月改訂 https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/113.pdf）【確認済】。帳簿には経過措置適用の旨の記載が必要（同Q&A113）【確認済】。→ 仕入先ごとの「登録有無」、仕入日で控除率を切り替えるテーブル、仕入先別年間累計の上限判定が必要【推測】。
- **2割特例**: 令和8年9月30日を含む課税期間までで終了（https://and-tools.net/guides/invoice-keika-sochi/）【二次情報】。後継として**3割特例**（個人事業者のみ、基準期間課税売上高1,000万円以下、登録事業者、令和9年分・令和10年分の申告で納付税額を売上税額の3割とできる）が令和8年度改正特集に掲載（https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice-review/index.htm）【確認済】。
- **少額特例**: 基準期間課税売上高1億円以下等の事業者は税込1万円未満の課税仕入れでインボイス保存不要、期間は令和5年10月1日〜**令和11年9月30日**（https://www.nta.go.jp/publication/pamph/shohi/kaisei/202304/02.htm）【確認済】。

### B2. 電子帳簿保存法

区分は①電子帳簿等保存（任意）、②スキャナ保存（任意）、③電子取引データ保存（2024年1月以降義務）（https://www.cloudsign.jp/media/electronic-books-maintenance-act/）【二次情報】。国税庁一問一答（電子取引関係、令和7年6月）による電子取引データの保存要件（https://www.nta.go.jp/law/joho-zeikaishaku/sonota/jirei/pdf/03-6.pdf）【確認済】:
- **真実性**: タイムスタンプ付与／訂正削除の履歴が残る・できないシステム／訂正削除防止の事務処理規程、のいずれか。
- **可視性**: PC・ディスプレイ・プリンタ備付け、自社開発時はシステム概要書、**検索要件＝取引年月日・取引金額・取引先**で検索でき、日付/金額は範囲指定、二以上の項目の組合せ検索が可能なこと。
- **緩和**: 基準期間売上高5,000万円以下、または日付・取引先ごとに整理した出力書面を提示でき、ダウンロードの求めに応じられる場合は検索機能不要。保存期間は原則7年。
- **優良な電子帳簿**: 訂正削除履歴、帳簿間の相互関連性、日付・金額・摘要等での検索機能を満たすと過少申告加算税5%軽減（https://www.nta.go.jp/law/joho-zeikaishaku/sonota/jirei/05.htm）【確認済】。
- **JIIMA認証**: 電子帳簿ソフト、電子書類ソフト、スキャナ保存ソフト、電子取引ソフト、2025年度改正で新設の「デジタルシームレスソフト」の5区分（https://www.jiima.or.jp/certification/）【確認済】。
→ 設計上は「仕訳・証憑の訂正削除ログの不変性」「証憑への取引日/金額/取引先メタデータ付与と範囲検索」「帳簿⇔証憑⇔仕訳の相互リンク」がコア要件【推測】。

### B3. 消費税

- **税率**: 標準10%、軽減8%（飲食料品〔酒類・外食除く〕、定期購読新聞）。外食は飲食設備＋サービス提供の有無で提供時点判定、出前・宅配は8%、ケータリングは10%（https://www.yayoi-kk.co.jp/kaikei/oyakudachi/gaishoku-shohizei/）【二次情報】。
- **重要（未確定事項）**: 政府は2026年8月5日に「2027年4月1日から2年間、軽減税率対象の飲食料品を1%」とする方針を閣議決定し、秋の臨時国会での法案成立を目指す。成立後は1%・8%（新聞）・10%の三税率が併存する見込み（https://hojyokin-portal.jp/columns/food_tax、https://stores.fun/magazine/articles/food-tax-reduction-2027-guide、https://www.nikkei.com/article/DGXZQOUA011O20R00C26A8000000/）【二次情報】。2026年9月10日時点で法律は未成立【二次情報】。→ 税率マスタは「税率×適用期間」で任意個数を持てる設計が必須【推測】。
- **税込/税抜経理**: 課税事業者はどちらも選択可能、免税事業者は税込経理が強制（https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6375.htm）【確認済】。
- **課税区分**: 課税/非課税（土地、有価証券、利子・保険料、切手印紙、行政手数料、社会保険医療、介護、学校教育、住宅の貸付など）/免税（輸出等）/不課税（https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6201.htm、https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6209.htm）【確認済】。仕入側は課税売上対応/非課税売上対応/共通対応の用途区分（個別対応方式・一括比例配分方式）が必要（https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6401.htm）【確認済】。
- **税額計算**: 売上税額は割戻し（原則）/積上げ（特例）、仕入税額は請求書等積上げ（原則）/帳簿積上げ/割戻し（特例）。売上を積上げにしたら仕入も積上げ必須（https://www.y-itax.com/%E6%B6%88%E8%B2%BB%E7%A8%8E/18043/220302-shiire-zeigaku-keisan）【二次情報】。→ 明細ごとの消費税額を「仕訳単位で保持」し、集計方式を切替可能にする【推測】。
- **中間申告**: 直前課税期間の確定消費税額48万円以下は不要、48万円超〜400万円以下は年1回、400万円超〜4,800万円以下は年3回、4,800万円超は年11回（https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6609.htm）【確認済】。
- **総額表示**: 消費者向け価格表示は税込表示義務（https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6902.htm）【確認済】。

### B4. 会計

- **勘定科目体系**: 法定の統一科目表はなく、中小企業は「中小企業の会計に関する基本要領（中小会計要領）」を拠り所とする（https://www.chusho.meti.go.jp/zaimu/youryou/about/index.html）【確認済】。実務上の標準科目は会計ソフトのテンプレートが事実上の標準（https://www.yayoi-kk.co.jp/kaikei/oyakudachi/bs-kanjokamoku/）【二次情報】。上場・大会社は「収益認識に関する会計基準」（企業会計基準第29号）（https://www.asb-j.jp/jp/accounting_standards_system/details.html?topics_id=13）【確認済：基準の存在】。
- **決算期**: 事業年度は任意。3月決算は全法人の19.0%、資本金1億円以上では54.3%（https://www.nli-research.co.jp/report/detail/id=61217?pno=2&site=nli）【二次情報】。→ 会計期間は「任意の開始月＋期の途中変更」を前提【推測】。
- **減価償却**: 法人税法上、機械装置等の法定償却方法は定率法で、定額法を選ぶには届出が必要（https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5409.htm）【確認済】。建物は定額法、平成28年4月1日以後取得の建物附属設備・構築物も定額法（https://tax-co.grancers.co.jp/archives/2569）【二次情報】。少額減価償却資産等の特例は期限付きで延長を繰り返すため、パラメータ化が必要【推測】。
- **源泉徴収（報酬・料金）**: 所得税法204条の8区分を個人に支払う際、10.21%（100万円超部分は20.42%）を源泉徴収し翌月10日納付、支払調書提出。請求書で消費税が区分されていれば税抜額を対象にできる（https://keiri-walker.com/shiharai-hoshu-ryokin/）【二次情報】。

### B5. JP Peppol / デジタルインボイス（JP PINT）

デジタル庁が日本のPeppol Authorityとして JP PINT を管理。最新版は **Ver.1.1.3（2026年6月8日公表）**で、Peppol BIS Standard Invoice JP PINT、JP BIS Self Billing Invoice、JP BIS Invoice for Non-tax Registered Businesses の3仕様（https://www.digital.go.jp/policies/electronic_invoice、https://www.digital.go.jp/en/policies/electronic_invoice）【確認済】。義務化はされておらず、4コーナーモデルでアクセスポイント経由の送受信【確認済】。→ 自前でアクセスポイントを持つより、認定プロバイダーAPIへの出力/取込アダプタとしてスコープ化するのが現実的【推測】。

### B6. 人事給与（モデル化すべきもの）

- 社会保険: 健康保険（50等級）・厚生年金（32等級）の標準報酬月額、資格取得時決定／定時決定／随時改定、介護保険は40〜64歳、労使折半、賞与は標準賞与額（https://www.yayoi-kk.co.jp/kyuyo/oyakudachi/shakaihoken-02/）【二次情報】。
- 所得税: 源泉徴収税額表（月額表・賞与、甲欄/乙欄）に基づく月次源泉徴収と年末調整。令和8年度改正は令和8年12月1日施行で令和8年分の年末調整から反映、改正後税額表は令和9年1月以後適用（https://www.nta.go.jp/users/gensen/2026kiso/index.htm）【確認済】。
- 雇用保険・労災、住民税特別徴収、給与支払報告書・法定調書【推測：一般知識】。
- 設計含意: 料率・等級表・税額表・控除額は「年度付きパラメータテーブル」として外出しし、ロジックは制度改正のたびに差し替え可能にする【推測】。

### B7. ERPが表現すべき日本の商習慣

- **締め日・支払サイト**: 「月末締め翌月末払い」等、取引先ごとに締め日＋支払月＋支払日を持つ（https://zeimu.cloud/kaisetsu/seikyu-invoice/shiharai-site）【二次情報】。下請法（2026年1月1日から中小受託取引適正化法＝取適法）は受領日から60日以内の支払期日を義務付け、**手形払い禁止**、従業員数基準の追加、特定運送委託の対象化（https://www.jftc.go.jp/file/toriteki_leaflet.pdf）【確認済】。
- **合計請求書**: 納品書（都度）＋月次合計請求書の組合せはインボイス制度上も認められ、端数処理は納品書単位【確認済】。→ 「納品書＝税額確定単位、請求書＝集計・入金消込単位」というモデル【推測】。
- **手形・でんさい**: 全銀協は電子交換所での手形・小切手の交換を**2027年3月31日で終了**（https://www.zenginkyo.or.jp/news/2026/n061802/）【確認済】。→ 新規システムでは受取手形/支払手形は最小限とし、でんさいを主に置く【推測】。
- **銀行振込・全銀フォーマット**: 総合振込は120バイト固定長（ヘッダ/データ/トレーラ/エンド）、種別コード21、委託者コード10桁、銀行4桁・支店3桁、預金種目1桁、口座7桁、受取人名は半角カナ30桁、金額10桁（https://www.gunmabank.co.jp/hojin/biznb/service/pdf/z_format1.pdf）【確認済】。ZEDI（XML）はEDI情報を付加でき売掛消込を自動化（https://www.zenginkyo.or.jp/abstract/efforts/smooth/xml/）【確認済】。→ 取引先マスタに「半角カナ名義」を必須項目として持ち、全角→半角カナ正規化が必要【推測】。
- **郵便番号・住所**: 日本郵便の郵便番号データは7桁、月次差分更新（https://www.post.japanpost.jp/service/search/zipcode/download/utf-readme.html）【確認済】。無料の郵便番号・デジタルアドレスAPI（https://lp-api.da.pf.japanpost.jp/）【確認済】。
- **和暦**: 令和は2019年5月1日開始、2026年＝令和8年。公的届出書類は原則和暦（https://taxlabor.com/wareki-seireki-hayami/）【二次情報】。→ 内部は西暦、表示/帳票で元号変換（元号テーブルは追加可能に）【推測】。
- **印鑑/電子署名**: 押印なしでも契約は有効、電子署名法3条により立会人型を含む電子署名も推定を受ける（https://www8.cao.go.jp/kisei-kaikaku/kisei/imprint/i_index.html）【確認済】。ただし請求書への角印画像は商慣習として依然求められることが多い（https://biz.moneyforward.com/invoice/basic/59372/）【二次情報】。

## スコープへの示唆（すべて【推測】）

**汎用コア（第1フェーズ）に含めるべきもの**
1. マスタ: 取引先（登録番号・免税/課税区分・締め支払条件・半角カナ名義・振込先）、品目（税区分・軽減税率フラグ・UoM）、勘定科目（中小会計要領ベースのテンプレート＋自由編集）、税率マスタ（税率×期間で任意個数。2027年4月の「1%」を想定した設計検証を必須に）。
2. 会計: GL/AP/AR、税込/税抜経理の切替、課税区分・用途区分、税額の明細保持（積上げ/割戻し両対応）、任意決算期、中間申告用集計、固定資産（定額/定率、期中取得月割）。
3. 販売/購買/在庫: 見積→受注→納品書→合計請求書（端数処理単位設定）、発注→入荷→仕入請求（経過措置控除率テーブルと1億円上限）、ロット/シリアル、AVCO/FIFO/標準。
4. 帳票: 適格請求書・適格簡易請求書・適格返還請求書のレイアウト、総額表示、和暦表示。
5. 電帳法対応の基盤: 証憑ストレージ（日付/金額/取引先メタデータ、範囲・複合検索）、訂正削除ログの不変性、帳簿⇔証憑リンク。JIIMA認証取得は目標にせず「要件充足の設計」に留める。
6. 出力/連携: 全銀固定長（総合振込）、CSV入出力、郵便番号API、公表サイトWeb-API、Peppol認定プロバイダー向けJP PINT出力（アクセスポイント自前運用は除外）。
7. 横断: 採番、承認、監査、通知、ロール権限。

**バーティカルパック（後続フェーズ）に分離すべきもの**
- ホテルPMS、飲食、小売POS、建設、不動産賃貸、製造拡張、サブスクリプション、フィールドサービス、プロジェクト請求。
- 人事給与は「勤怠・従業員マスタ」のみコアに入れ、社会保険・所得税・年末調整の計算は年度パラメータ駆動の別パックとする。

**スコープ外（連携のみ）を推奨**: 医療レセプト、教育の学籍管理、公益法人・学校法人会計、手形の交換所業務。

## 調査上の注記
Odoo公式ドキュメントの財務ローカライゼーション一覧（18.0）に日本は含まれておらず（https://www.odoo.com/documentation/18.0/applications/finance/fiscal_localizations.html）【確認済】、日本要件は自前実装が前提となる。物流TMS機能・ASCM用語定義・住民税特別徴収の一次情報は未取得で、該当箇所は【推測】。

## Sources
- https://www.odoo.com/page/all-apps
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/inventory_valuation/cheat_sheet.html
- https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/manufacturing.html
- https://frappe.io/erpnext/modules
- https://discuss.frappe.io/t/separating-agriculture-hospitality-non-profit-domains-from-erpnext/84547/4
- https://www.erpresearch.com/en-us/sap-s/4-hana-modules
- https://www.roommaster.com/blog/functions-of-property-management-system
- https://checkinn.jp/blog/sitecontroller/
- https://www.city.osaka.lg.jp/kenko/page/0000006422.html
- https://www.tax.metro.tokyo.lg.jp/shitsumon/leisure/concern_a01
- https://www.yayoi-kk.co.jp/kaikei/oyakudachi/gaishoku-shohizei/
- https://www.yayoi-kk.co.jp/kaikei/oyakudachi/point-industry-08/
- https://it-trend.jp/rental_management_software/article/615-6955
- https://digikar.m3.com/articles/rece-com/article28
- https://biz.moneyforward.com/accounting/basic/75612/
- https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6625.htm
- https://www.invoice-kohyo.nta.go.jp/about-toroku/index.html
- https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/57.pdf
- https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/67.pdf
- https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/58.pdf
- https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/24-2.pdf
- https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/invoice-review/index.htm
- https://www.nta.go.jp/taxes/shiraberu/zeimokubetsu/shohi/keigenzeiritsu/pdf/qa/113.pdf
- https://www.yamada-partners.jp/reform/r8/c01-2-revision-of-transitional-tax-credit-measures-for-taxable-purchases-from-tax-exempt-businesses
- https://and-tools.net/guides/invoice-keika-sochi/
- https://www.nta.go.jp/publication/pamph/shohi/kaisei/202304/02.htm
- https://www.nta.go.jp/law/joho-zeikaishaku/sonota/jirei/pdf/03-6.pdf
- https://www.cloudsign.jp/media/electronic-books-maintenance-act/
- https://www.nta.go.jp/law/joho-zeikaishaku/sonota/jirei/05.htm
- https://www.jiima.or.jp/certification/
- https://hojyokin-portal.jp/columns/food_tax
- https://stores.fun/magazine/articles/food-tax-reduction-2027-guide
- https://www.nikkei.com/article/DGXZQOUA011O20R00C26A8000000/
- https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6375.htm
- https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6201.htm
- https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6209.htm
- https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6401.htm
- https://www.y-itax.com/%E6%B6%88%E8%B2%BB%E7%A8%8E/18043/220302-shiire-zeigaku-keisan
- https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6609.htm
- https://www.nta.go.jp/taxes/shiraberu/taxanswer/shohi/6902.htm
- https://www.chusho.meti.go.jp/zaimu/youryou/about/index.html
- https://www.yayoi-kk.co.jp/kaikei/oyakudachi/bs-kanjokamoku/
- https://www.asb-j.jp/jp/accounting_standards_system/details.html?topics_id=13
- https://www.nli-research.co.jp/report/detail/id=61217?pno=2&site=nli
- https://www.nta.go.jp/taxes/shiraberu/taxanswer/hojin/5409.htm
- https://tax-co.grancers.co.jp/archives/2569
- https://keiri-walker.com/shiharai-hoshu-ryokin/
- https://www.digital.go.jp/policies/electronic_invoice
- https://www.digital.go.jp/en/policies/electronic_invoice
- https://www.yayoi-kk.co.jp/kyuyo/oyakudachi/shakaihoken-02/
- https://www.nta.go.jp/users/gensen/2026kiso/index.htm
- https://biz.moneyforward.com/payroll/basic/94813/
- https://zeimu.cloud/kaisetsu/seikyu-invoice/shiharai-site
- https://www.jftc.go.jp/file/toriteki_leaflet.pdf
- https://www.ht-tax.or.jp/topics/toritekiho-2026/
- https://www.zenginkyo.or.jp/news/2026/n061802/
- https://www.zenginkyo.or.jp/news/2025/n032601/
- https://www.gunmabank.co.jp/hojin/biznb/service/pdf/z_format1.pdf
- https://www.zenginkyo.or.jp/abstract/efforts/smooth/xml/
- https://www.post.japanpost.jp/service/search/zipcode/download/utf-readme.html
- https://lp-api.da.pf.japanpost.jp/
- https://taxlabor.com/wareki-seireki-hayami/
- https://www8.cao.go.jp/kisei-kaikaku/kisei/imprint/i_index.html
- https://biz.moneyforward.com/invoice/basic/59372/
