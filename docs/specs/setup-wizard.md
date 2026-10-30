# Spec: setup-wizard（初回セットアップウィザード）

- 状態: draft
- モジュール: `kernel`（設定 `setup.progress`、会社の所属人数、設定定義の表示属性 `managedBy`）、`apps/runtime`（設定の登録）、`apps/api`（`GET /meta/setup-status`）、`apps/web`（`/setup`、ホームの「セットアップを続ける」カード、`/admin/companies` の作成後の導線） ／ 依存: [settings-console](settings-console.md)（B1）、[company-admin](company-admin.md)（B2）、[setup-health](setup-health.md)（B3）、[ui-kit](ui-kit.md)、[form-ergonomics](form-ergonomics.md)（未保存の確認の文言）
- ADR: [ADR-0027](../adr/0027-setting-presentation.md) に §8 を追記（`setup.progress` の定義、表示属性 `managedBy`、「新しい書込経路を作らない」規則、所属人数の読取）。新しい ADR は作らない（ADR-0034 は使わない）
- 作成: 2026-10-29 ／ 作成者: agent（計画セッションが draft）。2026-10-30 spec writer（`wip/setup-wizard`、基点 `8d40672`）が B1〜B3 の実装に合わせて改訂（末尾の「改訂の記録」）。設計の元は [完成度向上の実装計画](../completion-plan.md) B4

## 目的（1段落）

導入直後の管理者は、会社情報・会計年度・勘定科目・税率と端数処理・請求書の発行者・在庫の扱い・業界テンプレート・利用者・勤怠給与の制度を、別々の画面と設定カードで正しい順に整える必要がある。順序と完了状態が分からないため、在庫を使わない業種で自動出庫が有効なまま物品の請求書を確定できない、登録番号が請求書に出ない、といったつまずきが起きる（[マニュアル 03](../manual/03-setup.md)、[導入チェック](setup-health.md)）。会社の管理者が、既存の設定 API と action を順番に呼ぶだけの段階式の画面で初期設定を進め、完了したかどうかを保存の有無ではなく実データで確かめ、中断・再開・スキップ（理由付き）しながら終えられるようにする。2 社目を作ったテナント管理者は、作成直後にこの画面へ進める。

## 段階と完了条件（安定。`GET /meta/setup-status` と画面が共有する）

段階の id は snake_case で安定（`setup.progress` の property 名、URL の `?step=`、試験が使う）。「完了条件」の導入チェックの項目 id は [setup-health](setup-health.md) の安定 id（`runHealthChecks` の結果）で、その項目の `status` が `ok` のときだけ満たす（`warn` / `fail` / 項目が無いときは満たさない）。`setup.*` の id はこの機能が API で計算する簡単な条件で、同じ形の点検項目として返す。

| #   | id                  | 名称（ja / en）                         | 完了条件（実データ）                                                                                                                                 | 保存に使う既存の経路                                                                                                                                       | 任意 |
| --- | ------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | `company_profile`   | 会社情報 / Company profile              | `company.profile` が ok（正式名称があり、保存値が定義に合う）                                                                                        | `PUT /meta/settings/company.profile`                                                                                                                       |      |
| 2   | `fiscal_year`       | 会計年度 / Fiscal year                  | `accounting.fiscal_period` が ok（今日を含む未締めの期間があり、30 日後を含む期間もある）                                                            | `POST /actions/accounting.open_fiscal_year`                                                                                                                |      |
| 3   | `chart_of_accounts` | 勘定科目の確認 / Chart of accounts      | `setup.chart_of_accounts`: 有効な勘定科目が 1 件以上あり、消費税の役割が `output_tax` の有効な科目と `input_tax` の有効な科目がそれぞれ 1 件以上ある | 書込みなし（科目の追加・変更は既存の `/e/account`）                                                                                                        |      |
| 4   | `tax`               | 税率と端数処理 / Tax rates and rounding | `tax.standard_rate` が ok（今日に有効な標準税率がある）                                                                                              | `PUT /meta/settings/tax.rounding`、`PUT /meta/settings/tax.price_includes_tax`（税率そのものは既存の `/e/tax_rate`）                                       |      |
| 5   | `invoice_issuer`    | 請求書の発行者 / Invoice issuer         | `sales.issuer` が ok（名称と登録番号を印字できる。免税事業者は番号不要）                                                                             | `PUT /meta/settings/sales.issuer`（または段階 1 の `company.profile`）                                                                                     |      |
| 6   | `inventory`         | 在庫の扱い / Inventory                  | `inventory.stock_settings` が ok                                                                                                                     | `PUT /meta/settings/inventory.auto_issue_on_sales`、`…/inventory.auto_receipt_on_purchase`、`…/inventory.default_warehouse`（倉庫は既存の `/e/warehouse`） |      |
| 7   | `industry_template` | 業界テンプレート / Industry template    | `setup.industry_template`: 会社の `packs.applied` に `example` 以外の pack が 1 件以上ある                                                           | `POST /actions/pack.apply`                                                                                                                                 |      |
| 8   | `users`             | 利用者 / Users                          | `setup.users`: この会社に所属する有効な利用者（`users.active = true`）が 2 人以上                                                                    | `POST /admin/users`、`PUT /admin/users/:id/companies/:companyId`、`POST /auth/invitations`                                                                 |      |
| 9   | `workforce`         | 勤怠・給与 / Work and pay               | `setup.workforce_policy`: 勤怠・給与の制度（entity `workforce_pay_policy`）が 1 件以上ある                                                           | `POST /actions/workforce.initialize_policy`                                                                                                                | 任意 |

状態の決め方（AC-15）: 完了条件を満たす → `done`。満たさず `setup.progress` にスキップの記録がある → `skipped`（理由付き）。それ以外 → `todo`。「残り」と完了数は任意でない段階（1〜8）だけで数え、`skipped` は「残り」に数えない（チェックリストには完了とは別の「スキップ（理由）」として残す）。ただし、段階の判定に使う点検が `fail`（伝票を確定できない状態）のときは、スキップしていてもホームのカードに警告として残す（AC-7）。

`setup.*` の簡単な条件は、満たすとき `ok`、満たさないとき `warn` を返す（`fail` は返さない。`fail` は導入チェックの「伝票を確定できない」状態だけに使う）。

## 受入基準（EARS）

AC-1〜AC-10 は 2026-10-29 の draft の番号と意味を保った（文言は改訂）。AC-11 以降を追加した。

### 画面の段階と保存

