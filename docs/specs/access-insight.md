# Spec: access-insight（権限マトリクスと監査の横断検索）

- 状態: draft
- モジュール: `kernel`（権限表の導出 `permission-matrix.ts`、監査の検索 `audit-search.ts`、監査表の索引）、`apps/api`（`GET /admin/permissions`、`GET /admin/audit`、`GET /admin/audit/options`）、`apps/web`（`/admin/permissions`、`/admin/audit`） ／ 依存: [ui-kit](ui-kit.md)、[list-workbench](list-workbench.md)（一覧の CSV 出力の監査 `export_rows`）、[company-admin](company-admin.md)（テナント管理者の判定 `assertAccessAdmin` の再利用）、[setup-health](setup-health.md)（管理画面の権限表示の先例）、[navigation-assist](navigation-assist.md)（`help.ts`）
- ADR: 新規 ADR は作らない。[ADR-0007](../adr/0007-authorization.md) に追補（権限表の導出、監査の検索の範囲と読取時のマスク、索引）。この項目に予約された ADR-0038 は使わない。DSL・port の拡張なし（kernel に読取関数と監査表の索引 3 本、kernel の機能のロール定数を足すだけ）
- 作成: 2026-10-30 ／ 作成者: agent（F3 spec 作成セッション、`wip/access-insight`）。設計の元は [完成度向上の実装計画](../completion-plan.md) F3

## 目的（1段落）

管理者は「sales ロールは取引先を削除できるか」「店舗限定の所属で何ができるか」を確かめるのに、ソースの `permissions` 定義を読むしかない。また監査は記録画面の監査パネル（記録 id 単位）と利用者ごとのアクセス変更履歴しか見る場所がなく、「先週だれが何を変えたか」「だれが取引先を CSV で持ち出したか」（[list-workbench](list-workbench.md) の出力の監査は記録されるが画面が無い）に答えられない。テナント管理者と会社の管理者が、registry の権限定義から導出した entity × ロール × 操作の表と、期間・利用者・対象・操作で監査を横断検索する画面を使えるようにする。どちらも読取専用で、新しい書込経路も権限の迂回も作らない。

## 受入基準（EARS）

### 権限マトリクス

