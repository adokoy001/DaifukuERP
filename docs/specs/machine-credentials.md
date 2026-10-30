# Spec: machine-credentials（機械用資格情報: API キー）

- 状態: implemented
- モジュール: `kernel`（`machine_credentials` 表、`kernel/src/machine-credentials.ts`、`Actor.type = 'machine'`、`requireHumanUserId`）、`apps/api`（認証 plugin、`/admin/tokens`）、`apps/mcp`（`DAIFUKU_API_KEY`）、`apps/web`（`/admin/tokens`）、`modules/workforce`・`modules/tax-filing`・`modules/workforce-evidence`（人の利用者を要する業務の判定だけ） ／ 依存: [access-management](access-management.md)、[enterprise-identity](enterprise-identity.md)、[mcp-app](mcp-app.md)、[ui-kit](ui-kit.md)、[navigation-assist](navigation-assist.md)（`help.ts`）
- ADR: [ADR-0023](../adr/0023-outbound-relay-principal-and-fencing.md) に追補（機械の本人性を LAN 中継機から連携・MCP へ一般化する。発行時の単回 step-up も引き継ぐ）。[ADR-0007](../adr/0007-authorization.md) に actor 種別を 1 行追記。[ADR-0021](../adr/0021-enterprise-authorization-and-integration.md) は変更しない（会社横断 port は機械を拒否する現行の動作を AC-23 で固定する）。この項目に予約された ADR-0035 は使わない
- 作成: 2026-10-30 ／ 作成者: agent（F2 spec writer、workflow wf_2b353e03-822、base `ffc2f42`）。設計の元は [完成度向上の実装計画](../completion-plan.md) F2

## 目的（1段落）

外部連携（会計・EC・BI などのサーバーから REST を呼ぶ）や AI エージェント（`apps/mcp`）は、いま人の利用者のメールアドレスとパスワード（MFA 登録済みなら `DAIFUKU_MFA_CODE` と `IDENTITY_ENCRYPTION_KEY` も）を環境変数や設定ファイルに置いて動かすしかない（[manual 09](../manual/09-ai.md)）。人のパスワードが連携先に散らばり、退職や異動で止めにくく、監査には「その人」の操作として残る。テナント管理者が、期限・会社・ロール・用途（MCP / 連携）を持つ API キーを画面から発行・失効でき、キーは人の JWT と同じ `Context` に解決されて同じ `Repository` / action の権限検査を通るようにする。秘密は発行時に一度だけ表示し、DB には hash だけを置く。最終使用時刻と、発行・失効・拒否の監査を残す。なお `apps/mcp` は従来どおりデータベースの資格情報（owner 接続を含む）で動くので、MCP を動かすホストそのものは信頼できる必要がある。`mcp` 用の鍵は人のパスワードを置き換え、監査される actor とロールを固定するが、ホストが行えることを制限するものではない。信頼できないホストからの連携には REST の `integration` 用の鍵を使う。

## 現状の確認（`ffc2f42` のコード）

- 人の認証: `apps/api/src/plugins/auth.ts` の `onRequest` hook が JWT を検証し、`loadPrincipal`（owner 接続）→ `resolveCompanyAccess` で `req.principal` を毎回読み直し、`buildContextParams` が `ContextParams` を作る。全業務経路は `withRequestContext`（`apps/api/src/request-context.ts`）→ `withContext` → `Repository` / `runAction`。`x-agent-id` で `actor = { type: 'agent', id, onBehalfOf: userId }`。
- 機械の本人性の先例: `kernel/src/relay-auth.ts`（ADR-0023）。`relay_credentials` は kernel の system table（`kernel/src/db/relay-tables.ts`、`registry.registerSystemTable`、tenant RLS、generic CRUD に出さない）、秘密は `opaqueToken()`（32 byte base64url）の `tokenHash()`（SHA-256 hex、`kernel/src/identity/crypto.ts`）だけを保存し、90 日で期限切れ。照合は owner 接続で hash を引き（`authenticateRelay`）、失敗予算は `withIdentityAttempt(owner, [{ key: 'relay-auth:' + ip, limit: 100 }])`（`apps/api/src/edge/context.ts`）。
- 利用者・所属の管理はテナント管理者だけ（`assertAccessAdmin`、`kernel/src/access-admin-common.ts`。`access-admin:<tenant>` の advisory lock、`accessScope` が `all` 以外は拒否）。付与できるロールは `availableRoles()`（`relay` を除く）。監査は `writeAccessAudit`（会社を指定して `writeAudit`）。
- MCP: `apps/mcp/src/session.ts` の `openAgentSession` がパスワードで認証し、`refreshAgentContext` がツール呼出し・リソース読取のたびに利用者と所属を読み直す。
- actor 種別で分岐する箇所（機械の actor を足したときの影響を確認した）: `lockIdentity`・`assertAccessAdmin`・`account-security.ts` の `lockedSelf` は `actorUser(ctx)`（agent なら `onBehalfOf`、それ以外は `actor.id`）で利用者行を引く。`authorized-companies.ts` の `liveUser` は user / agent 以外を拒否。`permissions.ts` の `$ctx.actorId` / `$ctx.userId` は `actor.id`（agent は `onBehalfOf`）。`repository/integrity.ts` の `updatedBy` は user 以外 `onBehalfOf ?? null`。`modules/workforce/src/common.ts` の `userId`・`modules/tax-filing/src/common.ts` の `actorId` は agent 以外 `actor.id` を返し、承認の自己判定（`requireOther`）と申告準備の「作成者以外の確認」（`changeState`）に使う。`modules/workforce-evidence/src/service.ts` の `actor` は user / agent 以外 `undefined`。
- 作成者・更新者の列: `Repository` の `created_by` / `updated_by`（`repository.ts` の private `actorUserId()`）と `integrity.ts` の `updatedBy` は user / agent 以外で `null` になる。鍵で作成・更新した記録も relay / system と同じく `null` になり、操作者は `audit_log` の `actor_type = 'machine'`・`actor_id` = 資格情報の id に残る。
- 発行の先例: 招待（`kernel/src/identity/invitations.ts` の `inviteIdentity`）と中継機の pairing（`kernel/src/relay-auth.ts` の `issueRelayPairing` / `revokeRelayCredentials`）は `lockIdentity` + `consumeStepUp` の単回 step-up を要する。`/auth/step-up` は `IDENTITY_ENCRYPTION_KEY` を設定した環境だけで使え（`configured()`）、未設定の画面は「本人確認の設定が必要」と案内する（`access-invite-user.tsx`、`edge-pairing.tsx`）。一方、利用者の直接作成（`createManagedUser`）は step-up を求めない。

## 受入基準（EARS）

### 発行

- AC-1 WHEN テナント管理者が人のセッション（`actor.type = 'user'`）で `POST /admin/tokens { name, purpose, companyId, roles, expiresInDays, stepUpToken }` を呼び、`lockIdentity(ctx, ctx.sessionVersion)` の下で単回 step-up（`consumeStepUp`）が通った THE SYSTEM SHALL `dfk_` と 43 文字（`opaqueToken()` の 32 byte 乱数）からなる秘密を作り、`machine_credentials` に `secret_hash = tokenHash(token)`・名前・用途・会社・ロール（重複を除いて整列）・発行者・期限（`ctx.now()` + `expiresInDays` × 86,400,000 ms）を保存し、監査（entity `machine_credential`、op `issue`、`after` = `{ name, purpose, companyId, roles, expiresAt, issuedSessionVersion }`、会社 = 対象の会社。`issuedSessionVersion` は発行したセッションの `sessionVersion` で、盗まれたセッションから発行された鍵を後から特定するために残す）を同じトランザクションで書き、`{ token, credential }` を返す。秘密を含むのはこの応答だけである。
- AC-2 THE SYSTEM SHALL 秘密そのもの・秘密の一部を DB のどの表（`machine_credentials`、`audit_log` の `before` / `after` を含む）にも保存せず、監査・要求ログ・エラー応答・一覧と履歴の API に出さない。保存するのは `secret_hash`（SHA-256 hex）だけで、一覧と履歴の API は hash も返さない。
- AC-3 IF 入力が不正（`name` が trim 後に空か 100 文字超、`purpose` が `mcp | integration` 以外、`roles` が空か 51 件以上、`availableRoles()` に無いロールを含む（`relay` は常に不可）、`expiresInDays` が 1〜365 の整数でない、`stepUpToken` が 43 文字の base64url でない、未知の項目（`accessScope`・`storeIds`・`siteIds`・`tenantAdmin` を含む）がある）THEN THE SYSTEM SHALL 保存せず、監査も書かずに 400 VALIDATION（`details.issues[].path` に項目）を返す。
- AC-3a IF `stepUpToken` が未知・使用済み・期限切れ・別の利用者のもの・発行後に `sessionVersion` が変わったもの THEN THE SYSTEM SHALL 保存せず監査も書かずに 401（`identityDenied`）を返す。IF API が本人確認（`IDENTITY_ENCRYPTION_KEY`）を設定していない THEN `/auth/step-up` が 401 になるため鍵は発行できず、画面は発行ボタンを無効にして設定が必要なことを示す（AC-28。招待・中継機の pairing と同じ）。一覧・失効・履歴はこの設定なしでも使える。
- AC-4 IF 要求者がテナント管理者でない、無効である、店舗・拠点限定の所属で操作している、または actor が人の利用者でない（`x-agent-id` 付きの代理、MCP の代理、機械用資格情報そのもの）THEN THE SYSTEM SHALL 一覧・発行・失効・履歴を 403 で拒否する。kernel の関数（`listMachineCredentials` / `issueMachineCredential` / `revokeMachineCredential` / `machineCredentialAudit`）を直接呼んでも同じ検査をする。
- AC-5 IF `companyId` が要求者のテナントの会社でない THEN THE SYSTEM SHALL 404 を返し、別テナントの会社の存在や属性を明かさない。
- AC-6 IF テナントの有効な資格情報（失効しておらず期限前のもの。発行者の無効化で `suspended` と表示される鍵も失効していないので数える）が既に 100 件ある THEN THE SYSTEM SHALL 発行を 409 CONFLICT（hint: 使っていない鍵を失効させる）で拒否する。件数の確認と保存は `access-admin:<tenant>` の advisory lock（`assertAccessAdmin(ctx, true)`）の中で行う。

