# 作業記録: 2026-10-30 会社の追加・編集と会社プロフィール（B2）

- セッション: 完成度向上計画 B2（workflow の作業項目、worktree `wip/company-admin`、基点 `ff65a6c`。同じブランチで続けて B3）／ 担当: agent ／ 対象: [docs/specs/company-admin.md](../specs/company-admin.md)
- 計測: tokens=null（未計測）, agent_minutes=約75（＋レビュー修正 約30。B3 と分けた概算）, human_minutes=0, rework_lines=約15（＋レビュー修正で約60。下の「レビュー指摘への対応」）（試験の期待値 3 か所: module 名 `l10n_jp`、`YEN` が有効な通貨コードだった、設定の「未設定」表示。型 1 か所）, gate_failures=1（gate:light の unit で `scripts/test/gate.test.ts` の AC-9 が 1 回失敗。今回の変更と無関係の競合で、単独再実行と gate:light の再実行で成功）

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

## レビュー指摘への対応（2026-10-30、修正担当 agent。B3 の指摘も同じコミットで対応し、B3 の分は [B3 の作業記録](2026-10-30-setup-health.md) に書いた）

B2 に関わる指摘 9 件をコードで確かめ、8 件を直し、1 件は一部を直した（下）。

- **通貨を JPY だけにした（major）。** 確認: `createCompanySchema` は英大文字 3 文字なら何でも通し、`assertJpySettlement`（`modules/accounting/src/money-contract.ts`）は売上・仕入・入出金の確定で JPY 以外の会社を拒否する。通貨は作成後に変えられず会社も削除できないので、`YEN` などの誤入力で伝票を確定できない会社が残る。spec の「業務は JPY のまま」とも食い違っていた。修正: kernel に `SUPPORTED_COMPANY_CURRENCIES = ['JPY']` を置き、`currency` を `z.enum` にした。画面の通貨欄は読取専用（`JPY`）、説明文は「現在は JPY の会社だけを作成できます（売上・仕入・入出金の伝票の確定が JPY だけに対応しているため）」。AC-3・スコープ外・マニュアル 08・ADR-0029 を合わせて直した。初版の作業記録の「`YEN` は形式上有効な通貨コード」は、この変更で再び無効になった（試験の期待値を `USD`・`YEN` の拒否に変え、`US_1` の作成は `currency: 'JPY'` にした）。
- **seed の失敗で生の例外の文を返さない（major。重複する minor 1 件も同じ）。** 確認: `seedCompany` が `error.message` を `StateError` の本文に入れており、drizzle の `DrizzleQueryError` の文（`Failed query: … params: …`）がそのまま API の 409 と画面に出る。初版の AC-10 の試験はこの文の存在を確かめていた。修正: 本文は module 名だけの固定の文、`details` は `module` と、kernel のエラーなら `cause`（その本文）、それ以外は `safeErrorDiagnostics`（`category`・`sqlState`）だけ。ログも同じ診断と request id だけ。AC-10 の文言を「失敗した module を返す（SQL・束縛値・生の例外の文は返さない）」に直した。
- **作成後に会社ピッカーが取り直すことの試験（minor）。** 確認: ブラウザ試験はサーバーの `/auth/companies` を直接呼んでいて、画面の無効化（`['companies']`）を消しても通る作りだった。修正: 新しいブラウザ試験で、先に `/templates` を開いてピッカーの取得結果を持たせ、画面内の移動（再読込なし）で会社を作成・改名してから `/templates` に戻り、`select#template-company` に新しい名前の選択肢があることを確かめる。
- **作成の流れでフォーカスを失わない（minor と major の 2 件）。** 確認: 「会社を追加」・取消・作成・「このまま一覧に戻る」のたびに、押した要素が消えて焦点が `<body>` に落ちていた。送信ボタンは `disabled` で焦点を失い、作成の知らせは文字を持ったまま現れる `role="status"`（UI 規約は `role="status"` を使わないとしている）。修正: フォームを開いたら会社コードの欄、取消と「一覧に戻る」で「会社を追加」、作成後は結果の枠の見出し（`tabIndex=-1`）へ焦点を移す。見出しへの移動で作成を知らせるので `role="status"` の段落は外した。送信中のボタンは `aria-disabled`（編集のダイアログの保存も同じ）。
- **サーバーの検証エラーの日英化と焦点（minor）。** 確認: 重複コードの issue（`already used`）が英語のまま欄に出て、焦点も移らず、それ以外の失敗はサーバーの英文と hint だけだった。修正: 既知の issue（`already used`、`immutable after creation`）を日英の文にし（`issuesByField(issues, t)`）、最初の誤りの欄へ焦点を移す（応答が届いた時点では入力欄が送信中で無効なので、次の描画で移す `useFieldFocus`）。それ以外の失敗は「会社を作成できませんでした。何も保存されていません。」→ 説明 → サーバーの文 → 閉じた技術情報（`ErrorDetails`）の順。編集のダイアログも同じ焦点の扱いで、欄に当たらない issue はトースト。
- **一覧の初回読込を骨格行にした（minor）。** `DataTableShell` の `skeleton` と `loadingLabel` を使い、文字だけの「読み込み中…」を外した。
- **AC の番号の付け違い（nit）。** 非テナント管理者の試験と画面のコメントを AC-2/AC-11 にし、spec の検証手順 2・4 の AC の範囲を直した（AC-10 は kernel の DB 試験だけで確かめる）。
- **切替ボタンの英文（nit）。** `SETUP_DESTINATIONS` に言語ごとの完全な文 `switchLabel`（「切り替えて会社プロフィールを入力」／ "Switch and fill in the company profile"）を持たせ、2 つの文字列の連結をやめた。
- **作業記録の計測行（minor、metrics）。** `docs/metrics/features.jsonl` の 2 行に `tokens: null` と `gateFailures`（B2 は 1、B3 は 0）を足した。

