# Spec: pack-scaffold（pack 雛形生成 `scripts/pack-new.mjs`）

- 状態: implemented
- モジュール: `scripts/`（`pack-new.mjs`・`pack-new.d.mts`・`pack-template/`・`test/pack-new.test.ts`・`test/pack-new.db.test.ts`）。生成先は `packs/<name>/` と `docs/specs/pack-<name>.md`、`--register` のときだけ `apps/runtime/`（`src/packs.ts`・`package.json`・`test/runtime.test.ts`）と `apps/web/e2e/workforce.spec.ts` ／ 依存: [pack](pack.md)（`definePack`・`applyPack`・`pack.apply`／`pack.list`）、[test-tiers](test-tiers.md)（`gate:light` と昇格規則）、[db-test-startup](db-test-startup.md)（`freshDb()` の schema テンプレート）
- ADR: 新規 ADR なし（開発用の生成スクリプトであり、kernel・DSL・権限・読み書きの経路を変えない）。関連: [ADR-0013](../adr/0013-hexagonal-ports.md)、[ADR-0015](../adr/0015-packs.md)、[ADR-0016](../adr/0016-foundation-invariants.md)、[ADR-0017](../adr/0017-runtime-and-schema-catalog.md)
- 作成: 2026-10-30 ／ 作成者: agent（B7 spec 作成セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) B7。作業記録（実装後）: `docs/log/2026-10-30-pack-scaffold.md`
- 改訂: 2026-10-30 spec 批評への対応（末尾「spec 批評への対応」）。Q2・Q3 を決定（D12・D13）。

## 目的（1段落）

新しい業種・顧客の pack を足すには、現在は `packs/example` を手で写し、名前を 10 か所以上書き換え、`apps/runtime/src/packs.ts` と `apps/runtime/package.json` に登録し、`pnpm install` と migration 生成を行い、登録で期待値が変わる既存テスト（`apps/runtime/test/runtime.test.ts` のカタログ一覧、`apps/api/test/migrations.db.test.ts` の migration 同期、`apps/web/e2e/workforce.spec.ts` の業界テンプレート数）に気付く必要がある。どれか 1 つを忘れると gate が落ち、原因が pack の外に見える。`node scripts/pack-new.mjs <name>` 1 回で、規約（[pack の書き方](../conventions/packs.md)）どおりの最小 pack・その DB テスト・spec の下書きを作り、残りの手順を順番どおりに表示し（`--register` なら登録の編集まで行い）、生成物に手を入れずに `pnpm gate:light` が通る状態から作業を始められるようにする。対象は pack を追加する開発者・エージェント（第三者を含む）であり、業務利用者向けの画面は増やさない。

## 用語と導出する名前

入力 `<name>` は kebab-case（例 `bike-shop`）。以下では `<k>` = 入力そのもの、`<s>` = `-` を `_` に置き換えた snake_case（`bike_shop`）、`<P>` = PascalCase（`BikeShop`）、`<c>` = camelCase（`bikeShop`）と書く。`<ja>`／`<en>` は pack の日本語・英語ラベル（`--label-ja`／`--label-en`、省略時は AC-23）。

| 用途 | 値 | 例（`bike-shop`） |
| --- | --- | --- |
| ディレクトリ | `packs/<k>` | `packs/bike-shop` |
| package 名 | `@daifuku/pack-<k>` | `@daifuku/pack-bike-shop` |
| pack 名（`definePack.name`、カタログのキー、`DAIFUKU_PACKS` の値、action・entity の接頭辞） | `<s>` | `bike_shop` |
| pack の export | `<P>Pack` | `BikeShopPack` |
| entity（小さなマスタ、code・name） | `<s>_tag` ／ export `<P>Tag` ／ ファイル `src/entities/<k>-tag.ts` ／ ラベル `<ja>のタグ`・`<en> tags` | `bike_shop_tag` |
| action（読取のみ） | `<s>.count_tags` ／ export `countTagsAction` ／ ファイル `src/actions/count-tags.ts` | `bike_shop.count_tags` |
| partner の ext key | `<c>Note`（text、`searchable`、200 文字） | `bikeShopNote` |
| sample の取引先コード | `<CODE>-0001`（`<CODE>` = `<s>` から `_` を除いて大文字にした先頭 12 文字。partner の `code` は 20 文字まで） | `BIKESHOP-0001` |
| spec | `docs/specs/pack-<k>.md` | `docs/specs/pack-bike-shop.md` |
| migration 名（登録時） | `pack_<s>` | `pack_bike_shop` |

## 受入基準（EARS）

### 生成（`scripts/pack-new.mjs`）

