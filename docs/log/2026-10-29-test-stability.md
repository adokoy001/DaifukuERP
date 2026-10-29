# 作業記録: 2026-10-29 既存試験 2 件の不安定要因の修正

- セッション: 完成度向上の実装（回帰テスト階層の基準計測中に発見） ／ 担当: agent ／ 対象: [test-tiers](../specs/test-tiers.md) の前提
- 計測: tokens=null, agent_minutes=20, human_minutes=0, rework_lines=0, gate_failures=2

## 決めたこと（と理由）
- 試験を弱めず、時刻と解決キャッシュという試験側の前提だけを直す。期待値（30 件まで 200、31 件目 429。source 外の TypeScript を拒否し、source 内を使う）は変えない。

## やったこと
- `apps/api/test/identity-rate-limit.db.test.ts` の招待発行の上限試験で、`Date` を固定した（同じファイルのパスワード散布試験と同じ方法）。招待の上限は壁時計に揃った 5 分の固定窓（`kernel/src/identity/rate-limit.ts` の `reserve`）なので、31 回のループが窓の境界をまたぐと計数がリセットされ、31 回目が 200 になる。ループ時間 / 窓（この環境で約 10 秒 / 300 秒）の確率で失敗していた。
- `deploy/test/compiled-api.test.mjs` のコンパイラ取得元の試験で、「解決できない」確認と「解決できる」確認を別の一時ディレクトリに分けた。開発者の `NODE_PATH` がグローバルの TypeScript を解決できる環境では、1 回目の解決結果が Node のモジュール解決キャッシュに残り、同じディレクトリでの 2 回目が source 外を指して失敗していた。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）
- [実測] 基準計測（main と同じ `431dda5` 相当のソース）で `pnpm test:db` が 700 成功・1 失敗（招待上限の 31 回目が 200）、`pnpm test:deploy` が 15 成功・1 失敗（`The frozen source compiler is missing.`）。この環境の `NODE_PATH=/usr/local/lib/node_modules_global`。
- [実測] 修正前でも `NODE_PATH` を外すと `pnpm test:deploy` は 16 件成功、招待上限の試験は単独実行で成功（境界をまたがない回）。
- [実測] 修正後、`pnpm test:deploy` が `NODE_PATH` あり・なしの両方で 16 件成功。`vitest run --project db apps/api/test/identity-rate-limit.db.test.ts` が成功。対象ファイルの eslint、`apps/api` の型検査が成功。
- [レビュー] 固定窓の境界をまたぐ失敗は `reserve` の `floor(now / seconds)` から導いた。境界をまたぐ時刻を作って再現する試験は追加していない。

- [実測] Claude Code のエージェント作業ツリー（`.claude/worktrees/`、メインの checkout の中に作られる別 checkout）があると、メインの checkout で実行した vitest が unit 517 ファイルを余分に拾い、DB project も他の作業ツリーの suite を拾う状態だった（`vitest list --project unit --filesOnly`）。ESLint も flat config の既定では dot directory を除外しない。`eslint.config.js` の ignores、`vitest.config.mts` の unit / db の exclude、`.gitignore`（Prettier と gate の変更集合）に `.claude/worktrees/` を足し、修正後は unit・db とも 0 ファイルになることを確認した。

## 見つけた問題と修正（発見経路つき）
- 招待上限の試験が窓の境界で失敗する — 発見: 実測（基準計測）、修正: この記録と同じコミット
- コンパイラ取得元の試験が `NODE_PATH` のある環境で失敗する — 発見: 実測（基準計測）、修正: 同上

- エージェント作業ツリーがメインの checkout の検査に混入する — 発見: 実測（統合後の gate:full が vitest で他の作業ツリーの試験を拾った）、修正: 除外設定の追加

## 未実施（減らさない。完了したら「済」を付けて残す）
- 招待上限の境界をまたぐ時刻を明示的に作る回帰試験

## 判断待ち（利用者）
- なし

## 次のセッションへ
- 基準計測（この環境、4 CPU、他の作業と並行）: format:check 22 秒、typecheck 11 秒、lint 20 秒、unit 49 秒、DB 833 秒（116 ファイル・701 件）、test:deploy 22 秒、docs:check と verify:assurance は 1 秒未満。