### 利用（REST API）

- AC-7 WHEN `Authorization: Bearer dfk_<43 文字>` の要求が `/auth/*`・`/admin/*` 以外の認証を要する経路に届き、資格情報が有効（失効していない、`now < expiresAt`、用途が `integration`、発行者が同じテナントの有効なテナント管理者）である THE SYSTEM SHALL その要求を `{ tenantId, companyId: 資格情報の会社, actor: { type: 'machine', id: 資格情報の id }, roles: 資格情報のロール, tenantAdmin: false, accessScope: 'all', storeIds: [], siteIds: [], mfaVerified: false }`（`sessionVersion` なし）の `ContextParams` で処理する。`tenantId` と `companyId` は資格情報の行からだけ決まる。読取・書込・アクション・CSV・集計・関連記録・`/meta` は人の JWT と同じ `withRequestContext` → `Repository` / `runAction` の経路を通り、同じロールの会社全体の所属を持つ人と同じ結果（同じ行、同じ 403）になる。ただし AC-22 の人の判断を要する業務と、`$ctx.userId` / `$ctx.actorId` を使う行規則（資格情報の id には一致する行が無い）は除く。鍵で作成・更新した記録の `created_by` / `updated_by` は `null`（relay / system と同じ）で、操作者は監査に残る。適用済み pack は人と同じく会社の設定から読む。業務の書込の監査は `actor_type = 'machine'`、`actor_id` = 資格情報の id で残る。
- AC-8 IF 資格情報が失効済み・期限切れ・用途違い（`mcp` の鍵を REST で使った）・発行者が無効またはテナント管理者でない THEN THE SYSTEM SHALL 401 PERMISSION_DENIED を返す。本文は理由によらず同じ（`API key is invalid, expired or revoked.` と、テナント管理者に発行し直しを頼む hint）で、理由は監査だけに残す（AC-14）。`dfk_` で始まるが形式に合わない値、一致する hash が無い値も同じ 401 にする。
- AC-9 WHEN 失効が確定した後、または期限を過ぎた後に始まった要求 THE SYSTEM SHALL 401 を返す。失効より前に認証を終えた実行中の要求は中断しない（人のセッション失効と同じ扱い。[access-management](access-management.md) の範囲外の記述）。
- AC-10 IF 機械用資格情報の要求に `x-company-id` があり資格情報の会社と異なる THEN THE SYSTEM SHALL 何も読まず書かずに 403 を返す。同じ値なら受け入れる（uuid の英字の大文字・小文字は区別しない。人の要求と同じ）。uuid の形でない値は、人の要求と同じく照合の前に 400 VALIDATION（`headers.x-company-id`）とし、監査しない。`x-agent-id` は使わず、actor は常に資格情報とする。
- AC-11 IF `dfk_` の値が URL の query にある THEN THE SYSTEM SHALL それを資格情報として読まない（`Authorization` が無ければ未認証の 401）。IF `dfk_` の Bearer を持つ要求に `Origin` header または `Sec-Fetch-Site` header がある THEN THE SYSTEM SHALL 照合せずに 401 を返す（ブラウザーから API キーを使わせない。ADR-0023 の中継機と同じ）。ブラウザーは同一 origin の GET に `Origin` を付けないが、`Sec-Fetch-Site` はすべての要求に付ける。`Sec-Fetch-Mode` は Node.js の `fetch` もサーバーから `cors` を送るので判定に使わない。
- AC-12 IF 機械用資格情報で人の操作者のセッションを要する経路（認証を要する `/auth/*`（本人の認証設定・`/auth/me`・会社一覧を含む）、`/admin/*`（利用者・会社・API キーの管理）、中継機の `/edge/pairings`・`/edge/credentials/revoke`）を呼んだ THEN THE SYSTEM SHALL 照合をせずに 403 を返す。経路の一覧は `apps/api/src/plugins/auth.ts` の `HUMAN_ONLY`（前方一致 `/auth/`・`/admin/` と完全一致の 2 経路）に明示する。判定は生の URL ではなく Fastify が選んだ経路（`req.routeOptions.url`）で行う（router は `%61dmin` を `admin` に復号し、重複した `/` を無視するため、`/%61dmin/tokens` も同じ 403 になる。一致する経路の無い URL は復号した path で判定し、その後 404）。
- AC-13 IF 同じ IP からの、一致する hash の無い値（未知の鍵・形式違い）による照合が 5 分間で 100 件に達した THEN THE SYSTEM SHALL その IP の以後の照合を 429 で拒否する（key `machine-auth:<ip>`）。照合の前は読むだけで予算が尽きていないかを確かめ（`assertIdentityBudget`）、数えるのは hash が一致しなかったときだけにする。有効な鍵の要求は予算を使わず、予算の行に書き込まない。IF 既知の鍵が失効済み・期限切れ・用途違い・発行者の無効・会社違いで拒否された THEN THE SYSTEM SHALL IP ではなくその資格情報ごとの予算（key `machine-denied:<credentialId>`、5 分 100 件）に数え、尽きたらその鍵だけを 429 にする（同じ IP の他の鍵は影響を受けない）。

### 最終使用と監査

- AC-14 WHEN 既知の資格情報（hash が一致した行）が AC-8 または AC-10 の理由で拒否された THE SYSTEM SHALL 監査（op `use_denied`、`after.reason` = `revoked | expired | purpose_mismatch | issuer_inactive | company_mismatch`、actor = `{ type: 'machine', id }`、会社 = 資格情報の会社）を、拒否の応答とは別のトランザクションで確定する。同じ資格情報・同じ理由の記録は 1 時間に 1 件までにする。間引きは `machine_credentials.last_denied_at` / `last_denied_reason` への条件付き更新（`UPDATE … SET last_denied_at = now, last_denied_reason = $reason WHERE tenant_id = $t AND id = $id AND (last_denied_at IS NULL OR last_denied_reason <> $reason OR last_denied_at < now - 1 時間) RETURNING id`）で行い、行が返ったときだけ監査を書く（同時の拒否でも 1 件になる）。`last_denied_at` は一覧に出す（AC-20）。一致する hash の無い値はテナントを決められないので監査せず、値をログに出さない。
- AC-15 WHEN 資格情報による認証が成功した THE SYSTEM SHALL `last_used_at` を `now` に更新する。前回の記録から 60 秒未満なら更新しない。読取だけの要求、認証の後に 403 / 400 になった要求も使用として記録する。
- AC-16 THE SYSTEM SHALL 要求ログ（`apps/api/src/plugins/request-log.ts`）の actor を `{ type: 'machine', id: 資格情報の id }` にし、`Authorization` の値を出さない。

### 失効と不変