- AC-1 WHEN 会社の管理者が `/setup` を開いた THE SYSTEM SHALL 上表の 9 段階を順に並べた段階一覧（stepper）と、選んだ段階の内容を表示する。各段階には状態（完了・未完了・スキップ・任意）を色と文字の両方で示し、任意でない 8 段階のうち完了した数とスキップした数を示す。開く段階は `?step=<id>`（有効な id のとき）、無ければ最初の `todo` の必須段階、それも無ければ段階 1 とする。段階の切替は URL の `?step=` を履歴を増やさずに置き換える。「再点検」で `GET /meta/setup-status` を取り直す（自動の定期取得はしない）。
- AC-2 THE SYSTEM SHALL 各段階の保存を上表の既存 API（`PUT /meta/settings/:key`、`POST /actions/accounting.open_fiscal_year`、`POST /actions/pack.apply`、`POST /admin/users`、`PUT /admin/users/:id/companies/:companyId`、`POST /auth/invitations`、`POST /actions/workforce.initialize_policy`）と、進捗の記録の `PUT /meta/settings/setup.progress` だけで行い、新しい書込みの API・action を作らない。各 API の権限検査（設定は admin か settings、会計年度は `fiscal_year` の create、テンプレートは admin、利用者はテナント管理者、勤怠の制度は `workforce_hr` / `workforce_payroll` か admin）をそのまま適用する。保存のあと `GET /meta/setup-status` を取り直して状態を表示する。
- AC-3 WHEN 会計年度の段階を開いた THE SYSTEM SHALL 既存の会計年度（`GET /api/fiscal_year`、要求者の読取権限）、`accounting.fiscal_period` の点検の状態と `company.profile` の決算月から次のとおり提案し、提案を承認したときだけ `accounting.open_fiscal_year { startDate }` を呼ぶ。「今日」はサーバーの業務日付（`GET /meta/setup-status` の `checkedAt` を Asia/Tokyo の日付にしたもの。`accounting.fiscal_period` の点検と同じ日）とする。「最後の年度」は終了日が最も遅い年度、「継続の年度」は最後の年度の終了日の翌日から始まる 12 か月の年度とする。
  - (a) 今日を含む年度があり、点検が `fail` でない: その年度（コード・開始日・終了日）を表示する。最後の年度の終了日が今日から 30 日以内（`accounting.fiscal_period` の `warn` と同じ範囲）のときだけ、継続の年度を提案する。
  - (b) 今日を含む年度が無い: 継続の年度が今日を含むときはそれを提案する（前の年度の続き）。そうでない（年度が 1 件も無い、または最後の年度との間が 12 か月を超えて空く）ときは、決算月 `m`（未設定なら 12）から、開始月 `m % 12 + 1` の 1 日で今日を含む 12 か月の年度を提案し、最後の年度との間に空きができるときは、その期間の日付の伝票は確定できないことを注記する。
  - (c) 今日を含む年度があるのに点検が `fail`（今日の期間が締め済み、または年度に期間が無い）: 点検の詳細と経路（`href`）を表示し、年度を提案しない。
  - (a)(b) の提案の開始月が決算月の翌月と違うときは、その旨と「既存の年度は変更・削除しない」ことを注記する。提案が既存の年度と重なるときは作成の操作を出さず、重なる年度を示す。年度の作成・変更・削除を他の経路で行わない。
- AC-4 WHEN 在庫の段階で「在庫を使わない」を選んで保存した THE SYSTEM SHALL `inventory.auto_issue_on_sales` と `inventory.auto_receipt_on_purchase` に `false` を保存する。「在庫を使う」を選んで保存した THE SYSTEM SHALL 両方に `true` を保存し、`inventory.stock_settings` の結果（既定倉庫が決まるか、物品があるか）とその詳細を表示し、既定倉庫が決まらないときは倉庫の一覧（`/e/warehouse`）と既定倉庫コードの設定カードを示す。「在庫を使う」の保存後は、マイナス在庫を許可しない（`inventory.allow_negative_stock` の既定 `false`）ため物品の売上請求書を確定する前に入庫が要ること、またはマイナス在庫を在庫タブで許可できることを、入庫の画面（`/e/stock_entry`）と在庫タブ（`/settings?tab=inventory`）へのリンク付きで説明する（期首在庫は B6 で、この項目の対象外）。選択肢には業種の目安（下の「データ・業務ルール」）を日英で添える。2 つの設定が食い違う（片方だけ有効）ときは、どちらの選択肢も選ばれていない状態で始め、「片方だけ有効」の現状を表示する。片方だけを変える運用は会社設定の「在庫」タブへのリンクで案内する。
- AC-5 THE SYSTEM SHALL 各段階の完了を保存の有無ではなく上表の実データの条件で判定し、admin の `GET /meta/setup-status` が `{ checkedAt, steps: [{ id, order, label, optional, status: 'done' | 'todo' | 'skipped', reason?, skippedAt?, completedAt?, regressed, checks: [{ id, status, label, detail, href? }] }], summary: { required, done, skipped, remaining, nextStep, attention }, progress }` を返す。`checks` は判定に使った点検項目（導入チェックの項目、または `setup.*` の項目）で、`detail` に件数や理由を日英で入れる。`reason` / `skippedAt` はスキップの記録があれば状態に関係なく返し、`completedAt` は `completed` の記録があれば返す。`nextStep` は最初の `todo` の必須段階の id（無ければ `null`）。`attention` は判定の点検に `fail` がある段階の id（状態に関係なく、表示順）。`progress` は保存されている `setup.progress` を schema で読んだ値（合わなければ `{}`）で、段階を返さない runtime（AC-16）の記録も含む。画面はこの `progress` に今回の変更を重ねて保存する（AC-15）。
- AC-6 WHEN 管理者が `todo` の段階をスキップした THE SYSTEM SHALL 理由（必須、前後の空白を除いて 1〜200 文字）を会社設定 `setup.progress` のその段階に `{ state: 'skipped', at, reason }` として `PUT /meta/settings/setup.progress` で記録し、段階一覧に「スキップ（理由）」と表示する。ブラウザを閉じて開き直しても、記録と実データから同じ状態を表示する。WHEN 管理者が「スキップを取り消す」を選んだ THE SYSTEM SHALL その段階の記録を除いた値を保存する。
- AC-7 WHEN `/meta` の `roles` に `admin` がある利用者がホームを開いた THE SYSTEM SHALL 次のどちらかが成り立つ間、「セットアップを続ける」カードを表示する: (1) 任意でない段階に `todo` が残っている、(2) `summary.attention` が空でない（スキップした段階を含め、伝票を確定できない点検 `fail` がある）。カードには完了数（例: 8 段階中 5 段階完了、スキップ 1）、次の段階の名称と `/setup?step=<id>` へのリンク（id は `nextStep`、それが無ければ `attention` の先頭）を表示し、(2) のときは「点検に失敗している段階があります」の警告とその段階名を表示する。どちらも成り立たないときはカードを表示しない（`/setup` は画面検索・「設定・管理」からいつでも開ける）。カードは `apps/web/src/components/setup-card.tsx` に置き、ホームのビューの選択に関係なく `admin` を持つすべての利用者に見せる（C6 のロール別ホームの統合後はビューの切替の上、統合前はホームの見出しと入口の操作の下の先頭）。`home-page.tsx` には import と 1 要素だけを足す。THE SYSTEM SHALL `/meta` の `roles` に `admin` が無いときは `GET /meta/setup-status` を要求しない。`GET /meta/setup-status` の取得に失敗したとき（403 を含む）はカードを出さず、ホームの他の表示を妨げない。
- AC-8 IF 要求の Context が `admin` ロールを持たない、または所属が店舗・拠点限定である THEN THE SYSTEM SHALL `GET /meta/setup-status` を拒否する（403、`PermissionDenied`）。画面は `/meta` の `roles` に `admin` が無い利用者に、`/setup` を画面検索・「設定・管理」・ホームのカードで出さない（画面は所属の範囲を知らないので、店舗・拠点限定の `admin` には項目が出るが、API が拒否する）。URL を直接開いた `admin` でない利用者と、`GET /meta/setup-status` が 403 を返した利用者には「会社の管理者だけが使えます」と説明し（`data-testid="setup-forbidden"`）、段階の内容と保存の操作を表示しない（AC-25 の失敗・再読込の表示にはしない）。
- AC-9 WHILE 段階の中の入力に未保存の変更がある WHEN 利用者が別の段階・前へ・次へ・別の画面へ移ろうとした、またはページを閉じようとした THE SYSTEM SHALL 「未保存の変更があります。破棄して移動しますか？」の確認を求め、取りやめたら移動しない（`useBlocker` とページ離脱時の確認。利用者と権限の画面と同じ文言）。保存中は移動させない。
- AC-10 THE SYSTEM SHALL 画面とカードの文言を日本語と英語で持ち、390px 幅で横にはみ出さずに全段階を選んで操作できるようにする。段階一覧は `<ol>` の各段階を 1 つのボタンにし、現在の段階に `aria-current="step"` を付ける。キー操作は roving tabindex とする: フォーカスを持つ段階（初めは現在の段階）のボタンだけを `tabIndex=0`、他を `-1` にし、Tab で一覧に入って Tab で出る。← → ↑ ↓ で隣の段階へ、Home / End で先頭・末尾へフォーカスを移し、Enter / Space で開く。段階を開いたらその段階の見出し（`tabIndex=-1`）へフォーカスを移す。状態の変化（保存・スキップ・再点検の結果）は polite なライブ領域で知らせる。

