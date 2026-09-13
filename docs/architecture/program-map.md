# プログラム地図

[全体像](README.md) / [AI向け入口](../../AI_INDEX.md)

## packageと役割

| 場所 | 責任 | 変更の入口 |
| --- | --- | --- |
| `kernel/` | DSL、権限、行境界、Repository、伝票、監査、採番、イベント、storage | [公開API](../../kernel/src/index.ts) |
| `modules/` | 会計、取引先、商品、税、売上、購買、支払、在庫、契約、商流、銀行、申告準備、添付、従業員/労務、業種共通の案件処理 | 各packageの `src/index.ts` と `src/module.ts` |
| `l10n/jp/` | 日本向けの帳票・制度・設定 | [日本module](../../l10n/jp/src/index.ts) |
| `packs/` | 業種固有のdocument、workflow、設定、sample、UIメニュー | 各packageの公開indexとpack定義 |
| `apps/runtime/` | 全adapterが使うmodule/pack catalogとenv読込 | [catalog](../../apps/runtime/src/catalog.ts)、[pack選択](../../apps/runtime/src/packs.ts) |
| `apps/api/` | JWT認証、HTTP、OpenAPI、DB/導入CLI | [server](../../apps/api/src/server.ts)、[main](../../apps/api/src/main.ts) |
| `apps/web/` | React画面、会社切替、汎用entityフォーム、専用業務画面 | [router](../../apps/web/src/router.tsx)、[API client](../../apps/web/src/api/client.ts) |
| `apps/edge/` | 店舗からの外向きHTTPS/WSS、耐久journal、IPP/模擬driver、OS別サービス導入。業務DBへ接続しない | [CLI](../../apps/edge/src/main.ts)、[setup](../../apps/edge/setup/main.ts)、[構造](edge-services.md)、[契約](../../modules/edge-integration/src/contract.ts) |
| `apps/mcp/` | actionから生成するMCP tools、呼出ごとの所属再確認 | [tools](../../apps/mcp/src/tools.ts)、[session](../../apps/mcp/src/session.ts) |
| 認証メール配送CLI | 暗号化した認証mail outboxをTLS SMTPで配送。汎用業務event配送は別の未実装範囲 | [mail-cli](../../apps/api/src/identity/mail-cli.ts)、[業務outbox](../../kernel/src/events.ts) |
| `scripts/` | schema生成補助、文書生成、専用試験cluster、配布 | [scripts](../../scripts/) |

依存名・固定版は [workspace](../../pnpm-workspace.yaml)、[lockfile](../../pnpm-lock.yaml)、各packageの `package.json` にあります。この文書へ依存版を重複コピーしません。

## 調査から実装までの近道

| 症状/変更 | 最初に確認するもの |
| --- | --- |
| 一覧に他社/他拠点の行が出る | `repository/scope.ts`、entityの行policy、Contextに渡る実所属 |
| 画面で項目が編集できない | entity fieldのreadOnly/serverOwned、allowedOps、metadata、document状態 |
| APIとMCPで動作が違う | adapterのContext生成とaction名。業務actionの複製を作らない |
| 二重処理で請求/有給/給与が重複する | business keyのwithLock、unique、expectedVersion、再実行の状態確認 |
| 新packが出ない | runtimeに登録、DAIFUKU_PACKS、選択会社で適用済みか、roleを順に確認 |
| schemaに変更がない | schema用runtimeが全packを読んでいるか、entityがregistryに登録されたか |
| 給与/申請が会社切替後も残る | query keyのcompany/user、abort/invalidate、権限エラー時の前データ表示 |
| 出荷後の請求で在庫がもう一度動く | `modules/trade/src/posting.ts` とinventoryの `source-documents.ts`。既存の請求単独処理も回帰する |
| 銀行の再取込・消込・出力で重複する | bankingの `imports.ts` / `reconcile.ts` / `transfers.ts`、同一キーと内容、原明細の不変性 |
| 申告資料の根拠が古い・形式が違う | tax-filingの `workflow.ts` / `profile.ts`、l10n/jpの `filing/`。保存根拠と現行根拠を区別する |
| ピボットの総計・小計・平均が合わない | `apps/web/src/lib/pivot.ts`、対象の1行の粒度・状態・日付、`apps/api/src/analytics/catalog.ts`。帳票の残高と期間増減を区別する |
| 分析設定や取得行が会社・権限変更後も残る | `analyticsScopeKey`、カタログquery keyと再確認、Worker取消、`analytics-storage.ts` の利用者・tenant・会社キー |
| メニューに重複・分類違い・未許可画面が出る | `apps/web/src/lib/navigation.ts` の共通カタログ、既存metadataと専用画面の利用条件。画面側へ分類と権限条件を複製しない |
| 画面の戻り先・パンくずが一致しない | 現在のpathname、カタログのURL解決、共通router。entityの新規・詳細を一覧へ対応させる |

