# テスト規約

| 種別 | どこ | 何を | 実行 |
|---|---|---|---|
| unit | `test/*.test.ts` | 純粋関数（services/）、DSL の導出結果 | `pnpm test`（数秒） |
| property | 同上（fast-check） | 丸め・集計・状態遷移の不変条件 | 同上 |
| golden | `test/golden/*.json` | 仕訳・帳票・在庫評価・税計算の決定論的出力。差分は `pnpm test -- -u` で更新し、**更新理由を作業記録に書く** | 同上 |
| db | `test/*.db.test.ts` | Repository・RLS・採番・docstatus・監査。`daifuku_test` DB を毎回 migrate | `pnpm test:db` |
| e2e | `apps/web/e2e/*.spec.ts`（Playwright） | 画面経由の主要シナリオ。role-based locator、`waitForTimeout` 禁止、データは API fixture でシード | `pnpm e2e` |
| mutation | Decimal・貸借検査の全ソース（StrykerJS 10.0.0） | 故意の変更を検出するか。全件Killedを要求 | `pnpm verify:mutation`、別CI |
| finite model | `verification/edge/`（TLA+/TLC） | 有限範囲の安全性、到達性、実装との共有trace | `pnpm verify:edge:model`、別CI |

生成検査はseedと失敗時pathを記録する。成功/拒否/再送の到達を固定prefixで保証し、その後の生成tailも実行する。期待した業務エラーと内部例外を区別する。参照解の独立性、空集合だけで通る条件、未対応の入力範囲を[検証台帳](../verification/invariants.md)と[検証設計](../architecture/practical-verification.md)へ記載する。

- テスト名に受入基準 ID（`AC-3`）を含める。
- テストの削除・skip・`expect` の骨抜きは禁止（lint）。誤ったテストは直し、作業記録に書く。
- 実装エージェントとは別コンテキストのレビュアがテストの「意味」を審査する（カバレッジではなく）。
