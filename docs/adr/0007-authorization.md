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

## 追補（2026-10-30、access-insight F3）: 権限表の導出と監査の検索

[access-insight](../specs/access-insight.md) で、権限の可視化と監査の横断検索を足した。新しい仕組み（DSL・port）は無く、この ADR の範囲の読取規則なので追補にした（予約の ADR-0038 は使わない）。

- **権限表は宣言から導出し、手書きの一覧を持たない。** `kernel/src/permission-matrix.ts` の `derivePermissionMatrix` が entity の `permissions.roles`・`rowRules`・`fieldGroups`、`storeAccess`・`siteAccess`（`registerStoreAccess` を含む）・`relayAccess`、document の `transitions`、action の `permission` から entity × ロール × 操作の表を作る。各セルは `can()`、店舗・拠点・店舗端末の注記は同じ `can()` に所属の範囲や actor を与えた結果、action は `canRunAction()` と一致することを、単体試験（試験用の registry）と全 runtime の DB 試験がセルごとに確かめる。名前付き遷移の `runnableRoles` が `transitionDocument` の判定（遷移のロールか admin（`roles` の無い遷移は全ロール）、`update`、確定なら `submit`・取消なら `cancel`）と一致することは単体試験だけが確かめる（2026-10-30 時点で名前付き遷移を宣言する module が無いため）。行ルールの `self` は最上位の AND の等号（または token だけの `$in`）に限り、行ルールが作成を制限しないことを `restrictedOps`（`create` を除く）と凡例で示す。
- **kernel の機能のロールは定数にする。** 会社設定・導入チェック・権限表と監査の検索の判定は `kernel-capabilities.ts` の `SETTINGS_ROLES`・`HEALTH_ROLES`・`ACCESS_INSIGHT_ROLES` を使い、権限表の凡例も同じ定数から作る。
- **監査の検索は 1 会社（またはテナントの会社なしの記録）、admin（会社全体の所属）の人か、その人の代理 AI だけ。** `actor.type` が `user`、または `onBehalfOf` を持つ `agent` に限り、`relay`・`system`・機械用資格情報は拒む。判定の順序は (1) ロール・範囲・actor の 403、(2) 検索条件の 400、(3) テナント範囲のテナント管理者の 403、(4) 会社なしの 409。
- **変更前後は読取時に絞る。** 記録画面の監査パネルと検索が共通の `auditSnapshotFilter` を使い、呼出し元の項目マスクと現在の `outputHidden`（ext を含む）を当てる。記録後に隠すことにした項目も出ない。返す行は呼出し元が見てよい対象に限る（fail closed）: 呼出し元が `read` できる registry の entity と kernel の監査対象（`AUDIT_SUBJECTS`）だけを SQL の WHERE（`entity IN (…)`）で選び、ページの件数を保つ。`read` できない entity（未適用のパック）も、この runtime が知らない名前（`DAIFUKU_PACKS` で外したパックや読み込んでいない module の entity。定義が無いので項目の制限や `outputHidden` を当てられない）も出さず、その対象を指定した検索は 403。
- **ページ送りは `(at, id)` の keyset。** cursor は `at` をマイクロ秒まで残した文字列（`to_char`）と `id`。合計件数は返さない。cursor の `at` は Postgres がそのまま受け付ける実在の時刻（0001 年以降）に限り、期間は 2000-01-01 以降の日付に限る（どちらも外れれば 400。Postgres の誤りで 500 にしない）。
- **索引を 3 本足した。** `audit_log_company_at_idx (tenant_id, company_id, at, id)`、`audit_log_actor_at_idx (tenant_id, actor_id, at)`、`audit_log_on_behalf_at_idx (tenant_id, on_behalf_of, at) WHERE on_behalf_of IS NOT NULL`（migration `0018_audit_search_indexes`）。80 万行での計測と書込の費用は [作業記録](../log/2026-10-30-access-insight.md)。既存の `audit_log_at_idx` を使う検索は計測した範囲に残っていないが、削除は別に決める。
- 検索の SQL を作る関数（`auditSearchStatement`）と見てよい対象の一覧（`visibleAuditSubjects`）は kernel の公開 index から export しない。module・pack・app は access の判定を先に行う `searchAudit`・`auditSearchOptions` だけを使う。
- 監査表の権限（app role は `SELECT`・`INSERT` のみ）と追記専用の trigger は変えない。検索自体は監査にも業務データにも書かない（読取専用のトランザクション）。
