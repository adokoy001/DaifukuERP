# Spec: settings-console（設定定義の表示属性と設定画面の再構成）

- 状態: implemented
- モジュール: `kernel`（registry の `SettingDef`、`setting-presentation.ts`、`settings.ts`）、`apps/api/src/routes/settings.ts`、`apps/web/src/pages/settings-page.tsx`、各 module / pack の設定定義 ／ 依存: [ui-kit](ui-kit.md)（D1）
- ADR: [ADR-0027](../adr/0027-setting-presentation.md)（設定定義の表示属性。B2 の会社プロフィール、B4 の `setup.progress` を後で追記）を新規作成。[ADR-0013](../adr/0013-hexagonal-ports.md) の L1 に追記
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) B1。実装: 2026-10-29 agent（B1 実装セッション、ブランチ `wip/settings-console`）。実装で変えた点は「未決事項」の末尾に記録した

## 目的（1段落）

会社設定は module が `registry.registerSetting` で宣言し、汎用の設定画面が JSON Schema からフォームを作る。従来は key ごとのカードが登録順に並び、細目名は JSON Schema の `title` が無いため英語の field 名（`receivable`、`Mode`）を humanize した表示になり、boolean・enum の単一値の設定は JSON の入力欄だった。勘定科目コードは文字列で手入力し、会社に値が無いときの既定値も見えない（[マニュアル 03](../manual/03-setup.md)）。初期設定と日常の変更を、経理担当者が日本語のラベルと選択肢で迷わず行えるよう、設定定義に表示属性を持たせ、画面を分類・選択式・既定値表示・履歴付きに作り替える。

## 受入基準（EARS）

- AC-1 THE SYSTEM SHALL `SettingDef` に任意の `category`（`company | accounting | tax | sales | purchase | inventory | contract | workforce | industry | integration | system`）、`order`（整数）、`fields`（object schema の property 名 → `{ label: Label; description?: Label; widget?: 'account-code' | 'warehouse-code' | 'textarea'; valueLabels?: Record<enum 値, Label> }`）を受け付ける。単一値（string / number / boolean / enum）の設定は `fields` の代わりに定義の直下の `widget` と `valueLabels` を受け付ける。`default` は module の `getSetting` の fallback と同じ値を書く。
- AC-2 IF `fields` に object schema に存在しない property 名がある、または schema が固定 property の object でない（単一値・record・配列）のに `fields` がある、`widget` / `valueLabels` を object schema に付けた、ラベルに `ja` / `en` の片方が無い、未知の `category` / `widget`、整数でない `order`、string 以外への `widget`、enum に無い `valueLabels` の key、schema を通らない `default` THEN THE SYSTEM SHALL 登録時に定義エラー（plain `Error`、[エラー規約](../conventions/errors.md)の定義の誤り）を投げ、その定義を登録しない。property 名と enum 値は API と同じ `z.toJSONSchema(schema, { io: 'input' })` から読む。
- AC-3 WHEN `category` が未指定 THE SYSTEM SHALL key の先頭 segment から既定の分類を決める（`company`→company、`tax`→tax、`sales`→sales、`purchase`→purchase、`payment`→accounting、`accounting`→accounting、`inventory`→inventory、`contract`→contract、`workforce`→workforce、`packs`→system、その他の pack/業界 key→industry）。
- AC-4 WHEN `GET /meta/settings` が呼ばれた THE SYSTEM SHALL 既存の `key / label / description / schema / value` に加えて `category`（解決済み）、`order`、`fields`、`widget`、`valueLabels`（定義にあるとき）、`defaultValue`（定義に `default` があるとき）、`isDefault`（会社に保存値が無いとき true）を返す。
- AC-5 WHEN `DELETE /meta/settings/:key` が admin または settings ロールから呼ばれた THE SYSTEM SHALL 会社の保存値を削除し、`company_settings` の監査に op `delete`、変更前の値と `null` を記録し、AC-4 と同じ形の結果を返す。未宣言の key は 404、保存値が無い場合は変更も監査もせずに同じ結果を返す。
- AC-6 WHEN `GET /meta/settings/:key/audit` が admin または settings ロールから呼ばれた THE SYSTEM SHALL その key を変更した直近 20 件の監査（時刻・op・操作者（同じ tenant の利用者なら名前）・その key の変更前・変更後）を新しい順に返す。未宣言の key は 404。
- AC-7 IF 要求者の所属が店舗・拠点限定（`accessScope` が `stores` / `sites`）か、admin でも settings ロールでもない THEN THE SYSTEM SHALL 一覧・保存・削除・履歴をすべて拒否する（既存の `PUT` と同じ境界。kernel の `setSetting` / `deleteSetting` / `settingHistory` も同じ検査をする）。
- AC-8 WHEN 設定画面を開いた THE SYSTEM SHALL 設定がある分類だけをタブとして表示し、各タブ内を `order`、次に現在の言語のラベル順で並べる。選択中のタブは URL の `?tab=` に保持し、表示中のタブに無い値は先頭のタブにする。タブは kit `Tabs` のキーボード操作（← → Home End、roving tabindex）に従う。
- AC-9 WHEN 細目を描画する THE SYSTEM SHALL `fields` のラベルと説明・enum 値のラベルを現在の言語で表示し、`fields` に無い細目だけ従来の humanize 表示にする。単一値の設定は設定のラベルを付けた 1 つの入力にする。
- AC-10 WHEN `widget` が `account-code` THE SYSTEM SHALL 有効な勘定科目から「コード 名称」で選ばせ、保存値はコード文字列とする。保存値が有効な科目に存在しないときは値を残したまま警告を表示する。科目の一覧を読めないときはコードの直接入力にする。`warehouse-code` は倉庫について同様とする。boolean はチェックボックス、enum は選択肢、`textarea` は複数行入力、record・配列は JSON 入力とする。
- AC-11 WHILE 会社に保存値が無い THE SYSTEM SHALL カードに「既定値を使用中」と既定値を表示し、入力欄を既定値から始める。WHEN 保存値があるカードで「既定に戻す」を kit の `Dialog` で確認した THE SYSTEM SHALL AC-5 を呼び、画面を更新する。既定値の宣言が無い JSON 入力の設定（`packs.applied`）には「既定に戻す」を出さない。保存値が定義に合わないときは警告を表示する。
- AC-12 WHEN カードの「変更履歴」を開いた THE SYSTEM SHALL AC-6 の結果を時刻・op・操作者・変わった細目の「変更前 → 変更後」で表示する。
- AC-13 THE SYSTEM SHALL このリポジトリで登録されるすべての object 型設定について、全 property の日本語・英語ラベルを `fields` に持ち、すべての enum（object の property と単一値）について全値の日英ラベルを持つ（単体試験で全 module・全 pack を読み込んだ registry を走査して検査する）。
- AC-14 THE SYSTEM SHALL 設定画面を [UI キット](ui-kit.md) の部品で構成し、390px 幅で横方向のはみ出しなく操作できる。

