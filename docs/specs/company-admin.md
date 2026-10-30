# Spec: company-admin（会社の追加・編集と会社プロフィール）

- 状態: implemented（2026-10-30、[作業記録](../log/2026-10-30-company-admin.md)）
- モジュール: `kernel`（会社作成、`company.profile` 設定）、`apps/api`（`/admin/companies`）、`apps/web`（`/admin/companies`）、`modules/sales`（請求書の発行者の既定） ／ 依存: [settings-console](settings-console.md)（B1 の `SettingDef.fields`）、[ui-kit](ui-kit.md)
- ADR: ADR-0029（会社作成と初期データ投入の境界）を新規作成。`company.profile` の表示属性は ADR-0027 に追記
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) B2。2026-10-30 実装時に改訂（下の「実装時の確認と変更」）

## 目的（1段落）

最初の会社と管理者は `pnpm run setup install` が作るが、2 社目以降を作る画面も API も無い。連結精算・FC 精算・会社切替があるのに、会社を増やすには開発用の手順に頼るしかない。また住所・電話・登録番号などの会社情報は、請求書の発行者設定（`sales.issuer`）にしか無く、申告や給与の資料が同じ出典を参照できない。テナント管理者が画面から会社を追加・編集でき、新しい会社に初期データ（勘定科目・税率・会計年度など）が入り、会社情報が 1 か所にまとまるようにする。

## 受入基準（EARS）

- AC-1 WHEN テナント管理者が `POST /admin/companies { code, name, country?, currency? }` を呼んだ THE SYSTEM SHALL 同じトランザクションで会社を作成し、作成者に `admin` ロールの所属を付け、登録済み module の `seed` を新会社の system context で実行し、監査に記録して、作成した会社（`seededModules`: seed を実行した module 名の順序付き一覧を含む）を返す。`country` の既定は `JP`、`currency` の既定は `JPY`。module の一覧と順序は setup・`db:reset` と同じ runtime の一覧。
- AC-2 IF 要求者がテナント管理者でない、有効でない、または要求の所属が店舗・拠点限定である THEN THE SYSTEM SHALL 会社の一覧・作成・編集を拒否する（403）。
- AC-3 IF `code` がテナント内で重複する、形式（英大文字・数字・`_`・`-`、1〜20 文字）に合わない、`name` が空、`country` が英大文字 2 文字・`currency` が英大文字 3 文字でない、または未知の項目がある THEN THE SYSTEM SHALL 作成せずに検証エラー（400、項目ごとの issue）を返す。
- AC-4 WHEN テナント管理者が `PATCH /admin/companies/:id { name?, country? }` を呼んだ THE SYSTEM SHALL 会社名・国を更新し、監査に変更前後を記録する。`code` と `currency` は作成後に変更できない（本文に含めると、同じ値でも検証エラー）。別テナントの会社 id は 404。
- AC-5 WHEN テナント管理者が `GET /admin/companies` を呼んだ THE SYSTEM SHALL テナントの全会社（コード・名称・国・通貨・作成日時・自分の所属の有無）を返す。
- AC-6 THE SYSTEM SHALL kernel が会社設定 `company.profile`（正式名称、郵便番号、住所、電話、メール、適格請求書発行事業者の登録番号 `T`+13 桁、課税区分 `taxable | exempt`、決算月 1〜12、代表者名。すべて省略可）を `category: 'company'` と全細目の日英ラベル付きで登録する。登録番号の形式違い、免税事業者と登録番号の同時指定は保存しない。
- AC-7 WHEN `sales.issuer` が未設定で適格請求書を表示した THE SYSTEM SHALL `company.profile` の正式名称（無ければ会社名）・登録番号・郵便番号・住所・電話・メールを発行者として印字する。`sales.issuer` が設定済み（schema に合う値）ならそれを細目単位で混ぜずにまとめて優先する。schema に合わない保存値は未設定として扱う。
- AC-8 WHEN 会社設定画面を開いた THE SYSTEM SHALL 「会社」タブの先頭に会社プロフィールを表示する（B1 の設定画面の仕組みで描画）。
- AC-9 WHEN テナント管理者が `/admin/companies` で会社を作成した THE SYSTEM SHALL 一覧を更新し、作成した会社へ切り替える操作と、初期設定（会社プロフィール・会計年度）への導線を表示する。切り替える操作は会社ピッカーと同じ経路（保存した選択＋ページの再読込）で、切り替えた先の画面（`/settings?tab=company` または `/e/fiscal_year`）を開く。会社ピッカーは作成後の会社を候補に含める（ピッカーの取得結果を無効化して取り直す）。
- AC-10 IF 初期データの投入中に失敗した THEN THE SYSTEM SHALL 会社・所属・投入データをすべて巻き戻し、原因を返す。
- AC-11 THE SYSTEM SHALL 画面の文言を日本語と英語で持ち、390px 幅で操作できる。

## 関係するファイル・インターフェース（名指し）

