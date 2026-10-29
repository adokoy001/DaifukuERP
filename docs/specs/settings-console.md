# Spec: settings-console（設定定義の表示属性と設定画面の再構成）

- 状態: draft
- モジュール: `kernel`（registry の `SettingDef`）、`apps/api/src/routes/settings.ts`、`apps/web/src/pages/settings-page.tsx`、各 module の設定定義 ／ 依存: [ui-kit](ui-kit.md)（D1）
- ADR: ADR-0027（設定定義の表示属性。B2 の会社プロフィールと共有）を新規作成
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) B1

## 目的（1段落）

会社設定は module が `registry.registerSetting` で宣言し、汎用の設定画面が JSON Schema からフォームを作る。現在は key ごとのカードが登録順に並び、細目名は JSON Schema の `title` が無いため英語の field 名（`receivable`、`Mode`）を humanize した表示になる。勘定科目コードは文字列で手入力し、会社に値が無いときの既定値も見えない（[マニュアル 03](../manual/03-setup.md)）。初期設定と日常の変更を、経理担当者が日本語のラベルと選択肢で迷わず行えるよう、設定定義に表示属性を持たせ、画面を分類・選択式・既定値表示・履歴付きに作り替える。

## 受入基準（EARS）

- AC-1 THE SYSTEM SHALL `SettingDef` に任意の `category`（`company | accounting | tax | sales | purchase | inventory | contract | workforce | industry | integration | system`）、`order`（整数）、`fields`（object schema の property 名 → `{ label: Label; description?: Label; widget?: 'account-code' | 'warehouse-code' | 'textarea' }`）を受け付ける。
- AC-2 IF `fields` に object schema に存在しない property 名がある、または schema が object でないのに `fields` がある THEN THE SYSTEM SHALL 登録時に定義エラーを投げる（内部の定義ミスとして、[エラー規約](../conventions/errors.md) に従う）。
- AC-3 WHEN `category` が未指定 THE SYSTEM SHALL key の先頭 segment から既定の分類を決める（`tax`→tax、`sales`→sales、`purchase`→purchase、`payment`→accounting、`accounting`→accounting、`inventory`→inventory、`contract`→contract、`workforce`→workforce、`packs`→system、その他の pack/業界 key→industry）。
- AC-4 WHEN `GET /meta/settings` が呼ばれた THE SYSTEM SHALL 既存の `key / label / description / schema / value` に加えて `category`、`order`、`fields`、`defaultValue`（定義に `default` があるとき）、`isDefault`（会社に保存値が無いとき true）を返す。
- AC-5 WHEN `DELETE /meta/settings/:key` が admin または settings ロールから呼ばれた THE SYSTEM SHALL 会社の保存値を削除し、`company_settings` の監査に変更前の値と `null` を記録し、AC-4 と同じ形の結果を返す。未宣言の key は 404、保存値が無い場合は変更せずに同じ結果を返す。
- AC-6 WHEN `GET /meta/settings/:key/audit` が admin または settings ロールから呼ばれた THE SYSTEM SHALL その key を変更した直近 20 件の監査（時刻・操作者・変更前・変更後）を新しい順に返す。
- AC-7 IF 要求者の所属が店舗・拠点限定（`accessScope` が `stores` / `sites`）か、admin でも settings ロールでもない THEN THE SYSTEM SHALL 一覧・保存・削除・履歴をすべて拒否する（既存の `PUT` と同じ境界）。
- AC-8 WHEN 設定画面を開いた THE SYSTEM SHALL 設定がある分類だけをタブとして表示し、各タブ内を `order`、次に現在の言語のラベル順で並べる。選択中のタブは URL の `?tab=` に保持する。
- AC-9 WHEN 細目を描画する THE SYSTEM SHALL `fields` のラベルと説明を現在の言語で表示し、`fields` に無い細目だけ従来の humanize 表示にする。
- AC-10 WHEN `widget` が `account-code` THE SYSTEM SHALL 有効な勘定科目から「コード 名称」で選ばせ、保存値はコード文字列とする。保存値が科目に存在しないときは警告を表示する。`warehouse-code` は倉庫について同様とする。boolean の細目はチェックボックス、`textarea` は複数行入力とする。
- AC-11 WHILE 会社に保存値が無い THE SYSTEM SHALL カードに「既定値を使用中」と既定値を表示する。WHEN 保存値があるカードで「既定に戻す」を確認した THE SYSTEM SHALL AC-5 を呼び、画面を更新する。
- AC-12 WHEN カードの「変更履歴」を開いた THE SYSTEM SHALL AC-6 の結果を時刻・操作者・変更の要約で表示する。
- AC-13 THE SYSTEM SHALL このリポジトリで登録されるすべての object 型設定について、全 property の日本語・英語ラベルを `fields` に持つ（単体試験で registry を走査して検査する）。
- AC-14 THE SYSTEM SHALL 設定画面を [UI キット](ui-kit.md) の部品で構成し、390px 幅で横方向のはみ出しなく操作できる。

## 関係するファイル・インターフェース（名指し）

- kernel: `kernel/src/registry.ts`（`SettingDef`、`registerSetting` の検査）、`kernel/src/settings.ts`（`deleteSetting` を追加。権限と監査は `setSetting` と同じ）、`kernel/src/audit.ts`（`auditTrail` を `company_settings` で使う）
- api: `apps/api/src/routes/settings.ts`（`toOut` の拡張、`DELETE`、`GET .../audit`）
- web: `apps/web/src/api/settings.ts`、`apps/web/src/api/types.ts`（`SettingMeta`）、`apps/web/src/pages/settings-page.tsx`、`apps/web/src/lib/schema.ts`（fields ラベルの反映）
- modules: `modules/{tax,sales,purchase,payment,inventory,contract}/src/**/settings.ts`、`modules/industry-operations/src/engine.ts`（`<pack>.due_days`）、`packs/{retail,real-estate,example,appliance-store}` の設定、`kernel/src/pack.ts`（`packs.applied`）
- docs: `docs/adr/0027-setting-presentation.md`、`docs/manual/03-setup.md`（設定表の更新と英語細目名の注意の削除）、`docs/conventions/ui.md`

## データ・業務ルール（出典）

- 業務値の意味は既存の各 module の設定定義と [マニュアル 03](../manual/03-setup.md) に従う。制度値の追加・変更はない。

## スコープ外（明記）

- 会社プロフィール `company.profile` と会社の追加（[実装計画](../completion-plan.md) B2）
- 設定値の一括インポート・エクスポート、設定の承認フロー
- 設定 key の改名・移行

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`（kernel を変更するため DB 全件へ昇格する）
2. 単体: `fields` 検査（AC-2、AC-13）、既定分類（AC-3）、schema → 画面項目の変換（AC-9）
3. DB: `GET` の新属性、`DELETE` と監査、履歴、店舗限定・権限なしの拒否（AC-4〜AC-7）
4. ブラウザ: タブ切替と URL、勘定科目ピッカーで売上転記科目を変更して保存、既定に戻す、履歴表示、390px（AC-8〜AC-14）
5. `pnpm gate:full`

## 未決事項（利用者の判断待ち）

- pack の設定を「業界」タブにまとめるか、pack ごとのタブにするか（初版はまとめる）。
