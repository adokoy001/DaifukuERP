# コードスタイル

- TypeScript strict。`any` 禁止、非 null アサーション禁止。`unknown` を絞り込む。
- ファイル1,000行・関数300行を超えたらlintで警告する（空行・コメント除外）。上限を満たすだけの分割はしない。読みやすさや責務の独立性が改善する場合に分割する。[整形・lint規約](lint.md) を参照。
- 命名: ファイル kebab-case、型 PascalCase、値 camelCase、DB 列 snake_case（DSL が変換）。エンティティ名は単数 snake_case（`sales_order`）。
- import は `import type` を優先（verbatimModuleSyntax）。
- 早期 return。ネスト ≤ 4。
- コメントはコードから読み取れない理由・境界・不変条件を補う。非自明な処理の新設・実質変更時は[責務ヘッダ](source-headers.md)を短く記す。自明な処理を言い換えるコメントは増やさない。
- 日本語のラベルは `{ ja: '…', en: '…' }` の両方を必ず書く。
- 呼出元が対処する業務・入力・認可エラーは `DaifukuError` 系、定義の誤りや内部不変条件違反は `Error`。拡張登録などの既存構造化エラー契約は維持する。[エラー設計](errors.md)を参照。