- AC-1 WHEN `node scripts/pack-new.mjs <name>` を妥当な名前で実行した THE SYSTEM SHALL 次の 10 ファイルだけを作り、それ以外のファイルを作成・変更しない（`packs/example` を含む既存の pack・module・apps は読むだけ。作業用の一時ディレクトリ（AC-12）は終了前に消す）: `packs/<k>/package.json`、`packs/<k>/tsconfig.json`、`packs/<k>/src/index.ts`、`packs/<k>/src/pack.ts`、`packs/<k>/src/entities/<k>-tag.ts`、`packs/<k>/src/actions/count-tags.ts`、`packs/<k>/src/seed.ts`、`packs/<k>/src/sample.ts`、`packs/<k>/test/pack.db.test.ts`、`docs/specs/pack-<k>.md`。終了コードは 0。
- AC-2 THE SYSTEM SHALL 上表の名前を入力から導出して全出力に埋め込み、どの出力にもテンプレートの置換記号（`__PACK_` で始まる記号）を残さない。生成した `src/pack.ts` は `definePack({ name: '<s>', label: label(<ja>, <en>), version: '0.1.0', depends: [PartnerModule.name], ext: { partner: { <c>Note } }, entities: [<P>Tag], actions: [countTagsAction], menus: [{ label: label(<ja>のタグ, <en> tags), entity: '<s>_tag', order: 90 }], seed, sample })` とし、`settings`・`labels`・`hooks` は含めない（下記「決定」D3）。ラベル（利用者が与えた文字列とそこから作る文字列）は `.ts` には `JSON.stringify(value)` の文字列リテラルとしてだけ埋め込み（引用符は AC-4 の Prettier が直す）、コメントには入れない。Markdown にはバックスラッシュ・`` ` ``・`*`・`_`・`[`・`]`・`<`・`>`・`|`・`#` を `\` でエスケープして埋め込む。どの文字を含むラベルでも、生成物は Prettier の検査と AC-20 の型検査を通り、実行時のラベルの値は与えた文字列と一致する。
- AC-3 THE SYSTEM SHALL `packs/<k>/package.json` を `packs/example/package.json` から作る: `name` は `@daifuku/pack-<k>`、`version` `0.0.1`、`private`・`type`・`exports`（`./src/index.ts`）・`scripts.typecheck` は example と同じ、`dependencies` は `@daifuku/kernel` と `@daifuku/mod-partner`（`workspace:*`）と `zod`（example と同じ範囲指定）、`devDependencies` は `@types/node`・`typescript`・`vitest`（example と同じ範囲指定）。2 空白の JSON に末尾改行。`packs/<k>/tsconfig.json` は `packs/example/tsconfig.json` と同一の内容にする。生成物の依存は example の依存の部分集合である。
- AC-4 THE SYSTEM SHALL 生成・編集したすべての `.ts` ファイルを、リポジトリに固定した Prettier（ルートの devDependency）と `.prettierrc.json` で整形してから書き込み、`pnpm format` を実行しなくても `pnpm format:check` が通るようにする。JSON と Markdown は整形対象外（`format` の glob に含まれないため）。
- AC-5 THE SYSTEM SHALL `docs/specs/pack-<k>.md` を日本語で書き、[`docs/specs/_template.md`](_template.md) のすべての `## ` 見出しを同じ順で含め、状態 `draft`、生成日（ローカル日付 `YYYY-MM-DD`）、生成した pack の受入基準 AC-1〜AC-7（下記「生成する pack の契約」）を記入し、目的・業務の受入基準・出典・スコープ外・未決事項は `TODO:` で始まる記入欄にする。生成した DB テストの各 `it` の名前に含まれる `AC-n` は、この spec の AC-1〜AC-7 と 1 対 1 に対応する。
- AC-6 WHEN 生成が成功した THE SYSTEM SHALL 残りの手順を次の順の番号付きで標準出力に表示する: (1) 登録: `--register` を付けたときは「登録済み（4 編集）」、付けなかったときは登録の 4 編集（AC-7 の (a)〜(d)）を貼り付けられる行のまま（未登録で試すときは飛ばしてよいが、後で登録したら (2) をやり直す旨を添える）、(2) `pnpm install`（新しい workspace package の link と lockfile 更新。`apps/runtime/package.json` を編集した後に実行する。動的 import は `apps/runtime` の依存と install でしか解決しないため）、(3) 登録した後で `pnpm db:generate pack_<s>`（entity の表を足す migration。両方の場合に表示する。統合時に番号が衝突したら統合担当が作り直す）、(4) `pnpm --filter @daifuku/pack-<k> typecheck` と `pnpm exec vitest run --project db packs/<k>/test/pack.db.test.ts`（`TEST_DATABASE_URL_OWNER`／`TEST_DATABASE_URL` が必要）、(5) `pnpm gate:light`（新しい `package.json` で DB 全件に昇格する旨）、(6) 任意: `.env` の `DAIFUKU_PACKS` を絞っているなら `<s>` を加える、`apps/web/src/lib/templates.ts` の説明文、`apps/web/src/lib/navigation-data.ts` の業務分野（無ければ「その他」に出る）、利用者向けの手順を足すときの `docs/manual`、作業記録 `docs/log/`、spec の `TODO:` の記入、(7) 適用: `pnpm pack:apply <s> --sample` または画面 `/templates`。
- AC-7 WHEN `--register` を付けた THE SYSTEM SHALL AC-1 に加えて次の 4 ファイルだけを編集し、それぞれ挙げた差分以外を変えない: (a) `apps/runtime/src/packs.ts` の `AVAILABLE` の最後の項目として `<s>: async () => (await import('@daifuku/pack-<k>')).<P>Pack,` を足す（整形は AC-4）、(b) `apps/runtime/package.json` の `dependencies` の末尾に `"@daifuku/pack-<k>": "workspace:*"` を足す（他のキーの順序と値は不変、2 空白の JSON に末尾改行）、(c) `apps/runtime/test/runtime.test.ts` の AC-3 の期待するカタログ一覧（`expect(schema.packs).toEqual([` の配列）の末尾に `'<s>'` を足す、(d) `apps/web/e2e/workforce.spec.ts` の `利用できる業界テンプレート <N> 種` の `<N>` を `<N+1>` にする（`/templates` の件数は `example` 以外の登録済み pack を数えるため）。`pnpm install` と `pnpm db:generate` は実行しない（D6）。
- AC-8 WHEN `--dry-run` を付けた THE SYSTEM SHALL 作るファイルの一覧（パスと行数）、`--register` 時の編集の差分、AC-6 の手順を表示し、何も書き込まない。終了コードは 0（拒否の条件に当たれば AC-9〜AC-11 と同じ）。
- AC-9 IF 名前が無い、位置引数が 2 つ以上ある、未知の option がある、または `--label-ja`／`--label-en` に値が無い THEN THE SYSTEM SHALL 使い方を標準エラーに出して終了コード 2 で終わり、何も書き込まない。IF 名前が kebab-case（`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`）でない、2 文字未満または 24 文字を超える、予約名（`pack`・`packs`・`all`・`none`・`kernel`・`company`・`constructor`・`missing`。D4）である、またはラベルが規則（1〜40 文字（Unicode のコードポイント数）、前後に空白が無い、制御文字・書式文字・行／段落区切り・孤立サロゲート（`\p{Cc}`・`\p{Cf}`・`\p{Zl}`・`\p{Zp}`・`\p{Cs}`）を含まない、`__PACK_` を含まない）に合わない THEN THE SYSTEM SHALL 守るべき規則と直した例（例: `bike_shop` → `bike-shop`）を標準エラーに出して終了コード 1 で終わり、何も書き込まない。`..`・`/`・`\`・`.`・絶対パス・NUL・空白・大文字・非 ASCII を含む名前はこの規則で拒否され、加えて解決した生成先の実パスが `<root>/packs` の直下であることを書込前に確かめる（パストラバーサルの二重の防御）。
- AC-10 IF 次のいずれかに当たる THEN THE SYSTEM SHALL 当たったものをすべて列挙して標準エラーに出し、終了コード 1 で終わり、何も書き込まない: `packs/<k>` が既に存在する（ファイル・ディレクトリ・シンボリックリンクのいずれでも。`node_modules` だけ残ったディレクトリも含む）、いずれかの workspace package の `package.json` の `name` が `@daifuku/pack-<k>`、`<s>` が `kernel/`・`modules/`・`l10n/`・`packs/`・`apps/` の `.ts`（`node_modules`・`dist` を除く。テスト内の定義を含む）で `defineModule`／`definePack` の `name` として宣言済み、または `apps/runtime/src/packs.ts` の `AVAILABLE` のキー、`<s>` または `<s>_tag` が同じ範囲で `defineEntity`／`defineDocument` の `name` として宣言済み、partner の ext key `<c>Note` が `kernel/`・`modules/`・`l10n/`・`packs/` の `.ts` でオブジェクトのキー（`<c>Note:`。definePack の `ext` や `registerExt` の宣言を含む保守的な検出）として現れる、既存の `packs/*` のディレクトリ名から導いた camelCase が `<c>` と同じ（例: `x-1` と `x1`。export 名と ext key が衝突する）、`docs/specs/pack-<k>.md` が既に存在する。静的な走査で見つからない動的な名前（`packs/industry-catalog` のように factory が組み立てる entity 名）は、import 時の kernel の検査（`definePack`・`registerPack`・`registerExt` の `Conflict`）が最終の判定になる。前回の中断で残った作業用ディレクトリ（AC-12）があれば、拒否はせずにそのパスを警告として標準エラーに出す。
- AC-11 IF `--register` を付け、(a)〜(d) の挿入位置（`const AVAILABLE` の object の閉じ括弧、`apps/runtime/package.json` の `dependencies`、`expect(schema.packs).toEqual([` から始まる配列、`利用できる業界テンプレート <N> 種`）がそれぞれちょうど 1 か所に見つからない、同じ項目が既にある、または `apps/runtime/package.json` を読み直して 2 空白で書き戻すと元の内容と一致しない THEN THE SYSTEM SHALL 該当ファイルと理由（「手で登録してください」と AC-6 (1) の行）を出して終了コード 1 で終わり、pack も含めて何も書き込まない（すべての検査と編集内容の計算を、最初の書込より前に終える）。
- AC-12 THE SYSTEM SHALL 次の順で書き込む: (1) pack のファイルを `<root>/node_modules/.cache/pack-new/` の下に作った一時ディレクトリ（同じファイルシステム上で、vitest・tsc・ESLint・git・pnpm の対象外）にそろえて書く、(2) 名前の変更の直前に `packs/<k>` が存在しないことを確かめてから一時ディレクトリを `packs/<k>` へ名前を変える（存在すれば失敗）、(3) spec を排他作成（flag `wx`）で書く、(4) 各編集の直前にそのファイルを読み直し、計画時の内容（`before`）と一致しなければ中止する。IF 書込の途中で失敗した、または SIGINT／SIGTERM を受けた THEN THE SYSTEM SHALL その実行で作ったファイルとディレクトリ（一時ディレクトリを含む）を消し、編集したファイルを元の内容に戻してから、失敗したパスと原因を出して終了コード 1（シグナルでは 130／143）で終わる。

### 生成する pack の契約（生成した DB テストで検証。括弧内は生成 spec・生成テストの AC 番号）

- AC-13（生成 AC-1）WHEN 生成した package を import した THE SYSTEM SHALL pack `<s>`（version `0.1.0`、depends `['partner']`）、partner の ext `<c>Note`（`source: 'pack:<s>'`）、pack が所有する entity `<s>_tag`、action `<s>.count_tags`（`mutates: false`、`tx: 'none'`、権限は `<s>_tag` の read）、派生 CRUD action（`<s>_tag.create` など）、メニューを登録する。
- AC-14（生成 AC-2、AC-3）WHEN 会社に初めて `applyPack(ctx, '<s>')` を実行した THE SYSTEM SHALL seed の 3 件のタグ（`standard`・`priority`・`inactive`）を作り、`packs.applied` に `{ at, version: '0.1.0' }` を記録し、sample は実行しない。2 回目の適用は何も書かない（タグの `version`、会社の settings、`company_settings` の監査件数が不変）。`force: true` は seed を再実行してもタグを重複させない。`sample: true` は sample の取引先 1 件（ext `<c>Note` 付き）を 1 回だけ作り、再度の `sample: true` では作らない。
- AC-15（生成 AC-4）THE SYSTEM SHALL 生成した pack の権限を次のとおりにする: `pack.apply` は admin のみ（`sales` は `PERMISSION_DENIED`）。タグの read と `<s>.count_tags` は `viewer` に許可し、`viewer` のタグ作成は `PERMISSION_DENIED`。タグに付与の無いロール（例 `accounting`）は一覧も `<s>.count_tags` も `PERMISSION_DENIED`。拠点限定の文脈（`accessScope: 'stores'`、`storeIds` あり）は `<s>.count_tags` を `PERMISSION_DENIED`（`storeAccess`／`siteAccess` を宣言しないため。kernel `checkActionPermission`）。いずれも読み書きは `repo(ctx, …)` と `runAction` を通し、`systemContext()` を使わない。
- AC-16（生成 AC-5）WHILE pack が会社 A と会社 B の両方に適用されている WHEN 会社 A でタグを 1 件作った THE SYSTEM SHALL 会社 B の一覧・件数・`<s>.count_tags` にそれを含めない。IF pack が適用されていない会社 C で、admin を含む利用者がタグの一覧・作成または `<s>.count_tags` を呼んだ THEN THE SYSTEM SHALL `PERMISSION_DENIED` とする（action は kernel `checkActionPermission` の `pack-not-applied`、entity は `can` の未適用判定。どちらも既存の kernel の振る舞いを生成テストで確かめるもの）。
- AC-17（生成 AC-6）IF partner を ext `<c>Note` が 200 文字を超える値で作ろうとした THEN THE SYSTEM SHALL `ValidationError`（`details.issues[].path` が `ext.<c>Note`）とし、何も書かない。WHEN `where: { 'ext.<c>Note': … }` で一覧した、または `search` で ext の文字列を検索した THE SYSTEM SHALL sample の取引先を返す。
- AC-18（生成 AC-7）WHEN 適用済みの会社で `appMeta(ctx, { appliedPacks })` を読んだ THE SYSTEM SHALL partner の `extFields` に `ext.<c>Note`（`source: 'pack:<s>'`、`searchable: true`）、`packs` に `{ name: '<s>', label, applied: true }`、module `<s>` のメニュー（ラベル `<ja>のタグ`／`<en> tags`）、entity `<s>_tag` を含める。未適用の会社では `applied: false` で、メニュー・entity・ext を含めない。

### gate と画面

- AC-19 WHEN `--register` を付けて生成し、表示された `pnpm install` と `pnpm db:generate pack_<s>` を実行した（生成したファイルは編集しない）THE SYSTEM SHALL `pnpm gate:light`（format:check、typecheck、API/Web typecheck、lint と依存境界、unit 全件（`apps/runtime/test/runtime.test.ts` を含む）、DB 全件（`apps/api/test/migrations.db.test.ts` などの migration 同期検査と生成 pack の DB テストを含む）、test:deploy、docs:check、台帳検査）と `pnpm --filter @daifuku/pack-<k> typecheck` を成功させる。WHEN `--register` なしで生成し `pnpm install` だけを実行した THE SYSTEM SHALL format:check、typecheck、lint（依存境界を含む）と生成 pack の DB テストを成功させる（未登録の pack は runtime が読まないので、migration は要らない）。
- AC-20 THE SYSTEM SHALL `scripts/test/pack-new.test.ts` で、一時ディレクトリに生成した `src/` と `test/` を現在の workspace に対して型検査する（生成先の `node_modules` を `packs/example/node_modules` へのシンボリックリンクにし、ルートの `tsc7` で `tsc -p packs/<k>/tsconfig.json --noEmit`）。生成には AC-2 の扱いにくい文字（`'`・`"`・`\`・`${x}`・`*/`・`|`・`` ` ``・日本語）を含むラベルを使う。テストの時間制限は 60 秒、子プロセスの時間制限は 50 秒とし、型エラーや時間切れでは tsc の出力を失敗メッセージに含める。kernel や partner の公開 API の変更でテンプレートが壊れたら `pnpm test` が落ちる。
- AC-21 WHEN 登録した pack を画面 `/templates` から会社に適用した THE SYSTEM SHALL その pack のカード（`templateStory` の既定の説明文、ラベルは日英で切替）を表示し、適用後に `<ja>のタグ`／`<en> tags` のメニュー（業務分野「その他」）から汎用一覧 `/e/<s>_tag` を開いて seed の 3 件を表示する。日本語・英語、1280px と 390px で、ページとアプリのスクロール領域が横にはみ出さない（既存の汎用画面の性質の確認であり、画面のコードは変えない）。登録した状態で `apps/web/e2e/workforce.spec.ts` が AC-7 (d) の件数で通る。
- AC-22 THE SYSTEM SHALL [pack の書き方](../conventions/packs.md) に「雛形から始める」（コマンド、option、生成物、登録の 4 編集、`pnpm install`・`pnpm db:generate` が要る理由と順序、片付け方、台帳 `PV-PACK-SCAFFOLD-01` の再確認の規則）を足し、「apps への追加」を AC-6 の順序（登録 → `pnpm install` → `pnpm db:generate`）と AC-7 の 4 編集に合わせる。[module・pack の拡張手順](../architecture/extension-guide.md) の手順 5 と「引継ぎを確認する記録」に雛形を入口として書き、エージェントによる生成・検証の実行は「第三者がこの手順だけで新しい pack を追加できること」の記録条件を満たさない（人間の第三者による導入実績ではない）ことを明記する。[業務条件と検証根拠の台帳](../verification/invariants.md) に `PV-PACK-SCAFFOLD-01` を足し、テンプレートと生成 pack が使う kernel のファイル（`kernel/src/pack.ts`・`kernel/src/actions/pack.ts`・`kernel/src/actions/run.ts`・`kernel/src/permissions.ts`・`kernel/src/meta.ts`・`kernel/src/testing.ts`）をリンクする（変更時に `check-assurance --changed` が再確認を促す）。
- AC-23 WHEN `--label-en` を省略した THE SYSTEM SHALL 名前の各語の先頭を大文字にして空白でつないだもの（`bike-shop` → `Bike Shop`）を英語ラベルにする。WHEN `--label-ja` を省略した THE SYSTEM SHALL 英語ラベルと同じ文字列を日本語ラベルにし、`warning: --label-ja was not given; the Japanese label is "<en>". Set a Japanese name in packs/<k>/src/pack.ts and the spec.` を標準エラーに出し、生成 spec に日本語ラベルを直す `TODO:` を残す（終了コードは 0）。
- AC-24 THE SYSTEM SHALL `scripts/test/pack-new.db.test.ts`（DB の test project。`pnpm test:db`・`pnpm gate`、kernel の変更で DB 全件に昇格した `gate:light`、`scripts/` の変更で選ばれる `gate:light`）で、固定の名前の pack をリポジトリ外の一時 workspace に生成し（`node_modules` は `packs/example/node_modules` の各項目へのシンボリックリンクを並べた実ディレクトリ。子プロセスの vitest のキャッシュを一時 workspace の外に書かないため）、生成した `test/pack.db.test.ts` を子プロセスの vitest で現在の kernel と partner に対して実行する。AC-13〜AC-18 のそれぞれについて、対応する生成 AC の `it` がすべて成功し、失敗・省略が無いことを別の `it` で確かめる。生成した pack はリポジトリに書かず、終了時に一時 workspace を消す。