### 進捗の設定と API

- AC-11 THE SYSTEM SHALL kernel が会社設定 `setup.progress` を登録する。schema は省略可の property 9 個（段階 id）と `updatedAt`（ISO 日時、省略可）を持つ object で、各段階の値は `{ state: 'completed', at: ISO 日時 }` か `{ state: 'skipped', at: ISO 日時, reason }`（どちらも strict。`skipped` は `reason` 必須、`completed` に `reason` や未知の key があれば 400）。最上位の未知の property（段階 id でないもの）は保存時に捨てる（zod の既定の strip。保存されるのは解析後の値）。表示属性は `category: 'system'`、設定と全 10 細目の日英ラベル、説明（日英）、`managedBy: { href: '/setup', label: セットアップ }`。`default` は宣言しない。apps/runtime の `loadRuntime` が `ensureSetupProgressSetting()`（冪等）を呼ぶ。保存値が schema に合わないときは記録なし（`{}`）として扱い、状態の判定を止めない。
- AC-12 THE SYSTEM SHALL `SettingDef` に表示属性 `managedBy?: { href, label }` を足し、`checkSettingDef` で `href` がアプリ内の経路（`isHealthHref` と同じ規則）であること・`label` が日英を持つことを登録時に検査する（違反は定義の誤りの `Error`）。`GET /meta/settings` はこの属性を返す。WHEN 設定画面が `managedBy` を持つ設定を表示した THE SYSTEM SHALL 入力欄・「保存」・「既定に戻す」を出さず、状態（未設定／会社の値）、説明、`<label>で変更` のリンク（`/meta` の `roles` に `admin` があるときだけ。無いとき（settings ロール）は「会社の管理者が<label>の画面で変更します」の文）、「変更履歴」だけを表示する。表示属性なので `PUT` / `DELETE` の検証と権限は変えない。
- AC-13 THE SYSTEM SHALL `GET /meta/setup-status` を要求の Context の会社についてだけ計算する。点検・件数・`setup.progress` は Repository（行の権限と会社の境界）または RLS の効く kernel の読取で行い、別の会社の記録・所属・設定を数えない。所属人数は `activeCompanyMemberCount(ctx)`（`kernel/src/company-access.ts`、`companyMemberIdentities` の隣）が `user_company_memberships.tenant_id = ctx.tenantId AND company_id = ctx.companyId AND users.active` を条件に明示して数える（この表の RLS はテナントの境界だけで、会社の境界は条件で守る）。ある会社の `setup.progress` を保存しても他の会社の状態は変わらない。所属の無い会社（テナント管理者は同じテナントの全社で admin になる。`resolveCompanyAccess`）や別テナントの会社を `x-company-id` で指定した要求は、既存の Context の規則で拒否される。IF 要求の Context に会社が無い（`ctx.companyId` が null。会社を選んでいないテナント管理者） THEN THE SYSTEM SHALL `GET /meta/settings` と同じ 404（`NOT_FOUND`、`company`）で拒否する。
- AC-14 THE SYSTEM SHALL `GET /meta/setup-status` を読取専用のトランザクション（`withRequestContext(..., { readOnlySnapshot: true })`）で実行し、何も書かない（監査も残さない）。応答には日英のラベル・件数・アプリ内の経路だけを入れ、接続先・秘密値・ファイルパス・例外の文・利用者の氏名やメールを入れない。kernel の点検は `runHealthChecks(ctx)`（API の運用点検 `extra` は渡さない）で行う。
- AC-15 THE SYSTEM SHALL 段階の状態を「条件を満たす → `done`、満たさずスキップの記録がある → `skipped`、それ以外 → `todo`」の順で決める（スキップしたあとで条件を満たせば `done`）。`completed` の記録（管理者が段階で「確認して次へ」を押した記録）は状態を変えず、`completedAt` として返す。`completed` の記録があるのに条件を満たさない段階は `regressed: true` とし、画面は「以前は完了していましたが、条件を満たさなくなりました」と示す。`summary` は任意の段階を数えない（`attention` は任意の段階も含む）。記録の扱い: 「確認して次へ」は段階が `done` のときだけ `completed` を書き（`todo` / `skipped` の段階では「次へ」で移動だけする）、`completed` を書くとその段階の `skipped` の記録を置き換える。スキップは段階が `todo` のときだけ選べる。スキップの記録は段階が後で `done` になっても残り（`reason` / `skippedAt` を返す）、「確認して次へ」で `completed` に置き換えるか「スキップを取り消す」で消すまで残る。保存する値は応答の `progress`（AC-5）に変更を重ねたもので、変更しない段階（応答に無い段階 9 を含む）の記録を保つ。記録の `at` と `updatedAt` は画面（クライアント）の時刻で、正式な変更時刻と変更者は `setSetting` の監査行が持つ。
- AC-16 IF 段階の判定に使う点検が `warn` / `fail` を返した、例外で失敗した、または結果に無い THEN THE SYSTEM SHALL その段階を `todo` とし、`checks` にその項目の状態と詳細（失敗・欠落は「点検できませんでした」）を入れ、他の段階を返し続ける。`setup.*` の各条件は savepoint（`withSavepoint`）の中で計算し、失敗をログに `safeErrorDiagnostics` だけで残す（setup-health と同じ扱い）。entity `workforce_pay_policy` が登録されていない runtime では段階 9 を返さない。

