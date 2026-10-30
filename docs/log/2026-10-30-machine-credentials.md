# 作業記録: 2026-10-30 機械用資格情報（API キー、F2）

- セッション: workflow wf_2b353e03-822（round 7）の F2 実装者、base `ffc2f42`、branch `wip/machine-credentials` ／ 担当: agent ／ 対象: [docs/specs/machine-credentials.md](../specs/machine-credentials.md)
- 計測: tokens=null（このセッションからは取得できない）, agent_minutes=約 150, human_minutes=0, rework_lines=約 60（下の「見つけた問題と修正」）, gate_failures=0（gate:light の結果は下の検証を参照）

## 決めたこと（と理由）

- **spec critic の 14 件はすべて受け入れた**（spec の「spec critic の指摘への対応」の表）。主な変更:
  - 発行に単回 step-up（`lockIdentity` + `consumeStepUp`）を要する。招待・中継機の pairing と同じ水準で、盗まれたテナント管理者の JWT から 365 日の `admin` 鍵を作れないようにした。代償として `IDENTITY_ENCRYPTION_KEY` の無い最小構成では発行できない（画面は発行ボタンを無効にして案内する。一覧・失効・履歴は使える）。失効は step-up なし（権限を減らすだけで、事故対応で直ちに止める必要がある）。発行の監査に `issuedSessionVersion` を残す。
  - 照合の失敗予算を中継機の「予約して成功時に返す」方式から変えた。未知の鍵だけを IP ごとに数え（照合前は `assertIdentityBudget` で読むだけ）、既知の鍵の拒否は鍵ごとの予算（`machine-denied:<id>`）に数える。有効な鍵は予算の行に書かない。
  - `use_denied` の間引きは `last_denied_at` / `last_denied_reason` への条件付き更新で 1 時間に 1 件（同時の拒否でも 1 件）。失効も `revoked_at IS NULL` の条件付き更新で、同時の失効・自動失効と競合しても監査は 1 件。
  - app role の `machine_credentials` への grant から `DELETE` を外した（`grantsFor`）。
  - `/edge/pairings`・`/edge/credentials/revoke` を `/auth/`・`/admin/` と同じ「人のセッションだけ」の経路（`HUMAN_ONLY`）に入れ、鍵では 403。
  - 一覧は有効な鍵を必ず含め、失効済み・期限切れは合計 500 件まで、超えたら `truncated: true`。
  - kernel の新しい port は `requireHumanUserId`（`Repository` の private `actorUserId()` と意味が逆なので名前を分けた）。
  - 利用者の無効化・テナント管理者の解除で鍵を失効させた件数を `updateManagedUser` の応答と監査に含め、`GET /admin/access` の `activeApiKeys` から利用者画面の確認文に件数を出す（AC-33 を新設）。
- **ADR は新番号を使わず ADR-0023 に追補**した（予約の ADR-0035 は未使用）。ADR-0007 に `actor.type='machine'` の 1 行。
- **発行の画面試験は identity 試験群に置いた**。通常のブラウザー試験の API は本人確認を設定しないため step-up が 401 になる。enterprise-identity と同じく本人確認を設定した fixture（`identity-e2e-server.ts`）で動かし、fixture にこの試験専用のテナント管理者 2 名を足した（enterprise-identity が初期管理者のパスワードと MFA を変えるので、それに依存しないため）。通常の試験群では未設定時の案内・非管理者・英語・390px・axe を確かめる。
- 発行の Dialog は `IdentityStepUp`（`ControlDialog`）を入れ子にせず、kit の `Dialog` の中に現在のパスワード欄（MFA 登録済みなら認証コード欄）を置き、`api/identity.ts` の `stepUp` を呼んでから発行する。サーバーの検証エラーを欄ごとに示し最初の誤りへ焦点を移すため。step-up の token は 4 分以内なら再試行に使い回す（発行の失敗で transaction が巻き戻るので未使用のまま残る）。
- Dialog 内の文は `<div>` にした。既存の `.action-dialog p`（`styles.css`）が段落を 12px・`#6d7890` にし、kit の notice・欄のエラーの色より優先されて WCAG のコントラストを満たさない（identity 試験の axe で検出）。共有の CSS は直していない（他の Dialog にも同じ規則が効く。下の「次のセッションへ」）。
- `restaurant_chain` の確認・提出は `ctx.actor.id` を記録するだけで自己承認の判定を持たないので変えていない（鍵で行えば資格情報の id が残る。代理 AI でエージェント名が残るのと同じ）。spec の対象 module（workforce・tax-filing・workforce-evidence）だけを `requireHumanUserId` に委ねた。

## やったこと