## 関係するファイル・インターフェース（名指し）

- 新規 `scripts/pack-new.mjs`（Node ESM。依存はルートの `prettier` だけ）。公開する関数（`scripts/test/pack-new.test.ts`・`pack-new.db.test.ts` から使う。名前は実装時に変えてよいが、純粋な計画と書込を分ける）:
  - `parsePackNewArgs(argv)` → `{ name, register, dryRun, labelJa?, labelEn?, root }`。不正は `PackNewUsageError`（終了コード 2）。`--root <dir>` はテスト用（既定はスクリプトの位置から求めたリポジトリのルート）。
  - `packNames(kebab)` → 上表の名前一式。`validatePackName(kebab)`・`validateLabel(text)` → 規則違反の一覧（AC-9）。`defaultLabels(names, given)` → ラベルと警告（AC-23）。
  - `findCollisions(root, names)` → 衝突の一覧（AC-10。書き込まない）。
  - `planPack({ root, names, labels, today, register })` → `{ files: { path, content }[], edits: { path, before, after }[], steps: string[] }`（Prettier の整形を含むため非同期。書き込まない）。
  - `writePlan(plan, root, io?)` → 一時ディレクトリへの書込・名前の変更・編集の適用と、失敗時の巻戻し（AC-12。`io` は失敗の注入や編集対象の差し替えを行うテスト用）。
  - `main(argv, { stdout, stderr })` → 終了コード（0 成功、1 拒否・失敗、2 使い方）。メッセージは英語（`scripts/gate.mjs` と同じ）。