- kernel: `kernel/src/company-admin.ts`（新規。`createCompany` / `updateCompany` / `listCompanies`）、`kernel/src/company-profile.ts`（新規。設定定義、`ensureCompanyProfileSetting`、`getCompanyProfile`、`companyProfileOf`）、`kernel/src/index.ts`
- runtime: `apps/runtime/src/index.ts`（`loadRuntime` が `ensureCompanyProfileSetting()` を呼ぶ）
- api: `apps/api/src/routes/company-admin.ts`（新規）、`apps/api/src/server.ts`。module seed は setup と同じ module 一覧（`apps/api/src/modules.ts`）を渡す
- web: `apps/web/src/pages/companies-page.tsx`（新規）、`apps/web/src/api/companies.ts`（新規）、`apps/web/src/lib/companies.ts`（新規。検証と導線）、`apps/web/src/router.tsx`、`apps/web/src/lib/navigation-data.ts`（`tenant-admin` 条件）、`apps/web/src/lib/help.ts`。会社ピッカー（`components/company-picker.tsx`）は変更しない: 作成・改名で `['companies']` の取得結果を無効化して取り直す
- modules: `modules/sales/src/actions/render-invoice-html.ts`（`resolveIssuer` / `loadIssuer`）、`modules/sales/src/settings.ts`（説明文）
- docs: `docs/adr/0029-company-creation.md`（新規）、`docs/adr/0027-setting-presentation.md`（§6 追記）、`docs/manual/08-admin.md`、`docs/manual/appendix-e-operations-control.md`、`docs/manual/03-setup.md`

## データ・業務ルール（出典）

- 登録番号の形式（`T` + 13 桁）— [日本の制度事実](../domain/japan-tax.md) のインボイス制度（国税庁 タックスアンサー No.6625）。実在照合は行わない。

## スコープ外（明記）

- 会社の削除・無効化、テナントの作成、会社間のデータ移動・複製
- 会社ロゴ、複数通貨の業務（`currency` は保存するが業務は JPY のまま）
- 申告・給与資料の読取元を `company.profile` へ切り替えること（参照先の差し替えは各資料の仕様で扱う）

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`（kernel を変更するため DB 全件へ昇格）
2. DB: 作成で seed が入ること（勘定科目・税率・会計年度の件数）、所属、監査、テナント管理者以外の拒否、重複コード、失敗時の巻戻し、更新の監査、RLS とテナント分離（AC-1〜AC-6、AC-10）— `kernel/test/company-admin.db.test.ts`、`apps/api/test/company-admin.db.test.ts`
3. 単体と DB: 発行者の解決順（AC-7）— `modules/sales/test/issuer.test.ts`、`apps/api/test/company-admin.db.test.ts`
4. ブラウザ: 2 社目の作成 → 切替 → 会社プロフィール入力 → 売上請求書の印刷に反映、非管理者には画面が出ない、390px、axe（AC-8〜AC-11）— `apps/web/e2e/company-admin.spec.ts`
5. `pnpm gate:full`（統合担当が実行）

## 実装時の確認と変更（2026-10-30）

- **RLS の確認結果**: `companies` は tenant の RLS policy（`for all`、`using` / `with check` とも `tenant_id = app.tenant_id`、FORCE RLS）を持ち、app role（`daifuku_app`）には `SELECT, INSERT, UPDATE, DELETE` が付与されている（`kernel/src/db/migrate.ts` の `enforcePolicies`。除外は `tenants` と `identity_rate_limits` だけ）。app role には `tenants` の権限が無い（`has_table_privilege('daifuku_app','tenants','SELECT') = false` を試験 DB で確認）が、外部キー検査は参照先表の所有者の権限で行われるので、要求のトランザクションから自テナントの会社行を挿入できる。別テナントの `tenant_id` の挿入は `with check` で失敗し、別テナントの会社は読めない（kernel の DB 試験）。**したがって owner 接続は使わず、setup とは経路を共有しない**。共有したのは「同じ module 一覧・同じ順序・同じ `systemParams(tenantId, companyId)` で seed を呼ぶ」部分。詳細は ADR-0029。
- **トランザクション**: setup は module ごとに確定して checkpoint するが、会社作成は全体を 1 トランザクションにした（失敗時に会社だけ残ると、削除の手段が無いため。AC-10）。
- **作成者の既定の会社**: 作成者に既定の会社が無ければ新しい会社にする（`putCompanyMembership` と同じ扱い）。
- **監査**: `company`（create / update、変更前後は会社の公開属性）と `company_membership`（create）。seed が書く記録の監査は actor `system`。
- **切替は自動にしない**: 計画は「作成後はその会社へ切り替え」だったが、続けて複数の会社を作る操作を妨げないよう、作成後の枠に「切り替えて会社プロフィールを入力」「切り替えて会計年度を確認」を出す（AC-9）。B4 のウィザードができたら導線を `/setup` に差し替える（`apps/web/src/lib/companies.ts` の `SETUP_DESTINATIONS`）。
- **一覧の「所属」**: owner 接続で作られた会社（業界デモなど）には作成者の所属が無いので、`member: false`（テナント管理者としては全社を扱える）と表示する。
- **AC-8 の並び**: `company.profile` は `order: 0`。現在 `company` 分類の設定はこれだけなので、会社タブは設定画面の先頭のタブになり、その先頭の枠になる。
- **`company.profile` の登録**: kernel の設定なので module の import では登録されない。`packs.applied` と同じく、apps/runtime の `loadRuntime` が `ensureCompanyProfileSetting()` を呼ぶ。
- **axe**: 共有の `a11y.spec.ts` の画面一覧（8 画面 × 2 言語 × 2 幅の件数を単体試験が固定している）は変えず、`company-admin.spec.ts` の中で同じ判定（`a11y-policy.ts` の `judge` と例外ファイル）を `/admin/companies` に適用した。

## 未決事項（利用者の判断待ち）

- 新会社に業界テンプレートを作成時に選ばせるか（初版は作成後に「業界テンプレート」画面で選ぶ。B4 のウィザードで案内する）。
- 新しい会社にも見本の取引先 3 件・品目（partner / product の seed）が入る。setup の初回の会社と同じ動作に揃えたが、本番の会社では見本を入れない選択肢を設けるか（seed とサンプルの分離は module 側の変更になる）。
- 作成後に自動で新会社へ切り替えるか（初版は切り替える操作を表示するだけ。上の「実装時の確認と変更」）。
