# pack の書き方（業種・顧客テンプレート）

設計の理由は ADR-0015。ここは「どう書くか」だけ。実例は `packs/example`（全機能を 1 回ずつ使う最小の pack）。

## module か pack か
判断基準: **他業種でも要るなら module、この業種（この顧客）だけなら pack。**

| 例 | 置き場所 | 理由 |
|---|---|---|
| 在庫、契約、入出金 | module | 小売でも不動産でも製造でも要る |
| 取引先に「顧客ランク」「JAN コード」を足す | pack（`ext`） | 業種固有の項目。コアの列にしない |
| 物件・区画のような業種固有の小さなマスタ | pack（`entities`） | 他業種は使わない。大きくなって他業種も使い始めたら module に昇格 |
| 業種の既定の端数処理・勘定科目 | pack（`settings` / `seed`） | module が宣言した設定の既定値を業種で変えるだけ |
| 取引先を「得意先/仕入先」と呼ぶ | pack（`labels`） | 表示だけの差 |
| 請求書の採番・税計算の差し替え | pack の `hooks` で `registry.registerOverride` | module が公開した差し替え点がある場合だけ。無ければ module に差し替え点を足す（ADR-0008） |
| 日本の法令ルール | l10n/jp | 国の差は業種の差ではない |

迷ったら pack に書き、2 つ目の pack が同じものを必要とした時点で module に移す（作業記録に「昇格」と書く）。

## 構成
```
packs/<p>/
  package.json            name: @daifuku/pack-<p>。dependencies に kernel と depends の module/pack
  src/index.ts            公開 API（Pack の export。apps はこれを import するだけ）
  src/pack.ts             definePack({...})
  src/entities/*.ts       defineEntity（1 ファイル 1 エンティティ）
  src/actions/*.ts        defineAction
  src/settings.ts         pack 自身が宣言する設定（あれば）
  src/seed.ts             冪等なマスタ
  src/sample.ts           デモデータ
  test/*.db.test.ts       専用 DB（daifuku_test_packs 等）で実行
```

## definePack
```ts
import { definePack, f, label, registry } from '@daifuku/kernel';
import { PartnerModule } from '@daifuku/mod-partner';   // 先に import して登録させる
import { TaxModule } from '@daifuku/mod-tax';           // settings の tax.rounding を宣言している module

export const RetailPack = definePack({
  name: 'retail',                          // snake_case。module と同じ名前空間。`pack` は予約
  label: label('小売', 'Retail'),
  version: '0.1.0',                        // packs.applied に記録される
  depends: [PartnerModule.name, TaxModule.name], // ext/labels の対象エンティティの module はここから辿れること
  ext: { partner: { janCode: f.text({ label: label('JAN', 'JAN'), searchable: true }) } },
  entities: [RetailStore],                 // エンティティ名は `<pack>_` で始める（全体で一意）
  actions: [storeSummaryAction],           // `retail.<verb_object>`
  hooks: () => { registry.registerSetting(RETAIL_SETTING); },
  settings: { 'tax.rounding': { mode: 'down', unit: 'invoice' } },
  labels: { partner: { entity: label('得意先', 'Customer'), fields: { name: label('店舗名', 'Store name') } } },
  menus: [{ label: label('店舗', 'Stores'), entity: 'retail_store', order: 80 }],
  seed: seedRetail,
  sample: sampleRetail,
});
```