- 新規 `scripts/pack-new.d.mts`（`scripts/gate.d.mts` と同じく、テストをルートの `pnpm typecheck` で検査するための型）
- 新規 `scripts/pack-template/`（置換記号入りのテンプレート。拡張子 `.tmpl` で Prettier・ESLint・tsc・vitest の対象外にする。内容は `packs/example` の同名ファイルの書き方に合わせる）:

  | テンプレート | 出力 |
  | --- | --- |
  | `src/index.ts.tmpl` | `packs/<k>/src/index.ts`（公開 API: `<P>Pack`、`<P>Tag`、`countTagsAction`、`SEED_TAGS`、`seed<P>`、`SAMPLE_NOTE`、`SAMPLE_PARTNER_CODES`、`sample<P>`） |
  | `src/pack.ts.tmpl` | `packs/<k>/src/pack.ts`（AC-2） |
  | `src/entities/tag.ts.tmpl` | `packs/<k>/src/entities/<k>-tag.ts`（`defineEntity`: `code`（required・unique・immutable・20 文字）、`name`（required・100 文字）、roles `sales: ['read','create','update']`・`viewer: ['read']`、`views.list`／`views.search`） |
  | `src/actions/count-tags.ts.tmpl` | `packs/<k>/src/actions/count-tags.ts`（`defineAction`: input `z.object({})`、output `{ count: int }`、`repo(ctx, <P>Tag).count()`） |
  | `src/seed.ts.tmpl` | `packs/<k>/src/seed.ts`（code で存在を確かめて `repo().create` する冪等な 3 件） |
  | `src/sample.ts.tmpl` | `packs/<k>/src/sample.ts`（既存コードを飛ばして取引先 1 件を作る） |
  | `test/pack.db.test.ts.tmpl` | `packs/<k>/test/pack.db.test.ts`（AC-13〜AC-18。`packs/example/test/pack.db.test.ts` と同じく `freshDb()`、`registerCrudActions()`、`registerPackActions()`、追加の会社は owner 接続の insert） |
  | `spec.md.tmpl` | `docs/specs/pack-<k>.md`（AC-5） |

  `package.json` と `tsconfig.json` はテンプレートを持たず、生成のたびに `packs/example` から作る（AC-3）。
