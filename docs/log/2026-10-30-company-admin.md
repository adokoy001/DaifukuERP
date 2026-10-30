# 作業記録: 2026-10-30 会社の追加・編集と会社プロフィール（B2）

- セッション: 完成度向上計画 B2（workflow の作業項目、worktree `wip/company-admin`、基点 `ff65a6c`。同じブランチで続けて B3）／ 担当: agent ／ 対象: [docs/specs/company-admin.md](../specs/company-admin.md)
- 計測: tokens=null（未計測）, agent_minutes=約75, human_minutes=0, rework_lines=約15（試験の期待値 3 か所: module 名 `l10n_jp`、`YEN` が有効な通貨コードだった、設定の「未設定」表示。型 1 か所）, gate_failures=1（gate:light の unit で `scripts/test/gate.test.ts` の AC-9 が 1 回失敗。今回の変更と無関係の競合で、単独再実行と gate:light の再実行で成功）

## 決めたこと（と理由）

- **owner 接続は使わない（[ADR-0029](../adr/0029-company-creation.md)）。** 計画は「`companies` の挿入が app role の RLS で許可されるかを確認し、されないなら setup の owner 接続の経路を共有する」だった。確認した結果、`companies` は tenant の RLS policy（`for all`）と FORCE RLS を持ち、`enforcePolicies` が app role に INSERT を付与している。app role は `tenants` を読めない（`has_table_privilege` で確認）が、外部キー検査は参照先表の所有者の権限で行われるので挿入できる。別テナントの行は `with check` で拒否される（DB 試験）。共有したのは seed の呼び方（同じ runtime の module 一覧・順序・`systemParams(tenantId, companyId)`）だけ。
- **全体を 1 トランザクションにした。** setup は module ごとに確定して再開できるようにしているが、画面から作る会社には削除の手段が無いので、途中失敗で「会社だけある」状態を残さない（AC-10）。seed が失敗したら module 名と原因を `StateError` で返す。
- **seed だけを system context で実行する。** 同じトランザクションのまま `makeContext(ctx.db, systemParams(...))` を作る。seed の書込みの監査は actor `system`（setup・`db:reset` で入った会社と同じ記録になる）。会社行・所属・監査は要求の context。
- **権限はテナント管理者だけ。** kernel の `assertAccessAdmin`（`users` を読み直し、店舗・拠点限定の所属も拒否、access-admin の advisory lock で利用者管理と直列）を使った。会社の `admin` はテナントの構成を変えられない（ADR-0018）。
- **`company.profile` は kernel の設定、列は増やさない。** 9 細目すべて省略可。登録番号は `^T\d{13}$`、免税事業者と登録番号の同時指定は拒否（`superRefine`）。`order: 0`、`category: 'company'` で会社タブの先頭。登録は `packs.applied` と同じく apps/runtime の `loadRuntime` から `ensureCompanyProfileSetting()`。ADR-0027 に §6 として追記した。
- **発行者は「`sales.issuer` があればそれをまとめて、無ければプロフィール」。** 細目単位で混ぜると、請求書だけ別名義にしたいときに住所などが意図せず混ざる。`resolveIssuer` を純粋関数にして単体試験した。schema に合わない `sales.issuer` は未設定として扱う（従来の `getSetting` と同じ）。
- **作成後に自動で切り替えない。** 続けて複数社を作る操作を妨げないよう、作成後の枠に「切り替えて会社プロフィールを入力」「切り替えて会計年度を確認」を出す。切替は会社ピッカーと同じ（保存した選択＋ページの再読込）。B4 のウィザードができたら `SETUP_DESTINATIONS` を `/setup` に差し替える（TODO として spec と lib に記載）。
- **会社ピッカーは変更しない。** 作成・改名で `['companies']`（ピッカー）、`['admin-companies']`、`['me']` の取得結果を無効化する。
- **axe は自分の spec の中で実行した。** 共有の `a11y.spec.ts` の画面一覧は単体試験が 8 画面・32 件に固定しており、同じ round の D3 も触る可能性があるため、`company-admin.spec.ts` の中で同じ判定（`a11y-policy.ts` の `judge` と例外ファイル）を `/admin/companies` に適用した。

