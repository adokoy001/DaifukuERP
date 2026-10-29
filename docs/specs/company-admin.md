# Spec: company-admin（会社の追加・編集と会社プロフィール）

- 状態: draft
- モジュール: `kernel`（会社作成、`company.profile` 設定）、`apps/api`（`/admin/companies`）、`apps/web`（`/admin/companies`）、`modules/sales`（請求書の発行者の既定） ／ 依存: [settings-console](settings-console.md)（B1 の `SettingDef.fields`）、[ui-kit](ui-kit.md)
- ADR: ADR-0029（会社作成と初期データ投入の境界）を新規作成。`company.profile` の表示属性は ADR-0027 に追記
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) B2

## 目的（1段落）

最初の会社と管理者は `pnpm run setup install` が作るが、2 社目以降を作る画面も API も無い。連結精算・FC 精算・会社切替があるのに、会社を増やすには開発用の手順に頼るしかない。また住所・電話・登録番号などの会社情報は、請求書の発行者設定（`sales.issuer`）にしか無く、申告や給与の資料が同じ出典を参照できない。テナント管理者が画面から会社を追加・編集でき、新しい会社に初期データ（勘定科目・税率・会計年度など）が入り、会社情報が 1 か所にまとまるようにする。

## 受入基準（EARS）

- AC-1 WHEN テナント管理者が `POST /admin/companies { code, name, country?, currency? }` を呼んだ THE SYSTEM SHALL 同じトランザクションで会社を作成し、作成者に `admin` ロールの所属を付け、登録済み module の `seed` を新会社の system context で実行し、監査に記録して、作成した会社を返す。`country` の既定は `JP`、`currency` の既定は `JPY`。
- AC-2 IF 要求者がテナント管理者でない、または有効でない THEN THE SYSTEM SHALL 会社の作成・編集を拒否する。
- AC-3 IF `code` がテナント内で重複する、または形式（英大文字・数字・`_`・`-`、1〜20 文字）に合わない THEN THE SYSTEM SHALL 作成せずに検証エラーを返す。
- AC-4 WHEN テナント管理者が `PATCH /admin/companies/:id { name?, country? }` を呼んだ THE SYSTEM SHALL 会社名・国を更新し、監査に変更前後を記録する。`code` と `currency` は作成後に変更できない。
- AC-5 WHEN テナント管理者が `GET /admin/companies` を呼んだ THE SYSTEM SHALL テナントの全会社（コード・名称・国・通貨・作成日時・自分の所属の有無）を返す。
- AC-6 THE SYSTEM SHALL kernel が会社設定 `company.profile`（正式名称、郵便番号、住所、電話、メール、適格請求書発行事業者の登録番号 `T`+13 桁、課税区分、決算月 1〜12、代表者名）を `category: 'company'` と全細目の日英ラベル付きで登録する。
- AC-7 WHEN `sales.issuer` が未設定で適格請求書を表示した THE SYSTEM SHALL `company.profile` の正式名称（無ければ会社名）・登録番号・住所・電話・メールを発行者として印字する。`sales.issuer` が設定済みならそれを優先する。
- AC-8 WHEN 会社設定画面を開いた THE SYSTEM SHALL 「会社」タブの先頭に会社プロフィールを表示する（B1 の設定画面の仕組みで描画）。
- AC-9 WHEN テナント管理者が `/admin/companies` で会社を作成した THE SYSTEM SHALL 一覧を更新し、作成した会社へ切り替える操作と、初期設定（会社プロフィール・会計年度）への導線を表示する。会社ピッカーは作成後の会社を候補に含める。
- AC-10 IF 初期データの投入中に失敗した THEN THE SYSTEM SHALL 会社・所属・投入データをすべて巻き戻し、原因を返す。
- AC-11 THE SYSTEM SHALL 画面の文言を日本語と英語で持ち、390px 幅で操作できる。

## 関係するファイル・インターフェース（名指し）

- kernel: 会社作成（`kernel/src/company-admin.ts` 新規、または既存の access 系に追加）、`kernel/src/company-profile.ts`（設定定義）、`kernel/src/index.ts`
- api: `apps/api/src/routes/access-admin.ts`（または新規 `company-admin.ts`）、module seed の呼び出しは setup と同じ module 一覧（`apps/api/src/modules.ts`）を使う
- web: `apps/web/src/pages/companies-page.tsx`（新規）、`apps/web/src/router.tsx`、`apps/web/src/lib/navigation-data.ts`（`tenant-admin` 条件）、`apps/web/src/components/company-picker.tsx`
- modules: `modules/sales` の請求書 HTML の発行者解決
- docs: `docs/adr/0029-company-creation.md`、`docs/manual/08-admin.md`、`docs/manual/appendix-e-operations-control.md`、`docs/manual/03-setup.md`

## データ・業務ルール（出典）

- 登録番号の形式（`T` + 13 桁）— [日本の制度事実](../domain/japan-tax.md) のインボイス制度（国税庁 タックスアンサー No.6625）。実在照合は行わない。

## スコープ外（明記）

- 会社の削除・無効化、テナントの作成、会社間のデータ移動・複製
- 会社ロゴ、複数通貨の業務（`currency` は保存するが業務は JPY のまま）
- 申告・給与資料の読取元を `company.profile` へ切り替えること（参照先の差し替えは各資料の仕様で扱う）

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`（kernel を変更するため DB 全件へ昇格）
2. DB: 作成で seed が入ること（勘定科目・税率・会計年度の件数）、所属、監査、テナント管理者以外の拒否、重複コード、失敗時の巻戻し、更新の監査（AC-1〜AC-5、AC-10）
3. 単体または DB: 発行者の解決順（AC-7）
4. ブラウザ: 2 社目の作成 → 切替 → 会社プロフィール入力 → 売上請求書の印刷に反映、非管理者には画面が出ない、390px（AC-8〜AC-11）
5. `pnpm gate:full`

## 未決事項（利用者の判断待ち）

- 新会社に業界テンプレートを作成時に選ばせるか（初版は作成後のウィザードで選ぶ）。
