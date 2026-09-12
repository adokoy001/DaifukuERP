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
