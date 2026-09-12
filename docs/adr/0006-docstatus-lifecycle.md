# ADR-0006: 伝票の共通基底 = docstatus（draft / submitted / cancelled）＋ amend

- 状態: 採択／ 確信度: 高
- 出典: research/02 §5（Frappe docstatus・Workflow、Odoo 採番問題、Temporal）

## 決定
- `defineDocument` は `docstatus smallint`（0 draft / 1 submitted / 2 cancelled）、`number`、`amended_from` を持つ。
- submit: 検証 → `before_submit` フック → 採番（no-gap）→ docstatus=1 → `after_submit`。submitted の行は「submit 後編集可」と宣言したフィールド以外は更新拒否。
- cancel: 依存文書（このドキュメントを参照する submitted 文書）があれば拒否 → `before_cancel` → docstatus=2 → `after_cancel`。
- amend: cancelled から複製し `amended_from` を設定、番号は `-1`, `-2` サフィックス。
- 承認フローは `transitions`（from/to/roles/guard）の宣言的ステートマシン。長期・外部連携・タイマーは worker のジョブに委ねる。