- 新規 `scripts/test/pack-new.test.ts`（vitest の unit project。`vitest.config.mts` の `**/test/**/*.test.ts` に含まれ、`pnpm test` と gate で実行される）
- 新規 `scripts/test/pack-new.db.test.ts`（vitest の DB project。AC-24）
- 読むだけ: `packs/example/package.json`・`tsconfig.json`（AC-3）、`.prettierrc.json`、`kernel/`・`modules/`・`l10n/`・`packs/`・`apps/` の `.ts`（AC-10 の走査）、各 workspace package の `package.json`
- `--register` で編集: `apps/runtime/src/packs.ts`（`AVAILABLE`、`selectedPackNames`・`loadPacks` は不変）、`apps/runtime/package.json`（`dependencies`）、`apps/runtime/test/runtime.test.ts`（AC-3 の一覧）、`apps/web/e2e/workforce.spec.ts`（業界テンプレート数）
- 生成 pack が使う kernel の公開 API（変更しない）: `definePack`（`kernel/src/dsl/pack.ts`。名前は `^[a-z][a-z0-9_]*$`、`pack` は予約、action は `<s>.` 接頭辞）、`defineEntity`・`defineAction`・`f`・`label`・`repo`、`applyPack`／`readAppliedPacks`／`PACKS_APPLIED_KEY`（`kernel/src/pack.ts`）、`registerPackActions`（`kernel/src/actions/pack.ts`、`pack.apply`／`pack.list`）、`registerCrudActions`、`runAction`、`appMeta`（`kernel/src/meta.ts`）、`can`（`kernel/src/permissions.ts`、未適用 pack の entity を拒否）、`checkActionPermission`（`kernel/src/actions/run.ts`、未適用 pack の action と拠点限定文脈を拒否）、`freshDb`（`@daifuku/kernel/testing`）。`@daifuku/mod-partner` の `Partner`・`PartnerModule`。
- 登録で影響を受ける既存の検査（変更しない。AC-7 の編集か手順で対応する）: `apps/runtime/test/runtime.test.ts`（AC-2 は `missing`・`constructor` を未知の名前として使う → 予約名、AC-3 は全カタログの完全一致 → AC-7 (c)）、`apps/web/e2e/workforce.spec.ts:485`（`利用できる業界テンプレート 15 種` の完全一致。`templates-page.tsx` は `example` 以外の pack を数える → AC-7 (d)。テスト名の英語 `fifteen` は表示の検査ではないので編集しない）、`apps/api/test/migrations.db.test.ts` ほか `pendingMigration()` が空であることを確かめる suite（`industry-templates.db.test.ts`、`ext-index-migration.db.test.ts`、`boolean-migration.db.test.ts`）→ `pnpm db:generate`。加えて `boolean-migration.db.test.ts` と `ext-index-migration.db.test.ts` の旧版からの更新の試験は、基準 commit `4afa6d1` では全 migration 適用後の public の制約をすべて比較するので、表を足す migration があると（pack に限らず）落ちる（実装時の一巡で実測。E2 の commit `8083d57` が既存の表の制約だけを比べるように直しており、統合後は通る。B7 はこの 2 ファイルを変えない）、`apps/runtime/test/setting-labels.test.ts`（生成 pack は設定を持たない）、`scripts/gate.mjs` の `ESCALATION_RULES`（`**/package.json`・`pnpm-lock.yaml`・`**/tsconfig*.json`・`apps/api/drizzle/**` で light の DB を全件に昇格）
- Web（変更しない）: `apps/web/src/lib/templates.ts` の `templateStory`（未知の pack は既定の説明文）と `templateOrder`（未知の pack は末尾）、`apps/web/src/lib/navigation-data.ts` の `workspaceForModule`（未知の module は `other`）、`apps/web/src/pages/templates-page.tsx`
- 文書: `docs/conventions/packs.md`、`docs/architecture/extension-guide.md`、`docs/verification/invariants.md`、`docs/log/2026-10-30-pack-scaffold.md`

