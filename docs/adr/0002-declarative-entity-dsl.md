# ADR-0002: 宣言的エンティティDSL（TypeScript・型推論）を単一の真実源にする

- 状態: 採択（試作段階、Phase 1 前に再評価）／ 確信度: 中
- 出典: research/01 §4-1（Frappe DocType / Odoo ORM / Axelor XML→JPA の比較）、research/02 §3

## 文脈
Frappe は「スキーマ・ビュー・権限をデータとして持つ」ことで拡張が速いが型がない。Odoo/Tryton は型とテストに強いがボイラープレートが多く、AI が書く行数＝逸脱の余地になる。

## 決定
- `defineEntity` / `defineDocument` / `defineAction` を kernel が提供する。定義は TypeScript のオブジェクトリテラルで、`Infer<typeof X>` により TS 型が推論される。
- kernel は定義から Drizzle テーブル・Zod スキーマ（insert/update/select）・OpenAPI・権限行・監査設定・汎用 UI メタデータ・MCP ツール定義を**ランタイムで導出**する。生成ファイルは作らない（例外: drizzle-kit 用の schema.generated.ts は登録済みテーブルの再エクスポートのみ）。
- モジュール側が手で書くのは、定義・フック・アクションのハンドラ・専用画面のみ。

## 帰結
+ 1エンティティ追加のコード量が最小になり、H1（カーネル仮説）を測れる。
− 型推論が重くなると tsc が遅くなり、エラーメッセージが読めなくなる（中止基準: tsc 10秒超 or 型エラーが解読不能）。その場合は Axelor 型の codegen に切り替える。
− Drizzle 側のカラム型は内部的に緩く、モジュールの独自クエリは `entity.col('name')` 経由になる。

## 最強の反論
Salesforce/Frappe のように「全部メタデータ・ランタイム解釈」の方が業種横断の適応速度は上で、ハイブリッドは「どこまでがコアか」の境界紛争を永続的に生む。逆に ERPNext の勘定科目5ルート固定のように、静的コアが国別要件の壁になる。→ ext 列（ADR-0003）でテナント固有フィールドを吸収し、足りなくなった時点で再評価。

## 追補（2026-10-30）: `views.form` のラベル付きグループ

[form-ergonomics](../specs/form-ergonomics.md) AC-1 で、汎用フォームの節に見出しを付けるため `ViewsConfig.form` を後方互換に拡張した。新しい ADR 番号は使わない（DSL の表現力の小さな拡張であり、決定の骨格は変わらないため）。

### 決定
- `views.form` の各グループは、従来の field 名の配列（`['code', 'name']`）か、ラベル付きの `{ label: Label; fields: string[] }`（kernel の型 `FormGroup`）のどちらでもよい。1 つの entity の中で混ぜてよい。`'auto'` も従来どおり。
- `defineEntity` / `defineDocument` は定義時に検査する: グループの field 名は宣言済みであること、1 つの field は 1 回だけ現れること、ラベル付きグループは日本語・英語の両方が空でないラベルと 1 つ以上の field を持つこと。従来は `views.form` を検査していなかったため、既存の定義をすべて読み込んで（単体・DB の全 suite）違反が無いことを確かめた。
- `/meta` の `EntityMeta.views.form` は `'auto' | FormGroupMeta[]`、`FormGroupMeta = string[] | { label, fields }`。従来の形のグループは従来と同じ `string[]` のまま出すので、ラベルを使わない entity の meta はバイト単位で変わらない。マスクされた field はどちらの形でも取り除く。ラベル付きのグループの field がすべて見えないときは、見出しを付けずに空の `[]` を返す（権限の field group の外の role に、隠れた節の存在と名前を知らせないため。グループの位置は保つ。UI は空の節を出さない）。
- 同じ追補で `FieldMeta.restricted?: true` を加えた。権限の `fieldGroups` に属する field に付き、ブラウザがその値を端末内に保存しない（未保存入力の退避）ための印である。マスクの判定そのもの（`maskedFields`）は変えない。
- 見出しは表示用の文言であり、権限・保存・API の入出力には影響しない。pack の `labelOverrides` は節の見出しを対象にしない（必要になったら別に追補する）。

### 帰結
+ 長いフォームに見出しと、狭い画面のタブ（汎用 UI の規約。[UI規約](../conventions/ui.md)）を宣言だけで付けられる。
+ 定義時検査により、存在しない field 名の書き間違いが起動時に分かる（従来は UI が黙って無視していた）。
− `/meta` を読む外部の利用者（MCP の resource を読むエージェントなど）は、`views.form` の要素がオブジェクトの場合を扱う必要がある。ラベルを付けた entity（取引先・売上請求書・仕入請求書・入出金・契約）から形が変わる。
