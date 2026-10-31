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

## 雛形から始める

新しい pack は生成器から始める（[spec](../specs/pack-scaffold.md)）。`packs/example` を手で写さない（ext key・ラベル上書き・設定が衝突する）。

```sh
node scripts/pack-new.mjs bike-shop --label-ja 自転車店 --label-en "Bike shop"            # 生成だけ
node scripts/pack-new.mjs bike-shop --register --label-ja 自転車店 --label-en "Bike shop" # 登録の 4 編集まで
node scripts/pack-new.mjs bike-shop --dry-run --register                                    # 何も書かずに一覧・差分・手順
```

- **名前**: kebab-case・2〜24 文字（`bike-shop` → pack `bike_shop`、package `@daifuku/pack-bike-shop`、export `BikeShopPack`、ext key `bikeShopNote`）。予約名 `pack`・`packs`・`all`・`none`・`kernel`・`company`・`constructor`・`missing` と、既存の module・pack・entity・ext key・sample の取引先コード（`BIKE_SHOP-0001`。同じコードの取引先が既にあると sample が作成を飛ばす）・カタログのキー・package 名・spec と衝突する名前は拒否され、何も書かれない（静的な走査。factory が組み立てる名前は import 時の kernel の `Conflict` が最終判定）。
- **ラベル**: `--label-en` を省くと名前の title case（`Bike Shop`）、`--label-ja` を省くと英語と同じ文字列になり警告と spec の `TODO:` が出る。日本語名は必ず決め、`src/pack.ts`（pack・ext の備考・メニュー）、`src/entities/<name>-tag.ts`（一覧画面の題名）、spec の 3 か所を直す。
- **生成物**: `packs/<name>/`（`package.json`・`tsconfig.json` は `packs/example` から、`src/index.ts`・`src/pack.ts`・`src/entities/<name>-tag.ts`・`src/actions/count-tags.ts`・`src/seed.ts`・`src/sample.ts`・`test/pack.db.test.ts`）と `docs/specs/pack-<name>.md`（AC-1〜AC-7 と `TODO:` の記入欄）。中身は partner の ext 1 項目、小さなマスタ 1 つとメニュー、読取の action 1 つ、冪等な seed、1 回だけの sample。生成した DB テストは規約の「テスト」節の最低限と、権限・会社・未適用会社・拠点限定の境界を確かめる。設定・ラベル上書き・hooks・伝票は生成しない（`packs/example`・`packs/restaurant-chain` を見て足す）。`.ts` は固定の Prettier で整形済み。
- **書込**: すべての検査と出力の計算を終えてから、`node_modules/.cache/pack-new/` で組み立てて `packs/<name>` へ名前を変える。途中の失敗（1 ファイルの書込が途中で切れた場合を含む）や Ctrl-C ではその実行が作ったものを消し、編集を戻す。戻せなかったパスがあれば一覧を出す。

**登録の 4 編集**（`--register` が行う。付けなければ貼り付けられる行を表示する）。`--register` は生成と同時にしか使えない（生成器を再実行すると `packs/<name>` などがあるので拒否される）。生成だけした pack を後から登録するときは、表示された行（または下の表）で 4 か所を手で編集する:

| ファイル | 編集 | 理由 |
| --- | --- | --- |
| `apps/runtime/src/packs.ts` | `AVAILABLE` の最後に `bike_shop: async () => (await import('@daifuku/pack-bike-shop')).BikeShopPack,` | runtime catalog（ADR-0017）。schema 生成も全登録 pack を読む |
| `apps/runtime/package.json` | `dependencies` の最後に `"@daifuku/pack-bike-shop": "workspace:*"` | 動的 import はこの依存と `pnpm install` でしか解決しない |
| `apps/runtime/test/runtime.test.ts` | AC-3 の `expect(schema.packs).toEqual([` の配列の最後に `'bike_shop',` | カタログを完全一致で固定するテスト |
| `apps/web/e2e/workforce.spec.ts` | `利用できる業界テンプレート <N> 種` を `<N+1>` に | `/templates` は `example` 以外の pack を数える（gate:full のブラウザ試験） |

**順序**（生成器が番号付きで表示する。順番を変えない）:

1. 登録（上の 4 編集。`--register` を付けなかったときは手で行う）。未登録で試すときは飛ばしてよいが、後で登録したら 2 をやり直す。
2. `pnpm install`（新しい workspace package の link と lockfile。登録の編集の後に実行する）。
3. 登録した後で `pnpm db:generate pack_<snake名>`（例 `pack_bike_shop`。pack の entity の表。`apps/api/test/migrations.db.test.ts`・`industry-templates.db.test.ts`・`ext-index-migration.db.test.ts`・`boolean-migration.db.test.ts` は未生成の差分があると落ちる）。
4. `pnpm --filter @daifuku/pack-<name> typecheck` と `pnpm exec vitest run --project db packs/<name>/test/pack.db.test.ts`。
5. `pnpm gate:light`（新しい `package.json`・lockfile・migration で DB 全件に昇格する）。完了と言う前に `pnpm gate:full`（`pnpm gate` にブラウザ試験を足したもの。4 番目の編集の件数は `workforce.spec.ts` を実行するこの段でしか確かめられない）。
6. 任意: `.env` の `DAIFUKU_PACKS`、`apps/web/src/lib/templates.ts` の説明、`apps/web/src/lib/navigation-data.ts` の業務分野（無ければ「その他」）、`docs/manual`、作業記録、spec の `TODO:`。
7. 適用: `pnpm pack:apply <snake名> --sample` または `/templates`。

