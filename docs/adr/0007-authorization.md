# ADR-0007: 権限は default-deny・単一機構（ロール×操作＋行ルール＋フィールド群）

- 状態: 採択／ 確信度: 中
- 出典: research/01 §4-4、research/02 §6（Odoo 3層、Frappe 5層と default-allow、Cerbos query plan）

## 決定
- 操作: `read / create / update / delete / submit / cancel / amend / export`。定義に無いロールは拒否。
- 行ルール: `rowRules: [{ roles, where }]` の `where` はドメイン式（`{ field: value }`, `$or`, `$in`, `$ctx.userId` 等）で、Repository が SQL WHERE に変換する。一覧・取得・更新・削除すべてに適用。
- フィールド群: `fieldGroups: { sensitive: { fields: [...], roles: [...] } }`。読み出しではマスク、書き込みでは拒否。
- 内部呼び出しも同じ Repository を通す。`ignorePermissions` に相当する引数は存在しない（lint で検知）。`systemContext()` はマイグレーション・シード・worker 専用で、全ロールを持つが監査ログに `actor.type='system'` と記録される。
- エージェント経由の操作は `actor.type='agent'` と `actor.onBehalfOf`（ユーザー）を監査に残す。
- 機械用資格情報（API キー）による操作は `actor.type='machine'`・`actor.id` = 資格情報の id（`onBehalfOf` なし）を監査に残す。鍵は通常のロールで同じ Repository の検査を通り、人の本人性を要する port と業務判断（`requireHumanUserId`）は拒否する（[ADR-0023](0023-outbound-relay-principal-and-fencing.md) の追補「連携・MCP 用の機械用資格情報」、2026-10-30）。

## 最強の反論
一覧の権限フィルタは最も複雑な横断関心事で、自作すると「ルールが増えるほど遅くなる」。Zanzibar 型（OpenFGA）に統一する方が委任・共有を一元化できる。→ Phase 3 で委任・共有要件が出た時点で再評価。
