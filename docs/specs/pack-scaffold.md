# Spec: pack-scaffold（pack 雛形生成 `scripts/pack-new.mjs`）

- 状態: draft
- モジュール: `scripts/`（`pack-new.mjs`・`pack-new.d.mts`・`pack-template/`・`test/pack-new.test.ts`）。生成先は `packs/<name>/` と `docs/specs/pack-<name>.md`、`--register` のときだけ `apps/runtime/`（`src/packs.ts`・`package.json`・`test/runtime.test.ts`） ／ 依存: [pack](pack.md)（`definePack`・`applyPack`・`pack.apply`／`pack.list`）、[test-tiers](test-tiers.md)（`gate:light` と昇格規則）、[db-test-startup](db-test-startup.md)（`freshDb()` の schema テンプレート）
- ADR: 新規 ADR なし（開発用の生成スクリプトであり、kernel・DSL・権限・読み書きの経路を変えない）。関連: [ADR-0013](../adr/0013-hexagonal-ports.md)、[ADR-0015](../adr/0015-packs.md)、[ADR-0016](../adr/0016-foundation-invariants.md)、[ADR-0017](../adr/0017-runtime-and-schema-catalog.md)
- 作成: 2026-10-30 ／ 作成者: agent（B7 spec 作成セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) B7。作業記録（実装後）: `docs/log/2026-10-30-pack-scaffold.md`

## 目的（1段落）

新しい業種・顧客の pack を足すには、現在は `packs/example` を手で写し、名前を 10 か所以上書き換え、`apps/runtime/src/packs.ts` と `apps/runtime/package.json` に登録し、`pnpm install` と migration 生成を行い、登録で期待値が変わる既存テスト（`apps/runtime/test/runtime.test.ts` のカタログ一覧、`apps/api/test/migrations.db.test.ts` の migration 同期）に気付く必要がある。どれか 1 つを忘れると gate が落ち、原因が pack の外に見える。`node scripts/pack-new.mjs <name>` 1 回で、規約（[pack の書き方](../conventions/packs.md)）どおりの最小 pack・その DB テスト・spec の下書きを作り、残りの手順を順番どおりに表示し（`--register` なら登録の編集まで行い）、生成物に手を入れずに `pnpm gate:light` が通る状態から作業を始められるようにする。対象は pack を追加する開発者・エージェント（第三者を含む）であり、業務利用者向けの画面は増やさない。

## 用語と導出する名前

入力 `<name>` は kebab-case（例 `bike-shop`）。以下では `<k>` = 入力そのもの、`<s>` = `-` を `_` に置き換えた snake_case（`bike_shop`）、`<P>` = PascalCase（`BikeShop`）、`<c>` = camelCase（`bikeShop`）と書く。

| 用途 | 値 | 例（`bike-shop`） |
| --- | --- | --- |
| ディレクトリ | `packs/<k>` | `packs/bike-shop` |
| package 名 | `@daifuku/pack-<k>` | `@daifuku/pack-bike-shop` |
| pack 名（`definePack.name`、カタログのキー、`DAIFUKU_PACKS` の値、action・entity の接頭辞） | `<s>` | `bike_shop` |
| pack の export | `<P>Pack` | `BikeShopPack` |
| entity（小さなマスタ、code・name） | `<s>_tag` ／ export `<P>Tag` ／ ファイル `src/entities/<k>-tag.ts` | `bike_shop_tag` |
| action（読取のみ） | `<s>.count_tags` ／ export `countTagsAction` ／ ファイル `src/actions/count-tags.ts` | `bike_shop.count_tags` |
| partner の ext key | `<c>Note`（text、`searchable`、200 文字） | `bikeShopNote` |
| sample の取引先コード | `<CODE>-0001`（`<CODE>` = `<s>` から `_` を除いて大文字にした先頭 12 文字。partner の `code` は 20 文字まで） | `BIKESHOP-0001` |
| spec | `docs/specs/pack-<k>.md` | `docs/specs/pack-bike-shop.md` |
| migration 名（登録時） | `pack_<s>` | `pack_bike_shop` |

## 受入基準（EARS）

### 生成（`scripts/pack-new.mjs`）