- AC-17 WHEN テナント管理者が `POST /admin/tokens/:id/revoke { reason? }` を呼んだ THE SYSTEM SHALL `revoked_at`・`revoked_by`・`revoke_reason`（任意、200 文字まで）を保存し、監査（op `revoke`、`before` = `{ revokedAt: null }`、`after` = `{ revokedAt, reason }`）を書き、更新後の行（AC-20 の形）を返す。更新は `UPDATE machine_credentials SET revoked_at, revoked_by, revoke_reason WHERE tenant_id = $t AND id = $id AND revoked_at IS NULL RETURNING *` の条件付き更新で行い、行が返ったときだけ監査を書く。行が返らなければ現在の行を読み直してそのまま返す（既に失効済みなら何も変えず監査も書かない。結果不明時の再試行と、同時の失効・AC-18 の自動失効との競合で安全。どちらの呼出しも 200 と同じ `revokedBy` を受け取る）。別テナントの id と存在しない id は 404。発行者以外のテナント管理者も失効できる。
- AC-18 WHEN `updateManagedUser` が利用者を無効化した、またはテナント管理者の属性を外した THE SYSTEM SHALL 同じトランザクションで、その利用者が発行した未失効の資格情報をすべて失効させ（`revoke_reason` = `issuer_deactivated` / `issuer_demoted`、`revoked_by` = 操作したテナント管理者）、それぞれ op `revoke` で監査する（AC-17 と同じ条件付き更新。対象は失効しておらず期限前の鍵）。`updateManagedUser` は失効させた件数を `revokedMachineCredentials` として応答と `access_user` の `update` 監査の `after` に含める。その利用者を再び有効化・昇格しても、失効した資格情報は戻らない。
- AC-19 THE SYSTEM SHALL 発行後の資格情報の名前・用途・会社・ロール・期限を変える手段と、物理削除の手段を持たない（`PATCH` / `PUT` / `DELETE /admin/tokens/:id` は経路が無く 404）。app role には `machine_credentials` の `DELETE` 権限を与えず、`UPDATE` は失効と利用の記録の列（`revoked_at`・`revoked_by`・`revoke_reason`・`last_used_at`・`last_denied_at`・`last_denied_reason`）だけに与える（`enforcePolicies` の `grantsFor` で `SELECT, INSERT, UPDATE (…)`、列の権限）。失効は戻せない: `enforcePolicies` が置く trigger（`machine_credentials_revocation_final`）が、一度設定した `revoked_at`・`revoked_by`・`revoke_reason` の変更を owner を含めて拒否する（AC-18 の「戻らない」を DB でも守る）。変えるときは新しく発行し、古いものを失効させる。

### 一覧と履歴

- AC-20 WHEN テナント管理者が `GET /admin/tokens` を呼んだ THE SYSTEM SHALL テナントの失効しておらず期限前の資格情報をすべて（AC-6 により最大 100 件）と、失効済み・期限切れの資格情報を発行の新しい順に合計 500 件まで、発行の新しい順に `{ id, name, purpose, companyId, companyCode, companyName, roles, issuedBy: { id, name }, createdAt, expiresAt, lastUsedAt, lastDeniedAt, revokedAt, revokedBy: { id, name } | null, revokeReason, status }` で返し、表示しきれなかった失効済み・期限切れの資格情報があれば `truncated: true` を返す（画面は「古い鍵は表示していません」と示す）。`status` は `revoked`（失効済み）→ `expired`（期限切れ）→ `suspended`（発行者が無効かテナント管理者でない。AC-18 を通らずに変わった場合の検出）→ `active` の順に判定する。応答には発行に使う `roles`（`availableRoles()`）、`companies`（テナントの会社の id・コード・名称）、`limits`（`{ maxActive: 100, maxDays: 365 }`）を含める。別テナントの資格情報は含めない。
- AC-21 WHEN テナント管理者が `GET /admin/tokens/:id/audit` を呼んだ THE SYSTEM SHALL その資格情報の監査を、`issue` と `revoke` はすべて、`use_denied` は新しい順に最大 50 件、合わせて新しい順に、時刻・op・actor の種別と id・操作者が利用者ならその名前・理由とともに返す。資格情報で行った業務の書込は含めない（各記録の監査で見る）。

### 人の判断を要する業務と kernel の境界

- AC-22 IF actor が機械用資格情報で、業務が人の利用者 ID を必要とする THEN THE SYSTEM SHALL 403（`PermissionDenied`、op `human-actor-required`）で拒否する。kernel は `requireHumanUserId(ctx)`（user → `actor.id`、agent → `onBehalfOf`、machine → `PermissionDenied`、system / relay → 現行どおり `actor.id`。`Repository` の private `actorUserId()` とは意味が違うので名前を分ける）を公開し、`modules/workforce/src/common.ts` の `userId`、`modules/tax-filing/src/common.ts` の `actorId`、`modules/workforce-evidence/src/service.ts` の `actor` はこれに委ねる（workforce-evidence は system / relay で従来どおり `undefined`）。したがって、これらを使う操作はすべて鍵では実行できない: 従業員本人の申請・入力（`requireSelf`）、承認・差戻し・確認・精算・給与と年末調整の確認（`requireOther` / `reviewed`）、休暇の付与（`grantedBy`）、給与制度の承認（`approvedBy`）、従業員の証憑の添付、申告準備資料の作成と確認（`preparedBy` / `confirmedBy`）、経費精算（expense module）の精算書と仮払の作成・更新・削除・確定・取消・訂正（明細の保存・削除を含む）と `expense.draft_settlement` / `expense.settlement_candidates`（`requireSettlementRoles`）、精算書による経費の精算と取消時の差戻し（workforce の `settleExpensesForSource` / `reopenExpensesForSource`）、受信箱の `workforce.todo` / `tax_filing.todo` / `expense.todo`。発行者が鍵で自分の申請を承認する、自分で作った申告準備資料を鍵で確認する、鍵で発行者本人に仮払を支払う、といった職務分離の回避を防ぐ。（2026-10-30 統合時の追記: expense module は F2 より前に作られ、module 独自の `actorUserId` が鍵には資格情報の id を返していた。そのため自己精算の判定（`refuseSelfSettlement`）が発行者本人の従業員に一致せず、admin（または accounting と workforce_payroll）の鍵で発行者本人の仮払を作成・確定（支払）でき、任意の精算書を取り消せた。`modules/expense/src/access.ts` の `actorUserId` と `requireSettlementRoles` を `requireHumanUserId` に委ねてロールの検査より前に、何も読まず書かずに拒否するようにし、workforce の `requireSettler` も鍵を先に拒否する。`expense.todo` は `workforce.todo` と同じく、action の権限を通った鍵をロールによらず 403 にする。）職務分離の判定を持たない休暇の付与も拒否されるが、これは人事・給与の連携を初版で鍵に開かない決定（スコープ外）として受け入れる。
- AC-23 THE SYSTEM SHALL 人の本人性を前提とする kernel の port を機械の actor に対して拒否する: `lockIdentity`・`assertAccessAdmin`・`authorizedCompanies` / `withAuthorizedCompany`（ADR-0021）・`issueRelayPairing` / `revokeRelayCredentials` / `withRelayOperator`・会社の作成と編集（`createCompany` / `updateCompany`）・本人のパスワード変更とセッション失効・AC-4 の資格情報の管理。行規則の `$ctx.actorId` / `$ctx.userId` は資格情報の id になり、利用者に結び付いた行（従業員本人の行など）には一致しない。

### MCP

- AC-24 WHEN `apps/mcp` が `DAIFUKU_API_KEY` を設定して起動した THE SYSTEM SHALL `DAIFUKU_EMAIL` / `DAIFUKU_PASSWORD` を要求せず、用途 `mcp` の有効な資格情報から AC-7 と同じ形の `ContextParams`（会社は資格情報の会社、actor は `machine`）を作る。`DAIFUKU_AGENT_ID` は使わず、起動ログには資格情報の id・名前・会社・ロールを出し、秘密は出さない。最終使用時刻は AC-15 と同じく記録する。
- AC-25 IF `DAIFUKU_API_KEY` と `DAIFUKU_EMAIL` / `DAIFUKU_PASSWORD` / `DAIFUKU_MFA_CODE` / `DAIFUKU_TENANT_ID` のどれかが同時に設定されている THEN THE SYSTEM SHALL 設定エラー（exit 2、どちらか一方にする案内）で止まる。IF 資格情報が形式違い・未知・失効済み・期限切れ・用途 `integration`・発行者が無効、または `DAIFUKU_COMPANY_ID` が資格情報の会社と異なる THEN THE SYSTEM SHALL 認証失敗（exit 3、秘密を出さない）で止まり、既知の資格情報なら AC-14 の監査を書く。
- AC-26 WHILE MCP サーバが資格情報で接続している WHEN ツールを呼ぶ・リソースを読む THE SYSTEM SHALL そのたびに資格情報と発行者を再検証し（`refreshAgentContext` の machine 分岐）、失効・期限切れ・発行者の無効化の後は `isError: true` と `PERMISSION_DENIED` を返して業務を実行しない。この拒否も AC-14 の `use_denied` を（間引いて）監査する。

### 画面 `/admin/tokens`