## 生成物と手書きの境界

DSL定義と業務actionが手書きの正本です。table/Zod/汎用CRUD/REST/MCPのschemaはそこから導出します。DBのgenerated schemaを独立に編集して業務定義を増やしません。

DB migrationは、生成結果を確認したうえで追加し、すでに適用した履歴を改変しません。Webの汎用フォームはmetadataを解釈し、スマホ打刻や本部承認など操作のまとまりが必要な業務は専用画面から同じactionを呼びます。

バイナリ添付はstorage portの先、DB dumpと実envは管理対象の非公開領域です。ソース管理と混ぜません。文書用画像は合成データだけを使います。

## 新しい共通業務の入口

- [従業員module](../../modules/workforce/src/index.ts): 公開entity・wire contract・制度seed。勤怠/休暇/経費/給与は各actionから開始する。
- [領収書module](../../modules/workforce-evidence/src/index.ts): 経費に従属する添付サービスと型。
- [業種共通処理](../../modules/industry-operations/src/index.ts): 業種固有の案件documentを組み立て、開始/完了/請求/集計を共通化する。
- [10業界の定義](../../packs/industry-catalog/src/index.ts): 選択したpackだけを読み、業種固有項目・検収条件・サンプルを載せる。

## 企業運営の追加入口

認証/MFAのsystem tables・API adapter、Square署名通知、会社横断認可、連結/FC、給与税保険/年調/勤務制度の責任分担は [企業運営拡張の構造](enterprise-operations.md) にまとめています。業務3moduleはruntime catalogで全adapterへ登録し、認証system tableの追加はADR-0022に基づきkernelへ登録します。具体的な画面入口は [付録H](../manual/appendix-h-enterprise-operations.md) と [付録I](../manual/appendix-i-fiscal-and-work-systems.md) を参照してください。

## 店舗機器と共通配備

[機器module](../../modules/edge-integration/src/index.ts) はgateway/device/job/eventのDSLと状態遷移を持ちます。[機械認可](../../kernel/src/relay-auth.ts) は人間JWTから独立し、[HTTP/WSS](../../apps/api/src/edge/routes.ts) が通知とHTTPS取得を提供します。[店舗UI](../../apps/web/src/pages/edge-page.tsx) は同じ公開actionを使用します。[共通配備](deployment.md) には配布graph、manifest、Caddy/systemd、readinessの関係をまとめています。

## 商流・銀行・申告準備

[統合構造](commerce-finance.md) に依存図と変更先をまとめています。`modules/trade` が既存inventory/invoiceを原資料に結び、`modules/banking` が既存payment/accountingと照合します。`modules/tax-filing` は資料採取と確認workflow、`l10n/jp/src/filing` は日本の出力profileを担当します。Webの `/commerce/trade`、`/finance/banking`、`/finance/filing` は公開contractを読み、専用actionを共通の [finance client](../../apps/web/src/api/finance.ts) から呼びます。

## レポートとブラウザ・ピボット

[分析の構造](reporting-pivot.md) と [付録M](../manual/appendix-m-analytics.md) に対象・数字の意味・操作をまとめています。`/reports` は既存 `TableResult` 帳票への入口、`/analytics` は最大9対象・18テンプレートから始めるブラウザ集計です。[API許可リスト](../../apps/api/src/analytics/catalog.ts) と [完全取得](../../apps/api/src/analytics/snapshot.ts) が権限内の最大5万行を同じ読取専用スナップショットから返し、[pivot.ts](../../apps/web/src/lib/pivot.ts) がWeb Worker内で十進集計します。[保存設定](../../apps/web/src/lib/analytics-storage.ts) はブラウザ内で利用者・tenant・会社ごとに分離し、業務行を保存しません。API取得上限・集計状態上限・表示ページ数は別の制限です。

## 業務分野と現在位置

[ナビゲーションの構造](navigation-workspaces.md) と [付録N](../manual/appendix-n-navigation.md) がホーム・左メニュー・全画面検索・分野別入口・パンくずの入口です。`/workspaces` から画面を検索し、`/workspaces/<workspace>` から業務目的を選びます。共通カタログを使って同じURLの重複を除き、既存の `/e/`・`/a/`・`/r/` と専用画面へ遷移します。表示の分類はAPIの認可や業務moduleの所有関係を変更しません。