### 各段階の内容

- AC-17 WHEN 会社情報の段階を開いた THE SYSTEM SHALL 設定画面と同じ部品（`SettingCard`）で `company.profile` を表示し、`company.profile` の点検結果を示す。保存は `PUT /meta/settings/company.profile`。
- AC-18 WHEN 勘定科目の段階を開いた THE SYSTEM SHALL `setup.chart_of_accounts` の件数（有効な科目、仮受消費税・仮払消費税の役割を持つ有効な科目）と、勘定科目の一覧（`/e/account`）へのリンクを表示する。この段階は何も書かない（「確認して次へ」は `completed` の記録だけ）。
- AC-19 WHEN 税率と端数処理の段階を開いた THE SYSTEM SHALL `tax.standard_rate` の点検結果と税率の一覧（`/e/tax_rate`）へのリンク、`tax.rounding` と `tax.price_includes_tax` の `SettingCard` を表示し、端数処理は「1 請求書につき税率ごとに 1 回」であることを添える（出典は下記）。
- AC-20 WHEN 請求書の発行者の段階を開いた THE SYSTEM SHALL `sales.issuer` の点検結果と、`sales.issuer` を保存しない場合は会社プロフィールが印字されることを表示する。WHEN 「会社プロフィールから複写」を押した THE SYSTEM SHALL `sales.issuer` のカードの入力欄に `company.profile` の正式名称（無ければ会社名）・登録番号・郵便番号・住所・電話・メールを入れる（保存はしない。入力は未保存の変更になる）。複写して保存すると以後のプロフィールの変更が請求書に反映されないこと（`sales.issuer` が有効ならまとめて優先される。company-admin AC-7）を同じ場所に示す。
- AC-21 WHEN 業界テンプレートの段階を開いた THE SYSTEM SHALL `/templates` と同じテンプレートの部品（`TemplateCard` と適用の確認）で、この会社に適用できるテンプレートを表示し、適用は確認のあと `POST /actions/pack.apply` で行う。テンプレートを使わない会社のために、スキップ（AC-6）を同じ段階に示す。
- AC-22 WHEN 利用者の段階を開いた THE SYSTEM SHALL この会社の有効な所属人数を表示する。テナント管理者には `/admin/users` と同じ部品（`AccessCreateUser`、`AccessInviteUser`、`AccessMemberships`）で利用者の作成・招待と所属の設定を表示し、作成した利用者の所属の編集は現在の会社を選んだ状態で開く。テナント管理者でない会社の管理者には「利用者の追加はテナント管理者が行います」と説明し、作成・招待の操作を出さない（スキップは選べる）。招待を作成したあとは、招待された人が受理し、テナント管理者がこの会社への所属を割り当てるまでこの段階は完了しない（招待された利用者は無効の状態で所属も無く、数えない）ことを説明する。所属の割当ては受理後に行うよう案内する（受理前に所属を付けると招待を再発行できない。`kernel/src/identity/invitations.ts`）。
- AC-23 WHEN 勤怠・給与の段階を開いた THE SYSTEM SHALL 任意であることと `setup.workforce_policy` の結果を表示し、制度が無いときだけ既存の部品（`WorkforceInitialize`）で `workforce.initialize_policy` を実行できるようにし、勤怠・給与の画面（`/workforce`）へのリンクを示す。

### 誤りと権限

- AC-24 IF 段階の保存が失敗した（400 の検証エラー、403、409 の重なり・競合、通信の失敗） THEN THE SYSTEM SHALL 入力を残したまま段階の中に失敗を表示し（設定カードは既存どおり細目に、ほかは「保存できませんでした」とサーバーの文、閉じた技術情報の `ErrorDetails`）、`GET /meta/setup-status` を取り直し、段階を進めない。会計年度の作成が 409（`CONFLICT`、既存の年度と重なる）を返したときは、重なる年度を示して作成しない。
- AC-25 IF `GET /meta/setup-status` の取得に失敗した（403 を除く） THEN THE SYSTEM SHALL `/setup` に失敗と「再読込」を表示し（前回の結果があれば残して `role="alert"` で失敗を知らせる）、段階の入力中の値を消さない。403 は AC-8 の説明を表示する。
- AC-26 IF スキップの理由が空・200 文字を超える THEN THE SYSTEM SHALL 送信せずに理由の欄に誤りを示し（サーバーも `setup.progress` の schema で 400 を返す）、記録を変えない。

### 導線とヘルプ

- AC-27 WHEN テナント管理者が `/admin/companies` で会社を作成した THE SYSTEM SHALL 作成後の枠の主な操作を「切り替えてセットアップを始める」（会社を切り替えて `/setup` を開く）にする（`apps/web/src/lib/companies.ts` の `SETUP_DESTINATIONS` の TODO を置き換える）。
- AC-28 THE SYSTEM SHALL `/setup` を「設定・管理」分野の専用画面（`kind: 'setting'`、新しい条件 `admin` = meta の roles に `admin` がある）として画面検索・分野一覧に出し、`lib/help.ts` に `/setup` → マニュアル 03「セットアップウィザード」の章を足す。

## 関係するファイル・インターフェース（名指し）

- kernel:
  - `kernel/src/setup-progress.ts`（新規）: `SETUP_PROGRESS_KEY = 'setup.progress'`、`SETUP_STEP_IDS`（上表の 9 id、表示順）、`type SetupStepId`、`setupStepRecordSchema`、`setupProgressSchema`、`SETUP_PROGRESS_SETTING`（`SettingDef`）、`ensureSetupProgressSetting()`（冪等。`ensureCompanyProfileSetting` と同じ形）、`setupProgressOf(settings)`（合わない値は `{}`）
  - `kernel/src/company-access.ts`: `activeCompanyMemberCount(ctx)`（`companyMemberIdentities` の隣。`user_company_memberships` と `users` を `ctx.db` で、tenant・company・`users.active` の条件を明示して数える。要求者が admin ロールかつ全社の所属でなければ `PermissionDenied`、会社が無ければ `NotFound`。件数だけを返す）
  - `kernel/src/registry.ts`（`SettingDef.managedBy?: { href: string; label: Label }`）、`kernel/src/setting-presentation.ts`（`checkSettingDef` の検査。アプリ内の経路の規則は `kernel/src/health.ts` の `isHealthHref` と共通の関数にする。循環 import を避けるため小さな共通モジュールへ移してよい）、`kernel/src/index.ts`（公開）