## データ・業務ルール（出典）

- 日本の制度値・業務ルールは扱わない（出典不要）。生成する pack は金額を持たない。業種固有の制度を pack に足す場合は、生成した spec の「データ・業務ルール（出典）」に `docs/domain/` の一次資料と確認日を書く（CLAUDE.md 規約 10。生成 spec の `TODO:` に明記する）。
- Postgres の識別子は 63 バイトまで（超えると切り詰められ、制約名が衝突しうる）。kernel が作る制約名の最長の接尾辞は `_tenant_isolation`・`_company_scope_fk`（17 文字）なので、名前の上限 24 文字は `<s>_tag_company_scope_fk`（45 文字）に余裕を残し、作成者が足す entity 名（`<s>_` の後ろ 21 文字まで）も収まる。既存の最長の pack 名は `professional_service`（20 文字）。

## スコープ外（明記）

- 伝票（`defineDocument`・明細）・設定（`registerSetting` と ADR-0027 の表示属性）・ラベル上書き・hooks／override・専用画面・帳票の雛形。必要なら `packs/example`（設定・ラベル上書き）や `packs/restaurant-chain`（伝票）を参照する旨を生成 spec と規約に書く。
- 生成した pack の削除・改名のコマンド（片付けは規約に `git` の手順として書く）。既存の pack の更新・移行。
- `pnpm install`・`pnpm db:generate`・`pack:apply` の自動実行（D6）。
- 利用者マニュアルの付録の自動生成（D7）。CLI の多言語化（開発用ツールのメッセージは英語）。
- 生成した pack を CI の別 job で登録・migration 生成まで行う仕組み（AC-24 は登録しない生成 pack の DB テストを DB tier で実行する。登録経路の一巡は検証 3 の記録で示す）。
- 第三者による完走の実施（記録条件は規約に書くが、実施は人間の第三者が行う）。
- `AI_INDEX.md` の更新（このラウンドでは統合担当が行う。作業記録と統合メモに 1 行の変更案を書く）。

## 決定（計画が選択を残した点）

- D1 テンプレートの元: `packs/example` をそのまま写して名前を置換する方式は採らず、`packs/example` の書き方に合わせた専用テンプレート（`scripts/pack-template/`）から作る。`package.json` と `tsconfig.json` だけは生成のたびに `packs/example` から作り、依存の範囲指定が example とずれないようにする。理由: example は definePack の全機能を検査する参照 pack で、partner の ext `customerRank`・`note2`、partner のラベル上書き、設定 `example.default_customer_rank` を持つ。写すと ext key が衝突して両方を登録した時点で import 時に `Conflict` になり、ラベル上書きは同じ会社で登録順に解決されて取引先の画面名を変えてしまう。
- D2 ファイル配置: 計画の略記 `src/{index,pack,entities,actions,seed,sample}.ts` ではなく、[pack の書き方](../conventions/packs.md) の構成どおり `src/entities/<k>-tag.ts` と `src/actions/count-tags.ts`（1 ファイル 1 定義）にする。entity・action を足していく出発点だからである。
- D3 生成する中身: 依存は `partner` だけ。partner の ext 1 項目、小さなマスタ 1 つ、読取の action 1 つ、冪等な seed、1 回だけの sample、メニュー 1 つ。これで規約の「テスト」節の最低限（適用・2 回目は書込ゼロ・force・ext の検証とフィルタ・pack の action・`appMeta` の extFields）と、権限・会社・拠点の境界を生成テストで示せる。設定・ラベル上書き・hooks は含めない（設定は ADR-0027 の日英ラベルが要り、ラベル上書きは中核の画面名を変えるため、必要になった作成者が example を見て足す）。マスタとメニューのラベルは pack のラベルから作り（`<ja>のタグ`／`<en> tags`）、`packs/example` の「タグ」と並んでも区別できるようにする。
- D4 名前の規則: 入力は kebab-case（ディレクトリと package 名の慣例。既存の `real-estate` → `real_estate` と同じ導出）、2〜24 文字。予約名: `pack`（kernel の予約）、`packs`・`company`（kernel が持つ会社設定の名前空間 `packs.applied`、B2 の `company.profile`。その名前の pack が設定を足すと同じキー空間を共有する）、`all`・`none`（`DAIFUKU_PACKS` の特別な値で、その名前の pack を選べなくなる）、`kernel`（層の名前と紛らわしい）、`constructor`・`missing`（`apps/runtime/test/runtime.test.ts` AC-2 が未知の名前として使い、登録すると既存テストが落ちる）。衝突の検査は静的な走査（速く、node_modules 無しの一時コピーでも試験できる）とし、取りこぼしは import 時の kernel の検査が拒否する。
- D5 整形: 生成時にリポジトリの Prettier API で整形する。名前の長さで行の折り返しが変わっても `format:check` が通り、作成者に `pnpm format` の実行を要求しない。
- D6 `--register` の範囲: 登録の 4 編集（カタログ、runtime の依存、カタログ一覧の期待値、業界テンプレート数の期待値）だけを行い、`pnpm install` と `pnpm db:generate` は実行せず手順として表示する。lockfile と migration の番号は並行するブランチで衝突しやすく、規約で統合担当が扱うとしているため。runtime テストとブラウザ試験の期待値を変えるのは、カタログと件数を固定するこれらのテストの目的どおり新しい pack を期待値に加える変更であり、完全一致の検査を弱めない。
- D7 マニュアル: 利用者マニュアルの付録の雛形は作らない。規約（[文書の管理方法](../architecture/documentation-contract.md)）は画面や手順が変わるときにマニュアルを更新するとしており、業務機能を足す前の雛形には利用者の手順が無い。表示する手順（AC-6 (6)）で `docs/manual` の更新を促す。B7 自体も開発用ツールなのでマニュアルは変えず、規約と拡張手順を更新する。
- D8 生成器のテスト: 依頼の「node test」は、`scripts/test/gate.test.ts` と同じ vitest の unit project に置く（Node 上で動き、`pnpm test`・gate・quick の関連選択にそのまま入る。`node --test` にすると gate に別の工程が要る）。
- D9 ADR: 不要。kernel・DSL・権限・データ経路を変えず、生成物は既存の DSL と kernel の公開 API だけを使う。
- D10 root `package.json` への `pack:new` の別名は足さない（`package.json` の変更は light の DB 全件昇格の対象で、並行するブランチとも衝突しやすい。足すかは統合担当が決める。Q1）。
- D11 生成テストの追加会社は、`packs/example` と同じく owner 接続の insert で作る。B2（[company-admin](company-admin.md)、並行して実装中）の kernel の会社作成が統合されたら、テンプレートをそれに置き換えてよい（統合担当への引継ぎ）。
- D12（Q2 の決定）生成 pack の振る舞いの契約（AC-13〜AC-18）は、AC-24 の DB テストで継続して実行する。生成した pack は一時 workspace に置き、登録・migration 生成はしない（`freshDb()` はレジストリから schema を作るので不要）。加えて台帳 `PV-PACK-SCAFFOLD-01` でテンプレートと kernel のファイルをリンクし、変更時に検証 3（登録経路の一巡）をやり直す規則を規約に書く。登録経路（AC-19）とブラウザ（AC-21）は一巡の計測として作業記録に残す（完了の定義 1 の「テスト名に AC-n」の例外として AC/試験の表に明記する）。
- D13（Q3 の決定）ラベルの既定値は AC-23 のとおり。日本語ラベルを省略しても止めない（計画の使い方は `<name>` だけ）が、警告と生成 spec の `TODO:` で必ず目に入るようにする。