- kernel: `machine_credentials`（`kernel/src/db/machine-tables.ts`、tenant RLS、複合 FK、purpose の check）、`kernel/src/machine-credentials.ts`（発行・一覧・失効・履歴・照合・再検証・発行者連動の失効・件数）、`Actor.type = 'machine'`、`requireHumanUserId`、`lockIdentity` / `assertAccessAdmin` / 本人のアカウント操作の machine 拒否、`assertIdentityBudget`、`grantsFor`。migration `0018_machine_credentials.sql`（`pnpm db:generate`）。
- modules: workforce `userId`、tax-filing `actorId`、workforce-evidence `actor` を `requireHumanUserId` に委ねた。
- apps/api: 認証 plugin の `Bearer dfk_` 経路（`HUMAN_ONLY`、`Origin` 拒否、`x-company-id` の一致、`machine-auth:<ip>`）、`/admin/tokens` の 4 経路、要求ログの `machine` actor。
- apps/mcp: `DAIFUKU_API_KEY`（`DAIFUKU_EMAIL` / `PASSWORD` / `MFA_CODE` / `TENANT_ID` との同時設定は exit 2）、`openMachineSession`、`refreshAgentContext(owner, app, params)` の machine 分岐（5 か所の呼出しを更新）、鍵のときは app 接続を認証前に開く、起動ログに資格情報の id・名前。
- apps/web: `/admin/tokens`（`pages/tokens-page.tsx`、UI キット）、`api/tokens.ts`、`lib/machine-credentials.ts`、`key` アイコン（Feather）、router・navigation-data（`tenant-admin`）・help.ts・CONVERTED、利用者画面の確認文（AC-33）。
- docs: manual 08（「API キーの発行と失効」、権限の節と監査の節）、manual 09（MCP と REST の推奨の接続方法）、ADR-0023 追補、ADR-0007、`docs/architecture/permissions.md`、`docs/operations/enterprise-identity.md`。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] kernel 単体 `kernel/test/machine-credentials.test.ts` 21 件、kernel DB `kernel/test/machine-credentials.db.test.ts` 20 件（AC-1〜AC-6、AC-3a、AC-7〜AC-10、AC-13〜AC-15、AC-17〜AC-21、AC-23、AC-26、AC-33）。同時 10 件の拒否で監査 1 件、同時 2 件の失効で監査 1 件、app role の DELETE 権限なし、既知の鍵 150 回の拒否後も同じ送信元の有効な鍵が通り有効な 120 件の同時要求で予算の行が 0 件、を実測。
- [実測] API DB `apps/api/test/machine-credentials.db.test.ts` 13 件（REST の 4 経路、AC-19 の 404、販売ロールの人と鍵で同じ一覧、`created_by = null` と監査の `machine`、同一の 401 本文、別会社・別テナントの 404、`x-company-id` 違いの 403 と監査、`x-agent-id` の無視、query の鍵と `Origin` の 401、`HUMAN_ONLY` の 403（admin・edge_manager の鍵）、IP 予算の 429 と同時 150 件の成功、要求ログの actor と鍵の非出力、休暇の付与・経費の承認・精算・証憑の添付・給与制度の承認・`workforce.todo`・`tax_filing.todo` の 403 `human-actor-required`、`group_accounting.companies` の 403、無効化での失効件数と `activeApiKeys`）。
- [実測] MCP: `apps/mcp/test/machine-credentials.db.test.ts` 3 件（AC-24〜AC-26）、`apps/mcp/test/config.test.ts` 9 件（AC-24、AC-25）。既存の `identity-mfa.db.test.ts` は `refreshAgentContext` の引数の追加に合わせて呼出しだけ直した（判定は変えていない）。
- [実測] 回帰: kernel の DB 全件と、API の access-admin・account-security・edge-relay・api・enterprise-identity・identity-rate-limit・company-admin・workforce-evidence、MCP の DB 全件を一括実行（42 files / 324 tests、695 秒、自分の DB `daifuku_test_f2mc`）。
- [実測] web 単体: `lib/machine-credentials.test.ts`、`navigation.test.ts`（AC-31）、`help.test.ts`（manual 08 の節の存在）、`token-usage.test.ts`（CONVERTED）。
- [実測] ブラウザー（通常の試験群、slot 29、industry project 込み）: `machine-credentials.spec.ts` 3 件、`navigation.spec.ts` 5 件、`access-management.spec.ts` 1 件、industry 3 件の計 12 件が通過（2.9 分）。`--no-deps` では navigation と access-management の各 1 件が業種会社の不在で失敗した（環境の既知の制約。industry project 込みで通過を確認）。
- [実測] ブラウザー（identity 試験群、`pnpm test:identity:e2e`、専用 DB `daifuku_e2e_test_enterprise_f2mc`、終了後に削除）: enterprise-identity 3 件と `machine-credentials-identity.spec.ts` 2 件の計 5 件が通過（2.3 分）。発行の未入力表示、`admin` の注意、step-up、秘密の一度だけの表示と見出しへの焦点、コピー（headless ではクリップボードが使えず手動コピーの案内の経路）、390px のはみ出しなし、秘密表示中の axe、閉じた後と再読込後に画面・storage・URL・一覧の応答に秘密が無いこと、鍵で `GET /api/partner` が 200、最終使用の表示、Esc で取りやめて「失効」へ焦点、失効後の行・告知・「履歴」への焦点、同じ鍵の 401、履歴の発行・失効・拒否、発行者のテナント管理者解除の確認文に件数が出て鍵が失効すること。
- [実測] 手動の確認（spec の検証手順 4）: 専用 DB `daifuku_f2_manual`（`db:reset`、終了後に削除）で `IDENTITY_ENCRYPTION_KEY` を設定した API を port 3199 で起動し、curl でログイン → step-up → `POST /admin/tokens` → 鍵で `GET /api/partner` 200 → 別会社の `x-company-id` 403 → 鍵で `/auth/me` 403 → 失効 200 → 同じ鍵が 401（同一の本文）→ 履歴が `use_denied:revoked, revoke:manual check, use_denied:company_mismatch, issue`。API のログに鍵の一部（12 文字）が出ていないことを grep で確認。用途 MCP の鍵で `DAIFUKU_API_KEY=… pnpm -s -C <worktree> --filter @daifuku/mcp start` を SDK の stdio クライアントで起動し、`partner_list` が一覧を返し、起動ログに資格情報の id・名前・会社・ロールが出て鍵は出ないことを確認。
- [実測] `GATE_DB_SHARDS=1 pnpm gate:light`: 結果は下の追記を参照。
- [レビュー] 秘密を保持するのは発行の Dialog の mutation の結果だけ（`gcTime: 0`、閉じるときに `reset()`、一覧の cache へ書かない）。URL・storage・toast・console に書く経路が無いことをコードで確認し、上の identity 試験で画面・storage・URL・応答を実測。
- [未検証] `pnpm gate:full`（統合担当が実行）。CI。
- [未確認] RFC 6750（Bearer Token Usage）と OWASP の Secrets Management / REST Security Cheat Sheet の一次資料。2026-10-30 にこのセッションから `www.rfc-editor.org` と `cheatsheetseries.owasp.org` への接続が proxy に拒否され（`connect_rejected`）、`docs/domain/` に内容と確認日を書けなかった。設計の根拠は既存の [機器連携の設計根拠](../domain/edge-relay-security.md)（RFC 9700）に依る。