- AC-27 WHEN テナント管理者が `/admin/tokens` を開いた THE SYSTEM SHALL UI キット（`PageHeader`・`DataTableShell`・`Badge`・`Button`・`Dialog`・`EmptyState`）で一覧（名前と鍵の ID の先頭 8 文字・用途・会社・ロール・発行者・発行日時・期限・最終使用・状態）を表示する。ID の先頭 8 文字は、各記録の履歴に `machine:<先頭 8 文字>…` と出る操作者を鍵に照合するため。状態は色だけでなく文字（有効 / 期限切れ / 失効 / 停止中）で示し、30 日以内に期限が来る有効な鍵には「期限まで N 日」を出す。最終使用が無い鍵は「未使用」。鍵が 1 件も無いときは発行の案内つきの空状態を出す。初回の読込は表の骨格行、読込の失敗は `MetaError`。
- AC-28 WHEN 「API キーを発行」の `Dialog` で名前・用途・会社（既定は選択中の会社）・ロール（`AccessRoleOptions` と `accessRoleLabel`）・有効期間（30 / 90 / 180 / 365 日、既定 90 日）と本人確認の現在のパスワード（MFA 登録済みなら認証コードも）を入れて「発行」を押した THE SYSTEM SHALL 名前・ロール・パスワードの未入力を送信前にその欄に示し、`/auth/step-up`（`api/identity.ts` の `stepUp`、`IdentityStepUp` と同じ API）で step-up を得てから発行を送る。パスワードの誤りはパスワード欄に、認証コードの誤り（step-up の検証エラーの path が `code`）は認証コード欄に示し、焦点もその欄へ移す。要求の処理中は「発行」を `aria-disabled` にして進行中の文言にし、二重送信をしない。応答を受け取れなかった（通信の失敗）ときは「発行されたか確認できません。一覧で『未使用』の鍵を確認し、心当たりのない鍵は失効させてください」と示し、保持していた step-up の token を捨てる（再試行はパスワードを聞き直す。使用済みかもしれない token を再送すると 401 でセッションが終わるため）。発行の要求の処理中に Esc・× で閉じたときは、一覧に同じ趣旨の警告（`tokens-issue-interrupted`）を出す。step-up の処理中に閉じたときは発行を送らない。本人確認が設定されていない API（`/auth/security` の `configured: false`）では「発行」を無効にし、運用管理者に `IDENTITY_ENCRYPTION_KEY` の設定を頼むよう案内する。`/auth/security` を読めなかったときは、読めなかったことと再試行のボタンを示し（`tokens-security-error`）、「発行」は無効にしてその説明を `aria-describedby` で結ぶ。サーバーの検証エラーは最初の誤りの欄へ焦点を移して示す。想定される失敗（有効な鍵の上限の 409、試行の上限の 429、会社が無い 404、権限の 403、欄ごとの検証エラー）は日英の文で示し、サーバーの文・コード・HTTP status は補助の行に残す。`admin` ロールを選んだときは「会社のすべての業務を操作できる鍵になります」の注意を出す。発行に成功したら、秘密を読取専用の欄に一度だけ表示し、「コピー」ボタン（結果を `aria-live` で知らせ、クリップボードが使えないときは欄を選択して手動コピーを案内）、「この画面を閉じると二度と表示できません。安全な場所に保存してください」の警告、用途に応じた使い方（連携: `Authorization: Bearer <鍵>`、MCP: `DAIFUKU_API_KEY=<鍵>`）を出し、枠の見出し（`tabIndex=-1`）へ焦点を移す。
- AC-29 WHEN 秘密を表示した枠を閉じた THE SYSTEM SHALL 秘密を画面の状態と React Query の mutation の結果から消す。秘密は URL・`localStorage`・`sessionStorage`・toast・console・一覧の cache に一度も書かない。再読込・画面の移動・一覧の再取得のあとも秘密は表示されない。焦点は見出しの「API キーを発行」へ戻す（空状態のボタンから開いた最初の鍵の発行でも。空状態は一覧の再取得で消えるため、kit の `Dialog` の焦点の戻し先が無くなる）。
- AC-30 WHEN 行の「失効」を押した THE SYSTEM SHALL kit の `Dialog` で鍵の名前と影響（この鍵を使う連携・エージェントは次の要求から 401 になる）を示し、任意の理由を入力させる。実行後は行の状態を「失効」に更新し、結果を `aria-live` で知らせ、焦点を行の「履歴」へ移す。Esc・取消では何もせず「失効」ボタンへ焦点を戻す。失効済み・期限切れの行に「失効」は出さない。行の「履歴」は AC-21 の結果を `Dialog` に時刻・操作・操作者・理由で表示する。
- AC-31 IF テナント管理者でない利用者が使っている THEN THE SYSTEM SHALL サイドバー・業務分野の画面・コマンドパレットに `/admin/tokens` を出さず（`navigation-data.ts` の `condition: 'tenant-admin'`）、URL を直接開いても「API キーの管理はテナント管理者だけが行えます」と表示して API を呼ばない（API も 403。AC-4）。
- AC-32 THE SYSTEM SHALL 画面の文言を日本語と英語で持ち、390px 幅でページの横方向のはみ出しなく一覧・発行・秘密の表示・失効・履歴を操作でき（履歴の表は 440px の Dialog に収まるよう各欄を折り返し、枠を横にスクロールさせない）、axe の serious / critical 違反を持たない（`apps/web/e2e/a11y-policy.ts` の `judge` を画面の試験で適用）。画面の手引きリンクは manual 08 の「API キーの発行と失効」を開く（`help.ts`）。
- AC-33 WHEN テナント管理者が `/admin/users` で、有効な API キー（失効しておらず期限前）を発行した利用者を無効化する、またはテナント管理者の属性を外す変更を確認しようとした THE SYSTEM SHALL 確認の文に「この利用者が発行した有効な API キー N 件も失効します / N active API keys issued by this user will be revoked」を出す。件数は `GET /admin/access` の `activeApiKeys`（発行者の id → 件数）から読む。

## HTTP 契約

| URL | 入力 | 成功 |
| --- | --- | --- |
| `GET /admin/tokens` | なし（テナント管理者の人のセッション） | `{ items: MachineCredentialView[], truncated: boolean, roles: string[], companies: [{ id, code, name }], limits: { maxActive, maxDays } }` |
| `POST /admin/tokens` | `{ name, purpose: 'mcp' \| 'integration', companyId, roles: string[], expiresInDays, stepUpToken }`（strict） | `{ token: 'dfk_…', credential: MachineCredentialView }` |
| `POST /admin/tokens/:id/revoke` | `{ reason?: string }`（strict、200 文字まで） | `{ credential: MachineCredentialView }` |
| `GET /admin/tokens/:id/audit` | なし | `{ items: [{ id, op, actorType, actorId, actorName, at, reason }] }` |

- 失敗: 400 VALIDATION、401 PERMISSION_DENIED（未認証・機械用資格情報の拒否・step-up の失敗）、403 PERMISSION_DENIED、404 NOT_FOUND、409 CONFLICT（有効な鍵の上限）、429（照合の失敗予算）。応答は既存の `onSend` hook により `cache-control: private, no-store`。
- 鍵の使い方（連携）: `curl -H "authorization: Bearer $DAIFUKU_API_KEY" http://<api>/api/partner`。`x-company-id` は不要（付けるなら鍵の会社と同じ値）。
- 鍵の使い方（MCP）: `DAIFUKU_API_KEY=<鍵> pnpm -s -C <repo> --filter @daifuku/mcp start`（`DATABASE_URL_OWNER` / `DATABASE_URL` は従来どおり必要。MCP のホストは信頼できる必要がある。目的の節を参照）。

## 設計判断（計画が選択を残した点と理由）