## 検証手順（E2E、実行して記録する）

受入基準と試験の段階の対応:

| AC | 段階 | 試験・方法 |
| --- | --- | --- |
| AC-1〜AC-12、AC-20、AC-23 | unit | `scripts/test/pack-new.test.ts`（一時ディレクトリへの生成、拒否、`--register`、`--dry-run`、注入した書込失敗と編集対象の変化、扱いにくいラベル、生成物の型検査） |
| AC-13〜AC-18、AC-24 | DB（継続） | `scripts/test/pack-new.db.test.ts` が一時 workspace に生成した pack の DB テスト（生成 AC-1〜AC-7）を子プロセスで実行し、AC ごとの `it` で結果を確かめる。加えて下記 3.3 と 4 で worktree に生成した pack の DB テストを一度実行する |
| AC-19 | 計測（worktree での一巡、一回限り） | 下記 3・4。所要時間と昇格の有無を log に残す（テスト名の AC-n の例外） |
| AC-21 | ブラウザ（一回限り） | 下記 3.5。コミットしない一時 spec または手動操作と、登録状態での `workforce.spec.ts`（テスト名の AC-n の例外） |
| AC-22 | レビューと `pnpm docs:check`・`pnpm verify:assurance` | `docs/architecture/extension-guide.md` は docs:check の対象。台帳は verify:assurance の対象 |

生成器そのものは開発者の手元で動く CLI で、実行時の権限・会社・拠点の境界を持たない（書込先は `<root>/packs/<k>`、`<root>/docs/specs/pack-<k>.md`、`--register` 時の 4 ファイル、作業用の `<root>/node_modules/.cache/pack-new/` に限る。AC-1、AC-7、AC-9、AC-12）。権限と会社・拠点の境界は、生成する pack の契約（AC-15、AC-16、AC-18）として生成テストで確かめる。

1. 単体: `pnpm exec vitest run --project unit scripts/test/pack-new.test.ts`。一時ディレクトリに生成器が読むファイル（`.prettierrc.json`、`tsconfig.base.json`、`packs/example/package.json`・`tsconfig.json`、`apps/runtime/src/packs.ts`・`package.json`・`test/runtime.test.ts`、`apps/web/e2e/workforce.spec.ts`、走査用の module・entity・ext 宣言の写し）を置いて生成し、ファイル一覧・導出名・置換記号の残り・`package.json`・Prettier の検査・spec の見出し（実リポジトリの `docs/specs/_template.md` と比較）と AC の対応・表示する手順と順序（両方のモード）・`--register` の差分・`--dry-run`・扱いにくいラベル・既定ラベルと警告・型検査（AC-1〜AC-8、AC-20、AC-23）を確かめる。拒否（名前の規則、予約名、パストラバーサル、各種の衝突、挿入位置の欠落、使い方、書込失敗と編集対象の変化の巻戻し）では、一時ディレクトリが変わっていないことを確かめる（AC-9〜AC-12）。実リポジトリに対しては書き込まない関数（`findCollisions`）だけを使い、`sales`・`real-estate`・`sales-invoice`・`example` の衝突を確かめる。
2. DB: `pnpm exec vitest run --project db scripts/test/pack-new.db.test.ts`（AC-24。AC-13〜AC-18 の生成テストが現在の kernel で通る）。
3. `pnpm gate:quick`（編集中）と `pnpm gate:light`（B7 の変更そのもの。`scripts/` と `docs/` だけなら DB は常時 4 suite と選ばれた suite）。
4. worktree での一巡（生成物はコミットしない。所要時間を log に残す）:
   1. `node scripts/pack-new.mjs scaffold-check --register --label-ja 雛形確認 --label-en "Scaffold check"` → 表示された手順を記録。
   2. `pnpm install` → `pnpm db:generate pack_scaffold_check`。
   3. `pnpm --filter @daifuku/pack-scaffold-check typecheck`、`pnpm exec vitest run --project db packs/scaffold-check/test/pack.db.test.ts`（AC-13〜AC-18）。
   4. `pnpm gate:light`（DB 全件へ昇格する。同居エージェントで遅いときは `uptime` を併記。`out of shared memory` で落ちた suite は単独で再実行してから判断する）（AC-19）。
   5. 画面: `e2e-run.sh` などで fixture を起動し、`/templates` から `scaffold_check` を適用し、`雛形確認のタグ` の一覧に 3 件、日英、1280px／390px（AC-21）。コミットしない一時 spec か手動操作で行い、どちらで確かめたかを log に書く。同じ登録状態で `apps/web/e2e/workforce.spec.ts` を実行し、結果を log に書く。
   6. 片付け: `git restore apps/runtime/src/packs.ts apps/runtime/package.json apps/runtime/test/runtime.test.ts apps/web/e2e/workforce.spec.ts pnpm-lock.yaml apps/api/drizzle`、`git clean -nd -- apps/api/drizzle`（確認）→ `git clean -fd -- apps/api/drizzle`（生成した `migrations/<n>_pack_scaffold_check.sql` と `meta/<n>_snapshot.json` を消す）、`rm -rf packs/scaffold-check docs/specs/pack-scaffold-check.md`（一時 spec があればそれも）、`pnpm install --frozen-lockfile`、`git status --short` が B7 の変更だけで、`apps/api/drizzle`・`packs/`・`docs/specs/` の下に未追跡のパスが残っていないことを確認。必要なら `pnpm test:db:templates -- --drop` で自分の試験 DB のテンプレートを消す。