- AC-1 WHEN admin ロールを持ち所属の範囲が全社の利用者（会社の管理者、またはどの会社でも admin になるテナント管理者）が `GET /admin/permissions` を呼んだ THE SYSTEM SHALL kernel の registry から導出した権限表を返す: `ops`（`OPS` の順）、`roles`（利用者管理で付けられるロールと同じ `availableRoles()` の集合。`admin` を先頭に「すべて（暗黙）」として、ラベルは module・pack の `roles` 宣言の最初のもの、無ければロール名）、`entities[]`（`name`、`label`（pack のラベル上書き `labelOverrides` を反映）、`module` とそのラベル、`kind`、`scope`、`pack`（pack の entity ならその名前、それ以外は null）、`applied`（現在の会社に適用済みか。pack でなければ true）、`ops`（document は 8 操作、それ以外は `read`・`create`・`update`・`delete`・`export`）、`grants`（ロール → 許可された操作。宣言を `ops` に限る）、AC-3 の注記）、`actions[]`（AC-4）。
- AC-2 THE SYSTEM SHALL 表を実行時に宣言（`permissions.roles`、`rowRules`、`fieldGroups`、`storeAccess`・`siteAccess`（`registerStoreAccess` で足されたものを含む）、`relayAccess`、document の `transitions`、action の `permission`）から導出し、entity・ロール・操作の手書きの一覧を持たない。registry の全 entity が 1 回ずつ現れ、各 entity・各ロール（admin を除く）・`ops` の各操作について「`grants[role]` に含まれる」と「`can({ roles: [role], accessScope: 'all', appliedPacks: [その entity の pack] }, entity, op)` が真」が一致する。
- AC-3 THE SYSTEM SHALL 各 entity の注記として次を返す。(a) 行ルール: `rowRules` ごとに対象ロール、元の `where`、日英の要約文、`self`、`restrictedOps`（対象ロールごとに、そのロールに許された操作のうち `create` を除いたもの。kernel は行ルールを既存の行の読取・変更・確定などにだけ当て、作成する値は制限しない）。要約文は field と enum のラベル、`$ctx.userId` / `$ctx.actorId` は「自分」、`$ctx.companyId` は「現在の会社」、`$ctx.tenantId` は「現在のテナント」、`docstatus` は状態名で書き、演算子は `=`・`≠`（`$ne`）・`>`・`≥`・`<`・`≤`・`が次のいずれか`（`$in`）・`が次に一致`（`$like`）・`が空`（`null`）・`が空でない`（`$ne: null`）、`$and` は「かつ」、`$or` は「または」でつなぐ。要約が知らない演算子は元の `where` の JSON をそのまま要約文にする。`self: true` は `where` の最上位の AND の項（`$and` の中は含まない）のどれかが、field の `$ctx.userId` / `$ctx.actorId` との等号（`{ userId: '$ctx.userId' }`）か、その token だけを持つ `$in` であるときに限る。それ以外（`$or` の中にだけある、`$ne` で使う、など）は `self: false` で「条件付き」の札になる。凡例に「作成時の値は行ルールでは制限されない（module の検証による）」と示す。(b) 項目の制限: `fieldGroups` ごとに名前、項目（ラベル付き）、読めるロール。(c) 店舗・拠点限定の所属: `stores` と `sites` のそれぞれについて有効な方針（`storePolicy` / `effectiveSitePolicy` と同じ解決。親方針は親 entity のラベル付き）と、その所属で許される操作の上限 `allowedOps`（方針が無ければ空、`sharedRead` は `read`・`export`、それ以外は確定・取消・改訂を除く）と `sharedReadAnyRole`（`sharedRead` ならロールによらず閲覧可）。各ロールの実効操作 =（`grants[role]` ∩ `allowedOps`）∪（`sharedReadAnyRole` なら `read`）が `can({ roles: [role], accessScope, appliedPacks: [その entity の pack] }, entity, op)` と一致する。(d) 店舗端末: `relayAccess.operations` と `relay` ロールの許可の積。(e) `audit: 'none'` なら「変更の監査なし（CSV 出力は記録される）」（`export_rows` は entity の `audit` 設定によらず出力を監査する）。(f) 名前付き遷移: 名前・`from`・`to`・`roles`・`guard` の有無と、`runnableRoles`（ロールが `t.roles` に含まれるか admin であり（`t.roles` が無ければ全ロール）、かつ `grants` に `update` があり、かつ `to` が確定なら `submit`・取消なら `cancel` がある、という `transitionDocument` と同じ判定）。確定への名前付き遷移がちょうど 1 つなら通常の `submit` はその遷移を通るので `submitVia: [その遷移名]` を返し、画面の `submit` のセルに「<遷移名> 経由のみ」と注記する（2 つ以上なら `submitVia` はそれらの名前で、通常の `submit` は使えないと注記する）。会社単位の entity は選択中の会社の行に限られることを凡例で示す（テナント共通の entity には `scope: 'tenant'` の札）。
- AC-3a THE SYSTEM SHALL 権限表の応答に `kernel`（kernel の機能とそれを使えるロールの一覧）を含める: 会社設定の変更と履歴・導入チェック = `admin`・`settings`（会社全体の所属）、利用者と権限・会社の管理 = テナント管理者、権限表と監査の検索 = `admin`（会社全体の所属）。一覧は `settings.ts`・`health.ts`・`audit-search.ts` が実際の判定に使うロール定数（`SETTINGS_ROLES`・`HEALTH_ROLES`・`ACCESS_INSIGHT_ROLES`）から作り、手書きの別の一覧を持たない。画面はロールの列ごとに、entity の許可が無くても kernel の機能があればそれを示す（例: `settings` の列の「会社設定・導入チェック」）。
- AC-4 THE SYSTEM SHALL 汎用（`generic`）でも内部（`internal`）でもない action について、`name`、`module`、`description`、`mutates`、入口の権限（`{ kind: 'authenticated' }` / `{ kind: 'roles', roles }` / `{ kind: 'entity', entity, op }`）、`storeAccess`・`siteAccess`・`relayAccess`、`applied` を返し、ロールごとの実行可否を `runnable`（ロール名の一覧）として返す。`runnable` に含まれることと `canRunAction({ roles: [role], accessScope: 'all', appliedPacks: <読み込まれた全パック> }, action)` が真であることが一致する（action の pack と、入口の権限が指す entity の pack の両方を適用した場合の可否。現在の会社に適用済みかは `applied` で別に返す）。画面には「action の中で追加の確認（テナント管理者だけ、など）を行う場合がある」ことを注記する。
- AC-5 IF 要求者が admin ロールを持たない、所属が店舗・拠点限定である、または実行者の種別（`actor.type`）が `user` でも `agent` でもない（店舗端末 `relay`、`system`、F2 の機械用資格情報 `machine` など今後増える種別を含む）THEN THE SYSTEM SHALL `GET /admin/permissions` を 403 で拒否する。`agent` は利用者の JWT に `x-agent-id` を付けた要求（同じ人の資格情報で、ロールもその人のもの）なので、その人が admin なら許す。会社を選んでいないテナント管理者（ロールは `admin`、適用済みパックなし）には pack の entity と action を `applied: false` で返す。
- AC-6 WHEN 管理者が `/admin/permissions` を開いた THE SYSTEM SHALL 「データ」と「アクション」のタブで表を表示する。データの表は module ごとにまとめた entity の行 × ロールの列で、各セルに許可された操作を略号（凡例を表示し、各セルには支援技術向けに操作の完全な名前を付ける）で示し、注記を札（自分の行のみ・条件付き・項目の制限・店舗限定・拠点限定・店舗端末・監査なし・未適用のパック）で示す。行を開くと行ルールの要約、制限項目、店舗・拠点限定の所属での実効操作、店舗端末の操作、名前付き遷移を表示する。module・ロール・名前（日英のラベルまたは entity 名の部分一致）で絞り込め、タブと条件を URL（`?tab=&module=&role=&q=&packs=`）に保持する。ロールを 1 つ選ぶと entity × 操作の表に切り替わる。凡例に kernel の機能（AC-3a）を表示する。未適用のパックの entity と action は既定で隠し、「未適用のパックも表示」で表示する（未適用と明記）。アクションのタブは action × ロールの実行可否と入口の権限を表示する。
- AC-7 THE SYSTEM SHALL 権限表の画面の文言を日本語と英語で持ち、390px 幅（幅 640px 以下）ではロールを 1 つ選んだ表示を既定にして（URL に `role` があればそのロール、無ければ `roles` の順で admin の次のロール。URL は書き換えない）、表は自分の領域の中だけで横に動かし、ページ全体に横スクロールを出さない。

### 監査の横断検索