1. **保存先は kernel の system table `machine_credentials`**（DSL の entity にしない）。認証の基盤は業務 entity と分け、generic CRUD・REST・MCP ツールに出さない（ADR-0022、ADR-0023 の `relay_credentials` と同じ）。`registry.registerSystemTable` で登録し、tenant RLS（`TENANT_POLICY_SQL`、FORCE RLS）と app role の grant は `enforcePolicies` が付ける。grant は `SELECT, INSERT, UPDATE`（`DELETE` なし。AC-19）。列: `id`、`tenant_id`、`company_id`（`(tenant_id, company_id)` → `companies` の複合 FK）、`name`、`purpose`、`roles`（jsonb）、`secret_hash`（unique）、`issued_by`（`(tenant_id, issued_by)` → `users` の複合 FK）、`expires_at`、`revoked_at`、`revoked_by`（`(tenant_id, revoked_by)` → `users`）、`revoke_reason`、`last_used_at`、`last_denied_at`、`last_denied_reason`、`created_at`。索引 `(tenant_id, company_id)`、`(tenant_id, issued_by)`。migration は `pnpm db:schema && pnpm db:generate` で作る（番号は統合時の次の番号）。
2. **ADR は ADR-0023 への追補で記録する**（新番号を使わない）。ADR-0023 の「人の JWT や `onBehalfOf` を使わない専用の機械 principal、opaque credential の SHA-256 hash だけの保存、tenant・company への固定、期限、毎回の有効性照合、generic CRUD に出さない、秘密を URL・監査・ログに出さない、Authorization header 専用、会社切替 header とブラウザー Origin を受け付けない」を、連携・MCP 用の資格情報に一般化する。中継機と違い、権限は専用の `relayAccess` ではなく通常のロール（人と同じ `Repository` の検査）で決める点、発行者の継続的な権限に結び付ける点（判断 9）を追補に書く。kernel の拡張（`Actor.type` に `machine`、`requireHumanUserId`）と、発行時の単回 step-up（判断 5）もこの追補に含める。
3. **actor は新しい種別 `machine`（`id` = 資格情報の id、`onBehalfOf` なし）**。`agent` + `onBehalfOf` = 発行者にすると、`actorUser(ctx)` が発行者になり、鍵が発行者の本人操作（`lockIdentity`）や利用者管理（`assertAccessAdmin`）を通ってしまう。`machine` なら既存の利用者行の照合がすべて一致せずに失敗する（fail closed。AC-23 で固定）。監査では `actor_type = 'machine'` で人・代理 AI と区別でき、資格情報の行から発行者を辿れる（電子帳簿保存法の訂正削除履歴に当たる監査は従来どおり残る）。
4. **鍵の形式は `dfk_` + 43 文字**。接頭辞で JWT と機械用資格情報を照合の前に振り分け（JWT は `.` で区切られた 3 部分）、漏洩時に secret scanning の規則で見つけやすくする。32 byte の乱数なので総当たりは現実的でなく、低速の KDF は使わず SHA-256 で足りる（ADR-0023 と同じ）。鍵の一部（末尾 4 文字など）も保存しない（AC-2 を単純に保ち、一覧は名前と id で識別する）。
5. **発行と失効はテナント管理者の人のセッションだけ。発行には単回 step-up を求める**（spec critic の指摘 1 を受けて変更）。会社の `admin` ロールだけの利用者・代理 AI・鍵そのものには開かない（鍵が鍵を作る持続化を防ぐ）。資格情報を発行する既存の 2 経路（招待、中継機の pairing）はどちらも `lockIdentity` + `consumeStepUp` を要し、ADR-0023 もそれを機械の本人性の前提にしている。step-up が無いと、盗まれたテナント管理者の JWT から最長 365 日・`admin` ロールの鍵を作れ、通常の事故対応（パスワードの再設定と全端末ログアウト）では止まらない（判断 9 で鍵はそれらに連動しない）。利用者の直接作成（`createManagedUser`）が step-up を求めないのは既存の別の穴で、ここで同じ水準に揃える理由にはしない（未決事項 1）。代償として、`IDENTITY_ENCRYPTION_KEY` を設定していない最小構成では鍵を発行できない（招待・pairing と同じ。一覧・失効は使える）。失効は step-up を求めない: 権限を減らすだけの操作で、事故対応の最中や最小構成でも直ちに止められる必要がある。発行の監査には発行したセッションの `sessionVersion`（`issuedSessionVersion`）を残し、盗まれたセッションから発行された鍵を特定できるようにする（manual 08 の事故対応の手順に、発行者で絞った鍵の確認と失効を書く）。
6. **ロールの上限は「発行者が付与できるロール」= `availableRoles()`（`relay` を除く）**。テナント管理者は全会社の所属に任意の登録済みロールを付与できる（`putCompanyMembership` と同じ集合）。鍵は常に会社全体（`accessScope: 'all'`）で、`tenantAdmin` を持たない。店舗・拠点限定の鍵は初版で作らない（スコープ外）。
7. **用途は表示だけでなく入口を限定する**: `integration` は REST API だけ、`mcp` は `apps/mcp` だけで受け付ける。MCP 用の設定ファイルから漏れた鍵を REST で使えない（逆も同じ）。
8. **期限は必須で 1〜365 日、画面の既定は 90 日**（ADR-0023 の中継機の 90 日に合わせる）。無期限の鍵は作らない。延長の手段は持たず、新しい鍵を発行する。
9. **鍵の有効性を発行者に結び付ける**。発行者が無効化・テナント管理者でなくなったら、`updateManagedUser` の同じトランザクションで鍵を失効させる（AC-18。人のセッションが「再有効化しても復活しない」のと同じ考え方）。加えて利用のたびに発行者が有効なテナント管理者であることを確かめ、AC-18 を通らない変更（owner 接続での直接の更新など）も 401 にする（`suspended`）。発行者のパスワード変更・全端末ログアウト（`sessionVersion`）では鍵を止めない（連携が管理者の個人操作で止まらないように。緊急時は画面で失効する）。セッションの盗難が疑われるときは、パスワードの再設定・全端末ログアウトに加えて、その利用者が発行した鍵を一覧で確認し、心当たりのないものを失効させる（manual 08）。発行には step-up が要るので、盗まれた JWT だけでは鍵を作れない（判断 5）。退職者が控えた鍵が使え続ける危険を、運用の手順に頼らず閉じる。
10. **照合の接続を分ける**: hash による照合だけ owner 接続（テナントが未確定のため。`authenticate` / `authenticateRelay` と同じ）、発行者の確認・`last_used_at` の更新・拒否の監査は資格情報のテナントを設定した app 接続のトランザクション（RLS が効く）で行う。拒否の監査は応答とは独立に確定する。
11. **最終使用は 60 秒単位、拒否の監査は資格情報・理由ごとに 1 時間に 1 件**（`last_denied_at` / `last_denied_reason` への条件付き更新で、同時の拒否でも 1 件）。毎要求の書込と、忘れられた連携の連打による追記専用の監査の膨張を抑える（`audit_log` は削除できないので、1 日最大 24 件 × 理由の数に抑える）。成功した使用は 1 件ずつ監査しない（業務の書込は各記録の監査に `machine` として残る）。
12. **人の判断を要する業務は機械を拒否する**（AC-22）。承認・確認は人の決定であり（manual 09「人間の確認を取ってから」）、鍵の id は利用者 id と一致しないので、既存の自己承認・作成者確認の判定をすり抜けてしまう。module ごとの判定の写しを直さずに済むよう、kernel の `requireHumanUserId` に寄せる。system / relay の戻り値は変えない（seed・worker・中継機の既存動作を変えないため）。
13. **失効は冪等（条件付き更新）、鍵は不変、物理削除なし**。結果不明時の再試行・同時の失効で二重の監査や 409 を出さない。履歴を残すため削除しない（保存期間の整理はスコープ外）。
14. **`x-agent-id` は無視、`x-company-id` は一致時だけ受理、`Origin` は拒否、`/auth/*`・`/admin/*` は人だけ**。汎用の HTTP クライアントが会社 header を常に付ける運用を妨げず、別会社への切替だけを止める。
15. **未知の鍵の照合予算は IP ごとに 5 分 100 件、既知の鍵の拒否は鍵ごとに 5 分 100 件**（中継機の `relay-auth:<ip>` と同じ値）。中継機の `withIdentityAttempt` のような「照合の前に予約し成功時に返す」方式は使わない: 共有の NAT や iPaaS の出口の後ろで、失効を忘れた 1 つの連携の再試行が同じ IP の健全な鍵（別テナントのものを含む）をすべて 429 にし、有効な要求も同時に 100 件を超えると返却前に上限に達し、要求ごとに owner 接続で 2 回書き込むからである。有効な鍵の要求は予算を読むだけで書かない。テナント内の有効な鍵は 100 件まで（AC-6）。成功した要求の数の上限は設けない（未決事項 3）。
16. **401 の本文は理由によらず同じ**。期限切れ・失効・用途違いの区別を外から引き出せないようにし、理由は管理者が履歴（AC-21）で見る。
17. **人事・給与の連携は初版で鍵に開かない**。AC-22 により、休暇の付与・精算・給与制度の承認・従業員の証憑の添付などは鍵では 403 になる。職務分離の判定を持たない休暇の付与まで止まるのは、kernel の判定を 1 か所に寄せた副作用として受け入れる（スコープ外に明記）。
18. **一覧は有効な鍵を必ず含める**。失効済み・期限切れの鍵が増えても、有効な鍵（最大 100 件）が一覧から押し出されて画面から失効できなくなることを防ぐ（AC-20）。

## spec critic の指摘への対応（2026-10-30、実装者）

