# ADR-0003: コアは型付き静的スキーマ、拡張は JSONB `ext` 列＋定義レコード。EAV 禁止

- 状態: 採択／ 確信度: 高
- 出典: research/02 §3（inner-platform effect、JSONB vs EAV、Shopify metafield）

## 決定
- コアエンティティのフィールドは通常列。テナント/パック固有の追加フィールドは `ext jsonb` 列に格納する。現在の型定義はコード登録で、`ext_field_definitions` は将来の DB 定義用に保持する（[ADR-0014](0014-ext-fields-internal-actions-lines-hook.md)）。索引は実際の演算子に合わせ、完全一致には宣言された内部計算列とスコープ付き B-tree を使用する（[ADR-0026](0026-ext-equality-indexes.md)）。全 ext への GIN は実装していない。
- EAV（属性テーブル）は作らない。新しい「エンティティ」が必要なときはパックが `defineEntity` で通常テーブルを追加する。

## 最強の反論
テナント固有の新エンティティ（例: ホテルの「備品貸出台帳」）は ext では足りず、結局動的テーブル生成が要る。→ パックとしてコード化する（no-code は本実験のスコープ外）。