- AC-8 WHEN admin ロールを持ち所属の範囲が全社の利用者が `GET /admin/audit` を呼んだ THE SYSTEM SHALL 現在の会社（`company_id = ctx.companyId`）の監査記録を、期間（`from`・`to`。`YYYY-MM-DD` を日本時間の日付として両端を含む）、利用者（`userId`。実行者 `actor_id` か代理元 `on_behalf_of` が一致）、対象（`entity`）、操作（`op`）、記録 id（`recordId`。`entity` と併用）で絞り込み、日時の新しい順（同じ日時は `id` の降順）に `limit`（1〜100、既定 50）件ずつ返す。応答は `{ items, nextCursor }` で、各項目は `id`、`at`、`entity`、`recordId`、`op`、`action`、`actorType`、`actorId`、`actorName`（実行者が tenant の利用者ならその名前、それ以外は null）、`onBehalfOf`、`onBehalfOfName`、`requestId`、`before`、`after`。
- AC-9 WHEN 前の応答の `nextCursor` を `cursor` に渡した THE SYSTEM SHALL その前のページの最後の項目より古い項目から続きを返す（同じ日時の行も重複・欠落しない。検索の間に新しい行が追記されても既に返した範囲はずれない）。続きが無ければ `nextCursor: null`。件数の合計は返さない。
- AC-10 WHEN テナント管理者が `scope=tenant` を指定した THE SYSTEM SHALL 会社に属さない監査記録（`company_id IS NULL`。利用者の作成・変更、パスワード変更、セッション失効、招待・本人確認）だけを同じ条件で返す。既定の `scope=company` の結果にはこれらを含めない。
- AC-11 IF 要求者が admin ロールを持たない、所属が店舗・拠点限定である、実行者の種別が `user` でも `agent` でもない（AC-5 と同じ）、または `scope=tenant` なのに有効なテナント管理者（`users.tenant_admin`、`assertAccessAdmin` と同じ判定）でない THEN THE SYSTEM SHALL `GET /admin/audit` と `GET /admin/audit/options` を 403 で拒否する。判定の順序は (1) ロール・所属の範囲・実行者の種別の 403、(2) 検索条件の 400（AC-15）、(3) `scope=tenant` のテナント管理者の 403、(4) 会社が無いときの 409 とする（admin でない要求者が誤った条件を送っても 403 になり、検索条件の形を知らせない）。
- AC-12 THE SYSTEM SHALL 検索結果を要求の tenant と範囲（会社範囲は現在の会社、テナント範囲は会社なし）の行に限り、どの絞り込み（記録 id・対象・利用者を含む）でも別の会社・別の tenant の行を返さない。会社の管理者は所属していない会社を選べない（既存の会社選択の拒否）ので、その会社の監査も見られない。
- AC-13 THE SYSTEM SHALL `before`・`after` を読取時に、その entity について呼出し元に適用される項目マスク（`maskedFields`）と `outputHidden`（ext の項目を含む）で絞って返す（記録画面の監査パネル `auditTrail` と同じ規則を共通の関数で適用する。記録した後で `outputHidden` や項目の制限に入った項目も出さない）。registry の entity のうち呼出し元が `read` できないもの（例: この会社で未適用のパックの entity）の行は結果から除く。除外は検索の SQL の WHERE（`entity NOT IN (<呼出し元が読めない registry の entity>)`）で行い、`limit` と cursor はその後に当たる（最後のページ以外は常に `limit` 件。JS で取り除いて件数が欠けることはない）。検証手順 4 の計測にもこの条件を含める。IF `entity` の絞り込みがそのような entity を指す THEN THE SYSTEM SHALL 403 を返す。registry に無い名前（kernel の監査対象や、読み込んでいない module の entity）の行は保存された値のまま返す。
- AC-14 THE SYSTEM SHALL 一覧の CSV 出力の監査（`op = 'export'`、`action = '<entity>.export_rows'`、`after = { export: { where, search, orderBy, columns, rows, total, truncated } }`）を他の監査と同じく結果に含め、`op=export` で絞り込めるようにする。条件の伏せ字（`'[masked]'`）はそのまま返し、値を復元しない。
- AC-15 IF 期間が欠けている・実在しない日付・`from` が `to` より後・366 日を超える（`from` から `to` までの日数を両端を含めて数え、366 以下を許す。例: 2024-01-01〜2024-12-31 は 366 日で許す、2025-01-01〜2026-01-01 は 367 日で拒む。Web の確認（AC-19）も同じ定義と同じ例で試す）、`limit` が 1〜100 の整数でない、`cursor` が読めない、`recordId` が uuid でないか `entity` なしで指定された、`entity`・`op` が形式（英小文字で始まる英小文字・数字・`_`、64 文字まで）に合わない、`userId` が空か 200 文字を超える、`scope` が `company`・`tenant` 以外、または未知の項目がある THEN THE SYSTEM SHALL 検索せずに 400（項目ごとの issue）を返す。IF 会社範囲なのに要求に会社が無い（会社を選ばない tenant の文脈）THEN THE SYSTEM SHALL 409（`StateError`、会社を選ぶ案内）を返す。
- AC-16 THE SYSTEM SHALL 検索と候補の取得を読取専用のトランザクション（`readOnlySnapshot`）で実行し、検索自体は監査にも業務データにも何も書かない。監査表の権限（app role は `SELECT`・`INSERT` のみ）と追記専用の trigger は変えない。
- AC-17 WHEN 管理者が `GET /admin/audit/options?scope=company|tenant` を呼んだ THE SYSTEM SHALL 絞り込みの候補を返す: `users`（会社範囲は、現在の会社に所属する利用者（`kind: 'member'`）、所属を外された元の所属者（`kind: 'former'`。この会社の `entity = 'company_membership'` の監査の `record_id` に現れ、今は所属していない tenant の利用者。画面は「（所属解除済み）」と付ける）、テナント管理者（`kind: 'tenant_admin'`）。各 `{ id, name, active, kind }` でメールアドレスは返さない（会社の管理者は利用者の一覧を見られない既存の境界を広げない）。同じ人は member、tenant_admin、former の順に 1 回だけ。テナント範囲は tenant の全利用者で `{ id, name, email, active, kind: 'user' }`。どちらも名前順）、`subjects`（会社範囲は呼出し元が読める entity（ラベル付き。`audit: 'none'` の entity も CSV 出力の監査があるので含める）と kernel の監査対象 `company_settings`・`company`・`company_membership`・`relay`、テナント範囲は `access_user`・`identity`。各 `{ name, label, kind: 'entity' | 'kernel' }`）、`ops`（kernel が知る操作とラベル。`OPS` と `AUDIT_OP_LABELS`: 添付の `supersede`、利用者の `password_change`・`sessions_revoke`、本人確認の `invitation_queued`・`invitation_accepted`・`password_reset`・`mfa_enabled`・`mfa_disabled`・`mfa_login`・`mfa_recovery_used`・`mfa_recovery_regenerated`・`oidc_linked`・`oidc_unlinked`、店舗端末の `pairing_issued`・`paired`・`rotated`・`revoked`）。候補に無い操作も AC-15 の形式なら検索でき、結果には操作名のまま表示する。利用者も候補に無い id（`system`、店舗端末、AI の agent id、今は候補に出ない人）を画面で直接入力して検索できる（API の `userId` は任意の文字列）。`AUDIT_SUBJECTS`・`AUDIT_OP_LABELS` が実際の書込と食い違わないよう、単体試験が `kernel/src` と `modules/*/src` の `writeAccessAudit(…, '<対象>', …, '<操作>')`・`writeAudit(…, '<対象>', …, '<操作>')`・`authAudit(…, '<操作>')` の文字列を走査し、一覧に無い対象・操作があれば失敗する。
- AC-18 THE SYSTEM SHALL 監査表 `audit_log` に検索用の索引 `audit_log_company_at_idx (tenant_id, company_id, at, id)`、`audit_log_actor_at_idx (tenant_id, actor_id, at)`、`audit_log_on_behalf_at_idx (tenant_id, on_behalf_of, at) WHERE on_behalf_of IS NOT NULL` を `kernel/src/db/system-tables.ts` の宣言と通常の migration 生成（`pnpm db:schema` → `pnpm db:generate audit_search_indexes`、生成された SQL は手で直さない）で追加し、既存の索引は残す。80 万行以上の現実的な分布のデータで、検証手順 4 の検索形 S1〜S7 の 1 ページ目が監査表の Seq Scan を使わず実行時間 100 ms 以下、最悪形 S8・S9 が 500 ms 以下であることを EXPLAIN (ANALYZE, BUFFERS) で確かめ、計画と時間を作業記録に残す。
- AC-19 WHEN 管理者が `/admin/audit` を開いた THE SYSTEM SHALL 直近 7 日（今日を含む、日本時間）の現在の会社の監査を表示し、期間・利用者・対象・操作・記録 id（対象を選んだときだけ入力できる）で、テナント管理者にはさらに範囲（この会社／テナントの管理操作）で絞り込めるようにする。条件と `cursor` を URL（`?from=&to=&user=&entity=&op=&record=&scope=&cursor=`）に保持し、再読込・戻る・共有した URL で、同じ会社を選んでいる限り同じ結果を出す（会社は URL ではなく画面上部の会社の選択で決まる）。入力の誤り（実在しない日付、開始 > 終了、366 日超、uuid でない記録 id）は欄ごとに理由を示し、最初の誤りへ焦点を移して検索しない。URL の読めない条件は無視して既定値で表示し、その旨を表示する。
- AC-20 THE SYSTEM SHALL 結果の各行に日時（日本時間と明記）、利用者（名前。代理なら「名前（AI 代理: agent id）」、`system`・`relay` などは種別名と id）、対象のラベル（読める entity は meta のラベル、kernel の監査対象は候補のラベル、それ以外は名前）、操作のラベル、内容（作成は書いた値、更新などは変わった項目と前後の値を既存の `fieldChanges`・`changeValueText` で、CSV 出力は「n 行（全 m 件。上限で打ち切ったときは明記）・列・条件」）を表示する。読める entity の記録で操作が削除・出力以外なら記録画面へのリンクを付ける。詳細（変更前後の全項目）は行ごとに開閉できる。「次へ」「前へ」（この画面で辿った範囲）「最初へ」でページを移り、表示件数と続きの有無を読み上げ領域に出す。0 件なら条件を変える案内を、取得に失敗したら理由と再試行を出し、入力した条件を残す。
- AC-21 THE SYSTEM SHALL 2 つの画面を「設定・管理」分野と画面検索に admin ロールの利用者にだけ表示し（ナビゲーションの新しい条件 `admin`）、それ以外の利用者が直接開いたとき、または API が 403 を返したとき（店舗・拠点限定の所属）は管理者だけが使える画面であることを説明する（範囲の切替はテナント管理者にだけ表示）。画面の手引きリンクは [08 管理者向け](../manual/08-admin.md) の該当節を開く。文言は日本語と英語、390px 幅で操作でき（ページ全体に横スクロールなし）、axe の serious・critical の違反が無い。