- runtime: `apps/runtime/src/index.ts`（`loadRuntime` が `ensureSetupProgressSetting()` を呼ぶ）
- api:
  - `apps/api/src/setup-status.ts`（新規）: `SETUP_STEPS`（id・順・日英ラベル・任意・判定に使う導入チェックの項目 id または `setup.*` 条件）、`deriveSetupStatus({ health, facts, progress })`（純粋関数。unit 試験の対象）、`collectSetupFacts(ctx)`（`runHealthChecks(ctx)`、`activeCompanyMemberCount`、`appliedPacksOf(company.settings)`、`registry.hasEntity` / `repo(ctx, registry.entity('account' | 'workforce_pay_policy')).count(where)` による件数。各条件は `withSavepoint` の中）、`setupStatus(ctx)`（admin の検査 → 収集 → 導出）
  - `apps/api/src/routes/setup-status.ts`（新規。`registerSetupStatusRoutes(app, { db })`、`GET /meta/setup-status`、`readOnlySnapshot: true`）、`apps/api/src/server.ts`（登録）、`apps/api/src/routes/settings.ts`（`SettingOut.managedBy` を返す）
- web:
  - `apps/web/src/pages/setup-page.tsx`（新規。stepper、段階の切替、未保存の確認、権限の説明）、`apps/web/src/components/setup-*.tsx`（新規。段階一覧と各段階）、`apps/web/src/components/setup-card.tsx`（新規。ホームのカード）、`apps/web/src/api/setup.ts`（新規。`useSetupStatus(enabled)`、`setupStatusKey`、進捗の保存は `useSaveSetting` を使う）、`apps/web/src/lib/setup-wizard.ts`（新規。純粋関数: 初期段階の選択、`proposeFiscalYear({ today, endMonth, years, check })`、`buildProgress(progress, change, now)`（応答の `progress` に変更を重ねる。変更しない段階の記録を保つ）、カードの表示判定、段階一覧のキー操作の移動先、在庫の目安の文言）
  - 既存の部品への追加（どれも省略可の prop で、既存の呼出しは変わらない）: `components/setting-card.tsx`（`onDirtyChange?`、`draftValue?`（入力欄の初期値。未保存の変更として扱う）、`managedBy` の読取専用表示）、`components/access-create-user.tsx`（`onCreated?(user)`）、`components/access-invite-user.tsx`（`onInvited?(userId)`）、`components/access-memberships.tsx`（`initialCompanyId?`）、`pages/templates-page.tsx`（`TemplateCard` と適用の確認を export する、または `components/template-card.tsx` へ移す）
  - `apps/web/src/router.tsx`（`/setup`、`validateSearch` で `step` を段階 id に限る）、`apps/web/src/lib/navigation-data.ts`（`/setup` の項目と条件 `'admin'`）、`apps/web/src/lib/navigation.ts`（条件 `'admin'` の判定）、`apps/web/src/lib/help.ts`（章）、`apps/web/src/lib/companies.ts`（`SETUP_DESTINATIONS`）、`apps/web/src/pages/home-page.tsx`（`<SetupCard />` の 1 要素と import だけ）、`apps/web/src/api/types.ts`（`SettingMeta.managedBy`）、`apps/web/src/ui/token-usage.test.ts`（新しい画面・部品を `CONVERTED` に追加）
- 試験: 下の「検証手順」に列挙
- docs: `docs/adr/0027-setting-presentation.md`（§8 と冒頭の「追記」の行、帰結の「読取専用の表示属性は B4 と合わせて検討」の解決）、`docs/manual/03-setup.md`（ウィザードを主手順に書き換え。help.ts と他の章が参照する見出し「設定画面」「会社プロフィール」「会計年度と会計期間」「勘定科目」「税率」を残す）、`docs/manual/01-install.md`（初回ログイン後に `/setup` を案内）、`docs/manual/08-admin.md`（「会社の追加と編集」の手順 3 を `/setup` に、「導入チェック」からウィザードへの言及）、`docs/manual/appendix-e-operations-control.md`（会社を増やす手順の続きとして `/setup`）

## 決めたこと（計画が選択を残した点）