## やったこと

- kernel: `company-admin.ts`（新規。`createCompany` / `updateCompany` / `listCompanies`、スキーマ）、`company-profile.ts`（新規）、`index.ts`
- runtime: `loadRuntime` が `ensureCompanyProfileSetting()` を呼ぶ
- api: `routes/company-admin.ts`（新規。`GET / POST /admin/companies`、`PATCH /admin/companies/:id`）、`server.ts`
- sales: `resolveIssuer`（新規、export）、`loadIssuer` の差し替え、`sales.issuer` の説明文
- web: `pages/companies-page.tsx`（新規、UI キット）、`api/companies.ts`（新規）、`lib/companies.ts`（新規）、`router.tsx`（`/admin/companies`）、`lib/navigation-data.ts`（`tenant-admin` 条件の項目）、`lib/help.ts`（08 章の新しい節）、`ui/token-usage.test.ts` の `CONVERTED`
- tests: `kernel/test/company-admin.db.test.ts`（30 件）、`apps/api/test/company-admin.db.test.ts`（8 件）、`modules/sales/test/issuer.test.ts`（5 件）、`apps/web/src/lib/companies.test.ts`（10 件）、`apps/web/e2e/company-admin.spec.ts`（3 件）、`apps/runtime/test/setting-labels.test.ts` と `apps/web/src/lib/help.test.ts` に項目を追加
- 文書: ADR-0029（新規）、ADR-0027 §6、マニュアル 08（「会社の追加と編集」）・03（会社タブ、「会社プロフィール」、発行者の解決順）・付録 E（利用者設定の前に会社を作る手順、テナント管理者の表）、spec（implemented、実装時の確認と変更、未決事項）

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] kernel の DB 試験 `kernel/test/company-admin.db.test.ts` 30 件成功（5.3 秒、`daifuku_test_w1`）: 作成（会社・admin 所属・seed が新会社の system context で 1 回・監査 `company` と `company_membership`・seed の書込みが actor `system`）、既定の module 一覧、テナント管理者でない会社 admin・無効なテナント管理者・店舗限定の context の拒否（一覧・作成・更新）、コードの重複・形式・名前・国・通貨・未知の項目、更新の監査（変更前後）と code / currency の不変、一覧（所属の有無、owner で作られた会社は `member: false`）、seed の失敗で会社・監査・前の seed の行が残らないこと、RLS（別テナントの一覧・更新 404・同じコードの作成は別テナントなら可・別テナントの `tenant_id` の挿入が失敗・別テナントからは読めない）、`company.profile` の分類・9 細目のラベル・登録番号と免税・決算月・メールの検証。
- [実測] API の DB 試験 `apps/api/test/company-admin.db.test.ts` 8 件成功（10.0 秒）: 実際の runtime の module 一覧（partner, product, tax, accounting, inventory, workforce, l10n_jp）の seed で、新会社に勘定科目 21 件超・税率・会計年度 1 件・倉庫が入り、seed を走らせていない基点の会社には勘定科目が無いこと、所属、監査、一覧と会社ピッカー（`/auth/companies`）と `/auth/me`、400（重複・形式・コード無し）、PATCH と不変項目と 404、会社 admin（非テナント管理者）の 403 と未ログインの 401、`GET /meta/settings` で `company.profile` が会社分類の先頭、登録番号の 400、下書き請求書の HTML がプロフィール（正式名称・登録番号・郵便番号・住所・電話・メール）を印字し、`sales.issuer` を保存するとそちらが優先されること。
- [実測] 単体: `modules/sales/test/issuer.test.ts` 5 件、`apps/web/src/lib/companies.test.ts` 10 件、`apps/runtime/test/setting-labels.test.ts`（`company.profile` を含む全設定のラベル）、`apps/web/src/lib/help.test.ts`、`apps/web/src/ui/token-usage.test.ts`、`apps/web/src/lib/navigation.test.ts` 成功。
- [実測] ブラウザ（`e2e-run.sh … 1`、新しい fixture DB、`--project=chromium --no-deps`）: `company-admin.spec.ts` 3 件と `settings-console.spec.ts` 5 件、計 8 件成功（1.1 分）。2 社目を画面から作成（形式違いのコードの案内と焦点、小文字のコードが大文字で送られる、作成枠、一覧の「管理者として所属」）、`/auth/companies` に新会社、「切り替えて会社プロフィールを入力」で新会社の `/settings?tab=company`（上部の会社名、先頭タブ「会社」、先頭の枠が `company.profile`、「未設定」）、正式名称・登録番号・住所・課税区分・決算月を保存、新会社で確定した売上請求書の「請求書を表示」の別タブに正式名称・登録番号・住所が出ること。改名のダイアログ、390px で横はみ出しなし、axe（日本語 390px と英語 1280px、作成フォームを開いた状態）で serious / critical なし。会社 admin（非テナント管理者）には画面検索に項目が出ず、直接開くと「テナント管理者だけ」、API の作成は 403。既存の設定画面の試験は会社タブが先頭に加わっても成功（B1 の試験は先頭タブをページから読む作り）。
- [実測] `pnpm gate:quick` 成功（220.6 秒。基点は origin/main の merge-base のため lockfile 等で全 unit に拡大、unit 156 ファイル 1,565 件）。
- [実測] `pnpm gate:light`: 1 回目は unit の `scripts/test/gate.test.ts` > AC-9（SIGTERM の試験が書きかけの `pids.json` を読む競合、`SyntaxError: Unexpected end of JSON input`）で失敗。今回の変更と無関係で、単独再実行は 86 件成功。2 回目は成功（1,184 秒＝19.7 分。kernel の変更で DB を全件に昇格: 133 ファイル 860 件 912 秒、unit 156 ファイル 1,565 件 108 秒、format:check・docs・台帳・typecheck（root / api / web）・lint（警告 5 件は既存ファイルの関数行数）・test:deploy も成功。負荷 3.6〜6.7 の共有コンテナで、同じ時間帯に他の agent も試験を実行していた）。
- [レビュー] seed は冪等で、新会社では空の状態から実行されるため、setup の初回と同じデータになる（`seedFiscalYear` は会計年度が無いときだけ当年 1〜12 月を作る、など）。
- [未検証] `pnpm gate:full`（統合担当が実行）。MCP からの会社作成（API のみ。MCP のツールは作っていない）。会社が数百社あるテナントでの一覧の表示速度。

## 見つけた問題と修正（発見経路つき）

- 試験の期待値の誤り 3 件（module 名は `jp` ではなく `l10n_jp`、`YEN` は形式上有効な通貨コード、既定値の宣言が無い設定の表示は「既定値を使用中」ではなく「未設定」）— 発見: 実測（DB・単体・ブラウザ試験の初回）、修正: 試験の期待値を直した（製品コードの不具合ではない）。

## 未実施（減らさない。完了したら「済」を付けて残す）

- B4 のセットアップウィザードへの導線（現在は会社タブと会計年度の一覧。`apps/web/src/lib/companies.ts` の `SETUP_DESTINATIONS`）。
- 申告・給与資料の読取元を `company.profile` へ切り替えること（spec のスコープ外。各資料の仕様で扱う）。
- 会社の削除・無効化（スコープ外）。

## 判断待ち（利用者）

- spec の未決事項: 作成時の業界テンプレート選択、新会社への見本データ（取引先・品目）の投入、作成後の自動切替。

## 次のセッションへ

- B3（導入チェック）は `company.profile` と発行者の解決（`resolveIssuer`）を点検項目に使う。
- STATUS・PLAN・completion-plan の更新は統合担当（integrationNotes に記載）。
