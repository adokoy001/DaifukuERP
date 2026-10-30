# 作業記録: 2026-10-30 機械用資格情報（API キー、F2）

- セッション: workflow wf_2b353e03-822（round 7）の F2 実装者、base `ffc2f42`、branch `wip/machine-credentials` ／ 担当: agent ／ 対象: [docs/specs/machine-credentials.md](../specs/machine-credentials.md)
- 計測: tokens=null（このセッションからは取得できない）, agent_minutes=約 160, human_minutes=0, rework_lines=約 70（下の「見つけた問題と修正」）, gate_failures=2（gate:light の 1 回目は自分の同時実行による unit の失敗、2 回目は既存の migration 試験の前提の誤り。3 回目で通過）

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
- Dialog 内の文は `<div>` にした。既存の `.action-dialog p`（`styles.css`、layer の外）が段落を 12px・灰色にし、kit の notice・欄のエラーの色より優先されるため。同じ規則の色 `#6d7890` は 12px で 4.43:1 と WCAG AA を満たさず（identity 試験の axe で検出）、共有の 1 行なので `--text-muted`（4.5:1）に直した。
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
- [実測] ブラウザー（通常の試験群、slot 29、industry project 込み）: `machine-credentials.spec.ts` 3 件、`navigation.spec.ts` 5 件、`access-management.spec.ts` 1 件、industry 3 件の計 12 件が通過（2.9 分）。共有の `.action-dialog p` の色を変えた後に、`a11y.spec.ts`・`company-admin.spec.ts`（Dialog の axe を含む）を加えて再実行し 50 件が通過（4.5 分、15:15）。`--no-deps` では navigation と access-management の各 1 件が業種会社の不在で失敗した（環境の既知の制約。industry project 込みで通過を確認）。
- [実測] ブラウザー（identity 試験群、`pnpm test:identity:e2e`、専用 DB `daifuku_e2e_test_enterprise_f2mc`、毎回削除）: 最終の実行（15:10、発行フォームの axe と `.action-dialog p` の色の変更の後）で enterprise-identity 3 件と `machine-credentials-identity.spec.ts` 2 件の計 5 件が通過（1.3 分）。その前の 1 回は gate:light と同時に走らせたため enterprise-identity の最初のログインが負荷で 10 秒を超えて失敗した（自分の試験は通過。変更していない経路）。発行の未入力表示、`admin` の注意、step-up、秘密の一度だけの表示と見出しへの焦点、コピー（headless ではクリップボードが使えず手動コピーの案内の経路）、390px のはみ出しなし、秘密表示中の axe、閉じた後と再読込後に画面・storage・URL・一覧の応答に秘密が無いこと、鍵で `GET /api/partner` が 200、最終使用の表示、Esc で取りやめて「失効」へ焦点、失効後の行・告知・「履歴」への焦点、同じ鍵の 401、履歴の発行・失効・拒否、発行者のテナント管理者解除の確認文に件数が出て鍵が失効すること。
- [実測] 手動の確認（spec の検証手順 4）: 専用 DB `daifuku_f2_manual`（`db:reset`、終了後に削除）で `IDENTITY_ENCRYPTION_KEY` を設定した API を port 3199 で起動し、curl でログイン → step-up → `POST /admin/tokens` → 鍵で `GET /api/partner` 200 → 別会社の `x-company-id` 403 → 鍵で `/auth/me` 403 → 失効 200 → 同じ鍵が 401（同一の本文）→ 履歴が `use_denied:revoked, revoke:manual check, use_denied:company_mismatch, issue`。API のログに鍵の一部（12 文字）が出ていないことを grep で確認。用途 MCP の鍵で `DAIFUKU_API_KEY=… pnpm -s -C <worktree> --filter @daifuku/mcp start` を SDK の stdio クライアントで起動し、`partner_list` が一覧を返し、起動ログに資格情報の id・名前・会社・ロールが出て鍵は出ないことを確認。
- [実測] `GATE_DB_SHARDS=1 pnpm gate:light`（自分の DB `daifuku_test_f2mc`）: 1 回目（14:00）は unit の 2 件が失敗した。`identity-runner.test.ts` は自分が同時に走らせた identity 試験群が port 5189 を使っていたため（EADDRINUSE）、`password-hash.test.ts` は負荷（load average 約 21）で 5 秒の上限を超えたため。どちらも自分の同時実行が原因で、DB lane は fail-fast で取消された。2 回目（14:11、ほかの試験を止めて実行）は static lane（format・docs・assurance・typecheck 3 種・lint・unit 1,733 件・deploy）が通過、DB lane は 137 files 中 3 件が失敗した: `boolean-migration.db.test.ts` と `ext-index-migration.db.test.ts` は試験の前提の誤り（下の「見つけた問題と修正」）、`apps/edge/test/actual-api.db.test.ts` は API fixture の起動待ち 30 秒の超過（負荷時）で、負荷が下がった後に 3 件を単独で再実行して通過（15 tests、77 秒）。3 回目（14:48、試験の修正後）は **通過**: static lane 全段（unit 164 files / 1,733 tests）、DB lane 137 files / 919 tests、計 1,243.5 秒（`result=passed`）。終了後に `pnpm test:db:templates -- --drop` で自分の DB の template 65 個（742.8 MB）を削除し、DB `daifuku_test_f2mc` も削除した。
- [レビュー] 秘密を保持するのは発行の Dialog の mutation の結果だけ（`gcTime: 0`、閉じるときに `reset()`、一覧の cache へ書かない）。URL・storage・toast・console に書く経路が無いことをコードで確認し、上の identity 試験で画面・storage・URL・応答を実測。
- [未検証] `pnpm gate:full`（統合担当が実行）。CI。
- [未確認] RFC 6750（Bearer Token Usage）と OWASP の Secrets Management / REST Security Cheat Sheet の一次資料。2026-10-30 にこのセッションから `www.rfc-editor.org` と `cheatsheetseries.owasp.org` への接続が proxy に拒否され（`connect_rejected`）、`docs/domain/` に内容と確認日を書けなかった。設計の根拠は既存の [機器連携の設計根拠](../domain/edge-relay-security.md)（RFC 9700）に依る。