## 関係するファイル・インターフェース（名指し）

- kernel（新規）: `kernel/src/permission-matrix.ts` — `derivePermissionMatrix(input)`（純粋関数。入力は entity 定義・action 定義・module と pack・適用済みパック・`storePolicy` の解決）、`permissionMatrix(ctx)`（AC-5 の確認の後に registry から導出）、`describeRowRule(entity, where): Label`、型 `PermissionMatrix` / `MatrixEntity` / `MatrixAction`
- kernel（新規）: `kernel/src/audit-search.ts` — `auditSearchQuery`（zod。route と単体試験が共有）、`searchAudit(ctx, query)`、`auditSearchOptions(ctx, scope)`、`assertAuditAccess(ctx, scope)`、日本時間の日付範囲 `auditPeriod(from, to)`（固定 `+09:00`）、cursor の符号化・復号（`at` をマイクロ秒まで残した UTC の文字列（SQL の `to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` で取り出す。JS の `Date` はミリ秒で切れるので使わない）と `id` を base64url にした不透明な値。続きは行値の比較 `(at, id) < ($1::timestamptz, $2::uuid)` で索引の範囲走査のまま絞る）、`AUDIT_SUBJECTS`（kernel の監査対象とラベル・範囲）、`AUDIT_OP_LABELS`、`ACCESS_INSIGHT_ROLES`
- kernel（新規）: `kernel/src/kernel-capabilities.ts` — `SETTINGS_ROLES`・`HEALTH_ROLES`（`admin`・`settings`）、`ACCESS_INSIGHT_ROLES`（`admin`）、`hasAnyRole(ctx, roles)`、`KERNEL_CAPABILITIES`（AC-3a の一覧。これらの定数から作る）
- kernel（変更）: `kernel/src/settings.ts`・`kernel/src/health.ts`（会社設定と導入チェックの判定を `SETTINGS_ROLES`・`HEALTH_ROLES` で行う。振る舞いは変えない）、`kernel/src/audit.ts`（`auditTrail` の中にある変更前後の絞り込みを共通関数（例 `auditSnapshotFilter(ctx, def)`）へ切り出し、`searchAudit` と共有。`auditTrail` の振る舞いは変えない）、`kernel/src/db/system-tables.ts`（`auditLog` に AC-18 の索引 3 本）、`kernel/src/index.ts`（export）
- kernel（利用のみ、変更なし）: `kernel/src/permissions.ts`（`can`、`maskedFields`）、`kernel/src/store-access.ts`（`storePolicy`、`effectiveSitePolicy`、`storeAllows`）、`kernel/src/actions/run.ts`（`canRunAction`）、`kernel/src/access-admin-common.ts`（`assertAccessAdmin`、`availableRoles`）、`kernel/src/public-output.ts`（`publicOutput`）、`kernel/src/registry.ts`（`allEntities`、`actions`、`allModules`、`packs`、`hasPack`、`labelOverrides`）、`kernel/src/actions/export-rows.ts`（出力の監査の形。変更なし）
- api: `apps/api/src/routes/access-insight.ts`（新規。`GET /admin/permissions`、`GET /admin/audit`、`GET /admin/audit/options`。querystring は kernel の zod で `parse`、`withRequestContext(..., { readOnlySnapshot: true })`）、`apps/api/src/server.ts`（登録）、`apps/api/drizzle/migrations/00NN_audit_search_indexes.sql` と `meta/`（生成物）
- web: `apps/web/src/pages/permissions-page.tsx`・`apps/web/src/pages/audit-page.tsx`（新規、UI キット）、`apps/web/src/api/access-insight.ts`（新規、TanStack Query）、`apps/web/src/lib/permission-matrix.ts`・`apps/web/src/lib/audit-search.ts`（新規、純粋関数: 絞り込み・略号・ロール別表示、URL ↔ 検索条件・検証・cursor の履歴・行の表示文）、`apps/web/src/lib/format.ts`（`formatTimestamp` に時間帯の指定を足す。`fieldChanges`・`changeValueText` を再利用）、`apps/web/src/router.tsx`（2 route と `validateSearch`）、`apps/web/src/lib/navigation-data.ts`（2 項目、`condition: 'admin'`）、`apps/web/src/lib/navigation.ts`（条件 `admin` = `meta.roles` に `admin`）、`apps/web/src/lib/help.ts`（2 画面の節）、`apps/web/src/ui/token-usage.test.ts`（`CONVERTED` に新しい画面と部品）
- docs: `docs/manual/08-admin.md`（節「権限マトリクス」「監査ログの検索」を追加し「監査と確認」から案内）、`docs/manual/appendix-e-operations-control.md` §2（役割の表の後に 2 画面への案内）、`docs/adr/0007-authorization.md`（追補）、作業記録 `docs/log/2026-10-30-access-insight.md`

