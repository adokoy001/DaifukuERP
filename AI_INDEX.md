# AI・開発者の入口

このファイルは改修時の読書順と実装への索引です。人もAIも同じMarkdownを使います。実行規約は [AGENTS.md](AGENTS.md)、利用者向け起動は [README](README.md)、実装の現在地は [STATUS](docs/STATUS.md) を参照してください。

## 最初の5分

1. `git status --short` と現在のbranchを確認し、既存の編集を保持する。
2. [構成の全体像](docs/architecture/README.md) と [プログラム地図](docs/architecture/program-map.md) で変更する層を選ぶ。
3. 変更に対応する `docs/specs/` の受入基準と `docs/adr/` の判断を読む。新しい業務契約は先にspecへ書く。
4. 下表から必要な文書とソースだけを読む。過去ログの全読込を前提にしない。
5. 実装後、[検証・移行・公開](docs/architecture/verification-and-release.md) に沿って測定し、実施結果と未検証範囲を残す。

## 作業別の読書順

| 作業 | 先に読む | 実装の入口 |
| --- | --- | --- |
| 業務項目・伝票・計算 | [データと処理](docs/architecture/runtime-and-data.md)、[拡張手順](docs/architecture/extension-guide.md) | [DSL](kernel/src/dsl/entity.ts)、[Repository](kernel/src/repository/repository.ts)、対象 `modules/*/src` |
| 権限・会社・拠点・本人分離 | [権限境界](docs/architecture/permissions.md)、[ADR-0018](docs/adr/0018-company-and-store-access.md) | [principal](kernel/src/principal.ts)、[会社所属](kernel/src/company-access.ts)、[権限](kernel/src/permissions.ts) |
| 本人認証・失敗時の保護 | [本人設定](docs/operations/account-security.md)、[品質改善仕様](docs/specs/quality-foundation.md) | [API認証](apps/api/src/plugins/auth.ts)、[本人画面](apps/web/src/pages/account-page.tsx) |
| 従業員スマホ・労務 | [従業員の構造](docs/architecture/workforce.md)、[統合受入基準](docs/specs/workforce-platform.md)、[日本の労務・給与](docs/domain/japan-workforce.md) | [Web routes](apps/web/src/router.tsx)、[module catalog](apps/runtime/src/catalog.ts) |
| 社員条件・シフト推薦 | [シフト構造](docs/architecture/shift-planning.md)、[仕様](docs/specs/employee-shift-planner.md)、[操作](docs/operations/shift-planning.md)、[ADR-0020](docs/adr/0020-browser-shift-planning.md) | [純粋エンジン](modules/workforce/src/scheduling/index.ts)、[snapshot](modules/workforce/src/shift-source.ts)、[管理UI](apps/web/src/pages/shift-page.tsx) |
| 業界テンプレート | [15業界の範囲](docs/domain/industry-catalog.md)、[pack規約](docs/conventions/packs.md)、[拡張手順](docs/architecture/extension-guide.md) | [pack catalog](apps/runtime/src/packs.ts)、[pack適用](kernel/src/pack.ts) |
| REST/MCP・外部呼出 | [処理経路](docs/architecture/runtime-and-data.md) | [REST](apps/api/src/routes/rest.ts)、[actions](apps/api/src/routes/actions.ts)、[MCP](apps/mcp/src/tools.ts) |
| UI・フォーム・レポート | [UI規約](docs/conventions/ui.md)、[report規約](docs/conventions/reports.md) | [router](apps/web/src/router.tsx)、[Web API](apps/web/src/api/)、[pages](apps/web/src/pages/) |
| スキーマ・導入・更新 | [検証と公開](docs/architecture/verification-and-release.md)、[安全なsetup](docs/operations/setup.md) | [schema同期](kernel/src/db/schema-sync.ts)、[setup](apps/api/src/setup/) |
| 日本制度の修正 | [国内税](docs/domain/japan-tax.md)、[労務・給与](docs/domain/japan-workforce.md) | 対象l10n/moduleの期間付き設定・算定処理 |

## 変更時に保つ契約

業務データは `Context` と `Repository` を通す。画面を非表示にするだけで権限制御を済ませない。会社/拠点/本人の境界はロール権限と別の制限として扱う。承認や会計処理の副作用は同じトランザクションで行い、二重実行をロック・一意性・版で防ぐ。

金額と数量は `Decimal`。確定済み伝票・帳簿は直接書き換えない。日本の制度は一次資料と確認日を残し、制度値と適用期間をデータに持つ。module/packからDBドライバやネットワークに直接依存しない。

## 文書の権威と更新

[文書の管理方法](docs/architecture/documentation-contract.md) の役割分担を使う。現在のソースと実行した試験が実装の証拠、specは期待動作、ADRは設計理由、logは過去の測定である。古いlogの手順が現行README/安全なsetupを上書きすることはない。

公開前の過去commit番号はローカル履歴への参照で、GitHub公開履歴と一致するとは限らない。実env・DB・dump・秘密・個人の開発セッションURLは文書へ貼らない。