## 見つけた問題と修正（発見経路つき）

- 共有の `.action-dialog p`（`styles.css`）の文字色 `#6d7890` が 12px で 4.43:1 しかなく、kit の `Dialog` の説明文と、発行の Dialog の確認文・コピーの結果の文字が WCAG AA を満たさなかった — 発見: identity 試験の axe（発行フォーム）、修正: `--text-muted`（4.5:1）に変更し、Dialog 内の自分の文は `<div>` にした（notice・欄のエラーの色がこの規則に上書きされないように）。
- kernel DB 試験で kernel 単体の登録に無いロール（`sales`、`edge_manager`）を使っていた — 発見: 実測（400）、修正: kernel 試験は `settings` / `admin` にした。
- 非管理者の試験が画面の遷移そのもの（Web の URL）を API 呼出しと数えていた、`aria-disabled` のボタンを Playwright が押せなかった — 発見: ブラウザー試験、修正: 試験側で API の URL に限定・`force` クリック。
- `apps/api/test/boolean-migration.db.test.ts` と `ext-index-migration.db.test.ts` が、旧版からの更新の前後で public の全制約を比較していたため、後の migration が表を足す（`0018_machine_credentials`）だけで失敗した — 発見: gate:light の DB lane、修正: 更新前に存在した relation の制約だけを比較するよう試験を直した（試験の誤りの修正で、既存の relation の制約は引き続き完全一致を要求する）。E2（recurring-journals）が自分の branch で同じ修正（commit `8083d57`）をしていたので、統合で衝突しないよう同一の hunk を当てた（`8374d96`）。
- identity 試験群の 1 回目は別の workflow の identity 試験と port 3109 で衝突し、相手の fixture に接続して失敗した — 発見: 実測（fixture の起動失敗の表示）、対処: 相手の終了を待ち、port が空いていることを確かめてから再実行。相手の試験へ数回のログイン要求が届いた可能性がある。

## 実装レビューの指摘への対応（2026-10-30、fixer）