**片付け**（試しに作った pack をコミットせずに消す）: `git restore apps/runtime/src/packs.ts apps/runtime/package.json apps/runtime/test/runtime.test.ts apps/web/e2e/workforce.spec.ts pnpm-lock.yaml apps/api/drizzle`、`git clean -nd -- apps/api/drizzle` で確認してから `git clean -fd -- apps/api/drizzle`（生成した migration と snapshot）、`rm -rf packs/<name> docs/specs/pack-<name>.md`、`pnpm install --frozen-lockfile`、`git status --short` に未追跡のパスが残っていないこと。

**テンプレートの保守**: `scripts/test/pack-new.test.ts`（unit）が生成物の型検査を、`scripts/test/pack-new.db.test.ts`（DB）が生成した DB テストの実行を毎回行う。登録・migration 生成・画面での適用は自動試験に含まれないので、台帳 [`PV-PACK-SCAFFOLD-01`](../verification/invariants.md) にリンクしたファイル（テンプレート、`kernel/src/pack.ts` などの適用・権限・meta・試験基盤）を変えたとき（`check-assurance --changed` が再確認を表示する）や登録先のファイルの形を変えたときは、spec の検証手順 4（登録して `gate:light` と画面での適用）をやり直し、作業記録に残す。

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
- **entities**: テーブルができるので、登録後に `pnpm db:generate pack_<snake名>` で migration を生成する（「apps への追加」3。番号が統合時に衝突したら統合担当が作り直す）。テスト（`freshDb`）はレジストリからスキーマを作るので生成前でも動く。
- **settings**: キーは登録済みの設定（`depends` の module が宣言したもの、または pack の `hooks` で `registry.registerSetting` したもの）で、値は schema を通ること。検査は適用時（未登録キー・不正値は `ValidationError`、何も書かれない）。会社が既に値を持つキーは上書きしない。
- **pack 自身の設定**（`hooks` で `registerSetting` するもの）: 設定画面の「業界」タブに出る。object の設定は全 property に日英の `fields` ラベルを、enum には `valueLabels` を書き、`default` に `getSetting` の fallback と同じ値を書く（[ADR-0027](../adr/0027-setting-presentation.md)、[UI 規約「会社設定の画面」](ui.md)）。科目コードの細目は `widget: 'account-code'`。書き忘れは `apps/runtime/test/setting-labels.test.ts` が落とす。
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
1. 上の「登録の 4 編集」を行う（`node scripts/pack-new.mjs <name> --register` なら済み）。`apps/runtime/src/packs.ts` のカタログに動的importを足し（ADR-0017）、API/MCPの個別一覧を増やさない。
2. 編集の後に `pnpm install` を実行する（`apps/runtime/package.json` の依存を link する。lockfile が並行ブランチと衝突したら統合担当が再実行する）。
3. エンティティを足したら `pnpm db:generate pack_<snake名>` で migration を生成する（番号が統合時に衝突したら統合担当が作り直す。作業記録に書く）。

## テスト
- `packs/<p>/test/*.db.test.ts`、専用 DB を `TEST_DATABASE_URL_OWNER` / `TEST_DATABASE_URL` で指定。
- 最低限: 適用で設定・seed が入る／2 回目は書き込みゼロ（行の version・設定・監査件数が変わらない）／`force` の挙動／ext の検証エラーと `ext.<key>` の一覧フィルタ／pack のアクション／`appMeta(ctx, { appliedPacks })` にラベルと `source: 'pack:<p>'` の extFields が出る。
- 計測（H3）: 作業記録に pack の行数（`src/`）と、pack のために触ったコア（kernel/modules）の差分行数を書く。

## Webの入口

`/templates` に説明・導入状態・サンプル選択を表示する。`apps/web/src/lib/templates.ts` に業界の説明を追加する。会社ごとの適用状況はpack.listを利用し、既存設定を変更するforceは通常の導入UIで送らない。

menuの `entity` は標準入力画面、`route: /r/<action>` は表形式レポート、`route: /a/<action>` は業務アクション入力画面にする。アクション入力は `serviceId` / `seasonId` 等の意味のある参照名と日本語のschema titleを宣言する。Webはcore entityを優先し、見つからなければ `<action.module>_<参照名>` に解決する。

認証情報はタブ単位のsessionStorageへ保存し、以前のlocalStorage認証を自動で引き継がない。会社切替はテンプレート画面で行う。選択もユーザー別・タブ別のsessionStorageへ保存し、切替時にページとクエリキャッシュを作り直す。他のタブで編集中の伝票の送信先を変えない。現在のアクセス権はtenant単位であり、店舗別や会社別のユーザー所属を実装したものではない。