- AC-1 WHEN `node scripts/pack-new.mjs <name>` を妥当な名前で実行した THE SYSTEM SHALL 次の 10 ファイルだけを作り、それ以外のファイルを作成・変更しない（`packs/example` を含む既存の pack・module・apps は読むだけ）: `packs/<k>/package.json`、`packs/<k>/tsconfig.json`、`packs/<k>/src/index.ts`、`packs/<k>/src/pack.ts`、`packs/<k>/src/entities/<k>-tag.ts`、`packs/<k>/src/actions/count-tags.ts`、`packs/<k>/src/seed.ts`、`packs/<k>/src/sample.ts`、`packs/<k>/test/pack.db.test.ts`、`docs/specs/pack-<k>.md`。終了コードは 0。
- AC-2 THE SYSTEM SHALL 上表の名前を入力から導出して全出力に埋め込み、どの出力にもテンプレートの置換記号（`__PACK_` で始まる記号）を残さない。生成した `src/pack.ts` は `definePack({ name: '<s>', label, version: '0.1.0', depends: [PartnerModule.name], ext: { partner: { <c>Note } }, entities: [<P>Tag], actions: [countTagsAction], menus: [{ label: label('タグ', 'Tags'), entity: '<s>_tag', order: 90 }], seed, sample })` とし、`settings`・`labels`・`hooks` は含めない（下記「決定」D3）。
- AC-3 THE SYSTEM SHALL `packs/<k>/package.json` を `packs/example/package.json` から作る: `name` は `@daifuku/pack-<k>`、`version` `0.0.1`、`private`・`type`・`exports`（`./src/index.ts`）・`scripts.typecheck` は example と同じ、`dependencies` は `@daifuku/kernel` と `@daifuku/mod-partner`（`workspace:*`）と `zod`（example と同じ範囲指定）、`devDependencies` は `@types/node`・`typescript`・`vitest`（example と同じ範囲指定）。2 空白の JSON に末尾改行。`packs/<k>/tsconfig.json` は `packs/example/tsconfig.json` と同一の内容にする。生成物の依存は example の依存の部分集合である。
- AC-4 THE SYSTEM SHALL 生成・編集したすべての `.ts` ファイルを、リポジトリに固定した Prettier（ルートの devDependency）と `.prettierrc.json` で整形してから書き込み、`pnpm format` を実行しなくても `pnpm format:check` が通るようにする。JSON と Markdown は整形対象外（`format` の glob に含まれないため）。
- AC-5 THE SYSTEM SHALL `docs/specs/pack-<k>.md` を日本語で書き、[`docs/specs/_template.md`](_template.md) のすべての `## ` 見出しを同じ順で含め、状態 `draft`、生成日（ローカル日付 `YYYY-MM-DD`）、生成した pack の受入基準 AC-1〜AC-7（下記「生成する pack の契約」）を記入し、目的・業務の受入基準・出典・スコープ外・未決事項は `TODO:` で始まる記入欄にする。生成した DB テストの各 `it` の名前に含まれる `AC-n` は、この spec の AC-1〜AC-7 と 1 対 1 に対応する。
- AC-6 WHEN 生成が成功した THE SYSTEM SHALL 残りの手順を番号付きで標準出力に表示する: (1) `pnpm install`（新しい workspace package の link と lockfile 更新）、(2) `--register` を付けなかったときは登録の 3 編集（AC-7 の (a)〜(c)）を貼り付けられる行のまま、付けたときは「登録済み」、(3) 登録したときは `pnpm db:generate pack_<s>`（entity の表を足す migration。統合時に番号が衝突したら統合担当が作り直す）、(4) `pnpm --filter @daifuku/pack-<k> typecheck` と `pnpm exec vitest run --project db packs/<k>/test/pack.db.test.ts`（`TEST_DATABASE_URL_OWNER`／`TEST_DATABASE_URL` が必要）、(5) `pnpm gate:light`（新しい `package.json` で DB 全件に昇格する旨）、(6) 任意: `.env` の `DAIFUKU_PACKS` を絞っているなら `<s>` を加える、`apps/web/src/lib/templates.ts` の説明文、`apps/web/src/lib/navigation-data.ts` の業務分野（無ければ「その他」に出る）、利用者向けの手順を足すときの `docs/manual`、作業記録 `docs/log/`、spec の `TODO:` の記入、(7) 適用: `pnpm pack:apply <s> --sample` または画面 `/templates`。
- AC-7 WHEN `--register` を付けた THE SYSTEM SHALL AC-1 に加えて次の 3 ファイルだけを編集し、それぞれ挙げた差分以外を変えない: (a) `apps/runtime/src/packs.ts` の `AVAILABLE` の最後の項目として `<s>: async () => (await import('@daifuku/pack-<k>')).<P>Pack,` を足す（整形は AC-4）、(b) `apps/runtime/package.json` の `dependencies` の末尾に `"@daifuku/pack-<k>": "workspace:*"` を足す（他のキーの順序と値は不変、2 空白の JSON に末尾改行）、(c) `apps/runtime/test/runtime.test.ts` の AC-3 の期待するカタログ一覧（`expect(schema.packs).toEqual([` の配列）の末尾に `'<s>'` を足す。`pnpm install` と `pnpm db:generate` は実行しない（D6）。
- AC-8 WHEN `--dry-run` を付けた THE SYSTEM SHALL 作るファイルの一覧（パスと行数）、`--register` 時の編集の差分、AC-6 の手順を表示し、何も書き込まない。終了コードは 0（拒否の条件に当たれば AC-9〜AC-11 と同じ）。
- AC-9 IF 名前が無い、位置引数が 2 つ以上ある、未知の option がある、または `--label-ja`／`--label-en` に値が無い THEN THE SYSTEM SHALL 使い方を標準エラーに出して終了コード 2 で終わり、何も書き込まない。IF 名前が kebab-case（`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`）でない、2 文字未満または 24 文字を超える、予約名（`pack`・`all`・`none`・`kernel`・`constructor`・`missing`。D4）である、またはラベルが 1〜40 文字の制御文字を含まない文字列でない THEN THE SYSTEM SHALL 守るべき規則と直した例（例: `bike_shop` → `bike-shop`）を標準エラーに出して終了コード 1 で終わり、何も書き込まない。`..`・`/`・`\`・`.`・絶対パス・NUL・空白・大文字・非 ASCII を含む名前はこの規則で拒否され、加えて解決した生成先の実パスが `<root>/packs` の直下であることを書込前に確かめる（パストラバーサルの二重の防御）。
- AC-10 IF 次のいずれかに当たる THEN THE SYSTEM SHALL 当たったものをすべて列挙して標準エラーに出し、終了コード 1 で終わり、何も書き込まない: `packs/<k>` が既に存在する（ファイル・ディレクトリ・シンボリックリンクのいずれでも。`node_modules` だけ残ったディレクトリも含む）、いずれかの workspace package の `package.json` の `name` が `@daifuku/pack-<k>`、`<s>` が `kernel/`・`modules/`・`l10n/`・`packs/`・`apps/` の `.ts`（`node_modules`・`dist` を除く。テスト内の定義を含む）で `defineModule`／`definePack` の `name` として宣言済み、または `apps/runtime/src/packs.ts` の `AVAILABLE` のキー、`<s>` または `<s>_tag` が同じ範囲で `defineEntity`／`defineDocument` の `name` として宣言済み、`docs/specs/pack-<k>.md` が既に存在する。静的な走査で見つからない動的な名前（`packs/industry-catalog` のように factory が組み立てる entity 名）は、import 時の kernel の検査（`definePack`・`registerPack` の `Conflict`）が最終の判定になる。
- AC-11 IF `--register` を付け、(a)〜(c) の挿入位置（`const AVAILABLE` の object の閉じ括弧、`apps/runtime/package.json` の `dependencies`、`expect(schema.packs).toEqual([` から始まる配列）がそれぞれちょうど 1 か所に見つからない、または同じ項目が既にある THEN THE SYSTEM SHALL 該当ファイルと理由（「手で登録してください」と AC-6 (2) の行）を出して終了コード 1 で終わり、pack も含めて何も書き込まない（すべての検査と編集内容の計算を、最初の書込より前に終える）。
- AC-12 IF 書込の途中で失敗した THEN THE SYSTEM SHALL その実行で作ったファイルとディレクトリを消し、編集したファイルを元の内容に戻してから、失敗したパスと原因を出して終了コード 1 で終わる。pack のファイルはまず `packs/` 直下の一時ディレクトリ（`.pack-new-<k>-<pid>`）に書き、そろってから `packs/<k>` へ名前を変える。

### 生成する pack の契約（生成した DB テストで検証。括弧内は生成 spec・生成テストの AC 番号）

- AC-13（生成 AC-1）WHEN 生成した package を import した THE SYSTEM SHALL pack `<s>`（version `0.1.0`、depends `['partner']`）、partner の ext `<c>Note`（`source: 'pack:<s>'`）、pack が所有する entity `<s>_tag`、action `<s>.count_tags`（`mutates: false`、`tx: 'none'`、権限は `<s>_tag` の read）、派生 CRUD action（`<s>_tag.create` など）、メニューを登録する。
- AC-14（生成 AC-2、AC-3）WHEN 会社に初めて `applyPack(ctx, '<s>')` を実行した THE SYSTEM SHALL seed の 3 件のタグ（`standard`・`priority`・`inactive`）を作り、`packs.applied` に `{ at, version: '0.1.0' }` を記録し、sample は実行しない。2 回目の適用は何も書かない（タグの `version`、会社の settings、`company_settings` の監査件数が不変）。`force: true` は seed を再実行してもタグを重複させない。`sample: true` は sample の取引先 1 件（ext `<c>Note` 付き）を 1 回だけ作り、再度の `sample: true` では作らない。
- AC-15（生成 AC-4）THE SYSTEM SHALL 生成した pack の権限を次のとおりにする: `pack.apply` は admin のみ（`sales` は `PERMISSION_DENIED`）。タグの read と `<s>.count_tags` は `viewer` に許可し、`viewer` のタグ作成は `PERMISSION_DENIED`。タグに付与の無いロール（例 `accounting`）は一覧も `<s>.count_tags` も `PERMISSION_DENIED`。拠点限定の文脈（`accessScope: 'stores'`、`storeIds` あり）は `<s>.count_tags` を `PERMISSION_DENIED`（`storeAccess`／`siteAccess` を宣言しないため。kernel `checkActionPermission`）。いずれも読み書きは `repo(ctx, …)` と `runAction` を通し、`systemContext()` を使わない。
- AC-16（生成 AC-5）WHILE pack が会社 A と会社 B の両方に適用されている WHEN 会社 A でタグを 1 件作った THE SYSTEM SHALL 会社 B の一覧・件数・`<s>.count_tags` にそれを含めない。IF pack が適用されていない会社 C で、admin を含む利用者がタグの一覧・作成または `<s>.count_tags` を呼んだ THEN THE SYSTEM SHALL `PERMISSION_DENIED` とする（action は kernel `checkActionPermission` の `pack-not-applied`、entity は `can` の未適用判定。どちらも既存の kernel の振る舞いを生成テストで確かめるもの）。
- AC-17（生成 AC-6）IF partner を ext `<c>Note` が 200 文字を超える値で作ろうとした THEN THE SYSTEM SHALL `ValidationError`（`details.issues[].path` が `ext.<c>Note`）とし、何も書かない。WHEN `where: { 'ext.<c>Note': … }` で一覧した、または `search` で ext の文字列を検索した THE SYSTEM SHALL sample の取引先を返す。
- AC-18（生成 AC-7）WHEN 適用済みの会社で `appMeta(ctx, { appliedPacks })` を読んだ THE SYSTEM SHALL partner の `extFields` に `ext.<c>Note`（`source: 'pack:<s>'`、`searchable: true`）、`packs` に `{ name: '<s>', label, applied: true }`、module `<s>` のメニュー、entity `<s>_tag` を含める。未適用の会社では `applied: false` で、メニュー・entity・ext を含めない。

### gate と画面

- AC-19 WHEN `--register` を付けて生成し、表示された `pnpm install` と `pnpm db:generate pack_<s>` を実行した（生成したファイルは編集しない）THE SYSTEM SHALL `pnpm gate:light`（format:check、typecheck、API/Web typecheck、lint と依存境界、unit 全件（`apps/runtime/test/runtime.test.ts` を含む）、DB 全件（`apps/api/test/migrations.db.test.ts` の同期検査と生成 pack の DB テストを含む）、test:deploy、docs:check、台帳検査）と `pnpm --filter @daifuku/pack-<k> typecheck` を成功させる。WHEN `--register` なしで生成し `pnpm install` だけを実行した THE SYSTEM SHALL format:check、typecheck、lint（依存境界を含む）と生成 pack の DB テストを成功させる（未登録の pack は runtime が読まないので、migration は要らない）。
- AC-20 THE SYSTEM SHALL `scripts/test/pack-new.test.ts` で、一時ディレクトリに生成した `src/` と `test/` を現在の workspace に対して型検査する（生成先の `node_modules` を `packs/example/node_modules` へのシンボリックリンクにし、ルートの `tsc7` で `tsc -p packs/<k>/tsconfig.json --noEmit`）。kernel や partner の公開 API の変更でテンプレートが壊れたら `pnpm test` が落ちる。
- AC-21 WHEN 登録した pack を画面 `/templates` から会社に適用した THE SYSTEM SHALL その pack のカード（`templateStory` の既定の説明文、ラベルは日英で切替）を表示し、適用後に「タグ」／「Tags」のメニュー（業務分野「その他」）から汎用一覧 `/e/<s>_tag` を開いて seed の 3 件を表示する。日本語・英語、1280px と 390px で、ページとアプリのスクロール領域が横にはみ出さない（既存の汎用画面の性質の確認であり、画面のコードは変えない）。
- AC-22 THE SYSTEM SHALL [pack の書き方](../conventions/packs.md) に「雛形から始める」（コマンド、option、生成物、登録の 3 編集、`pnpm install`・`pnpm db:generate` が要る理由、片付け方）を足し、「apps への追加」を AC-7 の 3 編集と migration 生成に合わせる。[module・pack の拡張手順](../architecture/extension-guide.md) の手順 5 と「引継ぎを確認する記録」に雛形を入口として書き、エージェントによる生成・検証の実行は「第三者がこの手順だけで新しい pack を追加できること」の記録条件を満たさない（人間の第三者による導入実績ではない）ことを明記する。

## 関係するファイル・インターフェース（名指し）

- 新規 `scripts/pack-new.mjs`（Node ESM。依存はルートの `prettier` だけ）。公開する関数（`scripts/test/pack-new.test.ts` から使う。名前は実装時に変えてよいが、純粋な計画と書込を分ける）:
  - `parsePackNewArgs(argv)` → `{ name, register, dryRun, labelJa?, labelEn?, root }`。不正は `PackNewUsageError`（終了コード 2）。`--root <dir>` はテスト用（既定はスクリプトの位置から求めたリポジトリのルート）。
  - `packNames(kebab)` → 上表の名前一式。`validatePackName(kebab)` → 規則違反の一覧（AC-9）。
  - `findCollisions(root, names)` → 衝突の一覧（AC-10。書き込まない）。
  - `planPack({ root, names, labels, today, register })` → `{ files: { path, content }[], edits: { path, before, after }[], steps: string[] }`（Prettier の整形を含むため非同期。書き込まない）。
  - `writePlan(plan, root, io?)` → 一時ディレクトリへの書込・名前の変更・編集の適用と、失敗時の巻戻し（AC-12。`io` は失敗を注入するテスト用）。
  - `main(argv, { stdout, stderr })` → 終了コード（0 成功、1 拒否・失敗、2 使い方）。メッセージは英語（`scripts/gate.mjs` と同じ）。
- 新規 `scripts/pack-new.d.mts`（`scripts/gate.d.mts` と同じく、テストをルートの `pnpm typecheck` で検査するための型）
- 新規 `scripts/pack-template/`（置換記号入りのテンプレート。拡張子 `.tmpl` で Prettier・ESLint・tsc・vitest の対象外にする。内容は `packs/example` の同名ファイルの書き方に合わせる）:

  | テンプレート | 出力 |
  | --- | --- |
  | `src/index.ts.tmpl` | `packs/<k>/src/index.ts`（公開 API: `<P>Pack`、`<P>Tag`、`countTagsAction`、`SEED_TAGS`、`seed<P>`、`SAMPLE_PARTNER_CODES`、`sample<P>`） |
  | `src/pack.ts.tmpl` | `packs/<k>/src/pack.ts`（AC-2） |
  | `src/entities/tag.ts.tmpl` | `packs/<k>/src/entities/<k>-tag.ts`（`defineEntity`: `code`（required・unique・immutable・20 文字）、`name`（required・100 文字）、roles `sales: ['read','create','update']`・`viewer: ['read']`、`views.list`／`views.search`） |
  | `src/actions/count-tags.ts.tmpl` | `packs/<k>/src/actions/count-tags.ts`（`defineAction`: input `z.object({})`、output `{ count: int }`、`repo(ctx, <P>Tag).count()`） |
  | `src/seed.ts.tmpl` | `packs/<k>/src/seed.ts`（code で存在を確かめて `repo().create` する冪等な 3 件） |
  | `src/sample.ts.tmpl` | `packs/<k>/src/sample.ts`（既存コードを飛ばして取引先 1 件を作る） |
  | `test/pack.db.test.ts.tmpl` | `packs/<k>/test/pack.db.test.ts`（AC-13〜AC-18。`packs/example/test/pack.db.test.ts` と同じく `freshDb()`、`registerCrudActions()`、`registerPackActions()`、追加の会社は owner 接続の insert） |
  | `spec.md.tmpl` | `docs/specs/pack-<k>.md`（AC-5） |

  `package.json` と `tsconfig.json` はテンプレートを持たず、生成のたびに `packs/example` から作る（AC-3）。
- 新規 `scripts/test/pack-new.test.ts`（vitest の unit project。`vitest.config.mts` の `**/test/**/*.test.ts` に含まれ、`pnpm test` と gate で実行される）
- 読むだけ: `packs/example/package.json`・`tsconfig.json`（AC-3）、`docs/specs/_template.md`（AC-5 の見出し）、`.prettierrc.json`、`kernel/`・`modules/`・`l10n/`・`packs/`・`apps/` の `.ts`（AC-10 の走査）、各 workspace package の `package.json`
- `--register` で編集: `apps/runtime/src/packs.ts`（`AVAILABLE`、`selectedPackNames`・`loadPacks` は不変）、`apps/runtime/package.json`（`dependencies`）、`apps/runtime/test/runtime.test.ts`（AC-3 の一覧）
- 生成 pack が使う kernel の公開 API（変更しない）: `definePack`（`kernel/src/dsl/pack.ts`。名前は `^[a-z][a-z0-9_]*$`、`pack` は予約、action は `<s>.` 接頭辞）、`defineEntity`・`defineAction`・`f`・`label`・`repo`、`applyPack`／`readAppliedPacks`／`PACKS_APPLIED_KEY`（`kernel/src/pack.ts`）、`registerPackActions`（`kernel/src/actions/pack.ts`、`pack.apply`／`pack.list`）、`registerCrudActions`、`runAction`、`appMeta`（`kernel/src/meta.ts`）、`can`（`kernel/src/permissions.ts`、未適用 pack の entity を拒否）、`checkActionPermission`（`kernel/src/actions/run.ts`、未適用 pack の action と拠点限定文脈を拒否）、`freshDb`（`@daifuku/kernel/testing`）。`@daifuku/mod-partner` の `Partner`・`PartnerModule`。
- 登録で影響を受ける既存の検査（変更しない）: `apps/runtime/test/runtime.test.ts`（AC-2 は `missing`・`constructor` を未知の名前として使う → 予約名、AC-3 は全カタログの完全一致 → AC-7 (c)）、`apps/api/test/migrations.db.test.ts` ほか `pendingMigration()` が空であることを確かめる suite（`industry-templates.db.test.ts`、`ext-index-migration.db.test.ts`）→ `pnpm db:generate`、`apps/runtime/test/setting-labels.test.ts`（生成 pack は設定を持たない）、`scripts/gate.mjs` の `ESCALATION_RULES`（`**/package.json`・`pnpm-lock.yaml`・`**/tsconfig*.json`・`apps/api/drizzle/**` で light の DB を全件に昇格）
- Web（変更しない）: `apps/web/src/lib/templates.ts` の `templateStory`（未知の pack は既定の説明文）と `templateOrder`（未知の pack は末尾）、`apps/web/src/lib/navigation-data.ts` の `workspaceForModule`（未知の module は `other`）、`apps/web/src/pages/templates-page.tsx`
- 文書: `docs/conventions/packs.md`、`docs/architecture/extension-guide.md`、`docs/log/2026-10-30-pack-scaffold.md`

## データ・業務ルール（出典）

- 日本の制度値・業務ルールは扱わない（出典不要）。生成する pack は金額を持たない。業種固有の制度を pack に足す場合は、生成した spec の「データ・業務ルール（出典）」に `docs/domain/` の一次資料と確認日を書く（CLAUDE.md 規約 10。生成 spec の `TODO:` に明記する）。
- Postgres の識別子は 63 バイトまで（超えると切り詰められ、制約名が衝突しうる）。kernel が作る制約名の最長の接尾辞は `_tenant_isolation`・`_company_scope_fk`（17 文字）なので、名前の上限 24 文字は `<s>_tag_company_scope_fk`（45 文字）に余裕を残し、作成者が足す entity 名（`<s>_` の後ろ 21 文字まで）も収まる。既存の最長の pack 名は `professional_service`（20 文字）。

## スコープ外（明記）

- 伝票（`defineDocument`・明細）・設定（`registerSetting` と ADR-0027 の表示属性）・ラベル上書き・hooks／override・専用画面・帳票の雛形。必要なら `packs/example`（設定・ラベル上書き）や `packs/restaurant-chain`（伝票）を参照する旨を生成 spec と規約に書く。
- 生成した pack の削除・改名のコマンド（片付けは規約に `git` の手順として書く）。既存の pack の更新・移行。
- `pnpm install`・`pnpm db:generate`・`pack:apply` の自動実行（D6）。
- 利用者マニュアルの付録の自動生成（D7）。CLI の多言語化（開発用ツールのメッセージは英語）。
- 生成した pack の DB テストを CI で継続実行する仕組み（未決事項 Q2）。
- 第三者による完走の実施（記録条件は規約に書くが、実施は人間の第三者が行う）。

## 決定（計画が選択を残した点）

- D1 テンプレートの元: `packs/example` をそのまま写して名前を置換する方式は採らず、`packs/example` の書き方に合わせた専用テンプレート（`scripts/pack-template/`）から作る。`package.json` と `tsconfig.json` だけは生成のたびに `packs/example` から作り、依存の範囲指定が example とずれないようにする。理由: example は definePack の全機能を検査する参照 pack で、partner の ext `customerRank`・`note2`、partner のラベル上書き、設定 `example.default_customer_rank` を持つ。写すと ext key が衝突して両方を登録した時点で import 時に `Conflict` になり、ラベル上書きは同じ会社で登録順に解決されて取引先の画面名を変えてしまう。
- D2 ファイル配置: 計画の略記 `src/{index,pack,entities,actions,seed,sample}.ts` ではなく、[pack の書き方](../conventions/packs.md) の構成どおり `src/entities/<k>-tag.ts` と `src/actions/count-tags.ts`（1 ファイル 1 定義）にする。entity・action を足していく出発点だからである。
- D3 生成する中身: 依存は `partner` だけ。partner の ext 1 項目、小さなマスタ 1 つ、読取の action 1 つ、冪等な seed、1 回だけの sample、メニュー 1 つ。これで規約の「テスト」節の最低限（適用・2 回目は書込ゼロ・force・ext の検証とフィルタ・pack の action・`appMeta` の extFields）と、権限・会社・拠点の境界を生成テストで示せる。設定・ラベル上書き・hooks は含めない（設定は ADR-0027 の日英ラベルが要り、ラベル上書きは中核の画面名を変えるため、必要になった作成者が example を見て足す）。
- D4 名前の規則: 入力は kebab-case（ディレクトリと package 名の慣例。既存の `real-estate` → `real_estate` と同じ導出）、2〜24 文字。予約名: `pack`（kernel の予約）、`all`・`none`（`DAIFUKU_PACKS` の特別な値で、その名前の pack を選べなくなる）、`kernel`（層の名前と紛らわしい）、`constructor`・`missing`（`apps/runtime/test/runtime.test.ts` AC-2 が未知の名前として使い、登録すると既存テストが落ちる）。衝突の検査は静的な走査（速く、node_modules 無しの一時コピーでも試験できる）とし、取りこぼしは import 時の kernel の検査が拒否する。
- D5 整形: 生成時にリポジトリの Prettier API で整形する。名前の長さで行の折り返しが変わっても `format:check` が通り、作成者に `pnpm format` の実行を要求しない。
- D6 `--register` の範囲: 登録の 3 編集（カタログ、runtime の依存、カタログ一覧の期待値）だけを行い、`pnpm install` と `pnpm db:generate` は実行せず手順として表示する。lockfile と migration の番号は並行するブランチで衝突しやすく、規約で統合担当が扱うとしているため。runtime テストの期待値を足すのは、カタログを固定するこのテストの目的どおり新しい pack を期待値に加える変更であり、完全一致の検査を弱めない。
- D7 マニュアル: 利用者マニュアルの付録の雛形は作らない。規約（[文書の管理方法](../architecture/documentation-contract.md)）は画面や手順が変わるときにマニュアルを更新するとしており、業務機能を足す前の雛形には利用者の手順が無い。表示する手順（AC-6 (6)）で `docs/manual` の更新を促す。B7 自体も開発用ツールなのでマニュアルは変えず、規約と拡張手順を更新する。
- D8 生成器のテスト: 依頼の「node test」は、`scripts/test/gate.test.ts` と同じ vitest の unit project に置く（Node 上で動き、`pnpm test`・gate・quick の関連選択にそのまま入る。`node --test` にすると gate に別の工程が要る）。
- D9 ADR: 不要。kernel・DSL・権限・データ経路を変えず、生成物は既存の DSL と kernel の公開 API だけを使う。
- D10 root `package.json` への `pack:new` の別名は足さない（`package.json` の変更は light の DB 全件昇格の対象で、並行するブランチとも衝突しやすい。足すかは統合担当が決める。Q1）。
- D11 生成テストの追加会社は、`packs/example` と同じく owner 接続の insert で作る。B2（[company-admin](company-admin.md)、並行して実装中）の kernel の会社作成が統合されたら、テンプレートをそれに置き換えてよい（統合担当への引継ぎ）。

## 検証手順（E2E、実行して記録する）

受入基準と試験の段階の対応:

| AC | 段階 | 試験・方法 |
| --- | --- | --- |
| AC-1〜AC-12、AC-20 | unit | `scripts/test/pack-new.test.ts`（一時ディレクトリへの生成、拒否、`--register`、`--dry-run`、注入した書込失敗、生成物の型検査） |
| AC-13〜AC-18 | DB | 生成した `packs/<k>/test/pack.db.test.ts`（生成 AC-1〜AC-7）を下記 3.3 と 4 で実行。生成物はコミットしないので CI では継続実行しない（Q2）。テンプレートの AC 番号と spec の対応は unit（AC-5）で確かめる |
| AC-19 | 計測（worktree での一巡） | 下記 3・4。所要時間と昇格の有無を log に残す |
| AC-21 | ブラウザ（一時） | 下記 3.5。コミットしない一時 spec または手動操作 |
| AC-22 | レビューと `pnpm docs:check` | `docs/architecture/extension-guide.md` は docs:check の対象 |

生成器そのものは開発者の手元で動く CLI で、実行時の権限・会社・拠点の境界を持たない（書込先は `<root>/packs/<k>`、`<root>/docs/specs/pack-<k>.md`、`--register` 時の 3 ファイルに限る。AC-1、AC-7、AC-9）。権限と会社・拠点の境界は、生成する pack の契約（AC-15、AC-16、AC-18）として生成テストで確かめる。

1. 単体: `pnpm exec vitest run --project unit scripts/test/pack-new.test.ts`。一時ディレクトリに生成器が読むファイル（`.prettierrc.json`、`tsconfig.base.json`、`docs/specs/_template.md`、`packs/example/package.json`・`tsconfig.json`、`apps/runtime/src/packs.ts`・`package.json`・`test/runtime.test.ts`、走査用の module・entity 宣言の写し）を置いて生成し、ファイル一覧・導出名・置換記号の残り・`package.json`・Prettier の検査・spec の見出しと AC の対応・表示する手順・`--register` の差分・`--dry-run`・型検査（AC-1〜AC-8、AC-20）を確かめる。拒否（名前の規則、予約名、パストラバーサル、各種の衝突、挿入位置の欠落、使い方、書込失敗の巻戻し）では、一時ディレクトリが変わっていないことを確かめる（AC-9〜AC-12）。実リポジトリに対しては書き込まない関数（`findCollisions`）だけを使い、`sales`・`real-estate`・`sales-invoice`・`example` の衝突を確かめる。
2. `pnpm gate:quick`（編集中）と `pnpm gate:light`（B7 の変更そのもの。`scripts/` と `docs/` だけなら DB は常時 4 suite）。
3. worktree での一巡（生成物はコミットしない。所要時間を log に残す）:
   1. `node scripts/pack-new.mjs scaffold-check --register --label-ja 雛形確認 --label-en "Scaffold check"` → 表示された手順を記録。
   2. `pnpm install` → `pnpm db:generate pack_scaffold_check`。
   3. `pnpm --filter @daifuku/pack-scaffold-check typecheck`、`pnpm exec vitest run --project db packs/scaffold-check/test/pack.db.test.ts`（AC-13〜AC-18）。
   4. `pnpm gate:light`（DB 全件へ昇格する。同居エージェントで遅いときは `uptime` を併記。`out of shared memory` で落ちた suite は単独で再実行してから判断する）（AC-19）。
   5. 画面: `e2e-run.sh` などで fixture を起動し、`/templates` から `scaffold_check` を適用し、「タグ」の一覧に 3 件、日英、1280px／390px（AC-21）。コミットしない一時 spec か手動操作で行い、どちらで確かめたかを log に書く。
   6. 片付け: `git restore apps/runtime/src/packs.ts apps/runtime/package.json apps/runtime/test/runtime.test.ts pnpm-lock.yaml apps/api/drizzle`、`rm -rf packs/scaffold-check docs/specs/pack-scaffold-check.md`（一時 spec があればそれも）、`pnpm install --frozen-lockfile`、`git status --short` が B7 の変更だけであることを確認。必要なら `pnpm test:db:templates -- --drop` で自分の試験 DB のテンプレートを消す。
4. 未登録の一巡: `node scripts/pack-new.mjs scaffold-free` → `pnpm install` → `pnpm format:check`、`pnpm typecheck`、`pnpm lint`、生成 pack の DB テスト（AC-19 後段）→ 3.6 と同じ片付け。
5. 第三者完走の記録条件（[拡張手順](../architecture/extension-guide.md)「引継ぎを確認する記録」: 開始 commit、追加した pack と業務台本、変更した層、手順で迷った箇所、権限外操作・再適用・更新を含む試験結果、PR を 1 つの記録に残す。実装担当と別の AI のレビューは人間の第三者による導入実績としない）を満たすかを log に書く。エージェントの実行は満たさない（人間の第三者ではなく、業務台本も無い）と記録する（AC-22）。
6. `pnpm gate:full`（統合担当が実行）。

## 未決事項（利用者の判断待ち）

- Q1 root `package.json` に `pnpm pack:new` を足すか。推奨: B7 では足さない（D10）。統合時に足す場合は CLAUDE.md の Commands と規約の例も合わせる。
- Q2 生成→登録→DB テストを CI で継続して実行するか。推奨: 初版は足さない。kernel の公開 API の変更は AC-20 の型検査が検出し、振る舞いは worktree での一巡（検証 3）の記録で示す。テンプレートを変える PR では検証 3 をやり直す、と規約に書く。
- Q3 `--label-ja` を省略したときの日本語ラベル。推奨: 英語ラベル（既定は名前の各語の先頭を大文字にしたもの、例 `Bike Shop`）と同じ文字列にし、「`--label-ja` で日本語名を指定してください」と警告を出す。生成 spec の `TODO:` にも残す。
- Q4 生成する ext を partner 以外（product など）に選べるようにするか。推奨: 初版は partner 固定（依存を 1 つにし、テストを決まった形にするため）。