- セッション: workflow wf_2b353e03-822 の F2 fixer（同じ branch・worktree、自分の DB `daifuku_test_w41`、ブラウザー slot 19）。計測: tokens=null, agent_minutes=約 75, human_minutes=0, rework_lines=約 600（試験の追加を含む）, gate_failures=1（gate:quick の unit 2 件が load average 約 20 での時間切れ。単独で再実行して通過）。
- 指摘 25 件（重複 3 組を含む）を照合した。spec の「実装レビューの指摘への対応」の表のとおり、`Sec-Fetch-Mode` の部分だけを退け、ほかはすべて受け入れた。
  - 人だけの経路の判定を `req.routeOptions.url`（一致しない URL は復号した path）に替えた。修正前に `/%61dmin/tokens` などが照合され、`last_used_at` が書かれることはレビューの実測で示されていた。修正後の API 試験で、8 通りの符号化した綴りが 403 `human-session-required` になり、`last_used_at` が `null` のままであることを確かめた。
  - ブラウザーの判定に `Sec-Fetch-Site` を加えた。`Sec-Fetch-Mode` は退けた。Node 22 の `fetch` がサーバー間でも `sec-fetch-mode: cors` を送ることを、このコンテナで実測したため（2026-10-30。受信した header は `{"authorization":…,"accept":"*/*","accept-language":"*","sec-fetch-mode":"cors","user-agent":"node",…}`）。これで拒否すると、Node で書いた連携がすべて止まる。
  - `machine_credentials` の app role の `UPDATE` を、失効と利用の記録の 6 列に限った（列の権限）。あわせて、一度設定した失効を owner でも戻せない trigger を `enforcePolicies` に足した（`audit_log` の trigger と同じ場所なので、migration と schema-sync の両方に効く）。drizzle の migration は増やしていない。既存の AC-19 試験は表全体の `UPDATE` 権限が `true` であることを確かめていた。これを「表全体の `UPDATE` は `false`、`revoked_at`・`last_used_at` の列は `true`、`roles` は `false`」に改めた。権限を狭めたことに合わせて試験の期待を変えたもので、確認する内容は増えている。
  - `x-company-id` は大文字・小文字を区別せずに比べる。API では uuid の形でない値を照合の前に 400 にした（人の要求と同じ）。kernel を直接呼んだときに形の違う値が 403・監査になることは変えず、既存の kernel 試験のとおり。
  - 履歴の表は、各欄を折り返して Dialog の幅に収めた（`whitespace-normal [overflow-wrap:anywhere]`）。kit の `DataTableShell` に焦点を受ける枠の prop を足す案は採らなかった。共有の kit を変えずに、横のスクロールそのものを無くせるため。
  - 発行の Dialog: 結果不明なら step-up の token を捨てる。認証コードの誤りは認証コード欄に示し、焦点も移す。発行の処理中に閉じたら一覧に警告を出す。step-up の処理中に閉じたら発行を送らない（レビューの指摘には無く、同じ経路を読んでいて見つけた。見えない鍵ができる）。`/auth/security` の読込失敗を表示する。想定される失敗は日英の文にした。閉じたら見出しの「API キーを発行」へ焦点を移す。
  - restaurant-chain の確認・提出は動作を変えず、spec のスコープ外に理由とともに明記した（提出者と確認者を比べる判定が無く、鍵が職務分離をすり抜ける余地が無い）。`requireHumanUserId` に替えると、代理 AI の記録がエージェントの id から利用者の id に変わってしまうため。
  - manual 08 は、監査パネルに出る `machine:<先頭 8 文字>…` と一覧の ID（新たに名前の下に表示）を照らし合わせる方法に書き換えた。manual 09 は対象の変数を名指しにし、API キーの検証の記録（前段の手動確認と DB 試験、未検証の `POST /actions` の例）を加えた。

### fixer の検証