修正の検証（すべて `daifuku_test_w1`・スロット 1）:

- [実測] kernel の DB 試験 `kernel/test/company-admin.db.test.ts`: `USD`・`YEN` の拒否（AC-3）、plain Error の seed の文が応答に出ないこと、SQL エラー（`select $1::text, 1 / 0`）の seed で応答の本文とログに `Failed query`・束縛値・SQL の断片が無く、`details` が `{ module, category: 'database', sqlState: '22012' }` で、会社が残らないこと（AC-10）。API の DB 試験 2 本と合わせ 3 ファイル 60 件成功（23.1 秒）。
- [実測] 単体 `apps/web/src/lib/companies.test.ts`（issue の日英化、最初の誤りの欄、JPY 以外の拒否、切替ボタンの文）ほか 4 ファイル 39 件成功。
- [実測] ブラウザ: `company-admin.spec.ts` 4 件と `setup-health.spec.ts` 4 件、計 8 件成功（1.1 分）。新しい試験はキーボードで開く → 取消 → 開く → 重複コード（欄に日本語の説明と焦点）→ 作成（見出しに焦点）→ 一覧に戻る（「会社を追加」に焦点）、通貨欄が読取専用の `JPY`、ピッカーの作成後・改名後の取り直し。作成の試験は見出しの焦点と切替ボタンの文も確かめる。
- [実測] 試験が無効化を捉えることの確認: `apps/web/src/api/companies.ts` からピッカーの無効化の 1 行を一時的に消して新しい試験だけを実行し、`/templates` の選択肢の確認（`toHaveCount(1)` に対し 0）で失敗することを見てから元に戻した。
- [実測] `pnpm gate:light`: 成功（1,293 秒＝21.6 分。kernel の変更で DB を全件に昇格: 134 ファイル 882 件 1,052.5 秒、unit 159 ファイル 1,597 件 80.7 秒、format:check・docs・assurance・typecheck（root / api / web）・lint（警告 5 件は既存ファイルの関数行数で、今回の変更のファイルではない）・test:deploy 25.5 秒も成功。負荷 3〜7 の共有コンテナ）
- [レビュー] `apps/web/src/router.tsx` の AppLayout は `/meta` の失敗で `MetaError` を出すので、導入チェック画面が読込中のまま止まる指摘（B3）は実際には起きない。設定画面と同じ防御として画面にも分岐を足した（B3 の記録）。
- [未検証] `pnpm gate:full`（統合担当）。スクリーンリーダーの実機での読み上げ（焦点の移動はブラウザ試験で確かめたが、読み上げそのものは確かめていない）。

## 未実施（減らさない。完了したら「済」を付けて残す）

- B4 のセットアップウィザードへの導線（現在は会社タブと会計年度の一覧。`apps/web/src/lib/companies.ts` の `SETUP_DESTINATIONS`）。
- 申告・給与資料の読取元を `company.profile` へ切り替えること（spec のスコープ外。各資料の仕様で扱う）。
- 会社の削除・無効化（スコープ外）。

## 判断待ち（利用者）

- spec の未決事項: 作成時の業界テンプレート選択、新会社への見本データ（取引先・品目）の投入、作成後の自動切替。

## 次のセッションへ

- B3（導入チェック）は `company.profile` と発行者の解決（`resolveIssuer`）を点検項目に使う。
- STATUS・PLAN・completion-plan の更新は統合担当（integrationNotes に記載）。
