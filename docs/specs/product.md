# Spec: product（品目マスタ）＋ uom（単位）

- 状態: approved ／ モジュール: modules/product ／ 依存: なし（kernel のみ）
- ADR: 0002, 0003, 0007, 0010 ／ 作成: 2026-09-10
- **H1 計測対象**: この spec と CLAUDE.md だけを渡された新規セッションのエージェントが実装する。

## 目的
販売・購買の対象（物品・サービス）と単位を持つ。税は「税区分」（カテゴリ）で持ち、率は tax モジュールが日付で解決する（率×期間の原則）。在庫評価・BOM は扱わない（Phase 3）。

## 受入基準（EARS）
- AC-1 WHEN a uom is created THE SYSTEM SHALL require a unique `code` (per company) and `name`; seed the standard units 個, 式, 時間, kg, 箱 idempotently.
- AC-2 WHEN a product is created with only `name` THE SYSTEM SHALL default `kind='goods'`, `taxCategory='standard'`, `isActive=true`, `isSold=true`, `isPurchased=true`, `uomId`= the company's 個 uom.
- AC-3 WHEN `code` is provided THE SYSTEM SHALL enforce uniqueness per company and immutability.
- AC-4 WHEN `salePrice` / `purchasePrice` are provided THE SYSTEM SHALL store them as Decimal (strings on the API) and reject negatives.
- AC-5 WHEN `taxCategory` is set THE SYSTEM SHALL accept only `standard | reduced | exempt | non_taxable | out_of_scope` (課税10% / 軽減8% / 免税 / 非課税 / 不課税; docs/domain/japan-tax.md).
- AC-6 WHILE a user has role `viewer` THE SYSTEM SHALL allow read only; `sales` and `purchasing` may read/create/update; `admin` all.
- AC-7 WHEN `product.list` is called with `search` THE SYSTEM SHALL match `name`, `nameKana`, `code`.
- AC-8 WHEN `product.resolve_price` is called with `{ productId, side: 'sale'|'purchase' }` THE SYSTEM SHALL return `{ price, taxCategory, uomId }` (price null when unset).
- AC-9 WHEN the module is seeded THE SYSTEM SHALL create 3 sample products idempotently (a goods item, a service item, a reduced-rate food item).

## フィールド
**uom**: code (text, required, unique, immutable, maxLength 10), name (text, required), symbol (text, maxLength 10). displayField name. permissions: viewer read; sales/purchasing read/create/update; admin all.

**product**: code (text, unique, immutable, maxLength 30), name (text, required, maxLength 200), nameKana (text, normalize halfwidth-kana), kind (enum goods/service, default goods, required), taxCategory (enum standard/reduced/exempt/non_taxable/out_of_scope, default standard, required), uomId (ref uom, required), salePrice (money, min '0'), purchasePrice (money, min '0'), isSold (bool default true required), isPurchased (bool default true required), isActive (bool default true required), description (text multiline). views: list = code, name, kind, taxCategory, salePrice; search = name, nameKana, code; form = [[code, name, nameKana], [kind, taxCategory, uomId], [salePrice, purchasePrice], [isSold, isPurchased, isActive], [description]].

## 関係するファイル
modules/product/{package.json, tsconfig.json}（既存 partner と同じ形。deps: @daifuku/kernel, zod のみ）, src/index.ts, src/module.ts（name 'product', depends []）, src/entities/{uom,product}.ts, src/actions/resolve-price.ts, src/seeds/{uoms,products}.ts, test/product.db.test.ts（AC-1..9）。テスト DB: `daifuku_test_product`。

## スコープ外
価格表・数量割引（Phase 3 pricing）、在庫（Phase 3）、バリアント、画像。

## 検証手順
`pnpm gate`; apps/api の modules.ts に `import '@daifuku/mod-product'` を追加（依存順: partner の後）し、`pnpm db:generate && pnpm db:reset` で 0001 マイグレーションが生成・適用される。
