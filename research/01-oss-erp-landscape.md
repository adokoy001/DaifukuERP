# 調査ノート01: オープンソースERPの現状とアーキテクチャ（2025–2026）

調査日: 2026-09-10 ／ 調査者: Claude（リサーチ用サブエージェント）／ 統合: Claude（claude-fable-5-1）
凡例：【確認済】＝公式サイト/GitHub/公式Docs等の一次情報、【二次情報】＝ブログ・比較記事・Wikipedia等、【推測】＝推論。

## 0. 調査対象と全体像

| 製品 | ライセンス | 最新版 / リリース周期 | 言語・DB・フロント | 規模の目安 |
|---|---|---|---|---|
| Odoo Community | LGPL-3（manifestのデフォルト）。Enterpriseは OEEL-1【確認済】(https://raw.githubusercontent.com/odoo/documentation/19.0/content/developer/reference/backend/module.rst) | 19.0（2025年9〜10月）、毎年10月に1メジャー、直近3版サポート【二次情報】(https://en.wikipedia.org/wiki/Odoo, https://ecosire.com/blog/latest-odoo-version) | Python 52% / JS 44%、PostgreSQL、Owl(JS)【確認済】(https://github.com/odoo/odoo) | 約198万LOC、貢献者4,144名【二次情報】(https://openhub.net/p/odoo)、20万コミット・52.8k★【確認済】 |
| ERPNext / Frappe | ERPNext GPL-3.0、Frappe Framework MIT【確認済】(https://github.com/frappe/erpnext, https://github.com/frappe/frappe) | v16 正式版 2026-01-12（β 2025-11-15）【確認済】(https://discuss.frappe.io/t/erpnext-hrms-frappe-framework-v16-release-dates/156349) | Python、MariaDB（Postgresは二級）、Redis、Node/Socket.IO、JS(jQuery系Desk)【確認済/二次】 | 38.6k★・6.1万コミット【確認済】、OpenHubは210万LOC（翻訳等含む可能性あり）【二次情報】(https://openhub.net/p/erpnext) |
| Dolibarr | GPL-3.0+【確認済】(https://github.com/Dolibarr/dolibarr) | 24.0.0（2026-08-20）、23.0（2026-02）、22.0（2025-07）…約半年周期【確認済】(https://wiki.dolibarr.org/index.php/List_of_releases,_change_log_and_compatibilities) | PHP 92%、MySQL/MariaDB/PostgreSQL、PHP 7.2–8.5【確認済】 | 7.4k★【確認済】 |
| Tryton | GPL-3.0-or-later【二次情報】(https://en.wikipedia.org/wiki/Tryton) | 7.6（2025-04-29）、7.8（2025-12-16）、次期8.2は2026-10-05予定。半年ごと、5シリーズごとにLTS(5年)【確認済】(https://discuss.tryton.org/t/tryton-release-7-6/8532, https://www.tryton.org/) | Python、PostgreSQL（SQLiteはテスト）、GTKクライアント＋sao(Web)【確認済】 | 約53万LOC（Py52%/XML28%）【二次情報】(https://openhub.net/p/tryton) |
| iDempiere | GPLv2【二次情報】(https://en.wikipedia.org/wiki/IDempiere) | 13 "Orion" LTS（2026-03）、ほぼ毎年12月【確認済】(https://idempiere.org/blog/2026/03/12/idempiere-13-orion/, https://idempiere.org/releases/) | Java、OSGi(Equinox)、ZK、Jetty、PostgreSQL≥14/Oracle≥23ai【二次情報】 | 約224万LOC（SQL55%/Java39%）【二次情報】(https://openhub.net/p/idempiere) |
| Axelor Open Suite | AGPL v3【確認済】(https://github.com/axelor/axelor-open-platform) | Suite v9.1.x/9.0.x/8.5.x 並行保守（2026-07）、Platform v8.2.1（2026-06）【確認済】(https://github.com/axelor/axelor-open-suite/releases) | Java 21、Guice、JPA/Hibernate、PostgreSQL、TypeScript/React【確認済/二次】(https://deepwiki.com/axelor/axelor-open-suite) | Platform 1.4万コミット【確認済】 |
| metasfresh | GPL（v2→v3移行方針）【確認済/二次】(https://github.com/metasfresh/metasfresh, https://en.wikipedia.org/wiki/Metasfresh) | GitHub Releasesは5.175（2023-06）で停止。従来は毎週金曜リリース【確認済】 | Java 83%/PLpgSQL 9%、Spring Boot、PostgreSQL、React/Redux【確認済】 | 2.3k★【確認済】 |
| Apache OFBiz | Apache-2.0【確認済】(https://ofbiz.apache.org/download.html) | 24.09.07（2026-06）、24.09系は2024-09からfeature-freeze、最大3ブランチ保守【確認済】 | Java 17、Groovy、FreeMarker、XML、Gradle、Tomcat【二次情報】(https://deepwiki.com/apache/ofbiz-framework) | — |

## 1. 各製品のアーキテクチャ機構

### Odoo — ORM＋アドオン＋XMLビュー継承
- **モジュール宣言**：`__manifest__.py` に `name/version/depends/data/demo/installable/auto_install/license/assets` を辞書で記述。`depends` 順にロードされ、`data` のXML/CSVがインストール時に投入される【確認済】(module.rst)。
- **モデル**：`Model`（永続、`_auto=True` でテーブル自動生成）、`TransientModel`（ウィザード用）、`AbstractModel`。継承は3種：`_inherit`+`_name`（古典継承）、`_inherit` のみ（**同一テーブルをin-place拡張**、他モジュールのモデル拡張の主手段）、`_inherits`（委譲/合成）。フィールドは `compute`+`@api.depends`、`related`、`store` で制御。`name/active/state/parent_id/company_id` は予約名で特別動作【確認済】(orm.rst)。レジストリがDBごとにモデル名→動的合成クラスを管理【二次情報】(https://deepwiki.com/odoo/odoo)。
- **ビュー**：`ir.ui.view` レコードの `arch` にXML。form/list/kanban/graph/pivot/calendar等、XPathで継承・差し替え【確認済】(https://www.odoo.com/documentation/19.0/developer/reference/user_interface/view_architectures.html)。
- **権限**：`ir.model.access` CSV（モデル×グループ×CRUD、加算的）、`ir.rule`（domain式のレコードルール、グローバルはAND・グループはOR）、`res.groups`（`implied_ids`）、フィールドの `groups` 属性【確認済】(security.rst)。
- **ワークフロー**：v11でワークフローエンジン削除【二次情報】(https://www.odoo.com/forum/help-1/workflows-in-odoo-11-125992)。以後は `state` フィールド＋メソッド＋自動アクションで代替【推測】。
- **レポート**：`ir.actions.report`＋QWebテンプレート、`report.paperformat`、wkhtmltopdfでPDF化【確認済】(reports.rst)。
- **ローカライズ構造**：`l10n_XX` モジュールが `account` に依存し、`models/template_xx.py` の `_get_xx_template_data/_get_xx_res_company/_get_xx_account_tax` と `data/template/account.account-xx.csv` 等（勘定科目・税・税グループ・fiscal position）でチャートテンプレートを定義。会社の国に応じて自動インストール。財務諸表は Enterprise 側の `l10n_XX_reports`【確認済】(https://raw.githubusercontent.com/odoo/documentation/19.0/content/developer/howtos/accounting_localization.rst)。
- **機能領域**：CRM/EC/会計/在庫/プロジェクト/HR/製造/ドキュメント等、約20コアアプリ【二次情報】(Wikipedia)。Enterprise限定：Payroll、Amazon連携、高度製造（Shopfloor/PLM/Quality）、Field Service、Planning、Helpdesk、Documents/Spreadsheet、Sign、Marketing Automation、Studio、モバイルアプリ、アップグレードサービス【確認済】(https://www.odoo.com/page/editions)。Communityは「Invoicing」止まりで本格会計（財務諸表・銀行照合・固定資産・予算）はEnterprise【二次情報】(https://www.odoo.com/forum/help-1/accounting-community-vs-enterprise-271286)。19.0では Equity/ESG アプリ、AI Agents、自然言語→domain検索、40以上の業種パッケージ追加【確認済】(https://www.odoo.com/odoo-19-release-notes)。
- **批判点**：Community/Enterprise分断、カスタムコード起因のアップグレード負債（6種の技術的負債）【二次情報】(https://novobi.com/6-types-of-odoo-technical-debt-and-how-to-avoid-them/)。マルチテナントは「DB per tenant + dbfilter」で、スキーマレベル分離なし、ワーカー当たり150–200MB、全テナント同一版ロック【二次情報】(https://oec.sh/blog/odoo-multi-tenant-architecture)。

### ERPNext / Frappe — DocTypeメタデータ駆動
- **DocType**：モデル定義がJSON（fields, permissions, naming）で、`tab<DocType>` テーブルを自動生成。`.json/.py/.js` の3ファイル。Child Table、Single、Virtual DocType【確認済】(https://docs.frappe.io/framework/user/en/basics/doctypes)。階層は App→Module→DocType→DocField→Property【二次情報】(https://gavv.in/blog/how-does-frappe-work/)。
- **カスタマイズの分離**：Customize Form が Custom Field / Property Setter として差分保存し、コアDocTypeを汚さないためアップグレード耐性がある。Client/Server Script も同様【確認済】(https://docs.frappe.io/framework/user/en/basics/doctypes/customize)。
- **権限**：Role × DocPerm（read/write/create/delete/submit/cancel/amend/report/export/import/share/print/email）、`permlevel` によるフィールド群単位の制御、User Permission（リンク値によるレコード制限）、Share【確認済】(https://docs.frappe.io/framework/user/en/basics/users-and-permissions)。
- **フック**：`hooks.py` の `doc_events / override_doctype_class / scheduler_events / fixtures / regional_overrides`。`@erpnext.allow_regional` で装飾された関数を `get_region()` の国コードで差し替える【二次情報】(https://deepwiki.com/frappe/erpnext/12.2-hooks-and-event-system)。イタリア対応は `erpnext/regional/italy/` に `setup.py(make_custom_fields)`、専用DocType、Print Formatを置く構造【確認済】(https://github.com/frappe/erpnext/pull/19335/files)。
- **マルチテナント**：Bench配下に複数Site（DB・設定・ファイル分離）、`X-Frappe-Site-Name` でルーティング、リクエストごと1トランザクション【二次情報】(gavv.in)。
- **機能領域**：Accounting/Procurement/Sales/CRM/Stock/Manufacturing/Projects/Assets/POS/Quality/Support/HR&Payroll＋No-Code Builder（v16サイト表記）【確認済】(https://frappe.io/erpnext/version-16)。Healthcare/Education/Agriculture/Non-Profit は別アプリ化【二次情報】(Wikipedia)。
- **v16**：典型リクエストで約2倍高速化（Redisアクセス削減、Cライブラリ、テンプレートキャッシュ、threaded worker）【確認済】(Frappeフォーラム)。
- **批判点**（技術的に踏み込んだ批評）：文字列連結SQLの遺産（v16でpypika QBを導入もコアに約694箇所残存）、N+1にeager loadingなし、子テーブルのネスト不可、メール主キー、MariaDBロックイン、5層の権限機構と default-allow、`ignore_permissions=True` の散在、WSGI専用、`bench migrate` にロールバックなし、jQuery時代のDesk UI、型ヒント欠如、メジャーアップグレードの脆さ、Redis単一障害点【二次情報】(https://dipankar-das.com/blog/frappe-framework-technical-autopsy/)。

### Dolibarr — PHPモジュール記述子＋Trigger/Hook
- `core/modules/modXXX.class.php` が `DolibarrModules` を継承し、`$this->rights`（権限ID・r/w/d・action/subaction）、`$this->menu`（top/left）、`$this->boxes`、`_load_tables('/sql/')` を宣言。イベントは `core/triggers`、拡張点は `core/hooks`。外部モジュールは `/custom/` に同構造で配置。v12以降 ModuleBuilder で雛形生成【確認済】(https://wiki.dolibarr.org/index.php/Module_development)。
- 機能領域：取引先/商品/販売/購買/会計/HR/プロジェクト/チケット/EDM/POS/製造計画/会員/寄付/契約、MultiCompanyモジュール【確認済/二次】(GitHub, Wikipedia)。
- 批判点：SQL・テンプレート・ロジック混在、テンプレートエンジン不在、仏語命名、Composer/Symfony非採用、ルーティング不在等が Issue で指摘【確認済】(https://github.com/Dolibarr/dolibarr/issues/10054)。CVEはXSS が支配的、SQLi・RCE も存在【二次情報】(https://stack.watch/product/dolibarr/dolibarr/)。日本語UIは機械翻訳的で「微妙な日本語」を直す記事が存在【二次情報】(https://note.com/kaname1340cc/n/nd0a12f5cfc42)。

### Tryton — Pool による同名クラス合成、`ir` メタモデル
- モジュールは `tryton.cfg`（`depends/extras_depend/xml/[register]`）と `__init__.py` の `register()` で Pool にクラス登録。同じ `__name__` を持つクラスを複数モジュールから**Poolがマージ**して1モデルにする【確認済】(https://docs.tryton.org/latest/server/topics/modules/index.html, .../models/index.html)。モデルは `ModelSQL/ModelView/ModelStorage/Workflow` ミックスイン。XMLで `ir.ui.view/ir.action/res.group/ir.model.access/ir.rule/ir.model.button` を投入。
- 権限は5層：`ir.model.access`（未定義なら全許可）、`ir.model.field.access`、action の groups、`ir.model.button`（複数ユーザー承認ルール可）、`ir.rule`（domain）【確認済】(https://docs.tryton.org/latest/server/topics/access_rights.html)。
- ローカライズ：`account_<cc>` モジュールが `account.account.template / account.account.type.template / account.tax.template / account.tax.code.template / account.tax.rule.template` をXMLで定義（be/es/fr/de_skr03/eu 等）【確認済】(https://discuss.tryton.org/t/how-to-create-your-country-localization-module-for-accounts/2758)。
- 規模：公式約150＋コミュニティ約50モジュール【二次情報】(https://ecosire.com/blog/odoo-vs-tryton-comparison-2026)。7.8で Peppol/UBL、Sale Rental、Chat、通知を追加【確認済】。
- 強み/批判：Decimal厳密、マイグレーション同梱、単一ライセンスの一方、コミュニティ小・UI地味・機能幅狭・CRM/マーケ弱い【二次情報】(https://discuss.tryton.org/t/advantages-of-tryton-over-odoo/4937, ecosire)。

### iDempiere — Application Dictionary（Active Data Dictionary）
- `AD_Table/AD_Column` を辞書に登録し「Synchronize Column」でDBテーブル生成、「Create Window, Tab and Field from Table」で `AD_Window/AD_Tab/AD_Field` のUIを自動生成、Tab Editorで配置、メニューも生成、Mandatory/UNIQUE制約を辞書で強制。「SQLもJavaも1行書かずに」機能追加可能【確認済】(https://wiki.idempiere.org/en/Application_Dictionary_-_Create_a_Custom_Table_and_Window)。拡張はOSGiプラグイン【二次情報】(Wikipedia)。
- 13 Orion（LTS）：会計ディメンション、ワークフロー担当者上書き、SSO複数プロバイダ、セッション指紋等【確認済】(idempiere.org)。
- 批判：Swing/ZK由来の古いUI、学習曲線、ドキュメント薄い【二次情報】(ecosire)。

### Axelor — XMLドメイン→JPAコード生成＋BPM/Studio
- `src/main/resources/domains/*.xml` の `<entity>` を `./gradlew generateCode` で JPA POJO＋Repository に生成。`views/*.xml` にform/grid、actionsをXML定義。サービスはGuiceでI/F→実装バインドし下流モジュールで上書き可能。Suiteは `axelor-base/account/sale/purchase/stock/crm/project/human-resource/production/supplychain` 等のGradleサブプロジェクト【確認済/二次】(https://docs.axelor.com/adk/5.4/tutorial/step3.html, deepwiki)。
- アプリ群：AI/BPM/BI/Connect(1,700+コネクタ)/Template、CRM/Sales/Marketing/Contracts、Accounting/Invoicing/Budget、Purchasing/Stock/Manufacturing/Quality、HR4種、Project/Portal/Support。業種：製造・流通・公共・サービス・コンサル・研修【確認済】(https://axelor.com/all-the-apps/)。

### metasfresh — ADempiere系をSpring Boot/Reactで再構築
- 2015年にADempiereからフォークし「アプリケーションとデータ層の分離」を掲げて大規模書き換え【二次情報】(Wikipedia)。REST API、RabbitMQ、Elasticsearch、Docker、Gherkin(BDD)テスト【確認済】(GitHub)。食品・卸に強く、GitHub Releasesは2023年で停止しSaaS（独DC）中心へ【確認済/推測】(https://metasfresh.com/en/)。

### Apache OFBiz — Entity Engine / Service Engine / Widget
- **コンポーネント**：各コンポーネントは `ofbiz-component.xml` を持ち、`applications/` と `plugins/` は配置場所のみ異なる【二次情報】(deepwiki)。
- **Entity Engine**：`entitymodel.xml` に `entity/field/prim-key/relation(one|one-nofk|many)/view-entity(member-entity, alias, view-link, group-by)`。`GenericDelegator` の `makeValue/create/store/findByAnd/findByCondition`、entity group によるデータソース抽象化、`fieldtype<db>.xml` でDB差異吸収【確認済】(https://cwiki.apache.org/confluence/display/OFBIZ/Entity+Engine+Guide)。
- **Service Engine**：`services.xml` に `name/engine(java|groovy|simple|entity-auto|route)/location/invoke/attribute(IN|OUT|INOUT)`、`use-transaction/require-new-transaction`、`auth`・`permission-service`、ECA（before-auth/in-validate/invoke/commit/return等のトリガー、sync/async）【確認済】(https://cwiki.apache.org/confluence/display/OFBIZ/Service+Engine+Guide)。
- 機能領域：会計/在庫/製造/受注(マルチチャネル・ドロップシップ)/HR/コンテンツ/プロジェクト/SFA/EC/POS【二次情報】(Wikipedia)。
- 批判：2023–2024年に認証バイパス→RCE（CVE-2023-51467 CVSS 9.8、CVE-2024-45195等）が実際に悪用【二次情報】(https://www.cybersecuritydive.com/news/apache-ofbiz-cve-exploitation/703788/)。コミュニティ自身が「all-or-nothingなモノリス」「UIがデータモデルの写し」「XMLアクションが画面/サービス/SECAに分散」「React等との統合困難」を指摘し、リポジトリ分割・Shiro採用・REST標準化を提案【確認済】(https://www.mail-archive.com/dev@ofbiz.apache.org/msg107988.html)。OOTB UIは「開発者向けであってエンドユーザー向けではない」と実装ベンダーも認める【二次情報】(https://www.hotwaxsystems.com/hotwax-blog/apache-ofbiz-a-modern-framework-hidden-behind-a-generic-ui)。

### 新興勢
- **Twenty（CRM）**：NestJS＋GraphQL Yoga＋TypeORM＋PostgreSQL、React 19。`objectMetadata/fieldMetadata` からDBスキーマとGraphQL型を動的生成、ワークスペース単位でテナント分離、`WorkspaceEntityManager` がobject/field/row権限を強制、SDKの `defineObject/defineField`【二次情報】(https://deepwiki.com/twentyhq/twenty)。ライセンスは AGPLv3＋SDK等はMIT＋`@license Enterprise` 表記ファイルは商用ライセンス【確認済】(https://github.com/twentyhq/twenty/blob/main/LICENSE)。56.2k★【確認済】。
- **Medusa 2.x（コマース）**：MIT、v2.15.5（2026-06）【確認済】(https://github.com/medusajs/medusa)。2.0（2024-10）で各コマースモジュールが**自前データモデルを持ちドメイン間FKを排除**、Module Links で関連付け、Workflows エンジンは補償トランザクション・長時間実行・human-in-the-loop対応、DMLでモデル定義【確認済】(https://medusajs.com/blog/v2-release)。
- **Open Mercato**：TypeScript/Next.js、MIT、MikroORM、Zod、MCP内蔵、AI変更の段階承認、フィールド暗号化。「既存ERPは2001–2010年設計にAIを後付けした"AI-decorated"」と批判し「AIコーディングエージェントが理解・拡張できる明示的規約」を重視【二次情報】(https://www.openmercato.com/blog-posts/open-source-erp-alternatives)。
- **ERPClaw**：GPLv3、Python 23万行、SQLite/PostgreSQL、「アクション層がAPI」でチャットから業務操作。AI-native判定の5基準（会話UX/エージェント型WF/意味データ/組込自動化/ガバナンス）を提唱【二次情報】(https://www.erpclaw.ai/ai-native-erp/)。

## 2. 横断比較の要点

| 観点 | コード駆動 | メタデータ駆動 |
|---|---|---|
| モデル定義 | Odoo(Pythonクラス)、Tryton(Python)、Axelor(XML→Java生成)、OFBiz(XML entity)、Dolibarr(SQL＋PHP) | Frappe(DocType JSON→`tab`テーブル)、iDempiere(AD_Table→DB同期)、Twenty(objectMetadata→動的スキーマ) |
| 拡張点 | Odoo `_inherit`/XPath、Tryton Pool合成、Axelor Guice上書き、OFBiz ECA/SECA、Dolibarr hooks/triggers | Frappe Custom Field/Property Setter/hooks、iDempiere OSGi＋辞書 |
| 権限 | Odoo/Tryton：モデルACL＋domainルール＋フィールド/ボタン | Frappe：Role×DocPerm＋permlevel＋User Permission；iDempiere：Role×Window/Process |
| WF | Odoo：state＋自動アクション（エンジン削除）；Tryton：Workflowミックスイン；iDempiere：AD_Workflow/DocAction；Axelor：BPM | Frappe：Workflow DocType；Medusa：補償付きワークフローエンジン |
| テナント | Odoo：DB/テナント（dbfilter）、Frappe：Site/テナント、Twenty：ワークスペーススキーマ | — |

## 3. 日本ローカライズの現状
- **Odoo**：本体に `l10n_jp`（Quartile社作、LGPL-3、勘定科目＋税＋内税/外税fiscal position、`account_tax_report_data.xml`）【確認済】(https://raw.githubusercontent.com/odoo/odoo/19.0/addons/l10n_jp/__manifest__.py)。Enterprise側に `l10n_jp_zengin`（全銀）と `l10n_jp_ubl_pint`（Peppol PINT-JP）が17.0で追加【二次情報】(https://raw.githubusercontent.com/mao-odoo/all_standard_odoo_apps_per_version/main/OUR_MODULES_DIFF.json)。OCA `l10n-japan`（AGPL-3）に締め請求（`l10n_jp_summary_invoice`＝適格請求書対応の合計請求書、税を税率合計で再計算）、締日、繰越、住所レイアウト、都道府県、税端数処理等11モジュール【確認済】(https://github.com/OCA/l10n-japan/blob/18.0/README.md, https://pypi.org/project/odoo-addon-l10n-jp-summary-invoice/18.0.1.6.0/)。
- **ERPNext**：公式Crowdinに日本語未収録で、2026年5月に Lifegence 主導の翻訳イニシアティブが始動【確認済】(https://discuss.frappe.io/t/japanese-localization-initiative-for-frappe-erpnext/162487)。消費税軽減税率・インボイス制度・帳票様式・翻訳品質・国内パートナー不足が課題とされ、商用サービスが補完【二次情報】(https://www.erpnext.jp/column/2-use-case/adoption-japan)。
- **iDempiere**：JPiere（GPLv2）が五十日払い・まとめ請求・消費税・検収基準の売上計上等の日本商慣習をOSGiプラグインで提供【二次情報】(https://www.oss-erp.co.jp/ja/jpiere/)。
- **Tryton**：公式に `account_jp` 相当は見当たらず（be/es/fr/de/eu のみ確認）【確認済/推測】。**Dolibarr/OFBiz/Axelor/metasfresh**：日本向け会計・帳票ローカライズは確認できず【推測】。

## 4. 設計への示唆（※以下は推測・提案）
1. **メタデータとコードの二層化**：Frappe/iDempiere/Twenty が示す「スキーマ・ビュー・権限をデータとして持つ」利点（no-code拡張、アップグレード耐性）と、Odoo/Tryton の「Python クラス合成」の利点（型・IDE・テスト容易性）を両取りするには、**型付きスキーマ定義（例：宣言的DSL/JSON Schema）を単一の真実源にし、そこからORMクラス・API・UI・権限テーブルを生成する**設計が有力。Axelor のXML→JPA生成はその前例。
2. **拡張はin-place改変ではなく差分レコードで**：Odoo の `_inherit`/XPath は強力だが、コアを直接書き換えるため負債化しやすい。Frappe の Custom Field/Property Setter、OFBiz の ECA、Medusa の Module Links のような「差分・イベント・リンク」で拡張し、コア改変を禁じる方が AI 生成コードの制御にも向く。
3. **ドメイン境界を最初から切る**：Medusa 2.0 の「モジュール間FK禁止＋Link＋補償付きワークフロー」は、多業種ERPで業種パックを後付けする際の依存爆発を防ぐ。OFBiz が自己批判した「all-or-nothingモノリス」を避ける。
4. **権限は default-deny・単一機構**：Frappe の5層混在と default-allow、Odoo の ACL/ルール/フィールド3層は複雑。モデルACL＋行ポリシー（domain/RLS）＋フィールドマスクを**一つのポリシー言語**で表現し、内部呼び出しも同じ経路を通す（`ignore_permissions` を作らない）。
5. **ワークフローは第一級**：Odoo が state 遷移に退化した一方、承認・取消・訂正（Frappe の submit/cancel/amend、iDempiere の DocAction）は業務システムの中核。伝票状態機械＋補償可能なプロセスエンジンをコアに置く。
6. **ローカライズを"国パック"として構造化**：Odoo の `l10n_XX`（CoA/税/fiscal position CSV＋Python テンプレート）と ERPNext の `regional_overrides`（国別関数ディスパッチ）を参考に、**勘定科目・税・帳票・銀行フォーマット・法定レポート・振る舞い上書き**を1パッケージで宣言する。日本では締め請求・五十日払い・軽減税率・適格請求書・全銀/Peppol JP が必須要件で、OCA l10n-japan と JPiere の機能一覧がそのまま要件表になる。
7. **マルチテナントとアップグレードを前提設計に**：Odoo/Frappe とも「DB per tenant」で全テナント同版ロックとロールバック不能なマイグレーションが痛点。スキーマバージョンをメタデータに持ち、前方/後方互換のマイグレーションとテナント別段階移行を設計に組み込む。
8. **AI-native の実務要件**：新興勢（Open Mercato/ERPClaw/Twenty/Odoo 19）の共通項は「全操作をエージェントが呼べるアクションAPI」「自然言語→クエリ」「AI変更の承認ゲートと監査」。OFBiz の service 定義（IN/OUT属性・auth・トランザクション）のような**宣言的サービス契約**を持てば、そのまま MCP/tool schema に変換できる。
9. **セキュリティの教訓**：OFBiz の認証バイパスRCE、Frappe/Dolibarr の SQLi/XSS 履歴は、文字列SQL・独自認証・レガシーエンドポイントの残存が原因。クエリビルダ強制、統一認証ミドルウェア、エンドポイント自動棚卸しを初日から。

## 調査上の注記
Odoo公式Docs本体（odoo.com/documentation）はナビゲーションのみ返るため、GitHub上のRST原文で代替確認した。OpenHubのDolibarr項目はGitHubの言語比率と矛盾する（HTML51%/貢献者45名）ため採用していない。ERPNextのOpenHub 210万LOCは翻訳CSV等を含む可能性が高く、参考値に留めるべき。metasfreshはGitHub Releasesが2023年で止まっているが、企業サイトは稼働中で、リリース方式変更の可能性がある（未確認）。Odoo Communityリポジトリの正確なアドオン数とTryton公式モジュール数の一次確認は未了（前者は120件以上をAPI応答の一部で確認、後者は二次情報で約150）。

## Sources
- https://github.com/odoo/odoo
- https://raw.githubusercontent.com/odoo/documentation/19.0/content/developer/reference/backend/module.rst
- https://raw.githubusercontent.com/odoo/documentation/19.0/content/developer/reference/backend/orm.rst
- https://raw.githubusercontent.com/odoo/documentation/19.0/content/developer/reference/backend/security.rst
- https://raw.githubusercontent.com/odoo/documentation/19.0/content/developer/reference/backend/reports.rst
- https://raw.githubusercontent.com/odoo/documentation/19.0/content/developer/howtos/accounting_localization.rst
- https://www.odoo.com/documentation/19.0/developer/reference/user_interface/view_architectures.html
- https://www.odoo.com/odoo-19-release-notes
- https://www.odoo.com/page/editions
- https://www.odoo.com/forum/help-1/accounting-community-vs-enterprise-271286
- https://www.odoo.com/forum/help-1/workflows-in-odoo-11-125992
- https://en.wikipedia.org/wiki/Odoo
- https://ecosire.com/blog/latest-odoo-version
- https://openhub.net/p/odoo
- https://deepwiki.com/odoo/odoo
- https://novobi.com/6-types-of-odoo-technical-debt-and-how-to-avoid-them/
- https://oec.sh/blog/odoo-multi-tenant-architecture
- https://raw.githubusercontent.com/odoo/odoo/19.0/addons/l10n_jp/__manifest__.py
- https://raw.githubusercontent.com/mao-odoo/all_standard_odoo_apps_per_version/main/OUR_MODULES_DIFF.json
- https://github.com/OCA/l10n-japan/blob/18.0/README.md
- https://pypi.org/project/odoo-addon-l10n-jp-summary-invoice/18.0.1.6.0/
- https://github.com/frappe/erpnext
- https://github.com/frappe/frappe
- https://discuss.frappe.io/t/erpnext-hrms-frappe-framework-v16-release-dates/156349
- https://frappe.io/releases/version-16
- https://frappe.io/erpnext/version-16
- https://en.wikipedia.org/wiki/ERPNext
- https://openhub.net/p/erpnext
- https://docs.frappe.io/framework/user/en/basics/doctypes
- https://docs.frappe.io/framework/user/en/basics/doctypes/customize
- https://docs.frappe.io/framework/user/en/basics/users-and-permissions
- https://docs.frappe.io/framework/user/en/introduction
- https://gavv.in/blog/how-does-frappe-work/
- https://deepwiki.com/frappe/erpnext
- https://deepwiki.com/frappe/erpnext/12.2-hooks-and-event-system
- https://github.com/frappe/erpnext/pull/19335/files
- https://dipankar-das.com/blog/frappe-framework-technical-autopsy/
- https://discuss.frappe.io/t/japanese-localization-initiative-for-frappe-erpnext/162487
- https://www.erpnext.jp/column/2-use-case/adoption-japan
- https://github.com/Dolibarr/dolibarr
- https://wiki.dolibarr.org/index.php/List_of_releases,_change_log_and_compatibilities
- https://wiki.dolibarr.org/index.php/Module_development
- https://en.wikipedia.org/wiki/Dolibarr
- https://github.com/Dolibarr/dolibarr/issues/10054
- https://stack.watch/product/dolibarr/dolibarr/
- https://note.com/kaname1340cc/n/nd0a12f5cfc42
- https://discuss.tryton.org/t/tryton-release-7-6/8532
- https://discuss.tryton.org/t/tryton-release-7-8/
- https://www.tryton.org/
- https://en.wikipedia.org/wiki/Tryton
- https://openhub.net/p/tryton
- https://docs.tryton.org/latest/server/topics/modules/index.html
- https://docs.tryton.org/latest/server/topics/models/index.html
- https://docs.tryton.org/latest/server/topics/access_rights.html
- https://docs.tryton.org/latest/
- https://discuss.tryton.org/t/how-to-create-your-country-localization-module-for-accounts/2758
- https://discuss.tryton.org/t/list-of-modules-and-what-they-do/2675
- https://discuss.tryton.org/t/advantages-of-tryton-over-odoo/4937
- https://ecosire.com/blog/odoo-vs-tryton-comparison-2026
- https://deepwiki.com/tryton/tryton
- https://en.wikipedia.org/wiki/IDempiere
- https://idempiere.org/
- https://idempiere.org/blog/2026/03/12/idempiere-13-orion/
- https://idempiere.org/releases/
- https://wiki.idempiere.org/en/Application_Dictionary_-_Create_a_Custom_Table_and_Window
- https://openhub.net/p/idempiere
- https://www.oss-erp.co.jp/ja/jpiere/
- https://axelor.com/release-of-axelor-open-suite-version-8-3/
- https://axelor.com/all-the-apps/
- https://github.com/axelor/axelor-open-suite/releases
- https://github.com/axelor/axelor-open-platform
- https://docs.axelor.com/adk/5.4/tutorial/step3.html
- https://deepwiki.com/axelor/axelor-open-suite
- https://github.com/metasfresh/metasfresh
- https://github.com/metasfresh/metasfresh/releases
- https://en.wikipedia.org/wiki/Metasfresh
- https://metasfresh.com/en/
- https://ofbiz.apache.org/download.html
- https://en.wikipedia.org/wiki/Apache_OFBiz
- https://cwiki.apache.org/confluence/display/OFBIZ/Entity+Engine+Guide
- https://cwiki.apache.org/confluence/display/OFBIZ/Service+Engine+Guide
- https://deepwiki.com/apache/ofbiz-framework
- https://www.mail-archive.com/dev@ofbiz.apache.org/msg107988.html
- https://www.hotwaxsystems.com/hotwax-blog/apache-ofbiz-a-modern-framework-hidden-behind-a-generic-ui
- https://www.cybersecuritydive.com/news/apache-ofbiz-cve-exploitation/703788/
- https://github.com/twentyhq/twenty
- https://github.com/twentyhq/twenty/blob/main/LICENSE
- https://deepwiki.com/twentyhq/twenty
- https://github.com/medusajs/medusa
- https://medusajs.com/blog/v2-release
- https://www.openmercato.com/blog-posts/open-source-erp-alternatives
- https://www.erpclaw.ai/ai-native-erp/
- https://www.erpclaw.ai/blog/5-ai-native-erps-that-earn-the-label/
- https://ecosire.com/blog/open-source-erp-top-10-comparison-2026
