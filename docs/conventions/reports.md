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

## 画面の条件と取得済み行

レポート画面は明示の入力default/titleを保持し、空の日付・対象年月・年を日本時間で補完する。会計年度や参照IDを推測して送信しない。画面で入力した条件と、サーバーが未指定時に選ぶ既定条件を区別する。日付を明示して実行した結果には、その期間をtitleまたはmetaで残す。[UIの入力規約](ui.md#レポートとピボットの入力表示) を参照。

`ReportTable` は受信済みの `rows` を検索・並替えし、25/50行ずつ描画する。`totals` はアクションが返した値を維持し、検索後や表示ページだけの合計へ置き換えない。受信行数・検索一致行数・表示範囲を明示する。行順変更時も金額の十進精度、同値の安定順、`ref` のリンクを保持する。CSVは結果内検索・ページの部分表示へ追従せず、出力時にアクションの条件と権限を使用する。

`meta.truncated` がある帳票の総計・残高の対象範囲はアクション側で説明する。画面ページングは返却上限の解消ではなく、取得済みの結果を見やすくする表示処理である。

## ブラウザ・ピボットとの境界

`/analytics/catalog` と `/analytics/snapshot` はブラウザ探索分析用の専用HTTP契約であり、`TableResult` ではない。任意entityやSQLを受け取らず、最大9対象の許可リストから会社・拠点・本人・項目権限を適用する。読取専用Repeatable Readで500行ずつ同じDBスナップショットを採取し、5万行を超える場合は部分結果を返さない。これは既存帳票の `MAX_REPORT_ROWS = 10000` と別の上限である。

ピボットでは1行の粒度、日付、対象状態、金額の通貨・数量の単位を明示する。請求ヘッダーを請求明細と呼ばない。期間原価増減を期末在庫残高、取得時点の請求残高を過去基準日の債権残高、銀行入出金を口座残高と呼ばない。店舗締めと売上請求など重複し得る対象を足さない。

ブラウザは元行から十進集計し、平均の小計・総計には合計と有効値件数を使う。行数・値のある件数・合計を区別し、欠測を0で埋めない。独自比率や加重平均の指標を追加する場合は、分子・分母・総計での再計算・ゼロ分母を先に定義する。現在提供する集計方法は合計・平均・最小・最大・値のある件数・記録件数である。

実装・保存境界・検査先は [分析の構造](../architecture/reporting-pivot.md)、受入基準は [仕様](../specs/reporting-pivot.md)、利用手順は [付録M](../manual/appendix-m-analytics.md) を参照する。
