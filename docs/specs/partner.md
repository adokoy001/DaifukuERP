# Spec: partner（取引先マスタ）

- 状態: approved
- モジュール: modules/partner ／ 依存: なし（kernel のみ）
- ADR: 0002, 0003, 0007, 0010, 0011
- 作成: 2026-09-10 ／ 作成者: Claude（アーキテクト役）

## 目的
顧客・仕入先・その他の相手先を1つのマスタで持つ。日本の商習慣（締め日・支払サイト、適格請求書発行事業者の登録番号、免税/課税区分、半角カナの振込名義）を Day 1 で表現する。Phase 0 の「1エンティティ貫通」の題材であり、H1 の1点目として計測する。

## 受入基準（EARS）
- AC-1 WHEN a partner is created with only `name` THE SYSTEM SHALL create it with `isCustomer=false`, `isSupplier=false`, `taxStatus='registered'`, `isActive=true`, `closingDay=31`, `paymentMonthOffset=1`, `paymentDay=31`.
- AC-2 WHEN `invoiceRegistrationNo` is provided THE SYSTEM SHALL accept only the form `T` + 13 digits and reject anything else with a VALIDATION error naming the field.
- AC-3 WHEN `nameKana` or `bankAccountHolderKana` is provided THE SYSTEM SHALL store it normalised to half-width katakana, upper-cased (全銀フォーマット要件; docs/domain/japan-tax.md#商習慣).
- AC-4 WHEN `code` is provided THE SYSTEM SHALL enforce uniqueness per company and immutability after create.
- AC-5 WHEN `closingDay`/`paymentDay` is provided THE SYSTEM SHALL accept 1..31 where 31 means 月末; `paymentMonthOffset` accepts 0..3.
- AC-6 WHILE a user has only role `viewer` THE SYSTEM SHALL allow read and deny create/update/delete.
- AC-7 WHILE a user has role `sales` THE SYSTEM SHALL allow read/create/update; `purchasing` the same; `accounting` read/update/export; `admin` everything.
- AC-8 WHEN `partner.list` is called with `search` THE SYSTEM SHALL match on `name`, `nameKana`, `code`.
- AC-9 WHEN the module is seeded for a company THE SYSTEM SHALL create 3 sample partners idempotently (no duplicates on re-run).
- AC-10 WHEN `partner.compute_due_date` is called with `{ partnerId, invoiceDate }` THE SYSTEM SHALL return the payment due date computed from the partner's closing day / month offset / payment day (月末 handling: 31 clamps to the month's last day; a date within the closing period belongs to that period).

## フィールド
| name | kind | 制約 | label ja/en |
|---|---|---|---|
| code | text | unique, immutable, maxLength 20 | 取引先コード / Code |
| name | text | required, maxLength 200 | 名称 / Name |
| nameKana | text | normalize halfwidth-kana, maxLength 100 | カナ名称 / Name (kana) |
| isCustomer | bool | default false, required | 顧客 / Customer |
| isSupplier | bool | default false, required | 仕入先 / Supplier |
| invoiceRegistrationNo | text | pattern ^T\d{13}$ | 登録番号 / Invoice registration no. |
| taxStatus | enum registered/exempt | default registered, required | 課税区分 / Tax status |
| closingDay | int 1..31 | default 31, required | 締め日 / Closing day |
| paymentMonthOffset | int 0..3 | default 1, required | 支払月 / Payment month offset |
| paymentDay | int 1..31 | default 31, required | 支払日 / Payment day |
| postalCode | text | pattern ^\d{3}-?\d{4}$ | 郵便番号 / Postal code |
| prefecture | text | maxLength 10 | 都道府県 / Prefecture |
| address1 | text | maxLength 200 | 住所1 / Address 1 |
| address2 | text | maxLength 200 | 住所2 / Address 2 |
| phone | text | maxLength 30 | 電話 / Phone |
| email | text | maxLength 200 | メール / Email |
| bankName | text | maxLength 100 | 銀行名 / Bank |
| bankBranch | text | maxLength 100 | 支店 / Branch |
| bankAccountType | enum ordinary/current/savings | | 預金種目 / Account type |
| bankAccountNo | text | pattern ^\d{1,7}$ | 口座番号 / Account no. |
| bankAccountHolderKana | text | normalize halfwidth-kana, maxLength 30 | 口座名義カナ / Account holder (kana) |
| notes | text | multiline | 備考 / Notes |
| isActive | bool | default true, required | 有効 / Active |

views: list = code, name, nameKana, isCustomer, isSupplier, taxStatus; search = name, nameKana, code; form = [[code, name, nameKana], [isCustomer, isSupplier, isActive], [invoiceRegistrationNo, taxStatus], [closingDay, paymentMonthOffset, paymentDay], [postalCode, prefecture, address1, address2, phone, email], [bankName, bankBranch, bankAccountType, bankAccountNo, bankAccountHolderKana], [notes]]

## 関係するファイル・インターフェース
- kernel: `defineEntity`, `defineAction`, `defineModule`, `f`, `repo`, `Decimal` は使わない（金額項目なし）。
- modules/partner/src/entities/partner.ts, src/actions/compute-due-date.ts, src/services/due-date.ts（純粋関数）, src/seeds/partners.ts, src/module.ts, src/index.ts
- test/due-date.test.ts（unit + property）, test/partner.db.test.ts

## データ・業務ルール（出典）
- 登録番号 T+13桁 — docs/domain/japan-tax.md（国税庁 公表サイト、確認 2026-09-10）
- 半角カナ名義 — docs/domain/japan-tax.md#商習慣（全銀フォーマット）
- 締め日・支払サイト — docs/domain/japan-tax.md#商習慣

## スコープ外
- 公表サイト Web-API による登録番号の実在確認（Phase 1, l10n/jp）
- 取引先ごとの価格表・与信（Phase 1 pricing/accounting）
- 取引先の担当者（contacts）子エンティティ（Phase 1）

## 検証手順
1. `pnpm gate` が通る。
2. `pnpm db:reset` の後 `pnpm dev:api` を起動し、`POST /auth/login` → `POST /api/partner` で AC-1〜5 を curl で確認。
3. MCP ツール `partner_list` が一覧を返す。
4. 画面 `/e/partner` で一覧・作成・編集ができる。

## 未決事項
- なし
