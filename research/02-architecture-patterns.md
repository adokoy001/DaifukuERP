# 調査ノート02: ERP／大規模業務システムのアーキテクチャパターン（2024–2026）

調査日: 2026-09-10 ／ 調査者: Claude（リサーチ用サブエージェント）／ 統合: Claude（claude-fable-5-1）
凡例: 【確認済】一次情報・公式ドキュメント／論文で確認、【二次情報】ブログ・メディア・ベンダー解説、【推測】推論。

## 1. モジュラーモノリス vs マイクロサービス／Composable・Headless ERP

**現在のコンセンサス**: 「まずモジュラーモノリス、必要な箇所だけサービス抽出」が2024–26年の主流見解。

- Shopify のコアは Ruby 280万行・50万コミットのモノリスで、37 のコンポーネント（Rails Engine）に分割し、静的解析ツール Packwerk が「依存グラフやカプセル化を破る変更をマージ前に拒否」する。マイクロサービス化は「全体の複雑性を著しく増大させる」として、高スループットの読み取りや機微データ処理など限定ケースでのみサービスを抽出【確認済】(https://shopify.engineering/shopify-monolith)
- 判断基準としてチーム規模（1–10人: 単純モノリス、10–50人: モジュラーモノリスが「ideal」、50人超: マイクロサービスが正当化）が示される【二次情報】(https://www.javacodegeeks.com/2025/12/microservices-vs-modular-monoliths-in-2025-when-each-approach-wins.html)
- 「マイクロサービス採用組織の42%が大きなデプロイ単位へ再統合」「サービスメッシュ採用率 18%→8%」等の数字が流布しているが、出典（CNCF 2025 調査）は記事内で検証されていない【二次情報・要注意】(https://byteiota.com/modular-monolith-42-ditch-microservices-in-2026/)
- モジュラーモノリスの実装規律: Spring Modulith `@ApplicationModule` や ArchUnit で境界をテストとして強制、モジュール間は「event-first」通信＋Transactional Outbox、「同期モジュール間呼び出しが3段以上連鎖したら再設計」【二次情報】(https://dev.to/x4nent/the-modular-monolith-2026-complete-guide-spring-modulith-archunit-fitness-functions-and-lessons-878)
- Outbox パターン: DBとメッセージブローカーへの二重書き込み問題を、同一トランザクションで outbox テーブルに書き、リレー／CDC で配信して解決。消費側は冪等必須【確認済】(https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)

**ERP の境界（Bounded Context）**:
- 「Sales と Fulfillment が同じ語を別の意味で使うなら境界がある」。`Order` は Ordering（明細・価格）／Fulfillment（ピッキング・倉庫）／Billing（支払条件・税）で別モデルを持つべきで、各コンテキストは別スキーマでデータを所有し、統合イベントで同期する【二次情報】(https://milanjovanovic.tech/blog/bounded-context-ddd-explained)

**Composable / Headless ERP**:
- Gartner の定義: 「Composable ERP は、基盤・管理・業務のデジタル能力を提供し、急速な事業変化に追随できるようにする適応的技術戦略」。同ページで「2027年までに、最近実装されたERPの70%超が当初のビジネスケースを完全には達成できず、25%は壊滅的に失敗する」【確認済】(https://www.gartner.com/en/information-technology/topics/enterprise-resource-planning)
- Gartner の構成要素 PBC（Packaged Business Capability）は「データスキーマと、サービス・API・イベントチャネルの集合からなる境界づけられた単位で、永続化・業務ロジック・標準インターフェース（APIとイベント）を含む」【二次情報（Gartner定義の引用）】(https://www.trisotech.com/composability-and-packaged-business-capabilities/)。技術的には DDD の Bounded Context ＋ API/イベント契約と同義【推測】。
- Gartner 自身も「Composable ERP の10の醜い真実」（2024年6月）という注意喚起レポートを出している【確認済（存在のみ）】(https://www.gartner.com/en/documents/5494395)。批判側は「用語自体はほぼ空虚だが、API/クラウドで実現可能になったモジュラー ERP という概念は有効」【二次情報】(https://www.trenegy.com/publications/composable-erp-gartners-idea-thats-really-just-chipotle-for-software)
- Headless ERP: Infor は「UI（head）を ERP エンジンから分離」し 8,500 超の API を提供と主張【確認済（ベンダー主張）】(https://www.infor.com/blog/headless-erp-digital-modernization)。Tailor は「headless は backend/frontend の分離、composable はさらに在庫・購買などバックエンドモジュール単位で差し替え可能」と区別【確認済（ベンダー）】(https://www.tailor.tech/headless-erp)

## 2. マルチテナンシー

- パターン比較: 共有テーブル＋tenant_id＋RLS（数百万テナントまで、横断分析容易）／schema-per-tenant（実用上500–10,000、カタログ肥大、マイグレーションを全スキーマに反復）／DB-per-tenant（実用上100–500、接続プール問題: 100テナント×10接続=1,000）。「現代の SaaS のデフォルトは共有テーブル＋RLS、エンタープライズ顧客のみ専用スキーマ／DBへ昇格するハイブリッド」【二次情報】(https://www.adiagr.com/blog/07-saas-postgres-multitenancy-patterns/)
- Azure Architecture Center: 完全共有／垂直分割（標準顧客は共有、エンタープライズは専用）／水平分割（アプリ層共有・DB専用）／単一テナントの4モデル、Deployment Stamps、分離は連続体であり DB のみ分離も可【確認済】(https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenancy-models)
- PostgreSQL RLS 実装: `SET rls.org_id=...` + `USING (org_id = NULLIF(current_setting('rls.org_id', TRUE), '')::uuid)`、全テーブルに tenant 列【確認済】(https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres)
- RLS の落とし穴: テーブル所有者・superuser・BYPASSRLS はポリシーを無視 → `FORCE ROW LEVEL SECURITY` 必須、SECURITY DEFINER 関数が「クロステナントアクセスを最も頻繁に漏らす」、接続プールでは `SET` でなく `SET LOCAL` をトランザクション内で、インデックス先頭列は tenant_id、ポリシー関数は STABLE/IMMUTABLE 明示、複数ポリシーは OR 結合、pg_dump／論理レプリケーションは BYPASSRLS 有無で全件か0件【二次情報】(https://queryplane.com/blog/postgres-row-level-security-in-practice/)
- 大手 SaaS の実例: Salesforce は MT_Objects/MT_Fields/MT_Data（Value0…ValueN のフレックス列）＋ MT_Indexes/MT_Unique_Indexes/MT_Relationships のピボット表で、全テナントを単一物理スキーマに収容し、ガバナー制限でリソース保護【確認済】(https://architect.salesforce.com/docs/architect/fundamentals/guide/platform-multitenant-architecture.html)。NetSuite は「単一インスタンスを複数顧客が共有し論理分離」【確認済（一般説明のみ）】(https://www.netsuite.com/portal/resource/articles/data-warehouse/multi-tenancy.shtml)。Odoo Online はマルチテナント、Odoo.sh は専用オプションあり【二次情報】(https://www.odoo.com/forum/help-1/is-odoo-multi-tenant-or-customer-dedicated-176614)、Odoo は顧客ごとに PostgreSQL DB を分ける DB-per-tenant 型と理解している【推測】。

## 3. メタデータ駆動／モデル駆動設計

- Inner-platform effect: 「使っているプラットフォームの（しばしば劣った）複製になるほどカスタマイズ可能なシステムを作る傾向」。典型例が EAV で、RDBMS の利点（制約・インデックス・クエリ最適化）を全て失う。正当化されるのは移植性と権限分離の目的【確認済】(https://en.wikipedia.org/wiki/Inner-platform_effect)
- 成功例: Frappe の DocType は「model+view+controller」を兼ね、フィールド・権限（ロール別 read/write/create/delete/export/print）・バリデーションをメタデータ化し UI から変更可。Python コントローラで検証ロジック、Virtual DocType で外部データも同 UI に統合【確認済】(https://frappe.io/framework/doctype)。一方で ERPNext は勘定科目のルートタイプが5種に固定されており、セルビア・ドイツ・フランス等の法定要件に対応できないという「土台」の硬直性が指摘される【二次情報】(https://discuss.frappe.io/t/scaling-regional-localisation-for-erpnext/133795)
- Salesforce は極端なメタデータ駆動（前節）で、無停止スキーマ変更と引き換えにガバナー制限・バルク処理強制という開発制約を負う【確認済】(同上 Salesforce URL)
- 動的属性の格納: JSONB は GIN インデックスで `@>` 検索、型保持、単一行取得。EAV は条件ごとに EXISTS/自己結合が増え実用に耐えない。外部キーは通常列、柔軟属性は JSONB に分離する【二次情報】(https://docs.bswen.com/blog/2026-04-24-jsonb-vs-eav-postgresql/)
- Shopify は metafield（既存リソースへの型付き拡張列）と metaobject（新エンティティ型）を「定義（definition）」と「値」に分け、app 所有名前空間と `access.admin/storefront` で権限を宣言。アプリはコアスキーマを変えずに宣言的に拡張【確認済】(https://shopify.dev/docs/apps/build/metaobjects/data-modeling-with-metafields-and-metaobjects)
- 型安全性の担保: スキーマ定義を single source of truth とし、そこから TS 型（コンパイル時）とランタイムバリデータの両方を生成する。検証コストはマイクロ秒オーダー【二次情報】(https://www.instant.one/blog/schema-first-code-generation-for-extensible-software-platforms)
- 規制産業での運用知見: メタデータ変更を「不変の Migration Plan にコンパイルし、コスト・影響を見積もってから承認」（Late-bound synthesis）。「複雑性を消すのではなく、明示的・レビュー可能・監査可能な上流へ押し出す」。「スタートアップには過剰」【二次情報】(https://medium.com/@zada.zavar/five-patterns-for-metadata-driven-platforms-3ed27b8f3ec4)

## 4. 財務コア（複式簿記台帳）

- Modern Treasury: 「台帳の全ての状態が記録され再構築できる」ことを保証するため、可変フィールドの下に append-only ログを置く。`effective_at`（時点残高照会）、Entry の `account_version`、Transaction の `transaction_version` で任意時点を再構築。複式検証は**通貨ごと**に行う（為替レートで貸借を合わせるのは誤り。為替取引は最低4勘定）【確認済】(https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-v)
- Square Books: `books`／`journal_entries`／`book_entries` の3表。「図の表に UPDATE 文はなく INSERT のみ」、訂正は相殺仕訳。残高は book 行にキャッシュし「支払額計算は単一行で集計不要」【確認済】(https://developer.squareup.com/blog/books-an-immutable-double-entry-accounting-database-service/)
- Stripe Ledger: 1日50億イベント、「ドル建て取引量の99.99%を4日以内に取り込み検証」、Clearing（定常状態で残高ゼロ）／Timeliness／Completeness の3指標で品質監視、訂正は「過去操作の取消と再処理」【二次情報（Stripe 公式ブログの引用）】(https://densitylabs.io/blog/building-trust-how-stripe-ensures-financial-accuracy-with-ledger/)
- TigerBeetle: 「借方／貸方は13世紀以来のビジネスの共通語」。UPDATE/DELETE 禁止、取消は別 transfer。transfer は `debit_account_id`／`credit_account_id`／`ledger`（資産種別）／`code`（理由）を持ち、two-phase transfer と linked events、残高上限は DB 内で強制【確認済】(https://docs.tigerbeetle.com/concepts/debit-credit/)
- Formance: 本番台帳の7要件＝貸借一致・原子的コミット・バイテンポラリティ・ハッシュチェーン履歴・冪等書き込み・直列化された並行制御・エンティティ単位の分離。Numscript で意図を書き台帳側が仕訳を導出【確認済（ベンダー）】(https://www.formance.com/blog/engineering/defining-double-entry)
- Beancount: 「財務の厳格なコンパイラ」。勘定は `open` 宣言必須、取引は必ずゼロ合計、失敗時は行番号付きエラー。10万取引で約8.8MB【二次情報】(https://beancount.io/blog/2025/07/22/beancounts-technical-edge-a-deep-dive-on-performance-python-api-and-data-integrity-vs-ledger-hledger-and-gnucash)。Ledger/hledger は `=` 区切りで主日付と effective/secondary date を持てる【確認済】(https://plaintextaccounting.org/Recording-dates)
- RDB 実装: 行は debit XOR credit、貸借一致は CHECK では不可能なので deferrable constraint trigger で検証、締め済み期間は投入拒否、訂正は開いた期間への逆仕訳【二次情報】(https://www.matthewswong.com/en/blog/erp-general-ledger-double-entry-design/)
- 勘定コードのセグメント拡張ではなく、事業部・原価センタ・プロジェクト・地域などの**ディメンション（分析タグ）**で追跡し、補助簿からGLへリアルタイム転記【二次情報（ベンダー）】(https://www.dualentry.com/blog/general-ledger-in-erp)
- 多通貨: 取引通貨／機能通貨／報告通貨、レート種別（spot・average・historical）、換算（translation）と再評価（revaluation）の区別、換算差額は OCI へ。「外貨と自国通貨の両方で同時に記録」【確認済（ベンダー）】(https://www.netsuite.com/portal/resource/articles/accounting/multi-currency-accounting.shtml)
- イベントソーシングとの関係: 「Event Store と Ledger DB は別概念」。ES は業務ロジックの結果を事象として保存、台帳は完全性・コンプライアンスに最適化【二次情報】(https://www.architecture-weekly.com/p/building-your-own-ledger-database)

## 5. ワークフロー／ステートマシン／採番／監査証跡

- Frappe の `docstatus`: 0 Draft／1 Submitted／2 Cancelled。Submittable でない DocType は常に Draft。提出後は「Allow on Submit」指定フィールドのみ変更可【確認済】(https://docs.frappe.io/framework/doctypes/docstatus)。修正は Cancel → Amend → 再提出で、「Sales Order に紐づく Delivery Note や Sales Invoice など依存文書を先にキャンセルする必要がある」【確認済】(https://docs.frappe.io/erpnext/edit-submitted-document)
- Frappe Workflow: Workflow State が doc_status に対応し、Transition は「元状態・アクション・次状態・許可ロール・Python 条件・自己承認可否」を持つ【二次情報】(https://readmex.com/en-US/frappe/frappe/page-90335d98a-823c-4948-8a8e-4438e6b3587d)
- Odoo の請求書採番: v14 以降は ir.sequence でなく「直前の仕訳番号からフォーマットを推測」する方式で、事前設定不可・再採番ウィザードはコンプライアンス上問題・ロック競合の課題があり、OCA モジュールが ir_sequence 方式を復活させている【確認済（OCA）】(https://apps.odoo-community.org/modules/account_move_name_sequence)。欠番の原因は「PostgreSQL シーケンスは非トランザクショナル」「下書き時に採番」等で、`no_gap` 実装は `SELECT FOR UPDATE` で直列化する。仏・独・西・印は欠番なし（または説明可能）を法的に要求【二次情報】(https://deploymonkey.com/blog/odoo-sequence-gap-missing-numbers-fix)
- Durable execution vs 明示的ステートマシン: ステートマシンは「遷移のDB保存・switch/case・タイムアウトのスケジュール」という配管コードを要する。Temporal は Signal で人間承認（human-in-the-loop）を扱い `Workflow.sleep(30 days)` が再起動を跨いで生きる。一方「単純・静的・厳密に定義された状態構造が必要なら明示的ステートマシンが依然適切」【確認済（ベンダー）】(https://temporal.io/blog/temporal-replaces-state-machines-for-distributed-applications)。イベントソーシング型ワークフロー（decide/evolve/initialState、インスタンスごとのストリームが inbox 兼 outbox）も提案されている【二次情報】(https://www.architecture-weekly.com/p/workflow-engine-design-proposal-tell)
- 監査証跡要件: 誰（人または技術サービスの一意ID）・何（create/change/delete/approve）・いつ（改竄不能タイムスタンプ）・変更前後の値。append-only で「気づかれずに編集・痕跡なく削除」が不可能であること、タイムスタンプと暗号チェーンで補強。独 GoBD の帳簿保存は 2025-01-01 から 8 年に短縮、21 CFR Part 11 は関連レコードの保存期間中は監査証跡を保持【二次情報】(https://erp-software.org/en/glossary/audit-trail/)

## 6. 認可モデル

- RBAC は「階層・共有・マルチテナンシーで破綻」、ReBAC は RBAC の上位集合で、OpenFGA は Conditions と Contextual Tuples で ABAC 的ケースも扱う【確認済】(https://openfga.dev/docs/authorization-concepts)。Zanzibar 論文: 数兆件の ACL、毎秒数百万リクエスト、p95 10ms 未満、可用性 99.999%（3年間）【確認済】(https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/)
- 製品比較: SpiceDB/OpenFGA は関係タプルを中央保管するため「dual-write 問題」（アプリデータと認可データの同期）を抱える。Cerbos（YAML/CEL）と OPA（Rego）はステートレス。Cedar は OpenFGA 比 28–35 倍、Rego 比 42–80 倍速いとされるが「根本的に異なるアーキテクチャの比較」との注意付き【二次情報】(https://sph.sh/en/posts/external-authorization-management-systems/)
- ERP に必須の一覧系フィルタ: Cerbos の PlanResources は ALWAYS_ALLOWED／ALWAYS_DENIED／CONDITIONAL（AST）を返し、AST を SQL/ORM の WHERE に変換して DB 側で絞り込む【確認済（ベンダー）】(https://www.cerbos.dev/blog/filtering-database-results-with-cerbos-query-plans)
- ERP ネイティブ実装: Odoo は ir.model.access（グループ×モデルの CRUD）→ ir.rule（ドメイン式による行レベル。グローバルルール同士は AND、グループルール同士は OR、両者は AND）→ フィールドの `groups` 属性（フィールドレベル）の3層【確認済】(https://www.odoo.com/documentation/19.0/developer/reference/backend/security.html)。Frappe は `permission_query_conditions`（WHERE 句を注入）と `has_permission` フックで拡張【確認済】(https://docs.frappe.io/framework/user/en/python-api/hooks)

## 7. 拡張／プラグインアーキテクチャ

- Odoo: `_inherit`（既存モデルにフィールド追加・メソッド上書き）、XPath によるビュー継承、`_inherits`（委譲・合成）でコアを編集せず拡張【確認済】(https://www.odoo.com/documentation/19.0/developer/tutorials/server_framework_101/12_inheritance.html)
- Frappe hooks.py: `doc_events`（CRUD フック）、`override_doctype_class`／`extend_doctype_class`（後者は複数アプリがインストール順に mixin 合成）、`override_whitelisted_methods`、`fixtures`（カスタムフィールド等の投入）、`scheduler_events`、権限フック【確認済】(同上)。国別ローカライズは Frappe Cloud のサイト作成時に地域アプリ選択（8か国）、コアでなくパートナーが開発【二次情報】(https://discuss.frappe.io/t/scaling-regional-localisation-for-erpnext/133795)
- Medusa v2: Module Links でカスタムデータをコアモジュールに「副作用なく」紐づけ、Workflow Hooks で既存ワークフローの所定点に注入、API ルート拡張。**モジュールは互いのテーブルに直接アクセスしない**分離原則【確認済】(https://docs.medusajs.com/learn/customization/extend-features)
- Saleor: 税計算・決済・配送は同期 Webhook で外部アプリに委譲（コアはレスポンスを待つ）。「多用すると API 応答時間に重大な影響」と公式に警告【確認済】(https://docs.saleor.io/developer/extending/webhooks/synchronous-events/overview)
- Shopify: metafield/metaobject 定義をアプリが宣言的にデプロイ（前節）【確認済】

## 8. レポーティング／分析

- 読み取りモデルの3段階: ①同一DBで書込/読込モデル分離（読込負荷で競合、リードレプリカで緩和）、②マテリアライズドビュー（鮮度と更新コストのトレードオフ）、③イベント駆動で別ストア（最も柔軟だが順序・結果整合性の管理が必要）【二次情報】(https://thecodinginterface.com/blog/cqrs-read-model-patterns/)
- 「Postgres の壁」: ダッシュボードのクエリが 50ms→5秒→タイムアウトになる。大口顧客のレポートが IOPS/RAM を食い尽くす noisy neighbor。推奨は Postgres（OLTP）＋DuckDB/MotherDuck（OLAP）のハイブリッドで、データ移動は①夜間 Parquet エクスポート、②Debezium 等の CDC、③リードレプリカ上の pg_duckdb の3方式。テナントごとに分離コンピュート【二次情報（ベンダー）】(https://motherduck.com/learn/duckdb-vs-postgres-embedded-analytics/)
- DuckDB 組込みの制約: 単一ライター（読取専用で複数プロセス可）、同期二重書き込み禁止、リクエストごとの INSERT 禁止、バッチにメタデータ（スキーマ版・行数・完了マーカー）を付与、5分以上の遅延を許容できる用途に限定【二次情報】(https://oneuptime.com/blog/post/2026-09-08-duckdb-embedded-analytics-not-oltp/view)
- セマンティックレイヤー: 「メトリクス・ディメンション・結合・アクセスルールを一度定義し全ての埋め込み面に適用」、署名付きセキュリティコンテキストで行レベル・マルチテナント分離、事前集計、SQL/REST/GraphQL【二次情報（ベンダー）】(https://cube.dev/articles/best-embedded-analytics-platforms-2026)

## 9. AI-native ERP（2025–2026）

- SAP: Joule Agent は 2026年6月に Ariba Intake Management／Ariba Contracts／Fieldglass の3つが GA、Agent Runtime は 2026-12-31 まで無償【二次情報】(https://erp.today/sap-joule-agents-ariba-fieldglass-procurement-automation-2026/)。2026-05-20 に SAP と Anthropic が MCP で Claude を SAP Business AI Platform／Joule に統合【二次情報】(https://erp.today/sap-anthropic-claude-joule-mcp/)。SAP 公式リファレンスでは Joule は A2A クライアント兼 MCP ツール消費者、外部公開は Agent Gateway（A2A、IAS トークン）と Integration Suite の MCP Gateway【確認済】(https://architecture.learning.sap.com/docs/ref-arch/76ec36)
- Oracle: 2026-03-24 に 22 の Fusion Agentic Applications と Agentic Applications Builder を発表。「ガードレール内で定型作業を自律的に進め、例外のみ人に上げる」【確認済】(https://www.oracle.com/news/announcement/oracle-introduces-fusion-agentic-applications-2026-03-24/)
- Microsoft: 2026 wave 1 で Finance & Operations の「MCP サーバーの改善」、Dataverse の MCP サーバー／Python SDK【確認済】(https://www.microsoft.com/en-us/dynamics-365/blog/business-leader/2026/03/18/2026-release-wave-1-plans-for-microsoft-dynamics-365-microsoft-power-platform-and-copilot-studio-offerings/)。Business Central は `mcp.businesscentral.dynamics.com` の安定エンドポイント、OAuth 2.1【二次情報】(https://www.azurecurve.co.uk/2026/05/new-functionality-in-microsoft-dynamics-365-business-central-2026-wave-1-create-agentic-experiences-with-enhanced-mcp-server/)
- Odoo 19: Ask AI（標準では「ビューを開きレポート表示はできるがデータ変更不可」）、AI Fields、ツール付き AI Agents、AI Server Actions（「業務ルールは強制せず正しさも保証しない」）、OCR 請求書取込【二次情報】(https://www.usecarly.com/blog/odoo-ai/)。Odoo 19 用 MCP サーバーモジュールや ERPNext 用 MCP サーバーが存在【確認済（存在）】(https://apps.odoo.com/apps/modules/19.0/mcp_server, https://github.com/rakeshgangwar/erpnext-mcp-server)
- ガバナンス: 「設計の悪い MCP サーバーは、どの個人ユーザーにも与えられない権限レベルでエージェントにアクセスを与えうる」。読取と書込は分離、アクセス制御はワークフロー内でエージェントに追従、事後再構築可能な監査【二次情報】(https://erp.today/model-context-protocol-erp-agentic-ai/)
- Gartner 予測（引用）: 2027年までに「agentic AI 利用組織のうち有意な測定可能価値を得るのは10%未満」「AI 対応 ERP 機能のうち GenAI 駆動は30%未満」【二次情報】(https://erpsoftwareblog.com/cloud/2025/12/top-trends-in-erp-insights-from-gartners-roadmap/)
- エージェント向けツール設計（Anthropic）: エンドポイントを薄くラップせず高インパクトなワークフロー単位に統合、名前空間による接頭辞、UUID でなく意味のある識別子を返す、`response_format` で冗長度制御、ページング・フィルタ・切詰め、「不透明なエラーコードでなく具体的で実行可能な改善を伝えるエラー」、評価セット駆動【確認済】(https://www.anthropic.com/engineering/writing-tools-for-agents)

## 10. 国際化／ローカライズ

- Odoo の fiscal localization package（`l10n_xx`）は勘定科目表・税・fiscal position（税/勘定のマッピング）・法定レポート・電子インボイスを一括導入し、50か国超をカバー【確認済】(https://www.odoo.com/documentation/19.0/applications/finance/fiscal_localizations.html)
- 外部税エンジン統合: 入力は ship-from/ship-to 住所・商品税コード・免税証明・nexus、出力は明細×管轄別税額。見積/受注時は同期計算（目標 <200ms、uncommitted）、請求書転記時に commit、申告は別工程。「未マッピング品目は全額課税にフォールバック」【二次情報】(https://knowledgelib.io/business/erp-integration/tax-engine-integration/2026)
- 電子インボイス義務化: ベルギー B2B 2026-01-01（Peppol/UBL）、ドイツ発行義務 2027（2028 完全）XRechnung、フランス大企業 2026・全企業 2027、ポーランド KSeF 2026、EU ViDA 2030。意味標準は EN 16931【二次情報】(https://e-invoice.be/e-invoicing-mandate-matrix)。日本の JP PINT は「Peppol PINT BIS Billing 準拠」で 2026-06-08 に v1.1.3、デジタル庁が 2021年9月から Japan Peppol Authority【確認済】(https://www.digital.go.jp/en/policies/electronic_invoice)

## 設計への示唆（以下はすべて【推測】）

**推奨アーキテクチャ決定 Top 5（各々に最強の反論を併記）**

1. **単一デプロイのモジュラーモノリス＋Bounded Context ごとの DB スキーマ所有＋Outbox によるイベント統合**。境界は CI の静的検査で強制する。AI 駆動開発では「境界がテストで守られている」ことが、エージェントの変更を安全に受け入れる前提条件になる。
   - *最強の反論*: 単一 DB は将来テナント分離やサービス抽出をする際の最大の摩擦点であり、最初から Medusa 型「モジュールはテーブルを共有しない」を徹底しないと、分散モノリスに劣る密結合になる。
2. **共有テーブル＋tenant_id＋PostgreSQL RLS（FORCE、SET LOCAL、tenant_id 先頭インデックス）をデフォルトとし、エンタープライズ向けに DB-per-tenant へ昇格できる抽象を最初から持つ**。
   - *最強の反論*: ERP は規制産業・大企業が主要顧客で、物理分離を要求しがち。DB-per-tenant の方が「顧客ごとのバージョン差・バックアップ・データ主権」を単純に解決でき、RLS bypass 事故のテール・リスクを構造的に消せる。
3. **「コア業務エンティティはコードで型付き、拡張はメタデータ」のハイブリッド**。台帳・在庫・受注などは静的スキーマ＋生成型で保ち、業種パックは Shopify 型 metafield/metaobject と JSONB＋GIN で追加する。EAV は採用しない。
   - *最強の反論*: Salesforce・Frappe が示すように「全てがメタデータ」の方が業種横断の適応速度は圧倒的に高く、ハイブリッドは「どこまでがコアか」の境界紛争を永続的に生む。
4. **財務コアは append-only の複式台帳を独立モジュールとして設計**: journal_entry/line、debit XOR credit、通貨別貸借一致を deferrable trigger で強制、`effective_at` と posting timestamp のバイテンポラル、訂正は逆仕訳のみ、ディメンションはタグ列、採番は転記時に no_gap シーケンスで確定。文書は Frappe 型 docstatus を共通基底に。
   - *最強の反論*: TigerBeetle や Formance のような専用台帳エンジンを組み込む方が「台帳で犯しがちな失敗」を回避できる。自作 PostgreSQL 台帳は高負荷時の直列化ボトルネックを自前で解決する必要がある。
5. **認可は「ロール×モデル CRUD」＋「ドメイン式による行フィルタ（クエリ変換）」＋「フィールド groups」の三層をコア内蔵。API は最初から MCP 前提で設計する**。
   - *最強の反論*: 一覧クエリの権限フィルタは ERP 全体を横断する最も複雑な横断関心事で、自作すると「ルールが増えるほど遅くなる」。最初から Zanzibar 型に統一した方が、共有・階層・委任を一つのモデルで表現できる。

**その他の含意**: 分析は OLTP から CDC/Parquet で切り離した DuckDB 系にし、セマンティックレイヤーでテナント分離済みメトリクスを供給する。ローカライズは「国パッケージ＝勘定科目表・税・fiscal position・レポート・e-invoice フォーマット」の単位でプラグイン化し、税計算は同期フック＋転記時 commit のインターフェースで外部エンジン差し替え可能にする。

## Sources
- https://shopify.engineering/shopify-monolith
- https://www.javacodegeeks.com/2025/12/microservices-vs-modular-monoliths-in-2025-when-each-approach-wins.html
- https://byteiota.com/modular-monolith-42-ditch-microservices-in-2026/
- https://dev.to/x4nent/the-modular-monolith-2026-complete-guide-spring-modulith-archunit-fitness-functions-and-lessons-878
- https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html
- https://milanjovanovic.tech/blog/bounded-context-ddd-explained
- https://www.gartner.com/en/information-technology/topics/enterprise-resource-planning
- https://www.trisotech.com/composability-and-packaged-business-capabilities/
- https://www.gartner.com/en/documents/5494395
- https://www.trenegy.com/publications/composable-erp-gartners-idea-thats-really-just-chipotle-for-software
- https://www.infor.com/blog/headless-erp-digital-modernization
- https://www.tailor.tech/headless-erp
- https://www.adiagr.com/blog/07-saas-postgres-multitenancy-patterns/
- https://learn.microsoft.com/en-us/azure/architecture/guide/multitenant/considerations/tenancy-models
- https://www.crunchydata.com/blog/row-level-security-for-tenants-in-postgres
- https://queryplane.com/blog/postgres-row-level-security-in-practice/
- https://architect.salesforce.com/docs/architect/fundamentals/guide/platform-multitenant-architecture.html
- https://www.netsuite.com/portal/resource/articles/data-warehouse/multi-tenancy.shtml
- https://www.odoo.com/forum/help-1/is-odoo-multi-tenant-or-customer-dedicated-176614
- https://en.wikipedia.org/wiki/Inner-platform_effect
- https://frappe.io/framework/doctype
- https://discuss.frappe.io/t/scaling-regional-localisation-for-erpnext/133795
- https://docs.bswen.com/blog/2026-04-24-jsonb-vs-eav-postgresql/
- https://shopify.dev/docs/apps/build/metaobjects/data-modeling-with-metafields-and-metaobjects
- https://www.instant.one/blog/schema-first-code-generation-for-extensible-software-platforms
- https://medium.com/@zada.zavar/five-patterns-for-metadata-driven-platforms-3ed27b8f3ec4
- https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-v
- https://developer.squareup.com/blog/books-an-immutable-double-entry-accounting-database-service/
- https://densitylabs.io/blog/building-trust-how-stripe-ensures-financial-accuracy-with-ledger/
- https://docs.tigerbeetle.com/concepts/debit-credit/
- https://www.formance.com/blog/engineering/defining-double-entry
- https://beancount.io/blog/2025/07/22/beancounts-technical-edge-a-deep-dive-on-performance-python-api-and-data-integrity-vs-ledger-hledger-and-gnucash
- https://plaintextaccounting.org/Recording-dates
- https://www.matthewswong.com/en/blog/erp-general-ledger-double-entry-design/
- https://www.dualentry.com/blog/general-ledger-in-erp
- https://www.netsuite.com/portal/resource/articles/accounting/multi-currency-accounting.shtml
- https://www.architecture-weekly.com/p/building-your-own-ledger-database
- https://docs.frappe.io/framework/doctypes/docstatus
- https://docs.frappe.io/erpnext/edit-submitted-document
- https://readmex.com/en-US/frappe/frappe/page-90335d98a-823c-4948-8a8e-4438e6b3587d
- https://apps.odoo-community.org/modules/account_move_name_sequence
- https://deploymonkey.com/blog/odoo-sequence-gap-missing-numbers-fix
- https://temporal.io/blog/temporal-replaces-state-machines-for-distributed-applications
- https://www.architecture-weekly.com/p/workflow-engine-design-proposal-tell
- https://erp-software.org/en/glossary/audit-trail/
- https://openfga.dev/docs/authorization-concepts
- https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/
- https://sph.sh/en/posts/external-authorization-management-systems/
- https://www.cerbos.dev/blog/filtering-database-results-with-cerbos-query-plans
- https://www.odoo.com/documentation/19.0/developer/reference/backend/security.html
- https://www.odoo.com/documentation/19.0/developer/tutorials/server_framework_101/12_inheritance.html
- https://docs.frappe.io/framework/user/en/python-api/hooks
- https://docs.medusajs.com/learn/customization/extend-features
- https://docs.saleor.io/developer/extending/webhooks/synchronous-events/overview
- https://thecodinginterface.com/blog/cqrs-read-model-patterns/
- https://motherduck.com/learn/duckdb-vs-postgres-embedded-analytics/
- https://oneuptime.com/blog/post/2026-09-08-duckdb-embedded-analytics-not-oltp/view
- https://cube.dev/articles/best-embedded-analytics-platforms-2026
- https://erp.today/sap-joule-agents-ariba-fieldglass-procurement-automation-2026/
- https://erp.today/sap-anthropic-claude-joule-mcp/
- https://architecture.learning.sap.com/docs/ref-arch/76ec36
- https://www.oracle.com/news/announcement/oracle-introduces-fusion-agentic-applications-2026-03-24/
- https://www.microsoft.com/en-us/dynamics-365/blog/business-leader/2026/03/18/2026-release-wave-1-plans-for-microsoft-dynamics-365-microsoft-power-platform-and-copilot-studio-offerings/
- https://www.azurecurve.co.uk/2026/05/new-functionality-in-microsoft-dynamics-365-business-central-2026-wave-1-create-agentic-experiences-with-enhanced-mcp-server/
- https://www.usecarly.com/blog/odoo-ai/
- https://apps.odoo.com/apps/modules/19.0/mcp_server
- https://github.com/rakeshgangwar/erpnext-mcp-server
- https://erp.today/model-context-protocol-erp-agentic-ai/
- https://erpsoftwareblog.com/cloud/2025/12/top-trends-in-erp-insights-from-gartners-roadmap/
- https://www.anthropic.com/engineering/writing-tools-for-agents
- https://www.odoo.com/documentation/19.0/applications/finance/fiscal_localizations.html
- https://knowledgelib.io/business/erp-integration/tax-engine-integration/2026
- https://e-invoice.be/e-invoicing-mandate-matrix
- https://www.digital.go.jp/en/policies/electronic_invoice