## 関係するファイル・インターフェース（名指し）

- kernel: `kernel/src/registry.ts`（`SettingDef`、`registerSetting` が `checkSettingDef` を呼ぶ）、`kernel/src/setting-presentation.ts`（新規: `SETTING_CATEGORIES`、`SETTING_WIDGETS`、`defaultSettingCategory`、`settingCategory`、`settingShape`、`checkSettingDef`）、`kernel/src/settings.ts`（`deleteSetting`、`settingHistory` を追加。権限は `setSetting` と同じ関数）
- api: `apps/api/src/routes/settings.ts`（`toOut` の拡張、`DELETE`、`GET .../audit`）
- web: `apps/web/src/api/settings.ts`（`useResetSetting`、`useSettingHistory`、`useCodeOptions`）、`apps/web/src/api/types.ts`（`SettingMeta`、`SettingChange`）、`apps/web/src/lib/schema.ts`（`fields` の反映）、`apps/web/src/lib/settings-console.ts`（新規: タブ・並び・フォームの形・既定値と履歴の文）、`apps/web/src/components/setting-card.tsx`・`setting-code-field.tsx`（新規）、`apps/web/src/pages/settings-page.tsx`、`apps/web/src/router.tsx`（`?tab=`）
- modules: `modules/tax/src/services/settings.ts`、`modules/{sales,purchase,payment,inventory,contract}/src/settings.ts`、`modules/industry-operations/src/engine.ts`（`<pack>.due_days`）、`packs/{example,retail,real-estate}/src/settings.ts`。`kernel/src/pack.ts` の `packs.applied` は key の先頭から system になり、record なので `fields` を持たない
- tests: `kernel/test/setting-presentation.test.ts`（AC-1〜AC-3）、`apps/runtime/test/setting-labels.test.ts`（AC-13）、`apps/web/src/lib/settings-console.test.ts`（AC-8〜AC-12 の純粋部分）、`apps/api/test/settings-console.db.test.ts`（AC-4〜AC-7）、`apps/web/e2e/settings-console.spec.ts`（AC-8〜AC-14）
- docs: [ADR-0027](../adr/0027-setting-presentation.md)、[マニュアル 03](../manual/03-setup.md)（設定画面の説明と表、英語細目名の注意を削除）、[UI 規約](../conventions/ui.md)（Tabs の注記、会社設定の画面）、[pack 規約](../conventions/packs.md)

## データ・業務ルール（出典）

