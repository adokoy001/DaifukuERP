# AI・開発者の入口

このファイルは改修時の読書順と実装への索引です。人もAIも同じMarkdownを使います。実行規約は [AGENTS.md](AGENTS.md)、利用者向け起動は [README](README.md)、実装の現在地は [STATUS](docs/STATUS.md) を参照してください。

## 最初の5分

1. `git status --short` と現在のbranchを確認し、既存の編集を保持する。[整形・lint規約](docs/conventions/lint.md) を読み、整形後の構造を基準に変更単位を決める。
2. [構成の全体像](docs/architecture/README.md) と [プログラム地図](docs/architecture/program-map.md) で変更する層を選ぶ。
3. 変更に対応する `docs/specs/` の受入基準と `docs/adr/` の判断を読む。新しい業務契約は先にspecへ書く。
4. 下表から必要な文書とソースだけを読む。過去ログの全読込を前提にしない。
5. 実装後、[検証・移行・公開](docs/architecture/verification-and-release.md) に沿って測定し、実施結果と未検証範囲を残す。

## 作業別の読書順

| 作業 | 先に読む | 実装の入口 |
| --- | --- | --- |
| 業務項目・伝票・計算 | [データと処理](docs/architecture/runtime-and-data.md)、[拡張手順](docs/architecture/extension-guide.md) | [DSL](kernel/src/dsl/entity.ts)、[Repository](kernel/src/repository/repository.ts)、対象 `modules/*/src` |
| 権限・会社・拠点・本人分離 | [権限境界](docs/architecture/permissions.md)、[ADR-0018](docs/adr/0018-company-and-store-access.md) | [principal](kernel/src/principal.ts)、[会社所属](kernel/src/company-access.ts)、[権限](kernel/src/permissions.ts) |
| 外部認証・MFA・メール | [企業拡張の構造](docs/architecture/enterprise-operations.md)、[認証運用](docs/operations/enterprise-identity.md)、[認証仕様](docs/specs/enterprise-identity.md)、[ADR-0022](docs/adr/0022-identity-challenges-and-delivery.md) | [kernel identity](kernel/src/identity/index.ts)、[HTTP/adapter](apps/api/src/identity/routes.ts)、[本人UI](apps/web/src/components/identity-security.tsx) |
| POS・連結・FC | [企業拡張の構造](docs/architecture/enterprise-operations.md)、[商業仕様](docs/specs/enterprise-commerce.md)、[一次資料](docs/domain/pos-group-accounting.md)、[操作](docs/manual/appendix-h-enterprise-operations.md) | [Square](apps/api/src/adapters/square-pos.ts)、[POS](modules/pos-integration/src/index.ts)、[会社認可port](kernel/src/authorized-companies.ts)、[連結](modules/group-accounting/src/index.ts)、[FC](modules/franchise/src/index.ts) |
| 見積・受発注・分納・分割請求 | [統合構造](docs/architecture/commerce-finance.md)、[商流仕様](docs/specs/trade-workflow.md)、[一次資料](docs/domain/trade-workflow.md)、[操作](docs/manual/appendix-l-commerce-bank-filing.md) | [trade contract](modules/trade/src/contract.ts)、[専用action](modules/trade/src/actions.ts)、[在庫の原資料保護](modules/inventory/src/source-documents.ts)、[UI](apps/web/src/pages/trade-page.tsx) |
| 銀行明細・照合・振込ファイル | [銀行仕様](docs/specs/bank-integration.md)、[銀行一次資料](docs/domain/japan-bank-integration.md)、[操作](docs/manual/appendix-l-commerce-bank-filing.md) | [banking contract](modules/banking/src/contract.ts)、[照合](modules/banking/src/reconcile.ts)、[出力](modules/banking/src/transfers.ts)、[UI](apps/web/src/pages/banking-page.tsx) |
| 財務諸表・給与の申告準備 | [申告準備仕様](docs/specs/tax-filing-preparation.md)、[日本の仕様・出典](docs/domain/japan-tax-filing.md)、[統合構造](docs/architecture/commerce-finance.md) | [共通workflow](modules/tax-filing/src/workflow.ts)、[国別port](modules/tax-filing/src/profile.ts)、[国内formatter](l10n/jp/src/filing/profiles.ts)、[UI](apps/web/src/pages/tax-filing-page.tsx) |
| 税保険・年末調整・勤務制度 | [給与仕様](docs/specs/enterprise-payroll.md)、[制度版仕様](docs/specs/payroll-rule-versions.md)、[構造](docs/architecture/payroll-automation.md)、[一次資料](docs/domain/japan-payroll-automation.md)、[操作](docs/manual/appendix-i-fiscal-and-work-systems.md) | [制度選択](modules/workforce/src/payroll-rules/resolver.ts)、[国別port](modules/workforce/src/payroll-rules/port.ts)、[日本の算定器とデータ](l10n/jp/src/payroll/)、[年調](modules/workforce/src/actions/year-end.ts)、[勤務制度](modules/workforce/src/work-system-contract.ts) |
| 本人認証・失敗時の保護 | [本人設定](docs/operations/account-security.md)、[品質改善仕様](docs/specs/quality-foundation.md) | [API認証](apps/api/src/plugins/auth.ts)、[本人画面](apps/web/src/pages/account-page.tsx) |
| 従業員スマホ・労務 | [従業員の構造](docs/architecture/workforce.md)、[統合受入基準](docs/specs/workforce-platform.md)、[日本の労務・給与](docs/domain/japan-workforce.md) | [Web routes](apps/web/src/router.tsx)、[module catalog](apps/runtime/src/catalog.ts) |
| 社員条件・シフト推薦 | [シフト構造](docs/architecture/shift-planning.md)、[仕様](docs/specs/employee-shift-planner.md)、[操作](docs/operations/shift-planning.md)、[ADR-0020](docs/adr/0020-browser-shift-planning.md) | [純粋エンジン](modules/workforce/src/scheduling/index.ts)、[snapshot](modules/workforce/src/shift-source.ts)、[管理UI](apps/web/src/pages/shift-page.tsx) |
| 業界テンプレート | [15業界の範囲](docs/domain/industry-catalog.md)、[pack規約](docs/conventions/packs.md)、[拡張手順](docs/architecture/extension-guide.md) | [pack catalog](apps/runtime/src/packs.ts)、[pack適用](kernel/src/pack.ts) |
| REST/MCP・外部呼出 | [処理経路](docs/architecture/runtime-and-data.md) | [REST](apps/api/src/routes/rest.ts)、[actions](apps/api/src/routes/actions.ts)、[MCP](apps/mcp/src/tools.ts) |
| UI・フォーム・レポート | [UI規約](docs/conventions/ui.md)、[report規約](docs/conventions/reports.md) | [router](apps/web/src/router.tsx)、[Web API](apps/web/src/api/)、[pages](apps/web/src/pages/) |
| 業務分野・画面検索・戻り先 | [ナビゲーションの構造](docs/architecture/navigation-workspaces.md)、[受入仕様](docs/specs/navigation-workspaces.md)、[操作](docs/manual/appendix-n-navigation.md) | [カタログ](apps/web/src/lib/navigation.ts)、[分野・検索](apps/web/src/pages/workspaces-page.tsx)、[現在位置](apps/web/src/components/screen-trail.tsx)、[router](apps/web/src/router.tsx) |
| ピボット・分析対象・保存設定 | [分析の構造](docs/architecture/reporting-pivot.md)、[受入仕様](docs/specs/reporting-pivot.md)、[操作](docs/manual/appendix-m-analytics.md) | [許可リスト](apps/api/src/analytics/catalog.ts)、[完全取得](apps/api/src/analytics/snapshot.ts)、[ブラウザ集計](apps/web/src/lib/pivot.ts)、[保存境界](apps/web/src/lib/analytics-storage.ts)、[画面](apps/web/src/pages/analytics-page.tsx) |
| 店舗LAN・機器連携 | [機器仕様](docs/specs/deployment-edge.md)、[機械認可ADR](docs/adr/0023-outbound-relay-principal-and-fencing.md)、[中継運用](docs/operations/edge-agent.md)、[操作](docs/manual/appendix-j-store-devices.md) | [純粋contract](modules/edge-integration/src/contract.ts)、[業務module](modules/edge-integration/src/index.ts)、[API](apps/api/src/edge/routes.ts)、[agent](apps/edge/src/main.ts) |
| クラウド・オンプレ配備 | [構成](docs/architecture/deployment.md)、[導入](docs/operations/deployment.md) | [配布](scripts/build-release.mjs)、[manifest検査](deploy/files.mjs)、[構成生成](deploy/profile.mjs) |
| AWS の独立試用 | [仕様](docs/specs/aws-trial.md)、[運用手順](docs/operations/aws-trial.md) | [専用 CloudFormation](deploy/aws/trial.cloudformation.json)、[境界回帰](deploy/aws/trial.test.mjs) |
| スキーマ・導入・更新 | [検証と公開](docs/architecture/verification-and-release.md)、[安全なsetup](docs/operations/setup.md) | [schema同期](kernel/src/db/schema-sync.ts)、[setup](apps/api/src/setup/) |
| 日本制度の修正 | [国内税](docs/domain/japan-tax.md)、[労務・給与](docs/domain/japan-workforce.md) | 対象l10n/moduleの期間付き設定・算定処理 |
| 不変条件・生成検査・検査自身の品質 | [検証設計](docs/architecture/practical-verification.md)、[台帳](docs/verification/invariants.md)、[仕様](docs/specs/practical-verification.md) | [台帳検査](verification/assurance.mjs)、[mutation](verification/mutation/README.md)、[エッジモデル](verification/edge/README.md) |

