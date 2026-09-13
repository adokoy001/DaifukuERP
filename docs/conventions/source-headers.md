# ソースの責務ヘッダ

`kernel/`・`modules/` の非自明な処理を新設・実質変更するときは、ファイル冒頭に短い説明を置く。読むべき仕様と、変更時に守る条件へすぐ移れることが目的である。

必要な項目だけを通常2〜5行にまとめる。既に同じ情報がある説明はそのまま使い、行数に合わせて削ったり水増ししたりしない。

- **責務と境界**: 何を決める処理か。純粋計算、DB更新、外部I/Oのどこを担当するか。
- **重要な不変条件**: 見落とすと挙動を壊す制約。例は丸め、ロックの寿命、取消・再試行の扱い。
- **仕様への入口**: 関連するspec・ADR・domainや、条件を検証する試験のパス。

```ts
// Pure moving-average valuation; callers authorize and persist stock movements.
// Every costDelta is the value change; zero quantity clears the remaining value.
// Contract: docs/specs/inventory.md; evidence: modules/inventory/test/moving-average.test.ts.
```

[moving-average.ts](../../modules/inventory/src/services/moving-average.ts) は、計算モデルと不変条件まで必要なため詳しく記した既存例である。[ext-index.ts](../../kernel/src/db/ext-index.ts) は短い境界説明の例。関数名の一覧・importの言い換え・作成者・更新日など、コードやGitから分かる情報は書かない。

再export専用ファイル、自明な型やDSL宣言、局所的な定数には一律に挿入しない。既存全ファイルの一括改修やテンプレートの機械的必須化は行わず、実質変更する責務の説明が古くなっていないかをレビューする。[コードスタイル](code-style.md)と[エラー設計](errors.md)も参照。