| # | 指摘 | 判断 | 反映先 |
| --- | --- | --- | --- |
| 1 | step-up なしの発行は盗まれた JWT を 365 日の鍵に変える | 受入。発行に単回 step-up を求め、`issuedSessionVersion` を監査に残す。失効は step-up なし（理由は判断 5） | AC-1、AC-3、AC-3a、AC-28、判断 5・9、未決事項 1 |
| 2 | 照合前の予約方式は共有 IP の健全な鍵を 429 にする | 受入。未知の鍵だけ IP 予算、既知の鍵の拒否は鍵ごとの予算、有効な要求は読むだけ | AC-13、判断 15、試験 |
| 3 | `use_denied` の間引きの方法が無く、同時に重複する | 受入。`last_denied_at` / `last_denied_reason` の条件付き更新、1 時間ごと。履歴は issue / revoke を常に含める | AC-14、AC-20、AC-21、判断 1・11 |
| 4 | 同時の失効で監査が二重になる | 受入。`revoked_at IS NULL` の条件付き更新 | AC-17、AC-18 |
| 5 | AC-19 の試験が無く、app role に DELETE がある | 受入。経路なしの 404 試験と grant から DELETE を外す | AC-19、判断 1 |
| 6 | AC-7 の「人と同じ結果」が `$ctx.userId` の行規則と矛盾 | 受入。例外を明記し、比較試験は利用者に結び付く行規則の無いロールで行う | AC-7 |
| 7 | `/edge/pairings` などが鍵で 401 になり紛らわしい | 受入。`HUMAN_ONLY` に加えて 403 | AC-12 |
| 8 | 発行者の無効化で鍵が黙って失効する | 受入。件数を応答と監査に含め、利用者画面の確認に件数を出す | AC-18、AC-33 |
| 9 | 一覧の 500 件上限で有効な鍵が押し出される | 受入。有効な鍵を必ず含め `truncated` を返す。停止中の鍵も上限に数える | AC-6、AC-20、判断 18 |
| 10 | AC-22 の試験が 2 操作だけ | 受入。証憑の添付・精算・休暇の付与・給与制度の承認を追加し、人事・給与の連携をスコープ外に明記 | AC-22、判断 17、試験 |
| 11 | `actorUserId` の名前が Repository の private と逆の意味 | 受入。`requireHumanUserId` にし、`created_by` / `updated_by` が `null` になることを明記 | 現状の確認、AC-7、AC-22 |
| 12 | MCP の基準の抜け（`DAIFUKU_TENANT_ID`、接続中の拒否の監査、app 接続の順序、mcp-app AC-1） | 受入 | AC-25、AC-26、関係するファイル |
| 13 | mcp 用の鍵がホストの信頼を減らすように読める | 受入。目的と manual 09 に 1 文 | 目的、HTTP 契約 |
| 14 | 発行の二重送信で見えない鍵ができる | 受入。処理中の無効化と、応答喪失時の案内 | AC-28 |

## 実装レビューの指摘への対応（2026-10-30、fixer）

| 指摘 | 判断 | 反映先 |
| --- | --- | --- |
| `HUMAN_ONLY` が生の URL を見るため `/%61dmin/…`・`/%61uth/…` が照合と handler に届く | 受入。`req.routeOptions.url`（一致しない URL は復号した path）で判定 | AC-12、API 試験 |
| 空状態のボタンから発行すると、閉じた後の焦点が `<body>` に落ちる | 受入。閉じたら見出しの「API キーを発行」へ焦点を移す | AC-29、identity 試験 |
| 履歴の表が Dialog の中で横にスクロールし、axe の scrollable-region-focusable | 受入。履歴の各欄を折り返して枠に収める（kit の `DataTableShell` は変えない） | AC-32、identity 試験（日英 × 390 / 1280px） |
| 未知の項目が path `''` の 1 件の issue になる | 受入。`parseAccess` が `unrecognized_keys` を項目ごとの issue（path = 項目名）に展開（利用者管理の他の入口も同じ） | AC-3、kernel 試験 |
| 結果不明の失敗の後の再試行が使用済みかもしれない step-up を再送する | 受入。結果不明なら token を捨てる | AC-28、ブラウザー試験 |
| 理由ごとの拒否の記録を確かめる試験が無い | 受入。同じ鍵を 2 つの理由で拒否する試験を追加（条件から理由を外す変更で失敗することを確認） | AC-14、kernel 試験 |
| `x-company-id` の大文字の uuid を別会社として拒否・監査する | 受入。大文字・小文字を区別しない。uuid の形でない値は照合前に 400 | AC-10、kernel・API 試験 |
| app role が `machine_credentials` の全列を更新できる（失効の取消し・ロールの拡大） | 受入。`UPDATE` を 6 列に限り、失効を戻させない trigger を追加 | AC-19、kernel 試験 |
| `Origin` の無い同一 origin の GET をブラウザーと判定できない | 一部受入。`Sec-Fetch-Site` も拒否する。`Sec-Fetch-Mode` は Node.js の `fetch` が送るので使わない（2026-10-30 に Node 22 で実測） | AC-11、API 試験 |
| restaurant-chain の確認・提出が鍵を受け入れることが spec に無い | 受入（spec に明記）。動作は変えない | スコープ外 |
| 認証コードの誤りで焦点がパスワード欄へ行く | 受入 | AC-28、ブラウザー試験 |
| 発行の処理中に Esc・× で閉じると黙って秘密が失われる | 受入。一覧に警告を出す。step-up の処理中に閉じたら発行を送らない | AC-28、ブラウザー試験 |
| `/auth/security` の読込失敗で理由の無い無効ボタンになる | 受入。失敗の表示と再試行 | AC-28、ブラウザー試験 |
| 想定される失敗が日本語の画面で英語の文になる | 受入。409・429・404・403・欄ごとの検証エラーを日英の文にし、サーバーの文は補助の行へ | AC-28、web 単体・ブラウザー試験 |
| manual 08 の「鍵の名前を一覧で確かめる」が画面ではできない | 受入。一覧の名前の下に鍵の ID の先頭 8 文字を出し、manual に照合の方法を書く | AC-27、manual 08 |
| 英語の画面でロールが「、」で区切られる | 受入 | 画面 |
| 使われない `token-dialog` の class | 受入（削除） | 画面 |
| spec の `actorUserId`、log の重複した行 | 受入 | spec、log |
| manual 09 の「下の 2 行」の曖昧さと API キーの検証の記録 | 受入 | manual 09 |
| AC-32 の一覧（鍵あり）・失効・履歴の Dialog に axe と 390px の試験が無い | 受入 | identity 試験 |

## 関係するファイル・インターフェース（名指し）

- kernel:
  - `kernel/src/context.ts`（`Actor.type` に `'machine'` を追加。`Context` の他の項目は変えない）
  - `kernel/src/db/machine-tables.ts`（新規。`machineCredentials`、`registry.registerSystemTable('machine_credentials', …)`）
  - `kernel/src/machine-credentials.ts`（新規）: `MACHINE_TOKEN_PREFIX = 'dfk_'`、`isMachineTokenFormat(value)`、`issueMachineCredentialSchema`、`revokeMachineCredentialSchema`、`MachinePurpose = 'mcp' | 'integration'`、`MachinePrincipal { credentialId, tenantId, companyId, name, purpose, roles, expiresAt }`、`listMachineCredentials(ctx)`、`issueMachineCredential(ctx, raw)`、`revokeMachineCredential(ctx, id, raw)`、`machineCredentialAudit(ctx, id)`、`authenticateMachineCredential(owner, app, token, { purpose, companyHeader?, budgetKey?, now? })`（拒否時は AC-14 の監査を確定し、AC-13 の予算を数えてから 401 / 403 / 429 を投げる）、`refreshMachineCredential(app, principal, purpose, now?)`、`machineContextParams(principal)`、`revokeIssuedMachineCredentials(ctx, userId, reason)`（AC-18、`updateManagedUser` から呼ぶ）
  - `kernel/src/access-users.ts`（`updateManagedUser` が無効化・降格で `revokeIssuedMachineCredentials` を呼び、件数を返す）、`kernel/src/access-directory.ts`（`activeApiKeys`）
  - `kernel/src/identity/rate-limit.ts`（読むだけの予算確認 `assertIdentityBudget`）、`kernel/src/identity/common.ts`（`lockIdentity` が machine を明示的に拒否）、`kernel/src/account-security.ts`（同じ）
  - `kernel/src/db/migrate.ts`（`grantsFor('machine_credentials')` = `SELECT, INSERT, UPDATE (失効と利用の記録の 6 列)`、失効を戻させない trigger）
  - `kernel/src/access-admin-common.ts`（`requireHumanUserId` を追加し、`assertAccessAdmin` が machine を明示的に拒否する。既存の `actorUser` は変えない）
  - `kernel/src/index.ts`（上記の export）。`kernel/src/identity/crypto.ts` の `opaqueToken` / `tokenHash` は変更せずに使う
- apps/api:
  - `apps/api/src/plugins/auth.ts`（`onRequest` で `Bearer dfk_` を機械の経路へ振り分け、`req.machine`（`MachinePrincipal | null`）を設定。`buildContextParams` は `req.machine` があれば `machineContextParams` を使う。`HUMAN_ONLY` の拒否、`Origin`・`x-company-id` の扱い、`machine-auth:<ip>` の予算）
  - `apps/api/src/routes/machine-credentials.ts`（新規。HTTP 契約の 4 経路、tag `access`）、`apps/api/src/server.ts`（登録）
  - `apps/api/src/plugins/request-log.ts`（actor の種別に `machine`）
  - `apps/api/drizzle/migrations/<次の番号>_machine_credentials.sql` と `meta/` の snapshot・journal
