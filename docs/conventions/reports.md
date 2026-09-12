# レポート系アクションの出力規約（TableResult）

集計・帳票系のアクション（試算表、消費税集計、年齢表…）は、汎用 UI と MCP が同じ描画/解釈をできるように、出力を次の形に揃える。

**実体は kernel にある**: `import { tableResult, column, MAX_REPORT_ROWS, type TableResult } from '@daifuku/kernel'`（Phase 1.5 で accounting から移動。accounting からの再エクスポートは互換のため残す）。

```ts
import { z } from 'zod';
export const tableResult = z.object({
  title: z.object({ ja: z.string(), en: z.string() }),
  columns: z.array(z.object({
    key: z.string(),
    label: z.object({ ja: z.string(), en: z.string() }),
    kind: z.enum(['text', 'decimal', 'int', 'date', 'ref', 'bool']),
    ref: z.string().optional(),          // kind='ref' のとき参照先エンティティ名（UI がリンクにする）
    align: z.enum(['left', 'right']).optional(),
  })),
  rows: z.array(z.record(z.string(), z.unknown())),   // decimal は文字列で
  totals: z.record(z.string(), z.string()).optional(),  // 列 key -> 合計（decimal 文字列）
  meta: z.record(z.string(), z.unknown()).optional(),   // 期間・条件など
});
```

- 入力は `z.object({ from: date, to: date, ... })` のように明示。既定値はアクション側で決める（会計年度など）。
- `tx: 'none'`、`mutates: false`。
- 行数上限 10,000。超える場合は `meta.truncated = true`。
- 汎用 UI は `/r/<action>` でこの形を表として描画し、入力フォームは action の input zod（`/meta` の actions に `inputSchema`（JSON Schema）を含める）から生成する。