1. **判定の置き場所は apps/api**（`apps/api/src/setup-status.ts`）。9 段階は複数の module の点検 id と entity 名にまたがるアプリの段取りで、kernel が module を知らないという層の規則（ADR-0013）に合わせた。kernel は設定 `setup.progress` と所属人数（kernel の表）だけを持つ。web は判定せず API の結果を表示する。
2. **完了 = 対応する点検がすべて `ok`**。`warn` も未完了にする（点検の理由を `detail` の文で区別しない）。帰結として、年度末の 30 日前から会計年度の段階が `todo` に戻り、管理者のホームにカードが再び出て翌年度の作成（AC-3 (a)）へ案内する。これは導入チェックの `warn` と同じ事実の案内なので許容した。
3. **状態の優先順位は done → skipped → todo**（AC-15）。計画の「スキップはチェックリストに未完了として残す」は、段階一覧で完了とは別の「スキップ（理由）」として表示することで満たし、ホームのカードの「残り」には数えない（理由を付けて決めたことを毎回促さない）。ただし判定の点検が `fail`（伝票を確定できない）の段階は、スキップしていてもカードに警告として残す（`summary.attention`、AC-7）。**計画からの逸脱**として記録する: 計画の骨子は「スキップしたステップはチェックリストに未完了として残す」「カードは `setup.progress` が無く fail があるとき」だった。この spec はカードを「必須段階に `todo` がある、または `fail` の点検がある」間に出し、スキップした段階は `fail` でない限りカードから外す（spec 批評 9）。
4. **`completed` の記録は確認の記録で、状態を変えない**。タスクの「completed / skipped とその理由・更新時刻」を保ちつつ、計画の「完了判定は保存の有無ではなく実データ」を優先した。使い道は表示（確認日時）と「条件を満たさなくなった」段階の検出（`regressed`）。
5. **進捗の書込みは既存の `PUT /meta/settings/setup.progress`**（admin か settings。専用の API は作らない）。値は丸ごと置き換えなので、画面は書く直前に `GET /meta/setup-status` を取り直し、応答の `progress`（保存値そのもの。応答に無い段階の記録も含む）に今回の変更を重ねて送る（`buildProgress`）。段階の一覧（`steps`）から組み立て直さないのは、返さない段階 9 の記録や `done` の段階に残るスキップの記録を消さないため（spec 批評 3）。同じ会社で 2 人が同時に書くと後の書込みが勝つ（設定の PUT に版の検査は無い）。記録は状態の判定に使わない補助情報なので許容した（未決事項）。settings ロールの利用者も API でこの設定を書けるが、できるのはスキップの記録でカードを消すことだけで、完了は実データで決まる。
6. **表示属性 `managedBy` を足す**（AC-12、ADR-0027 §8）。ADR-0027 の帰結が「読取専用の表示属性は B4 の `setup.progress` と合わせて検討する」としていた点への答え。設定画面で JSON として編集できると記録を壊しやすく、専用画面へ案内する方が分かりやすい。`PUT` / `DELETE` は変えない（表示属性は検証・保存・権限に影響しない、ADR-0027 §1）。`packs.applied` への適用はこの項目では行わない（未決事項）。
7. **勘定科目の条件は API の簡単な条件**（`setup.chart_of_accounts`、汎用の Repository の件数）。accounting に導入チェックの項目を足す案は `/admin/health` の項目と B3 の試験の固定 id 一覧を変えるため採らなかった。
8. **業界テンプレートの条件は `example` 以外**。`example` は拡張技術の見本で 15 業界に数えない（[業界カタログ](../domain/industry-catalog.md)、`/templates` の件数表示も除外している）。
9. **利用者の条件は「この会社の有効な所属が 2 人以上」**。テナントの利用者数ではなく会社の所属で数える（会社ごとの段階のため）。所属の無いテナント管理者は数えない。1 人で使う事業者はスキップする。
10. **勤怠・給与は任意で常に表示**（計画の未決事項の既定）。module の seed（`seedWorkforce`）が会社の作成時に制度を作るので、`/admin/companies` で作った会社では通常最初から `done` になる。`workforce.initialize_policy` は制度が無い古い会社のために残す。
11. **会計年度は作るだけで、変更・削除しない**（AC-3）。新しい会社には seed が当年 1〜12 月の年度を作るため、決算月が 12 でない会社では「既存の年度は決算月と合わない」という注記になる。1 年未満の年度（変則の事業年度）で決算月へ揃える機能は `accounting.open_fiscal_year` が 12 か月の年度しか作らないため対象外（スコープ外・未決事項）。重なりの最終的な防止はサーバーの既存の hook（`CONFLICT`）。
12. **決算月の入力は段階 1 だけ**。会計年度の段階では決算月を表示し、変更は段階 1（会社情報）へのリンクで案内する（決算月の保存先を 1 か所にする）。未設定のときは 12 月（暦年）として提案することを明示する。
13. **在庫の「使わない」は 2 つの設定を順に保存する**（設定ごとの既存の PUT）。2 つ目が失敗したときは失敗を示し、取り直した状態をそのまま表示する（`inventory.stock_settings` が実際の組合せで判定する）。
14. **ホームのカードは失敗を表示しない**（AC-7）。カードは補助の導線で、`/setup` は画面一覧から開ける。ホームの他の要素を妨げないことを優先した。カードは `/meta` の `roles` に `admin` がある利用者だけが `GET /meta/setup-status` を要求する（C6 のロール別ホームが「403 の要求が 0 件」を試験するため）。
15. **カードはホームのビューに関係なく admin に見せる**（spec 批評 1、C6 role-home AC-12・決定事項 18 への答え）: admin と業務ロールを併せ持つ利用者は C6 の既定のビューが業務ビューになるため、admin ビューの「導入・管理」カードの中に置くと見えない。C6 の統合後はビューの切替の上に、統合前はホームの入口の操作の下の先頭に置く。C6 の「導入・管理」カードの `/setup` へのリンクはそのまま残る（重複は許容。カードは未完了の間だけ出る）。
16. **運用の点検（メール・OIDC・移行・保存先）はウィザードに含めない**。運用者の作業で、`/admin/health` が扱う。`runHealthChecks` に `extra` を渡さないので owner 接続の読取（ADR-0027 §7 の例外）も使わない。
17. **会社の管理者だけ**（`admin` ロール）。settings ロールには開かない（計画の「管理者のみ」。テンプレート適用・会計年度の作成など settings ロールでは実行できない段階を含むため）。テナント管理者でない会社の管理者は、利用者の段階だけ説明表示になる（AC-22）。
18. **`/admin/companies` の作成後の導線は 1 つにする**（AC-27）。「切り替えてセットアップを始める」が `/setup` を開き、会社プロフィールと会計年度はウィザードの段階 1・2 で扱う。既存の単体試験 `apps/web/src/lib/companies.test.ts`（AC-9 の行き先と文言）とブラウザ試験 `apps/web/e2e/company-admin.spec.ts`（作成後のボタンの文言と遷移先）は、company-admin の仕様が「B4 ができたら `/setup` に差し替える」と予定していた要求の変更として書き換える（弱めるのではなく行き先を変える。作業記録に書く）。
19. **新しい ADR は作らない**。`setup.progress` と `managedBy` は ADR-0027 の設定の表示属性の延長なので §8 に追記する（計画の ADR 表も ADR-0027 に B4 を割り当てている）。§8 に書く内容: (1) `setup.progress` の schema・表示属性・登録（`loadRuntime`）、(2) `managedBy` の意味（表示だけで検証・保存・権限を変えない）と登録時の検査、(3) **ウィザードは新しい書込経路を作らない**: 各段階は既存の `PUT /meta/settings/:key`・`POST /actions/...`・`/admin/users...`・`POST /auth/invitations` を呼び、それぞれの権限検査を通す。段階を足すときも同じ規則に従う、(4) 状態は実データ（導入チェックの項目と `setup.*` の条件）で判定し、`setup.progress` は確認とスキップの補助記録であること、(5) `activeCompanyMemberCount` は kernel の表をテナント・会社・有効の条件を明示して数え（表の RLS はテナントの境界だけ）、件数だけを返し、admin ロール以外を拒否すること。冒頭の「追記予定: B4」を「追記: §8」に直す。

## データ・業務ルール（出典）