- apps/mcp: `apps/mcp/src/config.ts`（`DAIFUKU_API_KEY`、AC-25 の組合せ検査）、`apps/mcp/src/session.ts`（`openMachineSession`、`refreshAgentContext(owner, app, params)` の machine 分岐。app 接続を引数に足し、`server.ts` の 3 か所・`tools.ts`・`resources.ts` の 5 つの呼出しを直す）、`apps/mcp/src/main.ts`（鍵のときは app 接続を認証の前に開く。起動の分岐とログ）。[mcp-app](mcp-app.md) の AC-1（メールとパスワードが必須）は、この spec の AC-24 で「`DAIFUKU_API_KEY` を代わりに使える」と拡張される
- modules: `modules/workforce/src/common.ts`（`userId`）、`modules/tax-filing/src/common.ts`（`actorId`）、`modules/workforce-evidence/src/service.ts`（`actor`）を `requireHumanUserId` に委ねる（AC-22）。他の module は変えない（2026-10-30 統合時: `modules/expense/src/access.ts` の `actorUserId`・`requireSettlementRoles` と `modules/workforce/src/expense-settlement.ts` の `requireSettler` も委ねた。AC-22 の追記）
- apps/web:
  - `apps/web/src/pages/tokens-page.tsx`（新規 `TokensPage`）、`apps/web/src/components/access-user-profile.tsx` と `apps/web/src/api/access.ts`（AC-33 の件数と確認の文）、`apps/web/src/api/tokens.ts`（新規。`useMachineCredentials`、`useIssueMachineCredential`（mutation の結果を保持しない: `gcTime: 0`、閉じたら `reset()`）、`useRevokeMachineCredential`、`useMachineCredentialAudit`）、`apps/web/src/lib/machine-credentials.ts`（新規、純粋: 下書きの検証、状態と残り日数の文、用途のラベル、使い方の文）
  - `apps/web/src/components/access-role-options.tsx`（`AccessRoleOptions` / `accessRoleLabel` を変更せずに使う）
  - `apps/web/src/router.tsx`（`/admin/tokens`）、`apps/web/src/lib/navigation-data.ts`（`workspace: 'admin'`、`kind: 'setting'`、`condition: 'tenant-admin'`、ラベル `{ ja: 'API キー', en: 'API keys' }`）、`apps/web/src/lib/help.ts`（`'/admin/tokens': topic('08-admin.md', 'api-キーの発行と失効')`）、`apps/web/src/lib/help.test.ts` の `ROUTES`、`apps/web/src/ui/token-usage.test.ts` の `CONVERTED`
  - 発行の画面試験は step-up が要るので、本人確認を設定した identity 試験群で動かす: `apps/web/e2e/machine-credentials-identity.spec.ts`（新規）、`apps/web/playwright.identity.config.ts` と `apps/web/playwright.config.ts` の `testMatch` / `testIgnore`、`apps/api/test/identity-e2e-database.ts`（この試験専用のテナント管理者 2 名を追加）
- tests: 下の「検証手順」の表
- docs:
  - `docs/adr/0023-outbound-relay-principal-and-fencing.md`（追補「連携・MCP 用の機械用資格情報（2026-10-30、F2）」）、`docs/adr/0007-authorization.md`（`actor.type='machine'` の 1 行）
  - `docs/manual/08-admin.md`（新しい節「API キーの発行と失効」。「監査と確認」に機械の操作の記録、「利用者・会社・店舗の権限」に無効化・降格で鍵が失効することを追記）
  - `docs/manual/09-ai.md`（MCP の `DAIFUKU_API_KEY` を推奨の接続方法として表と例に追加、REST の API キーの呼び方、用途の違い）、`docs/operations/enterprise-identity.md`（MFA 利用者の MCP 起動に API キーという代替があること）
  - `docs/architecture/permissions.md`（機械の actor の権限と、人の判断を要する業務の拒否）
  - `docs/log/2026-10-30-machine-credentials.md`

## データ・業務ルール（出典）

