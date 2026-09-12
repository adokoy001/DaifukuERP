# ADR-0007: 権限は default-deny・単一機構（ロール×操作＋行ルール＋フィールド群）

- 状態: 採択／ 確信度: 中
- 出典: research/01 §4-4、research/02 §6（Odoo 3層、Frappe 5層と default-allow、Cerbos query plan）

## 決定
- 操作: `read / create / update / delete / submit / cancel / amend / export`。定義に無いロールは拒否。
- 行ルール: `rowRules: [{ roles, where }]` の `where` はドメイン式（`{ field: value }`, `$or`, `$in`, `$ctx.userId` 等）で、Repository が SQL WHERE に変換する。一覧・取得・更新・削除すべてに適用。
- フィールド群: `fieldGroups: { sensitive: { fields: [...], roles: [...] } }`。読み出しではマスク、書き込みでは拒否。
- 内部呼び出しも同じ Repository を通す。`ignorePermissions` に相当する引数は存在しない（lint で検知）。`systemContext()` はマイグレーション・シード・worker 専用で、全ロールを持つが監査ログに `actor.type='system'` と記録される。
- エージェント経由の操作は `actor.type='agent'` と `actor.onBehalfOf`（ユーザー）を監査に残す。

## 最強の反論
一覧の権限フィルタは最も複雑な横断関心事で、自作すると「ルールが増えるほど遅くなる」。Zanzibar 型（OpenFGA）に統一する方が委任・共有を一元化できる。→ Phase 3 で委任・共有要件が出た時点で再評価。
