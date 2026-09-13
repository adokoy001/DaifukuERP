# ビルド済みAPIと管理用ツール

仕様: [追加レビュー対応](../specs/review-hardening.md)。配備: [共通Linux配布](deployment.md)、[運用手順](../operations/deployment.md)。

## 成果物

`pnpm build:api` は型検査を実行し、固定済みのAPI依存グラフを `.runtime/api` へコピーする。first-partyの各workspaceは `src` の配置を保った `dist/*.js` に変換し、成果物内のpackage exportsを `dist` へ向ける。`pnpm --filter @daifuku/api start` はその生成済みAPIをNodeで起動する。開発時の `pnpm dev:api` は引き続きtsx watchを使う。

release buildも同じコンパイラを使い、`runtime/apps/api/dist/main.js` と `dist/setup/cli.js` を配布する。systemdと管理CLIはtsx loaderを必要としない。tsxはAPIの開発依存で、通常のAPI依存には含めない。

全体を1ファイルへbundleせず、パッケージ・モジュールの配置を維持する。相対importの `.ts` を `.js` へ変換し、制度JSON等を対応するdist位置へコピーする。`import.meta.url` を使うmigration/readinessの `../../drizzle/migrations` は元と同じ位置関係になる。第三者の固定package・ライセンス・内部symlinkは既存の配布方法を保つ。

TypeScriptの変換だけは型検査ではない。ソースの型検査をbuild前とgate/CIで行い、コンパイル済み成果物をNodeだけでロードして動作を確認する。ソースはreleaseの `source/` に残り、成果物を手編集して修正しない。

## 通常APIと管理機能

kernelの共通入口はschema生成を再exportしない。開発・テストのschema生成は明示的な `@daifuku/kernel/schema-tooling` を使う。通常APIの実際のmodule解決を試験で監視し、tsx、drizzle-kit、first-party `.ts` のロードを拒否して回帰を防ぐ。

drizzle-kit自体はsetupの未公開schema差分検出とmigration生成に必要なため、共通配布物の管理機能用に残す。依存をdevへ移すだけでsetupを壊さない。readinessは同梱migrationのhashと適用履歴を検査し、生成器を必要としない。APIのidentity処理がowner接続を必要とする現行設計は維持する。

## 検査

`pnpm test:deploy` は相対static/dynamic import、JSONとファイルURL、public subpath、実際のAPI module graph、独立したsetup help、生成serviceのJS起動を検査する。release検査では固定manifestに加え、新しいローカルDBで同梱migration、health/ready、正常停止を確認する。起動時間やメモリの改善率は測定なしに数値を主張しない。

根拠（2026-09-14確認）: [TypeScript rewriteRelativeImportExtensions](https://www.typescriptlang.org/tsconfig/rewriteRelativeImportExtensions.html)。