- 業務値の意味は既存の各 module の設定定義と [マニュアル 03](../manual/03-setup.md) に従う。制度値の追加・変更はない。各定義に足した `default` は、その module が `getSetting` に渡していた fallback 定数と同じ値である（`SALES_ACCOUNTS_DEFAULT`、`PURCHASE_ACCOUNTS_DEFAULT`、`PAYMENT_ACCOUNTS_DEFAULT`、`TAX_ROUNDING_DEFAULT`、`INVENTORY_SETTING_DEFAULTS`、`CONTRACT_*_DEFAULT`、`CLOSING_ACCOUNTS_DEFAULT`、`REAL_ESTATE_ACCOUNTS_DEFAULT`、`DEFAULT_RANK`、業種の `config.dueDays`）。

## スコープ外（明記）

- 会社プロフィール `company.profile` と会社の追加（[実装計画](../completion-plan.md) B2）
- 設定値の一括インポート・エクスポート、設定の承認フロー
- 設定 key の改名・移行
- 存在しない科目・倉庫コードを `PUT` で拒否すること（転記時の `INVALID_STATE` と画面の警告で扱う。ADR-0027「却下した案」）
- 読取専用の設定の表示属性（B4 の `setup.progress` と合わせて検討）

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`（kernel を変更するため DB 全件へ昇格する）
2. 単体: `fields` 検査（AC-1、AC-2）、既定分類（AC-3）、全設定のラベル走査（AC-13）、schema → 画面項目の変換・タブと並び・既定値と履歴の文（AC-8〜AC-12）
3. DB: `GET` の新属性、`DELETE` と監査、履歴（20 件の上限・新しい順・操作者名）、店舗・拠点限定・権限なしの拒否（route と kernel の両方）（AC-4〜AC-7）
4. ブラウザ: タブ切替と URL、← → Home End、勘定科目ピッカーで売上転記科目を変更して保存、存在しないコードの警告、既定に戻す（Esc で取りやめ・実行）、履歴表示、チェックボックス・倉庫・選択肢・複数行、英語表示、390px（AC-8〜AC-14）。`e2e-run.sh <worktree> 2 e2e/settings-console.spec.ts e2e/ui-kit.spec.ts e2e/navigation.spec.ts --project=chromium`
5. `pnpm gate:full`（統合担当が実行）

## 未決事項（利用者の判断待ち）

- pack の設定を「業界」タブにまとめるか、pack ごとのタブにするか（初版はまとめる）。
- `packs.applied` のような記録用の設定を画面で読取専用にするか（現状は JSON で編集でき、「既定に戻す」だけを出さない）。

### 実装で変えた点（計画時の draft からの差分）

- AC-1: 単一値の設定（`inventory.default_warehouse`、`contract.default_proration`、boolean の設定）には `fields` を付けられない（AC-2）ため、定義の直下に `widget` / `valueLabels` を足した。enum の選択肢を日本語にするため `fields` にも `valueLabels` を足した（目的の「選択肢で迷わず」）。計画にあった widget の `checkbox` / `select` は、schema の型（boolean / enum）から決まるので持たない。
- AC-2: 検査対象に、ラベルの日英・未知の category / widget・整数でない order・widget の型・`valueLabels` の値・`default` の schema 適合を足した。property 名は zod の内部構造ではなく、API が返すのと同じ JSON Schema 変換から読む。
- AC-3: `company` → company を足した（B2 の `company.profile` が明示しなくても会社タブに入る）。
- AC-4: 単一値用の `widget` / `valueLabels` を返す。
- AC-5: 監査の op を `delete` にした（`update` と区別して履歴に「既定に戻す」と出すため）。会社行を `FOR UPDATE` で読んでから消す。
- AC-6: 操作者の名前（同じ tenant の利用者の `name` のみ、メールは返さない）と op を足した。履歴の対象は、key を変更前か変更後の snapshot に持つ `company_settings` の監査（pack 適用・seed の書込みも含む）。
- AC-9 / AC-10: 単一値の設定を JSON 入力ではなく 1 つの入力（boolean はチェックボックスで必須印なし）にした。科目の一覧は利用者自身の権限で `GET /api/account?where={"isActive":true}` から読み（新しい読取経路を作らない）、読めないときはコード入力に戻る。一覧は 500 件まで（超えたら表示で知らせる）。
- AC-11: 既定値の宣言が無い JSON の記録（`packs.applied`）には「既定に戻す」を出さない。消すと会社の全テンプレートが無効になるため（従来の JSON 編集は残す）。リセット後はボタンが消えるので焦点をそのカードの「保存」に移す。保存値が定義に合わないときの警告を足した。各 module / pack の定義に `default` を足した（画面に既定値を出すため。applyPack は保存値を上書きしないので挙動は変わらない）。
- AC-13: enum 値のラベルも検査対象にした。走査は `apps/runtime` の `loadRuntime({ schema: true })` で全 pack を読み込む。
