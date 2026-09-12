# コードスタイル

- TypeScript strict。`any` 禁止、非 null アサーション禁止。`unknown` を絞り込む。
- ファイル ≤ 400 行、関数 ≤ 80 行（lint）。責務で分割する。
- 命名: ファイル kebab-case、型 PascalCase、値 camelCase、DB 列 snake_case（DSL が変換）。エンティティ名は単数 snake_case（`sales_order`）。
- import は `import type` を優先（verbatimModuleSyntax）。
- 早期 return。ネスト ≤ 4。
- コメントは「なぜ」だけ。「何を」はコードで。
- 日本語のラベルは `{ ja: '…', en: '…' }` の両方を必ず書く。
- 例外は `KernelError` 系（conventions/errors.md）。`throw new Error('...')` は禁止（lint 予定）。