- [実測] kernel・API の DB 試験 `kernel/test/machine-credentials.db.test.ts`・`apps/api/test/machine-credentials.db.test.ts`: 36 件が通過（18:03、自分の DB）。追加・変更した試験は次のとおり。AC-3 の未知の項目ごとの path。AC-10 の大文字の uuid（kernel）と 400（API）。AC-11 の `Sec-Fetch-Site` の 401、`Sec-Fetch-Mode` だけなら 200。AC-12 の符号化した綴りと `last_used_at`。AC-14 の 2 つの理由。AC-19 の列の権限、app role による 5 種の更新の `permission denied`、失効の取消しが app role・owner とも trigger で拒否されること。
- [実測] 変異の確認: `recordDenial` の条件から `ne(lastDeniedReason, reason)` を外すと、新しい AC-14 試験が失敗する（18:04。確認後に元へ戻し、`git diff` で戻ったことを確認）。
- [実測] web 単体 `apps/web/src/lib/machine-credentials.test.ts` 12 件（日英の失敗文・欄の文・補助の行・中断の文）。
- [実測] ブラウザー（通常の試験群、slot 19、`--no-deps`）: `machine-credentials.spec.ts` 4 件が通過（18:31、57 秒）。新しい試験は `page.route` で `/auth/security`・`/auth/step-up`・`POST /admin/tokens` を差し替え、次を確かめる。読込失敗の表示と再試行・`aria-describedby`。認証コードの誤りで認証コード欄に焦点と `aria-invalid`。処理中の Esc で一覧に警告が出て「API キーを発行」に焦点が戻ること。通信の失敗の後の再送でパスワードを聞き直し、発行の要求が増えないこと。409 の日英の文と補助の行。3 回の発行要求がすべて別の step-up の token だったこと。1 回目の実行は失敗した。`useEffect` の cleanup で立てた「閉じた」印が StrictMode の模擬の unmount で立ったままになり、step-up の後に何も起きなかった。mount のたびに印を戻すよう直して通過した（自分の変更の誤りを試験が捕えた）。
- [実測] ブラウザー（identity 試験群、`pnpm test:identity:e2e`、専用 DB `daifuku_e2e_test_enterprise_w41`、毎回削除）: 3 回目（18:39、load average 約 12〜16）で 5 件すべてが通過（2.0 分）。`machine-credentials-identity.spec.ts` の 2 件は 3 回とも通過した。この 2 件では次を確かめている。空状態のボタンから最初の鍵を発行し、閉じた後に見出しの「API キーを発行」へ焦点が戻ること。見出しのボタンから開いて Esc で戻ること。鍵がある一覧と失効の Dialog の 390px。長い理由（途切れない 60 文字の英数字を含む）を持つ履歴の Dialog を日英 × 390 / 1280px で開き、はみ出しなし・axe の serious / critical なし。1・2 回目（load average 約 18）は `enterprise-identity.spec.ts` の最初の試験が失敗した。1 回目は最初のログインが 10 秒以内に終わらず、2 回目は回復コードの一覧を描画前に読んだ（`allTextContents` は待たない）。F2 の変更が触れない経路で、負荷が下がった 3 回目に通過した。
- [実測] `GATE_DB_SHARDS=1 pnpm gate:light`（自分の DB `daifuku_test_w41`、18:40 開始、1,972.7 秒）: **通過**。static lane の全段（format・docs・assurance・typecheck 3 種・lint・unit 164 files / 1,736 tests・deploy）と、DB lane（kernel を変えたので全件へ昇格）の 137 files / 922 tests。開始後に変えたのは spec の検証の表とこの記録だけで、コードは変えていない。その前の `pnpm gate:quick`（18:22）では、unit の `password-hash.test.ts` と `apps/runtime/test/runtime.test.ts` が load average 約 20 で時間切れになった。2 つを単独で再実行すると通過した（8 tests、37 秒）。終了後に `pnpm test:db:templates -- --drop` で自分の DB の template を削除した。
- [未検証] `pnpm gate:full`（統合担当が実行）。CI。restaurant-chain の鍵による確認の動作は変えておらず、試験も足していない（spec のスコープ外）。

## 未実施（減らさない。完了したら「済」を付けて残す）

- 一次資料（RFC 6750、OWASP）の確認日つきの追記（接続できる環境で `docs/domain/identity-and-mail-sources.md` へ）。
- 汎用の監査パネル（`audit-panel.tsx`）で `machine:<id>` を鍵の名前で表示すること（F3 の範囲）。
- B4 のセットアップウィザード・C6 の役割別ホームからの導線（未統合のため。統合後に `navigation-data.ts` の `/admin/tokens` を参照する）。

## 判断待ち（利用者）

- spec の未決事項 1（利用者の作成・テナント管理者の付与にも step-up を求めるか、最小構成で MFA の無い利用者に限り鍵を発行できるようにするか）、2〜5 は spec のとおり既定のまま。

## 次のセッションへ

- 統合時: migration の番号（`0018_machine_credentials`）は round 5・6 の migration と衝突しうるので、統合順に振り直し `pnpm db:generate` の snapshot を作り直す。`router.tsx`・`navigation-data.ts`・`help.ts`・`help.test.ts`・`token-usage.test.ts` の CONVERTED・`playwright.config.ts` / `playwright.identity.config.ts` の `testIgnore` / `testMatch` の追加を統合する。
- `.action-dialog p`（`styles.css`）の色はこの項目で `--text-muted` に直したが、規則そのものが layer の外にあり kit の notice・欄のエラーより優先される。kit の Dialog の段落の扱いを整理するなら別項目で（統合時に他の branch が同じ行を変えていないか確認する）。

## 統合時の修正（2026-10-30、統合担当）

- E5（経費精算）は F2 より前に作られ、module 独自の `actorUserId` が鍵には資格情報の id を返していたため、AC-22 の対象から漏れていた。admin（または accounting と workforce_payroll）の鍵で発行者本人の従業員の仮払を作成・確定（支払）でき、任意の精算書を取り消せた。発見経路: 統合レビュー。`modules/expense/src/access.ts` の `actorUserId`・`requireSettlementRoles` と workforce の `requireSettler` を `requireHumanUserId` に委ね、`expense.todo` も `workforce.todo` と同じく鍵を 403 にした。AC-22 の一覧に expense module を日付つきで追記し、`apps/api/test/machine-credentials.db.test.ts` に仮払の作成・確定、精算書の取消、下書きの作成・候補、受信箱の鍵による 403 `human-actor-required` を足した（module の DB 試験と変異の確認を含む詳細は [経費精算の作業記録](2026-10-30-expense-settlement.md) 末尾の「統合時の修正」）。