## データ・業務ルール（出典）

- 権限の規則（ロール × 操作、行ルールは「付与された全ロールが制限されているときだけ」制限、項目の制限、default deny、admin は全操作）— [ADR-0007](../adr/0007-authorization.md)、`kernel/src/permissions.ts`。会社・店舗・拠点の境界（店舗・拠点限定の所属は確定・取消・改訂を行えない、方針の無い台帳は使えない）— [ADR-0018](../adr/0018-company-and-store-access.md)、`kernel/src/store-access.ts`。表はこれらの関数と同じ規則で導出し、AC-2・AC-3・AC-4 の整合試験で一致を確かめる。
- 監査の形（`writeAudit`、追記専用、app role は SELECT・INSERT のみ、更新・削除を拒む trigger）— `kernel/src/audit.ts`、`kernel/src/db/migrate.ts`。会社に属さない監査（`writeAccessAudit(ctx, null, …)`）は `access_user`・`identity`。一覧の CSV 出力の監査の形と伏せ字 — [list-workbench](list-workbench.md) の「データ・業務ルール」。
- 期間の日付は日本時間（業務日付の既定 `todayLocal(now, 'Asia/Tokyo')` と同じ。日本に夏時間は無いので `+09:00` 固定で変換）。
- 新しい制度値・法令の事実は無い。監査表は電子帳簿保存法の「訂正削除履歴」を支える仕組みの 1 つ（[日本の制度事実](../domain/japan-tax.md) の「電子帳簿保存法」）だが、この画面は同法の検索要件（取引年月日・金額・取引先。証憑は [実装計画](../completion-plan.md) E4）を満たすとは主張しない。

## 判断と理由（計画が選択を残した点）

1. **経路は REST の管理 route、action（MCP の tool）にしない。** 先例（`/admin/access`、`/admin/companies`、`/meta/health`）と同じく kernel の関数を route から呼ぶ。テナント範囲の判定に DB の確認（`assertAccessAdmin`）が要る。MCP の tool として一覧に出すかは別に決める（未決事項 1）。ただし REST の管理 route は、利用者の JWT に `x-agent-id` を付けた AI の代理要求（`actor.type = 'agent'`、ロールはその人のもの）からも届く。これは同じ人の資格情報なので、その人が admin なら許し（AC-5・AC-11）、`relay`・`system`・F2 の `machine` など人の資格情報でない種別は拒む。「AI は監査を読めない」とは主張しない。kernel の関数として作るので、後で action に包むのは小さな変更で済む。
2. **使える人は admin ロール（全社所属）の利用者。** 会社の管理者は自社の監査と権限表、テナント管理者はどの会社でも同じ（`resolveCompanyAccess` がテナント管理者に admin を付ける）に加えてテナント範囲。settings ロールは使えない（設定の変更履歴は既存の `/meta/settings/:key/audit` で見られる）。
3. **監査の範囲は 1 会社。** 要求は 1 つの会社で動く原則（ADR-0018）を崩さない。テナント管理者が別の会社の監査を見るときは会社を切り替える。全会社の一括検索はしない（未決事項 2）。
4. **ページ送りは keyset（`at` 降順・`id` 降順の cursor）、合計件数なし。** 監査表は追記専用で際限なく増えるので、`count(*)` と `offset` は遅く、検索中の追記でページがずれる。cursor なら索引の範囲走査で済み、AC-9 のずれも起きない。
5. **期間は日本時間の日付で最大 366 日、既定は直近 7 日。** 業務日付の扱いに合わせ、索引の走査範囲を有限にする（S8 の最悪形を 500 ms 以下に抑える前提）。それ以前の記録の履歴は記録画面の監査パネルで見られる。
6. **利用者の絞り込みは `actor_id` か `on_behalf_of` の一致。** AI 代理（MCP）の操作も本人の操作として見つかる。そのための部分索引を足す（予備計測で BitmapOr になり 19 ms）。
7. **記録 id は対象（entity）と併用する。** 既存の `audit_log_record_idx (tenant_id, entity, record_id)` を使える。entity なしでは予備計測で tenant 全体の索引走査（54〜71 ms）になり、記録 id は entity の中で意味を持つため。
8. **変更前後のマスクは読取時に、記録画面の監査パネルと同じ規則。** admin は項目の制限を受けない（`maskedFields` が空）が、`outputHidden` は誰にも出さない。共通関数にして、今後 admin 以外へ広げても同じ規則になるようにする。読めない entity の行は「詳細だけ隠す」のではなく除外する（行の存在と操作者も業務の情報であり、ページの件数も安定する）。
9. **権限表の列は `availableRoles()`。** 利用者と権限の画面で付けられるロールと同じ集合にする。`relay` は付けられない機械用のロールなので列にせず、店舗端末の注記に出す。
10. **導出と行ルールの要約文は kernel（サーバー）で作る。** field・enum のラベルを持つのは kernel で、Web は受け取った表を描くだけにする（手書きの一覧を Web に持たない。他の入口でも同じ表になる）。
11. **document 以外の確定・取消・改訂は「対象外」。** 汎用の文書操作は document にしか登録されないので、宣言にあっても表の `ops` に含めない。
12. **索引は予備計測（下表）から 3 本に決める。** 実装時に同じ形で計り直し、S1〜S9 の基準を満たさない形があれば、その形を直す最も狭い索引を足して計り直す（追加は spec と作業記録に書く）。既存の `audit_log_at_idx` と `audit_log_record_idx` は他の検索が使うので消さない（未決事項 5）。
13. **ADR は ADR-0007 への追補。** 新しい仕組み（DSL・port）は無く、権限の可視化と監査の読取規則は ADR-0007 の範囲。予約の ADR-0038 は使わない。
14. **監査の検索結果の CSV 出力と、検索したこと自体の監査はしない。** 出力は持ち出しになり、出力の監査と別の権限が要る（未決事項 3）。記録画面の監査パネルも閲覧を記録していない。
15. **監査表は kernel の中で `ctx.db` から読む（Repository を通さない）。** `audit_log` は entity ではなく kernel の system table で、既存の `auditTrail`・`accessAudit` と同じ層・同じ方法（tenant の RLS、明示した tenant と会社の条件）で読む。module・pack・app は kernel の関数を呼ぶだけで、DB に直接触れない（規約 5）。変更前後に含まれる entity のデータには AC-13 の規則（読める entity だけ、呼出し元のマスクと `outputHidden`）を当てるので、Repository で読めない値は出ない。users・所属の表（利用者名と候補）も `accessDirectory`・`companyMemberIdentities` と同じく kernel の中で読み、返すのは id・名前・メール・有効かだけにする。