5. 未登録の一巡: `node scripts/pack-new.mjs scaffold-free` → `pnpm install` → `pnpm format:check`、`pnpm typecheck`、`pnpm lint`、生成 pack の DB テスト（AC-19 後段）→ 4.6 と同じ片付け。
6. 第三者完走の記録条件（[拡張手順](../architecture/extension-guide.md)「引継ぎを確認する記録」: 開始 commit、追加した pack と業務台本、変更した層、手順で迷った箇所、権限外操作・再適用・更新を含む試験結果、PR を 1 つの記録に残す。実装担当と別の AI のレビューは人間の第三者による導入実績としない）を満たすかを log に書く。エージェントの実行は満たさない（人間の第三者ではなく、業務台本も無い）と記録する（AC-22）。
7. `pnpm metrics:add -- --feature pack-scaffold …` で計測値を残す。
8. `pnpm gate:full`（統合担当が実行）。

## 未決事項（利用者の判断待ち）

- Q1 root `package.json` に `pnpm pack:new` を足すか。推奨: B7 では足さない（D10）。統合時に足す場合は CLAUDE.md の Commands と規約の例も合わせる。
- Q2 決定済み（D12）。
- Q3 決定済み（D13、AC-23）。
- Q4 生成する ext を partner 以外（product など）に選べるようにするか。推奨: 初版は partner 固定（依存を 1 つにし、テストを決まった形にするため）。

## spec 批評への対応（2026-10-30）

| # | 指摘 | 判断 | 反映 |
| --- | --- | --- | --- |
| 1 | AC-6 の手順の順序（install が登録より前） | 採用 | AC-6 を 登録 → `pnpm install` → `pnpm db:generate`（両モードで表示）の順にし、単体テストで両モードの順序を確かめる。規約の「apps への追加」も同じ順（AC-22） |
| 2 | `workforce.spec.ts:485` の業界テンプレート数と `boolean-migration.db.test.ts` が影響一覧に無い | 採用 | AC-7 に 4 番目の編集 (d)、AC-11 に挿入位置の条件、影響一覧に 2 件を追加。検証 4.5 で登録状態の `workforce.spec.ts` を実行する |
| 3 | ラベルの埋め込み方（`'`・`\`・`${`・`*/`）が未定義 | 採用 | AC-2 に `JSON.stringify` のリテラルだけ・コメント禁止・Markdown のエスケープを定め、AC-9 のラベル規則を厳密化。AC-20 の型検査を扱いにくいラベルで行う |
| 4 | 生成 pack の契約（AC-13〜AC-18）が一回の実行でしか検証されない | 採用（最小案より強く） | AC-24 の DB テストで継続実行し、台帳 `PV-PACK-SCAFFOLD-01` と規約の再確認規則を追加。AC-19・AC-21 は一回限りの計測として表に明記（D12） |
| 5 | 片付けで生成した migration が残る | 採用 | 検証 4.6 に `git clean -nd`／`-fd -- apps/api/drizzle` と未追跡パスの確認を追加 |
| 6 | ラベル省略時の既定値が未定義（Q3） | 採用 | AC-23・D13 として決定し、単体テストを置く |
| 7 | 一時ディレクトリが `packs/` 直下にあり、各ツールの走査に入る。書込順と上書き防止が未定義 | 採用 | AC-12 で `<root>/node_modules/.cache/pack-new/` に移し、書込順・`wx`・編集直前の再読込・シグナル時の巻戻しを定義。AC-10 で残骸を警告。単体テストで編集対象の変化を注入する |
| 8 | ext key `<c>Note` の衝突が検査されない | 採用 | AC-10 に ext key の走査と、既存 pack のディレクトリ名からの camelCase の一致を追加 |
| 9 | AC-20 の型検査の時間制限が無い | 採用 | AC-20 にテスト 60 秒・子プロセス 50 秒と失敗時の出力を明記 |
| 10a | メニュー名が example の「タグ」と同じ | 採用 | entity とメニューのラベルを pack のラベルから作る（D3、AC-18、AC-21） |
| 10b | 検証に `pnpm metrics:add` が無い | 採用 | 検証 7 |
| 10c | AI_INDEX の行を統合担当に回している | 不採用 | このラウンドの実装担当は `AI_INDEX.md` を編集しない取り決め（統合担当が行う）。変更案は作業記録と統合メモに書く（スコープ外に明記） |
| 10d | 予約名に kernel の設定名前空間が無い | 採用 | 予約名に `packs`・`company` を追加（AC-9、D4） |