## 見つけた問題と修正（発見経路つき）

- kernel DB 試験で kernel 単体の登録に無いロール（`sales`、`edge_manager`）を使っていた — 発見: 実測（400）、修正: kernel 試験は `settings` / `admin` にした。
- 発行の Dialog の確認文・コピーの結果の文字が `.action-dialog p` の灰色（コントラスト 4.43）になった — 発見: identity 試験の axe、修正: Dialog 内の文を `<div>` に。
- 非管理者の試験が画面の遷移そのもの（Web の URL）を API 呼出しと数えていた、`aria-disabled` のボタンを Playwright が押せなかった — 発見: ブラウザー試験、修正: 試験側で API の URL に限定・`force` クリック。
- identity 試験群の 1 回目は別の workflow の identity 試験と port 3109 で衝突し、相手の fixture に接続して失敗した — 発見: 実測（fixture の起動失敗の表示）、対処: 相手の終了を待ち、port が空いていることを確かめてから再実行。相手の試験へ数回のログイン要求が届いた可能性がある。

## 未実施（減らさない。完了したら「済」を付けて残す）

- 一次資料（RFC 6750、OWASP）の確認日つきの追記（接続できる環境で `docs/domain/identity-and-mail-sources.md` へ）。
- 汎用の監査パネル（`audit-panel.tsx`）で `machine:<id>` を鍵の名前で表示すること（F3 の範囲）。
- B4 のセットアップウィザード・C6 の役割別ホームからの導線（未統合のため。統合後に `navigation-data.ts` の `/admin/tokens` を参照する）。

## 判断待ち（利用者）

- spec の未決事項 1（利用者の作成・テナント管理者の付与にも step-up を求めるか、最小構成で MFA の無い利用者に限り鍵を発行できるようにするか）、2〜5 は spec のとおり既定のまま。

## 次のセッションへ

- 統合時: migration の番号（`0018_machine_credentials`）は round 5・6 の migration と衝突しうるので、統合順に振り直し `pnpm db:generate` の snapshot を作り直す。`router.tsx`・`navigation-data.ts`・`help.ts`・`help.test.ts`・`token-usage.test.ts` の CONVERTED・`playwright.config.ts` / `playwright.identity.config.ts` の `testIgnore` / `testMatch` の追加を統合する。
- `.action-dialog p`（`styles.css`）の灰色は kit の `Dialog` を使う他の画面の段落にも効き、12px で WCAG のコントラストを満たさない。共有の CSS の修正は別項目で扱う。