16. **spec 批評への対応（2026-10-30、実装セッション）。** すべて受け入れた。(1) 利用者の候補に元の所属者を足し、会社範囲ではメールを返さない（AC-17）。画面は候補に無い id も直接入力できる。(2) 名前付き遷移の実行可否は `transitionDocument` と同じ判定で `runnableRoles` にし、確定の遷移が 1 つなら `submit` のセルに「経由のみ」と注記する（AC-3(f)）。(3) 行ルールは作成を制限しないので、ロールごとの制限対象の操作 `restrictedOps` と凡例を返す（AC-3(a)）。(4) `self` は最上位の AND の等号か token だけの `$in` に限り、`$or`・`$ne` などは「条件付き」にする（AC-3(a)）。(5) cursor はマイクロ秒の `at` と行値の比較にする（インターフェース）。(6) 実行者の種別は `user` と `agent` だけを許す（AC-5・AC-11、判断 1）。(7) API の DB 試験にも AC-13 のマスクと未適用のパックの除外を入れる（検証手順 3）。(8) 366 日は両端を含む日数と例で定める（AC-15）。(9) `settings` の列が空に見えないよう kernel の機能を定数から導出して表示する（AC-3a）。(10) 読めない entity の除外は SQL の WHERE で行う（AC-13）。(11) 監査の対象・操作の一覧の漏れは走査する単体試験で検出する（AC-17）。(12) `audit: 'none'` の札は「変更の監査なし（CSV 出力は記録される）」（AC-3(e)）。(13) 整合の式に pack を渡す（AC-3(c)、AC-4）。(14) 狭い画面の既定のロールと、共有 URL が同じ会社でだけ同じ結果になることを定める（AC-7、AC-19）。(15) 索引の書込の費用を計る（検証手順 4）。(16) 403 と 400 の順序、会社なしの権限表、`pnpm metrics:add` を定める（AC-5、AC-11、検証手順 7）。
17. **kernel の機能のロールは定数にして判定と表示で共有する。** 会社設定（`settings.ts`）と導入チェック（`health.ts`）は以前から `admin` か `settings` を `isAdmin(ctx) || ctx.roles.includes('settings')` で判定していた。権限表の凡例だけに同じ一覧を手書きすると食い違いうるので、`kernel-capabilities.ts` の定数を両方の判定と権限表が使う。

### 予備計測（spec 作成時、2026-10-30）

条件: 使い捨ての DB に同じ列の `audit_log` だけを作り、80 万行（tenant A 60 万行: 会社 a0 約 36 万・a1〜a4 各約 6 万・会社なし約 4 千、tenant B 20 万行）、entity 120 種（偏りあり）、利用者 60 人（偏りあり）、AI 代理 5%、操作 create 45%・update 40%・submit 8%・cancel 2%・delete 2%・export 1%・その他 2%、3 年分、変更前後は約 300 バイトの JSON。owner 接続（RLS なし）で手書きの SQL（Drizzle の出力に相当）、負荷平均 9〜11 の共有機。1 回の計測で、実装時の計り直しの代わりにはならない。

| 形                                    | 既存の索引だけ                                  | 3 本を足した後                               |
| ------------------------------------- | ----------------------------------------------- | -------------------------------------------- |
| S1 会社範囲・直近 7 日                | 4.2 ms（`audit_log_at_idx`、会社で 419 行除外） | 0.5 ms（`audit_log_company_at_idx`）         |
| S2 会社範囲・366 日・cursor の続き    | 5.0 ms                                          | 0.5 ms                                       |
| S3 利用者（低頻度）・366 日           | 64.8 ms（7,228 行除外）                         | 18.7 ms（actor と on_behalf の BitmapOr）    |
| S4 対象（低頻度 entity）・366 日      | 18.6 ms（`audit_log_record_idx`）               | 12.1 ms（同じ）                              |
| S5 `op=export`・366 日                | 590.0 ms（40,851 行除外）                       | 28.0 ms（3,956 行除外）                      |
| 参考: 記録 id（entity なし）          | 53.9 ms                                         | 70.5 ms → entity 併用を必須にした（判断 7）  |
| S7 テナント範囲・366 日               | 83.1 ms                                         | 12.9 ms                                      |
| S8 一致 0 件の操作・366 日            | 271.4 ms（Parallel Seq Scan）                   | 330.8 ms（company_at の Bitmap、119,424 行） |
| S9 頻出 entity と `op=export`・366 日 | 228.2 ms                                        | 112.2 ms                                     |
| 行の無い利用者・366 日（参考）        | 406.4 ms                                        | 0.1 ms                                       |