## 変更時に保つ契約

店舗端末のWindows/Linux/macOSサービス導入を変更する場合は、[セットアップ構造](docs/architecture/edge-services.md)、[仕様](docs/specs/edge-installers.md)、[操作](docs/manual/edge-service-setup.md)を読み、`apps/edge/setup`の共通engineとOS adapterの境界を確認してください。

業務データは `Context` と `Repository` を通す。画面を非表示にするだけで権限制御を済ませない。会社/拠点/本人の境界はロール権限と別の制限として扱う。承認や会計処理の副作用は同じトランザクションで行い、二重実行をロック・一意性・版で防ぐ。

金額と数量は `Decimal`。確定済み伝票・帳簿は直接書き換えない。日本の制度は一次資料と確認日を残し、制度値と適用期間をデータに持つ。module/packからDBドライバやネットワークに直接依存しない。

銀行の候補は人が確認してから消込する。振込ファイル出力を送金済みにしない。申告準備の確認・出力を電子申告の提出・受理にしない。原資料に従属する請求/入出庫は専用の取消経路を使い、結果不明時は同じ再試行キーと内容で照会・再送する。銀行出力の同一バイト再取得と、申告出力の最新資料再検査は別の契約である。

## 文書の権威と更新

[文書の管理方法](docs/architecture/documentation-contract.md) の役割分担を使う。現在のソースと実行した試験が実装の証拠、specは期待動作、ADRは設計理由、logは過去の測定である。古いlogの手順が現行README/安全なsetupを上書きすることはない。

公開前の過去commit番号はローカル履歴への参照で、GitHub公開履歴と一致するとは限らない。実env・DB・dump・秘密・個人の開発セッションURLは文書へ貼らない。
