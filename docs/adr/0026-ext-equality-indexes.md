# ADR-0026: ext の完全一致検索は内部計算列とスコープ付き B-tree で支える

- 状態: 採択
- 日付: 2026-09-14
- 関連: [JSONB 拡張](0003-typed-core-jsonb-ext.md)、[ext の型・検索](0014-ext-fields-internal-actions-lines-hook.md)、[全 schema のカタログ](0017-runtime-and-schema-catalog.md)、[受入基準](../specs/review-hardening.md)

## 背景

`searchable: true` は検索欄の `ILIKE '%入力%'` に加わる指定で、索引指定ではない。完全一致の `where: { 'ext.jan': '0001234567890' }` は別の操作である。JSONB 全体の GIN は `->>` で取り出した text の比較をそのまま高速化しない。

最初に検討した `left(ext ->> 'jan', 128)` の式索引は、隔離した PostgreSQL の実験で app ロール・FORCE RLS・generic plan の組合せでは候補の絞り込みに使われなかった。RLS より先に非 leakproof 式を評価させる変更は行わず、索引で参照する値を STORED generated column として保持する。

## 決定

ext の text 項目に `equalityIndex: true` を宣言できる。初回は小売 pack の `product.ext.jan` だけで使用する。通常列では従来の `index` を使い、ext の `unique` / `index` は引き続き定義エラーとする。

```ts
ext: {
  product: {
    jan: f.text({ maxLength: 13, searchable: true, equalityIndex: true }),
  },
},
```

全 pack を登録した後の `registry.tables()` が schema 専用の表を生成し、次を加える。

- 内部 text 列: `GENERATED ALWAYS AS (left((ext ->> 'jan'), 128)) STORED`。
- 非 unique B-tree: 会社単位なら `(tenant_id, company_id, 内部列)`、tenant 単位なら `(tenant_id, 内部列)`。
- 列・索引名: キーと方式から安定した名前を生成する。PostgreSQL の識別子長制限を守り、長い名前も hash で区別する。

runtime の `EntityDef.table`、参照カラム、公開フィールド、入力 schema は置き換えない。内部列は通常の SELECT の列挙、汎用入力、metadata、監査対象に追加しない。生成値は PostgreSQL が ext の INSERT / UPDATE と同時に維持し、Repository やフックの書込み経路に依存しない。

完全一致は内部列の一致で候補を絞り、**元の全文 text 比較を必ず残す**。`$in` も同じ規則に従う。128 文字を超える値が同じ接頭辞でも誤一致しない。候補と入力の切出しは双方で PostgreSQL の `left` を使い、JavaScript の UTF-16 単位で切らない。JAN の先頭ゼロ、重複コード、長い既存の自由形式値を保持する。索引のために元の JSONB を切り詰めない。

`null` は内部計算列の NULL を検索し、従来どおり JSON null とキー欠落を含む。`$ne` / `$like` / 汎用検索は元の全文条件のまま。数値・日付の範囲演算子や ext の並び替えは追加しない。検索値はバインドし、JSONB キーだけを登録済みの厳密な正規表現で検証したリテラルとして扱う。tenant/company 条件、row rules、権限、RLS は変更しない。

## 導入と寿命

`0016_ext_equality_indexes` は既存 schema に内部列 1 個と索引 1 本を追加する。過去の migration は変更しない。新しいアプリを起動する前に owner 用の migration 手順を実施する。通常リクエストや `pack.apply` から DDL を発行しない。

STORED 列の追加は既存行の計算と表の更新作業を伴い、通常の索引構築にもロック時間が必要である。大規模導入では所要時間・空き容量・バックアップと復元を確認して保守時間を設ける。`CREATE INDEX CONCURRENTLY` を既存のトランザクション内 migration へ挿入しない。将来のオンライン移行には、別の実行経路と中断・失敗・再開の管理が必要になる。

runtime の `DAIFUKU_PACKS` や会社の適用 pack の変更を、物理列・索引を削除する指示にしない。schema ツールは全インストール済み pack を読み込む。項目・索引の廃止は保持方針と明示的な migration をレビューする。将来の tenant 独自定義には、所有者・重複・索引数・容量の管理が必要であり、現段階で会社ごとに索引を増やす仕組みは作らない。

## 検証

- unit: 後からの登録、tenant/company ごとの schema、安定名、公開カラム不変、値のバインド、NULL / IN / 負条件、fuzzy 検索との分離。
- DB: 索引のない既存データからの追加、長文・絵文字・先頭ゼロ・重複コード、生成値の自動更新、会社・tenant・role の境界。
- 実行計画: 隔離した合成 2 万件、app ロールと FORCE RLS を維持した `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`、`force_generic_plan` で候補列まで索引条件に入ることを検査する。これは実運用の応答時間保証ではない。
- migration: 全 pack の 0015 と 0016 を比較し、計算列・索引以外の表定義を保持。既存商品・会社設定・version・FK を保持し、再実行で変化がないことを検査する。

## 公式資料

- [PostgreSQL: RLS](https://www.postgresql.org/docs/16/ddl-rowsecurity.html): 非 leakproof 関数より先に行の可視性を検査する。
- [PostgreSQL: generated columns](https://www.postgresql.org/docs/16/ddl-generated-columns.html): 保存計算列の更新と式の制限。
- [PostgreSQL: JSONB indexing](https://www.postgresql.org/docs/16/datatype-json.html#JSON-INDEXING): GIN の対応演算子と式の一致。
- [PostgreSQL: CREATE INDEX](https://www.postgresql.org/docs/16/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY): ロック、concurrent 構築の制限。
- [Drizzle: generated columns](https://orm.drizzle.team/docs/generated-columns): `generatedAlwaysAs` の宣言。

公式資料確認日: 2026-09-14。