索引の大きさ（80 万行、表本体 417 MB）: company_at 59 MB、actor_at 65 MB、on_behalf（部分）3.4 MB。3 本の作成と ANALYZE は 5.8 秒。

## スコープ外（明記）

- 権限の編集（定義はコード、所属のロールは既存の「利用者と権限」で変える）、利用者を選んだ実効権限の表示（複数ロールの合成と行ルールの規則の計算。未決事項 4）
- 全会社の横断検索、会社範囲とテナント範囲の混在表示
- 監査の検索結果の CSV 出力、検索の監査、MCP の tool（action）
- 変更前後の中身での検索（JSON の全文検索）、時刻単位の期間指定、366 日を超える期間
- 監査の保存期間・アーカイブ・削除、既存索引の削除、`CREATE INDEX CONCURRENTLY`（migration は 1 トランザクションで、適用中は書込を止める既存の手順に従う）
- レポート（`export_rows` 以外の表 action）の CSV 出力を監査に足すこと（未決事項 7）
- 電子帳簿保存法の検索要件（証憑の検索は E4）

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:quick`（編集中）、`pnpm gate:light`（`GATE_DB_SHARDS=1`、`TEST_DATABASE_URL_*` を設定）。full は統合担当。
2. 単体:
   - `kernel/test/permission-matrix.test.ts` — 試験用の registry（ロール・行ルール（自分・条件・`$or`・`docstatus`）・項目の制限・店舗方針（store・parent・sharedRead）・拠点方針・`registerStoreAccess` で足した方針・`relayAccess`・名前付き遷移・document と非 document・pack の entity と action・`audit: 'none'`・module の `roles` 宣言）から、`ops`、`roles` とラベル、`grants`、要約文（日英）と `self`（`$or` と `$ne` の規則は `self: false`）、作成を許すロールの `restrictedOps`（`create` を含まない）、店舗・拠点の実効操作、店舗端末、`applied`、action の入口と `runnable`、名前付き遷移の `runnableRoles` と `submitVia`、kernel の機能（AC-3a）を導出し、試験用 registry の全 entity・ロール・操作で `can()`・`canRunAction()` と一致すること、遷移の `runnableRoles` が `transitionDocument` と同じ判定（ロール・`update`・`submit`/`cancel`）を `can()` で組み立てた結果と一致すること（AC-1〜AC-4、AC-3a）
   - `kernel/test/audit-search.test.ts` — 検索条件の検証（AC-15 の各 400 の理由。日付の実在、閏年、2024-01-01〜2024-12-31（366 日）は許し 2025-01-01〜2026-01-01（367 日）は拒む、`recordId` と `entity`）、`AUDIT_SUBJECTS`・`AUDIT_OP_LABELS` と `kernel/src`・`modules/*/src` の監査の書込の文字列の走査（AC-17）、日本時間の範囲（`from` の 00:00+09:00 以上、`to` の翌日 00:00+09:00 未満）、cursor の往復と改ざん、共通の変更前後の絞り込みが admin 以外の Context で制限項目と `outputHidden`（ext を含む）を落とすこと（AC-8、AC-9、AC-13、AC-15）
   - `apps/web/src/lib/permission-matrix.test.ts` — module・ロール・名前の絞り込み、URL の往復、略号と完全な名前、ロール別表示、未適用のパックの扱い、店舗・拠点の実効操作の表示（AC-6、AC-7）
   - `apps/web/src/lib/audit-search.test.ts` — URL ↔ 検索条件、既定の直近 7 日（日本時間）、入力の検証と最初の誤り、読めない URL 条件の無視、cursor の履歴（次へ・前へ・最初へ、条件変更で初期化）、行の表示文（利用者・代理・system・relay、CSV 出力の要約、作成と更新の内容、リンクの有無）（AC-19、AC-20）
   - `apps/web/src/lib/navigation.test.ts`（条件 `admin`）、`apps/web/src/lib/help.test.ts`（2 画面の節が手引きにあること）、`apps/web/src/ui/token-usage.test.ts`（AC-21）
3. DB:
   - `kernel/test/audit-search.db.test.ts` — 試験用 entity（項目の制限、`outputHidden` の項目と ext、未適用にできる pack の entity）で: 同じ日時の行をまたぐ cursor の続き（重複・欠落なし、途中の追記でずれない）、会社範囲・テナント範囲・別 tenant の分離、記録後に `outputHidden` になった項目を含む旧い行（owner で直接挿入）が出ないこと、読めない entity の行の除外と `entity` 指定時の 403、試験用 entity の `export_rows` で出力した監査が `op=export` で見つかり伏せ字のままであること、会社の無い Context での会社範囲の 409、検索の前後で `audit_log` と業務表の件数が変わらないこと、ページの境界の両側にマイクロ秒だけ違う `at` の行（owner で直接挿入）を置いても重複・欠落が無いこと、読めない entity の行が混ざっても `limit=2` の最後以外のページが 2 件であること、元の所属者が候補に `former` で出て絞り込めること（AC-9、AC-10、AC-12〜AC-17）
   - `apps/api/test/access-insight.db.test.ts` — 全 runtime（`buildServer`）で HTTP 越しに: `GET /admin/permissions` の全 entity・ロール・操作が `can()` と、全 action・ロールが `canRunAction()` と一致し、registry の全 entity が 1 回ずつ現れること、admin 以外（sales）・店舗限定の admin・別会社の会社管理者の拒否（AC-1〜AC-5）。`GET /admin/audit` の期間・利用者（本人と AI 代理）・対象・操作・記録 id の絞り込み、`limit` と cursor、会社の管理者 A・B とテナント管理者の分離、`scope=tenant` の結果と会社管理者の 403、sales・店舗限定の 403、AC-15 の 400、取引先の `export_rows` の監査が見えること、`GET /admin/audit/options` の候補と範囲（会社範囲にメールが無いこと、所属を外した sales の利用者が `former` で出てその id で絞り込めること）、`x-agent-id` を付けた admin の要求は通り利用者の絞り込みで代理元として見つかること、admin でない利用者が誤った条件を送ると 400 でなく 403 になること、旧い行（owner で挿入）の `outputHidden` の項目（勤怠の領収書 `workforce_receipt` の `storageKey`）が返らないこと、未適用のパックの entity の行が除かれ `entity=<その entity>` が 403 になること、`pg_indexes` に AC-18 の 3 本があること（AC-5、AC-8、AC-10〜AC-15、AC-17、AC-18）
4. 索引の計測（AC-18、手動で実行し作業記録に残す）: 自分で作った使い捨ての DB に通常の schema（migration か `createSchemaFromScratch`）を作り、owner で 80 万行以上（予備計測と同じ分布）を投入して `ANALYZE` する。app role で `set_config('app.tenant_id', …)` した読取専用トランザクションの中で、`searchAudit` が発行する SQL（Drizzle の `toSQL()` で取り出す）に対して S1（会社範囲・直近 7 日）、S2（366 日・cursor の続き）、S3（低頻度の利用者・366 日）、S4（低頻度の entity・366 日）、S5（`op=export`・366 日）、S6（entity と記録 id）、S7（テナント範囲・366 日）、S8（一致 0 件の操作・366 日）、S9（頻出 entity と `op=export`・366 日）の `EXPLAIN (ANALYZE, BUFFERS)` を索引の追加前と後で 3 回ずつ取り、計画・中央値・負荷平均・索引の大きさ・作成時間を記録する。索引の書込の費用として、監査の行 1 万件の挿入（`writeAudit` と同じ列）の時間を索引の追加前と後で計り、`audit_log_at_idx` を使う既存の検索が残るかを記録する（未決事項 5 の材料）。終わったら DB を消す。
5. ブラウザ（`apps/web/e2e/access-insight.spec.ts`。`--project=chromium --no-deps`）:
   - 権限表: 管理者で開き、取引先の行の sales の列が `GET /admin/permissions` の `grants.sales` と同じ略号であること、module とロールで絞り込み URL を再読込して同じ表示、ロール別表示、入出金（`payment`）の行を開いて sales の行ルールの要約（「区分 = 入金」）が出ること、アクションのタブ、英語表示、390px（ロール別表示が既定、ページの横スクロールなし）、axe（AC-6、AC-7、AC-21）
   - 監査: 管理者が第 2 の利用者を作り会社に sales で所属させ（取引先の作成・更新ができる）、その利用者で取引先を作成・更新し、管理者で取引先の CSV を出力する。監査画面で利用者をその人に絞るとその人の行だけが出て記録画面へのリンクが開けること、`op=export` で CSV 出力の行（行数・列）が出ること、日付の誤り（開始 > 終了）で欄に理由が出て焦点が移ること、URL の再読込・戻るで条件が戻ること、51 件以上の更新を作って「次へ」「前へ」「最初へ」、英語表示、390px、axe（AC-19〜AC-21）
   - 権限の無い利用者: sales だけの利用者でナビゲーションに 2 画面が出ず、直接開くと説明が出ること。範囲の切替がテナント管理者にだけ出ること（AC-21）
6. `pnpm test:db:templates -- --drop`（自分の `TEST_DATABASE_URL_*` で）、`pnpm gate:full`（統合担当）
7. `pnpm metrics:add -- --feature access-insight --tokens N --minutes N --human-minutes 0 --rework-lines N` で数値を残す。

## 統合時の注意

- 同じ回の F2（API キー）・F1（配送 worker）も migration を足す見込みで、番号（`00NN`）が衝突しうる。衝突したら後に統合する branch の migration を、registry の宣言から `pnpm db:generate audit_search_indexes` で作り直す（SQL を手で直さない）。
- `router.tsx`、`navigation-data.ts`（条件 `admin` の追加を含む）、`help.ts`、`token-usage.test.ts` の `CONVERTED` は統合担当がまとめる。C6（役割別ホーム）の管理者向けの節に 2 画面へのリンクを足すかは統合時に判断する（この項目では足さない）。
- F2（`machine_credential` の `issue`・`revoke`・`use_denied` など）・F1 が監査の書込を足すと、AC-17 の走査試験が `AUDIT_SUBJECTS`・`AUDIT_OP_LABELS` に無い対象・操作として失敗する。統合時にラベル付きで一覧へ足す（会社に属する書込なら `scope: 'company'`）。F2 の `actor.type = 'machine'` は `/admin/*` で拒まれ、この項目の判定（`user` と `agent` だけ）でも 403 になる。
- F2 で機械用資格情報の `actor.type` が増えた場合、監査画面は未知の種別を種別名と id のまま表示する（`audit-search.ts` の表示文に種別のラベルを足すのは F2 側か統合時）。F1 の `integration.webhooks` などに秘密値を会社設定として置くと、既存の設定の監査（`/meta/settings/:key/audit`）と同じくこの検索にも変更前後が出るので、秘密値を会社設定に平文で置かないこと。

## 未決事項（利用者の判断待ち）

1. 監査の検索を MCP の tool（action）として公開するか。推奨: 初版は公開しない（tool の一覧に出すと AI が常に使える手段になるので別に決める。利用者の JWT による代理要求 `x-agent-id` は判断 1 のとおり REST で届く）。
2. テナント管理者向けに全会社を一度に検索するか。推奨: しない（会社を切り替える。1 要求 1 会社の原則）。
3. 監査の検索結果を CSV で出力するか。推奨: 次版。出す場合は出力自体を監査し、出力の権限を分ける。
4. 利用者を選んで実効権限（所属の複数ロールの合成、行ルールの「全ロールが制限されたときだけ」、店舗・拠点の範囲）を表示するか。推奨: 次版（この版の表とその導出式で計算できる）。
5. 既存の `audit_log_at_idx (tenant_id, at)` を消して書込の費用を減らすか。推奨: 初版は残す（使う検索を確かめてから）。
6. settings ロールにも監査の検索を許すか。推奨: 許さない（設定の履歴は設定画面で見られる）。
7. レポート（`export_rows` 以外の表 action）の CSV 出力も監査に記録するか。推奨: 別項目にする（この画面は記録されたものを表示するだけ）。
