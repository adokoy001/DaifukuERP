# テスト規約

| 種別 | どこ | 何を | 実行 |
|---|---|---|---|
| unit | `test/*.test.ts` | 純粋関数（services/）、DSL の導出結果 | `pnpm test`（数秒） |
| property | 同上（fast-check） | 丸め・集計・状態遷移の不変条件 | 同上 |
| golden | `test/golden/*.json` | 仕訳・帳票・在庫評価・税計算の決定論的出力。差分は `pnpm test -- -u` で更新し、**更新理由を作業記録に書く** | 同上 |
| db | `test/*.db.test.ts` | Repository・RLS・採番・docstatus・監査。`daifuku_test` DB を毎回 migrate | `pnpm test:db` |
| e2e | `apps/web/e2e/*.spec.ts`（Playwright） | 画面経由の主要シナリオ。role-based locator、`waitForTimeout` 禁止、データは API fixture でシード | `pnpm e2e` |
| mutation | 金額・税・権限の経路のみ（StrykerJS、Phase 1〜） | テストが同じ思い込みを共有していないか | 週次 |

- テスト名に受入基準 ID（`AC-3`）を含める。
- テストの削除・skip・`expect` の骨抜きは禁止（lint）。誤ったテストは直し、作業記録に書く。
- 実装エージェントとは別コンテキストのレビュアがテストの「意味」を審査する（カバレッジではなく）。