- **名前**: pack 名・エンティティ名・設定キーの前半は snake_case、ext キーは camelCase（ADR-0014。`customer_rank` ではなく `customerRank`）。
- **定義エラーは import 時に出る**（全部通るまで何も登録しない）。hint を読んで直す。
- **ext**: `required` を付けない（既存データへの導入時に不足する）。既定値は付けられないので、要るなら `before_validate` フックで入れる。範囲検索・並び替えが要る項目は ext ではなく pack のエンティティの列にする。
- **ext の索引**: text の `equalityIndex: true` は完全一致 / IN 用の内部計算列と tenant/company 付き非 unique B-tree を作る。追加時は全 pack を読んで新規 migration を生成する。`searchable: true` は部分一致検索への参加指定であり、索引を作らない。通常リクエストや会社への pack 適用で DDL を実行しない。先頭ゼロ・長い既存値・全文比較を保持する方式と導入時のロックは [ADR-0026](../adr/0026-ext-equality-indexes.md) を参照。
- **entities**: テーブルができるのでマイグレーション生成が要る（統合時に本体が `pnpm db:generate`）。テスト（`freshDb`）はレジストリからスキーマを作るので生成前でも動く。
- **settings**: キーは登録済みの設定（`depends` の module が宣言したもの、または pack の `hooks` で `registry.registerSetting` したもの）で、値は schema を通ること。検査は適用時（未登録キー・不正値は `ValidationError`、何も書かれない）。会社が既に値を持つキーは上書きしない。
- **labels**: 会社に適用されたパックだけを反映する。同じ会社で複数のパックが同じラベルを指定した場合は登録順に解決されるため、業種のデモは別会社へ分ける。ext 項目のラベルは ext 定義に書く。
- **hooks**: definePackのhooksで登録したフック・差し替え・購読は、現在の会社の適用scopeで実行される（ADR-0016）。未適用会社へ波及しない。固有アクション・エンティティも未適用なら拒否される。特別な条件を加える場合も現在のContextを保つ:
  ```ts
  registry.registerHook('partner', 'before_validate', async (ctx, { row }) => {
    if (!(await readAppliedPacks(ctx)).retail) return;
    // ...
  });
  ```
- **seed**: 冪等に書く（コードで存在確認してから `repo().create`）。`force` で再実行される。
- **sample**: 会社ごとに 1 回だけ実行される（`force` なら再実行）。安全のため既存コードは飛ばす書き方を推奨。
- **禁止**: drizzle / postgres / fastify / node:fs の import（ADR-0013。lint で落ちる）、コア module の `src/` 内部の import、module を書き換えて pack の都合を入れること。

## 適用
- CLI: `pnpm pack:apply <name> [--company <companyId>] [--sample] [--force]`（既定の会社は tenant名Demo・会社コードDEMO・admin@example.comが一意に一致する会社。曖昧なら拒否する）。結果（書いた設定・seed/sample を実行したか・記録）を JSON で出す。
- API / MCP: `POST /actions/pack.apply { name, sample?, force? }`（admin）、`POST /actions/pack.list`（適用状況）。`GET /meta` の `packs[].applied`。
- 導入済みでサンプル追加もforceも指定しない再適用は何もしない（`alreadyApplied: true`、書き込みゼロ）。未追加のサンプルは `sample: true` で後から一度追加できる。version を上げても自動では再適用しない。既存設定の上書きを含む再導入は `force` の明示操作になる。

## apps への追加
1. `apps/runtime/src/packs.ts` のカタログに動的importを足す（ADR-0017）。API/MCPの個別一覧を増やさない。
2. `apps/runtime/package.json` のdependenciesに `@daifuku/pack-<p>` を足す（`pnpm install` は統合担当が実行）。
3. エンティティを足したらマイグレーション生成を本体に依頼する（作業記録に書く）。

## テスト
- `packs/<p>/test/*.db.test.ts`、専用 DB を `TEST_DATABASE_URL_OWNER` / `TEST_DATABASE_URL` で指定。
- 最低限: 適用で設定・seed が入る／2 回目は書き込みゼロ（行の version・設定・監査件数が変わらない）／`force` の挙動／ext の検証エラーと `ext.<key>` の一覧フィルタ／pack のアクション／`appMeta(ctx, { appliedPacks })` にラベルと `source: 'pack:<p>'` の extFields が出る。
- 計測（H3）: 作業記録に pack の行数（`src/`）と、pack のために触ったコア（kernel/modules）の差分行数を書く。

## Webの入口

`/templates` に説明・導入状態・サンプル選択を表示する。`apps/web/src/lib/templates.ts` に業界の説明を追加する。会社ごとの適用状況はpack.listを利用し、既存設定を変更するforceは通常の導入UIで送らない。

menuの `entity` は標準入力画面、`route: /r/<action>` は表形式レポート、`route: /a/<action>` は業務アクション入力画面にする。アクション入力は `serviceId` / `seasonId` 等の意味のある参照名と日本語のschema titleを宣言する。Webはcore entityを優先し、見つからなければ `<action.module>_<参照名>` に解決する。

認証情報はタブ単位のsessionStorageへ保存し、以前のlocalStorage認証を自動で引き継がない。会社切替はテンプレート画面で行う。選択もユーザー別・タブ別のsessionStorageへ保存し、切替時にページとクエリキャッシュを作り直す。他のタブで編集中の伝票の送信先を変えない。現在のアクセス権はtenant単位であり、店舗別や会社別のユーザー所属を実装したものではない。
