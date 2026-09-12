# ADR-0009: 全操作は宣言的アクション。REST と MCP に自動公開

- 状態: 採択／ 確信度: 高
- 出典: research/01 §4-8（OFBiz service 定義、AI-native ERP）、research/02 §9（MCP、Anthropic ツール設計）

## 決定
- `defineAction({ name, input: zod, output: zod, permission, tx, description: {ja,en}, handler })`。
- api は `POST /actions/{name}` を自動生成し、OpenAPI に載せる。mcp は同じ定義から tool を生成する（名前は `.`→`_`）。
- エンティティの CRUD も kernel が汎用アクション（`<entity>.list/get/create/update/delete/submit/cancel/amend`）として登録する。
- ツール説明は「何をするか・いつ使うか・戻り値の意味」を含め、エラーは「次に何をすべきか」を返す。
- エージェント呼び出しは監査ログに `actor.type='agent'`。書き込み系は承認ゲート（Phase 4）を挟めるよう `tx: 'required'` の前段に `approval?: {...}` を予約。
