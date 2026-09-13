# 検証・移行・公開

[全体像](README.md) / [貢献手順](../../CONTRIBUTING.md) / [安全なsetup](../operations/setup.md)

## 検証を分ける

| 種類 | 目的 | 方法 |
| --- | --- | --- |
| 型/lint/依存境界 | 宣言と層の契約を維持 | `pnpm typecheck`、`pnpm lint` |
| 単体 | 計算・状態・入力の境界値 | `pnpm test` |
| DB | RLS/所属/参照/確定/並行実行の実挙動 | `pnpm test:db`、破棄可能な専用DB |
| 統合gate | 上記を一括で再現 | `pnpm gate` |
| Web | 単体・型とproduction build | `pnpm --filter @daifuku/web test` / `typecheck` / `build` |
| API成果物 | 型検査済みJS・固定依存・管理CLI | `pnpm build:api`、`pnpm test:deploy`、[配置の契約](compiled-api.md) |
| E2E | 実画面の導線・失効・スマホ操作 | CONTRIBUTINGの空DB fixture + Playwright |
| setup受入 | install/upgrade/backup復元/失敗再開 | 別clusterで `pnpm test:setup` |
| 配布・機器 | 固定graph・改変検知・agent journal/実通信 | `pnpm test:deploy`、`pnpm --filter @daifuku/edge build`、専用DBで実API/TLS試験 |
| 文書 | AI入口と現行ソースの整合 | 主要文書のリンクと構成/契約を照合 |
| 不変条件の台帳 | 前提・参照先・変更時の再確認 | `pnpm verify:assurance`（gateに含む） |
| 対象限定mutation | 計算処理を壊した際の検出 | `pnpm verify:mutation`（別CI） |
| 有限モデル | エッジ状態遷移の安全性・到達性 | `pnpm verify:edge:model`（Java 17/21、別CI） |

DB試験は業務DB・UIデモと共有しません。TEST_DATABASE_URL_OWNERとTEST_DATABASE_URLは同じ専用DBを指し、owner/appの別roleを使います。既存roleの権限を試験の都合で変更しません。

生成DB操作列、会社/拠点の比較、独立したシフト全探索は通常のunit/DBへ組み込みます。[検証設計](practical-verification.md)と[台帳](../verification/invariants.md)で前提と限界を確認し、変更時は `pnpm verify:assurance --changed main` から直接参照する項目を見直します。

## スキーマ変更

Entityとsystem tableの定義を変更したら、`pnpm db:schema`、`pnpm db:generate` の結果を確認します。既存のmigrationを編集せず追加します。runtimeのpack選択をnoneにしても、schema catalogには登録済み全packを含めます。

新規導入だけでは既存データの保全を証明できません。旧migrationまでのfixtureに取引を作り、バックアップし、別の空DBへ復元してから追加migrationを適用し、旧データ・新既定値・制約を確認します。実環境への実行は [setup手順](../operations/setup.md) を使い、通常の再開でdb:resetしません。

## 試験で失敗したとき

原因がコード、fixture、環境のどれかを切り分け、失敗した契約と修正理由をログへ残します。期待値の削除、skip、timeoutの根拠なし拡大、認可の緩和で通しません。直した範囲を再検証し、新しい懸念がなければ同じ試験をむやみに繰り返しません。

## 公開するもの

ソース、Markdown、合成データの画面例、LICENSE/NOTICE、固定lockfile、CI設定を公開します。実env、DB、dump、添付、秘密、setup状態、個人の開発セッションURLを含めません。元のローカル履歴に私的情報がある場合は保全したまま、点検したtreeから新しい公開履歴を始めます。

[`scripts/bundle-all.sh`](../../scripts/bundle-all.sh) はcleanなHEADの追跡ソースだけをZIPへ出します。未追跡ファイルや.gitを取り込まず、既存出力の上書き、未確定変更、禁止パスを拒否します。生成マニュアルHTMLはローカル成果物です。

## 公開完了の条件

1. 現行候補でgate、Web、必要なE2E/setup受入と配布物検査が通る。
2. ライセンス/第三者表示と実装範囲が明確である。
3. 指定リポジトリへ点検した内容だけを反映し、remoteのtree（mode含む）とローカルを照合する。
4. GitHub Actionsの対象commitを確認して最終結果を記録する。

ソース公開とアプリのインターネット配信は別の操作です。接続権限の不足でpushできない場合、未公開と明記し、準備済みのcommit/保存先/必要な設定を示します。公開承認済みでも、接続成功やCI成功を推測して報告しません。

共通実行配布物は [`scripts/build-release.mjs`](../../scripts/build-release.mjs) を使います。offline frozen依存からAPI graph・Web・店舗agentを作り、ファイル内容/permission/symlinkをmanifestで検証します。設定とDBは含めません。詳細は [共通配備](../operations/deployment.md)。
