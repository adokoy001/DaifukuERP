# ADR-0008: 拡張はフック・イベント・ext 列・Link。コア改変はしない

- 状態: 採択／ 確信度: 中
- 出典: research/01 §4-2/3、research/02 §7（Odoo `_inherit` の負債、Frappe hooks、Medusa Module Links）

## 決定
- パック/l10n は次の手段でのみコアの振る舞いを変える: (1) `registerHook(entity, phase, fn)`（before_validate / before_create / after_create / before_update / after_update / before_submit / after_submit / before_cancel / after_cancel）、(2) outbox イベントの購読、(3) `ext` フィールド定義の追加、(4) `registerOverride(point, fn)` — コアが明示的に公開した差し替え点（例: `tax.rounding`, `document.numbering`）、(5) 依存先テーブルへの FK を持つ自前エンティティ。
- コアのファイルを編集して業種/国固有のロジックを入れることは禁止。必要なら差し替え点を追加する PR をコア側に出す（それ自体を H3 の指標として数える）。