- 日本の業務・法令の規則は新しく扱わない（制度値なし）。
- 監査の継続: 機械による書込も `audit_log` に actor と変更前後が残り、訂正削除の履歴の扱いは変えない — [日本の制度事実](../domain/japan-tax.md#電子帳簿保存法)（国税庁 電子帳簿保存法一問一答）。
- access token を URI の query に入れず、利用範囲を限定する — [機器連携の設計根拠](../domain/edge-relay-security.md) の RFC 9700（OAuth 2.0 Security BCP、確認日 2026-09-12）。AC-11・判断 7 の根拠。
- **未確認**: RFC 6750（Bearer Token Usage。Authorization header での送信、401 / 403 の使い分け）と OWASP の Secrets Management / REST Security Cheat Sheet（秘密の期限・失効・ログ非出力）。2026-10-30 にこのセッションから `www.rfc-editor.org` と `cheatsheetseries.owasp.org` へ接続できず、内容と確認日を `docs/domain/` に書けなかった。実装者は接続できれば `docs/domain/identity-and-mail-sources.md` に一次資料と確認日を追記し、できなければ log に未確認と書く。

## スコープ外（明記）

- OAuth 2.0 の client credentials・token exchange、JWT 形式の機械トークン、署名付き要求
- 鍵の rotation の自動化・期限の延長・発行後の編集（AC-19）・物理削除と保存期間の整理
- 店舗・拠点限定の鍵、複数の会社にまたがる鍵（会社横断 port は拒否する。AC-23）
- 鍵ごとの要求数の上限、接続元 IP の許可リスト
- 期限切れの前の通知（メール・受信箱 `<module>.todo`・導入チェックの項目）。一覧の「期限まで N 日」だけ
- 汎用の監査パネル（`audit-panel.tsx` の `machine:<id>`）で鍵の名前を表示すること（F3 の監査の横断検索で扱う）
- MCP の HTTP / SSE transport、MCP から REST を経由する接続
- 失効の step-up（判断 5）
- 人事・給与の連携を鍵で行うこと（休暇の付与・精算・給与制度の承認・従業員の証憑の添付など。AC-22、判断 17）
- B4 のセットアップウィザード・C6 の役割別ホームからの導線（未統合のため。統合後に追加するなら `navigation-data.ts` の項目を参照する）
- pack `restaurant-chain` の締めの提出・店長確認（`restaurant_chain.submit_for_review`・`restaurant_chain.review`・`before_submit` の hook）を鍵に対して拒否すること（AC-22 の対象外）。この pack は提出者と確認者を比べる判定を持たず、人でも同じ人が提出と確認をできるので、鍵が職務分離をすり抜ける余地が無い。`submittedBy` / `reviewedBy` には資格情報の id が残る（代理 AI でエージェントの id が残るのと同じ）。`requireHumanUserId` に替えると代理 AI の記録が利用者の id に変わるため、pack の判断として別項目で扱う

## 検証手順（E2E、実行して記録する）

1. 編集中は `pnpm gate:quick`。commit 前に `TEST_DATABASE_URL_OWNER` / `TEST_DATABASE_URL` を設定して `GATE_DB_SHARDS=1 pnpm gate:light`（kernel・migration を変えるので DB 全件へ昇格する）。最後に `pnpm test:db:templates -- --drop`。
2. 試験と受入基準の対応:

| 水準 | ファイル | 受入基準 |
| --- | --- | --- |
| 単体 | `kernel/test/machine-credentials.test.ts` | 鍵の形式と `isMachineTokenFormat`、入力 schema（AC-3）、状態の判定順（AC-20）、`machineContextParams` の形（AC-7）、`requireHumanUserId` の種別ごとの戻り値（AC-22） |
| DB | `kernel/test/machine-credentials.db.test.ts` | 発行と hash だけの保存（全列と監査の `before` / `after` を文字列化して秘密・その 8 文字以上の部分を含まない、`secret_hash = sha256(token)`、`issuedSessionVersion`）（AC-1、AC-2）、step-up の欠如・使用済み・別人の拒否（AC-3a）、テナント管理者以外・無効・代理・機械の拒否（AC-4）、別テナントの会社（AC-5）、停止中を含む上限（AC-6）、`now` を進めた期限切れ・失効・用途違い・発行者の無効化と 401、拒否の監査と 1 時間の間引き・同時 10 件の拒否で監査 1 件（AC-8、AC-9、AC-14）、既知の鍵の拒否は鍵ごとの予算・未知の鍵は IP 予算（AC-13）、最終使用の更新と 60 秒の間引き（AC-15）、冪等な失効・同時 2 件の失効で監査 1 件（AC-17）、無効化・降格での失効と件数・再有効化で戻らないこと（AC-18）、app role に DELETE が無いこと（AC-19）、有効な鍵を必ず含む一覧と `truncated`・別テナントの一覧・失効・履歴の不可視（AC-20、AC-21）、kernel の人の port の拒否（AC-23）、`activeApiKeys`（AC-33） |
| DB | `apps/api/test/machine-credentials.db.test.ts` | REST の 4 経路と検証エラー・step-up（AC-1、AC-3、AC-3a、AC-4〜AC-6、AC-17、AC-20、AC-21）、`PATCH` / `PUT` / `DELETE /admin/tokens/:id` の 404（AC-19）、鍵による読取・作成と、同じロール（販売・閲覧）の人と同じ結果、閲覧ロールの鍵の 403、業務の監査の `actor_type = 'machine'` と `created_by = null`（AC-7）、失効後・期限切れ後の 401 と同一の本文（AC-8、AC-9）、会社の分離（別会社の id は 404、`x-company-id` 違いは 403 と監査、同じ値は可）、別テナントの記録の不可視（AC-7、AC-10）、query の鍵・`Origin` 付き（AC-11）、`/auth/me`・`/admin/access`・`POST /admin/tokens`・`/edge/pairings`・`/edge/credentials/revoke` の 403（admin・edge_manager の鍵でも）（AC-12）、未知の鍵の 429・同じ IP からの有効な同時 150 件が成功・失効済みの鍵 200 件の後も同じ IP の有効な鍵が 200（AC-13）、要求ログの actor と鍵の非出力（inject の logger を捕捉）（AC-2、AC-16）、休暇の付与・経費の承認・精算・証憑の添付・給与制度の承認・受信箱（`workforce.todo` / `tax_filing.todo`）を鍵で行うと 403 `human-actor-required`（AC-22。勤怠の承認と申告準備の確認は同じ `requireHumanUserId` を通る経路で、試験は経費の承認と `tax_filing.todo` で代表させた。作業記録を参照）、`group_accounting.companies` の 403（AC-23）、無効化の応答の `revokedMachineCredentials` と `GET /admin/access` の `activeApiKeys`（AC-18、AC-33）、発行者本人の従業員への仮払の作成・人が用意した仮払の確定・確定済みの精算書の取消・`expense.draft_settlement`・`expense.settlement_candidates`・`expense.todo` を鍵（admin、accounting と workforce_payroll、`expense.todo` は accounting だけも）で行うと 403 `human-actor-required` で何も書かれない（AC-22、2026-10-30 統合時の追加） |
| DB | `modules/expense/test/access.db.test.ts`、`modules/workforce/test/leave-expense.db.test.ts` | 機械の actor（admin、accounting と workforce_payroll）が経費精算のすべての hook・action（作成・ヘッダと明細の更新・明細の削除・削除・確定・取消・訂正、仮払の作成・更新・削除・確定・取消、下書きの作成・候補・受信箱）と workforce の `settleExpensesForSource` / `reopenExpensesForSource` で 403 `human-actor-required`、版・状態・件数が変わらない（AC-22、2026-10-30 統合時の追加） |
| DB | `apps/mcp/test/machine-credentials.db.test.ts` | 鍵での起動と ContextParams、`partner_list` の実行と監査の actor（AC-24）、用途違い・失効済み・会社違いの拒否（AC-25）、接続中の失効・期限切れでツールが `isError` と `use_denied` の監査（AC-26） |
| 単体 | `apps/mcp/test/config.test.ts` | `DAIFUKU_API_KEY` だけで設定が通り、パスワード・`DAIFUKU_TENANT_ID` 等との同時設定が設定エラー（AC-24、AC-25） |
| 単体 | `apps/web/src/lib/machine-credentials.test.ts` | 下書きの検証、状態と「期限まで N 日」・「未使用」の文、使い方の文、無効化の確認に足す文（ja / en）（AC-27、AC-28、AC-33） |
| 単体 | `apps/web/src/lib/help.test.ts`、`apps/web/src/lib/navigation.test.ts` | `/admin/tokens` の手引きの節が manual 08 にあり、`tenant-admin` 条件で非管理者に出ない（AC-31、AC-32） |
| ブラウザ（通常の試験群、本人確認なし） | `apps/web/e2e/machine-credentials.spec.ts` | 画面の見出し・空状態・発行ボタンの無効と設定の案内（AC-3a、AC-27、AC-28）、非管理者には画面もナビゲーションも出ない（AC-31）、英語表示、390px のはみ出しなし、`judge` による axe（AC-32）。`page.route` で step-up と発行の応答を差し替えて、`/auth/security` の読込失敗、認証コードの誤りの欄と焦点、処理中に閉じたときの一覧の警告、結果不明の後の再送で step-up を聞き直すこと、409 の日英の文（AC-28、AC-29） |
| ブラウザ（identity 試験群、本人確認あり） | `apps/web/e2e/machine-credentials-identity.spec.ts` | 発行（未入力の欄の表示、`admin` の注意、パスワードでの step-up）→ 秘密を一度だけ表示・コピーの通知・閉じた後と再読込後に画面のどこにも無い・一覧の応答にも無い → Playwright の `request` で鍵を使って `GET /api/partner` が 200 → 失効（Esc で取りやめ、実行、焦点）→ 同じ鍵が 401 → 履歴に発行・失効・拒否、別のテナント管理者が発行した鍵を持つ利用者の管理者属性を外すと確認に件数が出て鍵が失効、390px と axe（秘密の表示、鍵がある一覧、失効の Dialog、長い理由を持つ履歴の Dialog を日英 × 390 / 1280px）、空状態のボタンから発行した後の焦点（AC-8、AC-18、AC-27〜AC-30、AC-32、AC-33） |

3. ブラウザ試験: `/tmp/claude-0/-home-user-DaifukuERP/8a7541e3-ab40-5f9c-ac08-5679d2bd0af8/scratchpad/tools/e2e-run.sh <worktree> <slot 19〜30> e2e/machine-credentials.spec.ts e2e/navigation.spec.ts e2e/access-management.spec.ts --project=chromium --no-deps`。identity 試験群は新しい空の DB `daifuku_e2e_test_enterprise_<suffix>` を `TEST_DATABASE_URL_*` に渡して `E2E_IDENTITY_PREPARE=1 pnpm test:identity:e2e`（固定の port 3109 / 3110 / 5189 が空いていることを確かめてから）
4. 手動の確認（log に記録）: `IDENTITY_ENCRYPTION_KEY` を設定して `pnpm dev:api` を起動し、テナント管理者の JWT で `POST /auth/step-up` → `POST /admin/tokens` → 返った鍵で `curl -H "authorization: Bearer <鍵>" /api/partner`（200）→ `x-company-id` に別会社（403）→ `POST /admin/tokens/:id/revoke` → 同じ curl が 401 → `GET /admin/tokens/:id/audit` に `issue` / `use_denied` / `revoke`。用途 `mcp` の鍵で `DAIFUKU_API_KEY=<鍵> pnpm -s -C <repo> --filter @daifuku/mcp start` を SDK クライアント（`apps/mcp/test/stdio.db.test.ts` と同じ方法）で接続して `partner_list` を呼ぶ。
5. `pnpm gate:full`（統合担当が実行）。

## 未決事項（利用者の判断待ち）

1. **利用者管理全体（利用者の作成・テナント管理者の付与）にも step-up を求めるか** — 鍵の発行は spec critic の指摘で step-up を求めることにした（判断 5）。`createManagedUser` / `putCompanyMembership` が step-up なしで永続的な資格情報（パスワード）や権限を作れる点は既存の別の穴として残る。最小構成で鍵を発行したい要望があれば、MFA の無い利用者に限って `IDENTITY_ENCRYPTION_KEY` なしで step-up を使えるようにするかも合わせて判断する。
2. **発行者のパスワード変更・全端末ログアウトで鍵を止めるか** — 推奨の既定: 止めない（判断 9）。無効化・テナント管理者の解除だけで失効する。
3. **鍵ごとの要求数の上限（中継機は 600 件/分）を設けるか** — 推奨の既定: 初版は設けない。IP ごとの失敗予算だけ。負荷の問題が出たら `identityRateLimit` で追加する。
4. **期限が近い鍵の通知** — 推奨の既定: 一覧の「期限まで N 日」だけ。導入チェック（`registry.registerHealthCheck`、id `system.machine_credentials`）は閲覧できる利用者（admin / settings）と鍵の管理者（テナント管理者）が一致しないため、別の項目で扱う。
5. **MCP で鍵を使うときに `DAIFUKU_AGENT_ID` を監査へ残すか** — 推奨の既定: 残さない（actor は鍵。エージェントを分けたいときは鍵を分ける）。
6. **一次資料の追記**（RFC 6750、OWASP）— 上の「データ・業務ルール」の未確認の項目。実装時に接続できれば確認日つきで追記する。