- 消費税の端数処理は「1 適格請求書につき税率ごとに 1 回」（段階 4 の説明） — [日本の制度事実](../domain/japan-tax.md#rounding)（国税庁 インボイス Q&A 問57、確認 2026-09-10）
- 登録番号は `T` + 13 桁（段階 1・5 の説明と `sales.issuer` の点検） — [日本の制度事実](../domain/japan-tax.md)（国税庁 タックスアンサー No.6625、確認 2026-09-10）。company-admin・setup-health と同じ出典で、新しい制度値はない。「免税事業者を選ぶと登録番号は不要（同時に入れると保存できない）」は製品の挙動（company-admin AC-6、`company.profile` の schema）として書き、画面に法令の説明としては書かない（spec 批評 10。免税事業者と適格請求書発行事業者の関係の一次出典は docs/domain に無い）。
- 在庫を「使う／使わない」の業種の目安（段階 6） — 法令ではなく当プロジェクトの業界テンプレートの実装（spec 批評 11 で根拠を絞った）。在庫を使う目安: 小売（`packs/retail/src/settings.ts` が自動入出庫を有効にする）、電器店（`packs/appliance-store/src/pack.ts` が同じ）、卸売（[業界カタログ](../domain/industry-catalog.md)「売上請求確定時に、会社の自動出庫設定が有効なら既定倉庫から出庫する」）、農家（`packs/farm/src/services/stock.ts` が収穫を入庫伝票にする）、飲食チェーン（`packs/restaurant-chain` の食材・廃棄が在庫伝票を使う）。在庫を使わない目安: 物品を仕入れて売らず、役務・賃貸・工事などを請求する会社（業種を列挙しない）。画面では「目安」と明記し、判断は会社に委ねる。
- 会計年度の提案（段階 2）は、会社が入れた決算月と `accounting.open_fiscal_year` の 12 か月の年度からの計算で、制度値を使わない。事業年度の長さなどの法令（法人税法 第13条など）は判定にも画面の文言にも使わない。**【未確認】** 一次出典（e-Gov 法令検索、国税庁）をこのセッションから取得できなかった（2026-10-30、`laws.e-gov.go.jp` と `www.nta.go.jp` の名前解決が拒否された）ため、docs/domain には追加していない。画面に制度の説明を足すときは、先に一次出典を docs/domain に置く。

## スコープ外（明記）

- 他システムからのデータ移行（[csv-import](csv-import.md)）と期首残高（B6）
- テナントや最初の会社の作成（`pnpm run setup install`）、会社の作成そのもの（B2 の `/admin/companies`）
- 段階の追加を module / pack が宣言する仕組み（初版は固定の 9 段階）
- 既存の会計年度の変更・削除、1 年未満の年度（変則の事業年度）の作成
- 運用者の設定（SMTP・OIDC・移行・添付の保存先・バックアップ）の点検と変更
- 新しい書込みの API・action、複数の設定をまとめて保存する一括の操作（保存は段階ごとの既存の経路）
- 段階の期限・通知・定期的な再点検、MCP の専用ツール（`GET /meta/setup-status` は REST だけ）
- 業界テンプレートの「使う予定」の記録や推薦

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`（kernel を変更するため DB 試験は全件へ昇格。この共有機では `GATE_DB_SHARDS=1`）
2. 単体（kernel）`kernel/test/setup-progress.test.ts`: schema（skipped は理由必須・1〜200 文字・前後空白、completed に理由があれば拒否（strict）、ISO 日時、最上位の未知の段階は捨てる）、`setupProgressOf` が合わない値を `{}` にする、`ensureSetupProgressSetting` の冪等、`category`・全細目の日英ラベル・`managedBy`（AC-6、AC-11、AC-26）。`kernel/test/setting-presentation.test.ts` に `managedBy` の登録時検査（アプリ外の経路・ja/en の欠け・`//`・スキームを拒否）（AC-12）。`activeCompanyMemberCount` は下の DB 試験（`apps/api/test/setup-status.db.test.ts` の専用の describe）で: 有効な所属だけを数える、無効な利用者（招待されて未受理の利用者に所属を付けた状態を含む）と別の会社の所属を数えない、admin でない・店舗限定の Context は `PermissionDenied`、会社の無い Context は `NotFound`（AC-13、AC-22）。`apps/runtime/test/setting-labels.test.ts` は登録の一覧に `setup.progress` が入ることを足す（全 property のラベルは既存の走査で検査される）
3. 単体（API）`apps/api/test/setup-status.test.ts`: `deriveSetupStatus` の表（各段階の条件、`warn` / `fail` / 欠落は `todo`、done → skipped → todo の優先、`example` だけでは未完了、所属 1 人は未完了・2 人で完了、任意の段階を `summary` に数えない、`nextStep`、`completed` の記録と `regressed`、`workforce_pay_policy` が無い runtime で段階 9 を返さない、`done` の段階にもスキップの記録（`reason` / `skippedAt`）を返す、`attention` にスキップした段階の `fail` が入る、`setup.*` の未達は `warn`）（AC-5、AC-7、AC-15、AC-16）
4. DB（API）`apps/api/test/setup-status.db.test.ts`（全 module と pack を読み込んだ runtime、`db.run` で業務日付を固定し、route は `inject`）: 段階ごとに実データで `todo` → `done`（正式名称を保存、今日を含む年度の有無と 30 日前の `warn`、仮受消費税の科目を無効にする・戻す、標準税率の適用終了日、登録番号と免税事業者、自動入出庫を on のまま既定倉庫を解決できなくする・自動入出庫を off にする、`example` の適用だけ・業界 pack の適用、2 人目の所属の追加と無効化、勤怠の制度の有無（workforce の seed を実行していない試験用の会社で `workforce.initialize_policy` の前後））、スキップの記録と理由の返却・条件を満たしたあとの `done`・取消、理由なしのスキップの 400、`managedBy` を返す `GET /meta/settings`、settings / sales ロールと店舗・拠点限定の 403、会社の分離（A 社の記録・所属が B 社の状態に出ない、テナント管理者でない利用者が所属の無い会社を指定すると 403）、応答が読取専用で監査が増えない・秘密値やメールを含まない、点検が例外を投げた段階だけが `todo` になる、`completed` に `reason` を付けた保存の 400、会社を選んでいないテナント管理者の 404、無効な利用者の所属を数えない、`progress` が保存値を返す（AC-2、AC-5、AC-6、AC-8、AC-11〜AC-16、AC-22、AC-26）
5. 単体（Web）`apps/web/src/lib/setup-wizard.test.ts`: 初期段階の選択、`proposeFiscalYear`（決算月 3・12・未設定、今日を含む年度の有無、30 日前の翌年度、重なりで提案しない、開始月の不一致の注記、seed の 1〜12 月の年度と決算月 3 で翌年 1〜3 月の今日 → 継続の年度（翌年 1〜12 月）を提案、12 か月を超える空きでは決算月に揃えて空きを注記、今日の期間が締め済み・年度に期間が無い（点検 `fail`）では提案しない）、`buildProgress`（記録の追加・取消・`updatedAt`、応答に無い段階 9 の記録が残る、`done` の段階のスキップの記録が残る、`completed` が `skipped` を置き換える）、記録の操作の可否（`done` だけ「確認して次へ」、`todo` だけスキップ）、カードの表示判定（`attention` だけでも出る、admin でなければ要求しない）、段階一覧のキー操作の移動先と roving tabindex、全文言の日英（AC-1、AC-3、AC-6、AC-7、AC-10、AC-15）。`apps/web/src/lib/companies.test.ts` の AC-9 を `/setup` の導線に、`apps/web/src/lib/navigation.test.ts` に条件 `admin` の項目を、`apps/web/src/lib/settings-console.test.ts` に `managedBy` の表示判定（admin ならリンク、settings ロールなら文）を足す（AC-12、AC-27、AC-28）
6. ブラウザ `apps/web/e2e/setup-wizard.spec.ts`: `/admin/companies` で 2 社目を作る → 「切り替えてセットアップを始める」 → ホームにカード（次の段階が会社情報） → `/setup` で 9 段階を順に通す（会社情報を入力・保存、会計年度は既存の年度の表示と決算月の不一致の注記で年度が増えないこと（実行日が年末 30 日以内で段階が `todo` のときは、提案された翌年度を作成して進む。試験を実行日に依存させない）、勘定科目の確認、端数処理のカード、発行者の点検が ok、在庫を使わないを保存、業界テンプレートを理由付きでスキップ、利用者を作成してこの会社に所属させる、勤怠・給与が準備済み） → 再読込でスキップと状態が残る → ホームのカードが消える → その会社で物品の品目（`SAMPLE-GOODS`、在庫 0）の売上請求書を作成して確定できる。未保存の確認（取りやめると移動しない）、段階一覧のキー操作と `aria-current="step"`、`GET /api/fiscal_year` の応答を空に差し替えたときの提案と、作成で既存の年度との重なり（409）を表示して年度が増えないこと、390px で横にはみ出さない、英語表示、axe（`a11y-policy.ts` の `judge` を ja 390px と en 1280px で `/setup` に適用）、admin でない利用者（settings ロールの所属）に項目・カードが出ず URL では説明だけが出て API は 403、テナント管理者でない会社の管理者には利用者の段階で説明だけが出る、admin と accounting を併せ持つ所属の利用者にもホームのカードが出る（AC-7）、`page.route` で `GET /meta/setup-status` を 500 にしたとき `/setup` は `role="alert"` と「再読込」を出し入力中の値が残る（AC-25）・ホームはカードを出さず他の表示が出る（AC-7）・403 にしたとき `/setup` は `setup-forbidden` を出す（AC-8）、`PUT /meta/settings/company.profile` と `PUT /meta/settings/inventory.auto_receipt_on_purchase` を 500 にしたとき入力が残り段階が進まず状態を取り直す（AC-24、決定事項 13）（AC-1〜AC-10、AC-17〜AC-25、AC-27、AC-28）。`apps/web/e2e/company-admin.spec.ts` の作成後のボタンの文言と遷移先を `/setup` に合わせる（会社プロフィールの入力はウィザードの段階 1 の同じ `SettingCard` で行う）
7. 既存の試験への影響の確認: ホームにカードが増えるため、ホームを開くブラウザ試験（`smoke`・`a11y`・`navigation` など）と設定画面の「システム」タブの試験（`settings-console.spec.ts`）がそのまま通ること
8. `pnpm gate:full`（統合担当が実行）

## 未決事項（利用者の判断待ち）

- ホームのカードを「表示しない」にする操作を設けるか（既定: 設けない。要らない段階は理由付きでスキップする）。
- 勤怠・給与の段階を、従業員機能を使う会社だけに表示するか（既定: 常に任意として表示）。
- `packs.applied` にも `managedBy: { href: '/templates' }` を付けて設定画面での JSON 編集をやめるか（既定: この項目では変えない。B1 の判断を保つ）。
- 会社設定の `PUT` に版の検査（`expectedVersion`）を設けるか（既定: 設けない。`setup.progress` は判定に使わない補助情報で、同時の書込みは後勝ち）。
- seed が作る当年 1〜12 月の年度を、決算月に合わせた年度へ置き換える手段（1 年未満の年度、または未使用の年度の削除）を設けるか（既定: 設けない。既存の年度は変えず注記だけ）。
- 種類が「確認」の段階（勘定科目・税率）を、seed の値で条件を満たしていても管理者の確認（`completed`）まで未完了にするか（既定: しない。計画どおり実データで判定する）。

## 改訂の記録

- 2026-10-30（implementer、spec 批評への対応。下の表）
  - 採用: 1（カードは admin なら常に、`/meta/setup-status` を admin 以外は要求しない。AC-7・決定事項 19）、2（会計年度の継続の規則と (c)。AC-3）、3（`progress` を返して重ねる、記録の扱い。AC-5・AC-15・決定事項 5）、4（AC-8 は admin ロールの有無で隠す、403 は説明の表示。AC-8・AC-25）、6（会社の条件を明示、会社の無い Context は 404。AC-13）、7（「在庫を使う」の後の入庫の説明と、食い違いの表示。AC-4）、8（失敗の経路のブラウザ試験。検証 6）、9（計画からの逸脱を記録し、`fail` はスキップしてもカードに残す。状態の決め方・AC-7・決定事項 3）、10（免税事業者の扱いを製品の挙動として書く）、11（業種の目安の根拠を pack の実装とカタログに絞る）、12（`managedBy` のリンクは admin だけ。AC-12）、13（roving tabindex、`completed` は strict。AC-10・AC-11）。
  - 一部採用: 5（招待の後の説明は採用。招待された利用者の所属の編集を開く案は採らない: 受理前に所属を付けると `kernel/src/identity/invitations.ts` が招待の再発行を拒否し、既存の招待画面も「受理後に割り当てる」と案内しているため。AC-22）。

- 2026-10-30（spec writer、基点 `8d40672`。B1〜B3 の実装後の改訂）
  - AC-1〜AC-10 の番号と意味を保ち、文言を実装に合わせた: AC-2 に進捗の書込み先と各 API の権限、AC-3 に提案の規則と「既存の年度を変えない」、AC-4 に「使う」の保存内容と倉庫の確認、AC-5 に応答の形、AC-7 にカードの置き場所と失敗時の扱い、AC-8 に 403 と画面の説明、AC-10 にキー操作とフォーカス。
  - 段階 id と完了条件の表を追加（B3 の安定 id と `setup.*` の簡単な条件）。draft の「会計年度が今日を含む」は `accounting.fiscal_period` の `ok` に統一した。
  - AC-11〜AC-28 を追加: `setup.progress` の schema と表示属性、`managedBy`（ADR-0027 の帰結の未決への答え）、会社の分離、読取専用、状態の優先順位、点検の失敗、各段階の内容、保存の失敗、理由の検査、`/admin/companies` の導線、画面一覧とヘルプ。
  - 実装の確認で分かった事実を反映: 新しい会社には seed が当年 1〜12 月の会計年度・勘定科目・税率・倉庫 `MAIN`・見本の物品・勤怠の制度を作るため、段階 2・3・4・6・9 は作成直後から `done` になりうる。`/admin/users` の操作はテナント管理者だけ（`assertAccessAdmin`）。`AccessCreateUser` は所属を付けない。`TemplateCard` は未 export。設定画面に未保存の確認は無い（`SettingCard` に `onDirtyChange` が要る）。
  - 「関係するファイル」を実在のファイル・関数名に更新し、判定の置き場所を `apps/api/src/setup-status.ts` に決めた（draft の `apps/api/src/routes/setup-status.ts` だけでは純粋関数の単体試験の置き場が無かった）。
  - 未決事項の「段階 (9) の表示」は既定（常に任意）を決めごとに移し、新しい未決事項を足した。
