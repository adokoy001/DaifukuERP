# ADR-0027: 会社設定の表示属性は設定定義に持たせ、登録時に schema と照合する

- 状態: 採択（2026-10-29）／ 確信度: 中
- 関連: [ADR-0013](0013-hexagonal-ports.md)（L1 設定 `registerSetting`）、[ADR-0015](0015-packs.md)（pack の設定既定値）、[受入基準](../specs/settings-console.md)、[UI 規約](../conventions/ui.md)
- 追記: §6 B2 の `company.profile`（[company-admin](../specs/company-admin.md)、2026-10-30）、§7 B3 の導入チェックの登録 port（[setup-health](../specs/setup-health.md)、2026-10-30）。追記予定: B4 の `setup.progress`（[setup-wizard](../specs/setup-wizard.md)）

## 背景

会社設定は module / pack が `registry.registerSetting({ key, label, schema })` で宣言し、汎用の設定画面が `GET /meta/settings` の JSON Schema からフォームを作る（ADR-0013 L1）。宣言には画面向けの情報が無かったため、次の問題があった。

- 細目名が JSON Schema の property 名（`receivable`、`taxPayable`）の humanize で、日本語にならない。zod の `.describe()` / `title` は単一文字列で、`{ ja, en }` を持てない。
- 勘定科目・倉庫のコードを文字列で手入力する。存在しないコードを入れても保存でき、転記時に `INVALID_STATE` で初めて分かる。
- boolean や enum の単一値の設定が JSON の入力欄になる。
- 会社に値が無いとき、module が実際に使う既定値（`getSetting` の fallback）が画面から見えない。値を消して既定に戻す操作も無い。
- 設定が登録順に 1 列で並び、業界 pack を入れると 20 件を超える。

## 決定

### 1. `SettingDef` の表示属性

```ts
registry.registerSetting({
  key: 'sales.accounts',
  label: label('売上転記の勘定科目', 'Sales posting accounts'),
  schema: salesAccountsSchema,
  default: SALES_ACCOUNTS_DEFAULT,          // module の getSetting fallback と同じ値
  category: 'sales',                         // 省略時は key の先頭で決める
  order: 20,                                 // タブ内の並び（昇順。無いものは後ろ、次にラベル順）
  fields: {                                  // object schema の property ごと
    revenue: { label: label('売上高', 'Revenue'), widget: 'account-code' },
  },
});
```

- `category`: `company | accounting | tax | sales | purchase | inventory | contract | workforce | industry | integration | system`（kernel の `SETTING_CATEGORIES`、表示順）。省略時は `defaultSettingCategory(key)`: 先頭 segment が `company`→company、`tax`→tax、`sales`→sales、`purchase`→purchase、`payment` / `accounting`→accounting、`inventory`→inventory、`contract`→contract、`workforce`→workforce、`packs`→system、それ以外（pack・業界の key）→industry。
- `fields`: object schema（固定 property を持つもの）専用。`{ label, description?, widget?, valueLabels? }`。`widget` は `account-code` / `warehouse-code` / `textarea`。`valueLabels` は enum 値のラベル。
- `widget` / `valueLabels`（定義の直下）: 単一値（string / number / boolean / enum）の設定専用。`inventory.default_warehouse` の `warehouse-code`、`contract.default_proration` の選択肢ラベルなど。
- `default`: module が会社に値が無いときに使う値。画面の「既定値」表示に使う。applyPack は保存済みの値を一切上書きしない（既定値との比較もしない）ので、宣言しても pack の挙動は変わらない。

表示属性は検証・保存・権限に影響しない。`PUT` の検証は従来どおり `schema` だけで行う。

### 2. 登録時の検査（定義の誤りは `Error`）

`registerSetting` が `checkSettingDef` を呼び、次を開発者向けの `Error`（[エラー規約](../conventions/errors.md)の「定義の誤り」）で拒否する。拒否された定義は登録されない。

- `fields` の key が schema の property に無い／schema が固定 property の object でない（record・配列・単一値）のに `fields` がある。
- `widget` / `valueLabels` を object schema に付けた／`fields` を単一値に付けた。
- 設定のラベル・設定の説明（`description`）・細目のラベルと説明・enum 値のラベルに `ja` と `en` の両方が無い。未知の `category` / `widget`、整数でない `order`。
- `account-code` / `warehouse-code` / `textarea` を string 以外に付けた。`valueLabels` の key が enum 値に無い。
- `default` が schema を通らない。

property 名と enum 値は、API が返すのと同じ `z.toJSONSchema(schema, { io: 'input' })` から読む（`settingShape`）。最上位の判定は画面（`apps/web` の `settingForm`）と同じ規則にする: 最上位が union（`anyOf` / `oneOf`。nullable の object や nullable の enum はこうなる）か、`type` が `object` そのものでない object は「その他」（JSON 入力）として扱い、`fields` / `widget` / `valueLabels` を登録時に拒否する（画面が黙って無視しないように）。nullable の文字列は `type: ["string", "null"]` で union にならないので単一値のまま。property の中の nullable は画面のフォームと同じく外して読む。この規則で、zod の包み（`.default()`、`.optional()`、nullable）の違いで画面と検査が食い違わない（両側に単体試験がある）。

リポジトリ内のすべての object 設定が全 property の日英ラベルを、すべての enum が全値のラベルを持つことは、全 module と全 pack を読み込んで registry を走査する単体試験（`apps/runtime/test/setting-labels.test.ts`）で保つ。

### 3. API

- `GET /meta/settings`: 従来の `key / label / description / schema / value` に `category`（解決済み）、`order`、`fields`、`widget`、`valueLabels`、`defaultValue`（宣言があるとき）、`isDefault`（会社に保存値が無いとき true）を足す。保存値が schema に合わないときは従来どおり `value: null` で、`isDefault: false` になる（画面は「保存値が定義に合わない」と警告する）。
- `DELETE /meta/settings/:key`: kernel の `deleteSetting` が会社の保存値を消す。会社行を `FOR UPDATE` で読み、監査 `company_settings` に op `delete`、変更前 `{ key: 値 }`、変更後 `{ key: null }` を記録する。保存値が無ければ何も書かず監査もしない。どちらも `GET` と同じ形で返す。未宣言の key は 404。
- `setSetting`（`PUT`）も同じ関数（`lockedCompanySettings`）で会社行を `FOR UPDATE` で読んでから変更前の値を記録する。同じ会社への書込みが重なっても後の書込みは前の書込みの確定を待つので、履歴の各行の変更前は一つ前の行の変更後と一致する（履歴と「変わった細目」の表示が実際の変化と食い違わない）。
- `GET /meta/settings/:key/audit`: kernel の `settingHistory` が `company_settings` の監査のうち、変更前か変更後の snapshot にその key を持つ行（`setSetting`、`deleteSetting`、pack 適用、seed）を新しい順に 20 件返す。各行は時刻・op・操作者・その key の変更前後の値。操作者の名前（同じ tenant の利用者の `name` だけ。メールは返さない）は、利用者であることが確かな id にだけ添える: `actorType: 'user'` の行の操作者と、agent の行の `onBehalfOf`（認証済みの呼出し元）。agent 自身の id は要求ヘッダー `x-agent-id`（MCP ではログイン時の agent 名）の自由な文字列で検証されないので、利用者の id と同じ文字列でも名前に解決しない（`actorName: null`。画面は `agent:<id>（<利用者> の代理）`）。
- 権限は 3 つとも `PUT` と同じ境界: admin か `settings` ロール、かつ所属の `accessScope` が店舗・拠点限定でない。kernel の `setSetting` / `deleteSetting` / `settingHistory` が同じ関数で検査するので、route を経ない呼出しでも同じになる。

### 4. 画面

- `/settings` は設定がある分類だけを kit の `Tabs` で並べ、選択を `?tab=` に保つ。タブ内は `order`、次に表示言語のラベル順。
- object は property ごと、単一値は 1 つの入力（boolean はチェックボックス、enum は選択肢ラベル付きの select、整数は数値）、record などは従来の JSON 入力。
- `account-code` は有効な勘定科目（`isActive: true`）、`warehouse-code` は倉庫を、利用者自身の権限で `GET /api/<entity>` から読んで「コード 名称」の select にする（新しい読取経路は作らない）。保存値が一覧に無ければその値を残したまま警告する。一覧は先頭 500 件までで、全件数（`total`）がそれより多いときは、一覧に無い保存値を同じ条件の `where={"code":…}` で 1 件だけ引き直し、見つからないときだけ警告する。任意の細目（schema で optional）には常に「指定しない」の選択肢を出し、空にすると module 側の省略時の扱いになる。select の末尾の「コードを直接入力…」で、まだ存在しないコードも入力できる（「設定 → 科目・倉庫を後から作る」順序を残すため。下の「却下した案」）。一覧を読めないときはコードの直接入力に戻り、403 なら「参照する権限が無い」と、それ以外は「読み込めない」と表示する。
- 会社に値が無いカードは「既定値を使用中」と既定値を表示し、フォームは既定値から始まる。値があるカードには「既定に戻す」（kit `Dialog` で確認）を出す。ただし既定値の宣言が無い JSON 入力の記録（`packs.applied`、`canReset`）には出さない（消すと会社の全テンプレートが無効になるため）。全カードに「変更履歴」を出す。履歴で会社に値が無かった側は、既定値の宣言があれば「既定値（4000）」、無ければ「未設定」と書く。
- 保存値が schema に合わないカードは「定義に合わない値」の印と警告を出す。警告の文は、既定値の宣言があれば「既定値が使われている」、無ければ「未設定として扱われている」。

### 5. 既定値とテンプレートが書いた値

「既定値」は module の宣言した `default`（`getSetting` の fallback）だけを指す。テンプレート（pack）の適用が書いた値（例: 賃貸管理の `sales.accounts.revenue = 4200`）は、ほかの保存値と同じ**会社の値**として扱う。そのため「既定に戻す」はテンプレートの値ではなく module の既定値（`sales.accounts.revenue = 4000`）に戻す。テンプレートを適用した会社（`packs.applied` が空でない）では、確認の画面にその旨を添える。テンプレートの値に戻すには、その値を入れ直すか、`pnpm pack:apply <name> --force`（API `pack.apply` の `force`。そのテンプレートの設定をすべて上書きし、seed も再実行する。ADR-0015）を使う。テンプレートごとの既定値を画面に出すことはしていない（設定定義は module ごとで、pack の既定値は pack 側の `settings` にあるため）。

### 6. kernel の設定 `company.profile`（2026-10-30 追記、[company-admin](../specs/company-admin.md)）

会社の基本情報を 1 か所に置くため、kernel が設定 `company.profile` を登録する（`kernel/src/company-profile.ts`）。`companies` の列は増やさない（移行なし）。

- schema: すべて省略可の object。`legalName`（正式名称）、`postalCode`、`address`、`phone`、`email`（メール形式）、`invoiceRegistrationNo`（`^T\d{13}$`。国税庁 タックスアンサー No.6625。実在照合はしない）、`taxStatus`（`taxable | exempt`）、`fiscalYearEndMonth`（1〜12 の整数）、`representative`。`taxStatus: 'exempt'` と登録番号の同時指定は拒否する（登録番号は適格請求書発行事業者＝課税事業者だけが持つ）。この相互検査は zod の `superRefine` で、JSON Schema には現れない（画面は API の検証エラーを細目に表示する）。
- 表示属性: `category: 'company'`、`order: 0`（会社タブの先頭）、全 9 細目の日英ラベル、住所は `textarea`、`taxStatus` の選択肢ラベル（課税事業者／免税事業者）。`default` は宣言しない（既定値は「空のプロフィール」で、「既定に戻す」は保存値を消す）。
- 登録: `ensureCompanyProfileSetting()`（冪等）を apps/runtime の `loadRuntime` が呼ぶ。`packs.applied` と同じく kernel の設定なので module の import には載らない。kernel を直接使う試験は自分で呼ぶ。
- 読取: `getCompanyProfile(ctx)`（保存値が schema に合わなければ空のプロフィールと警告ログ）、`companyProfileOf(settings)`（会社行の `settings` から。1 回の会社読取で他の設定と一緒に解決するため）。
- 最初の読み手は販売: `sales.issuer` が未設定（または schema に合わない保存値）のとき、請求書の発行者は `company.profile` の正式名称（無ければ会社名）・登録番号・郵便番号・住所・電話・メールから組み立てる（`modules/sales` の `resolveIssuer`）。`sales.issuer` が有効なら細目単位で混ぜず、それをまとめて使う（振込先など請求書だけの情報を別名義で持てるように）。申告・給与資料の読取元の切替は各資料の仕様で扱う。

### 7. 導入チェックの登録 port（2026-10-30 追記、[setup-health](../specs/setup-health.md)）

設定が業務に使える状態か（今日を含む会計期間、有効な税率、発行者、倉庫など）を点検する `GET /meta/health` のため、kernel に小さな port を足す（ADR-0013 の「足りない port は kernel に足して ADR に書く」に当たる）。

- `registry.registerHealthCheck({ id, label, order?, run })`（`kernel/src/registry.ts`）。`id` は `<module>.<name>` で一意かつ安定（B4 のウィザードが完了条件に使う）。ラベルは日英必須、`order` は整数。module は `defineModule` の `hooks` で登録する（accounting・tax・sales・inventory）。`registry.reset()` で消える。
- `run(ctx)` は `{ status: 'ok' | 'warn' | 'fail', detail: Label, href? }` を返す。`runHealthChecks(ctx, extra)`（`kernel/src/health.ts`）が、kernel の点検（`company.profile`、`system.outbox`）・登録された点検・呼出し元が渡す `extra`（API の運用点検: メール・OIDC・移行・保存先）を `order` 順に、**呼出し元の Context のまま**それぞれ savepoint の中で実行する。権限のバイパスは作らない。読めない entity の点検は「点検する権限がありません」の `warn` になる。
- 例外・不正な結果は `warn`（「点検できませんでした」）。例外の文はログにだけ出し、応答には出さない。`href` はアプリ内の相対パス（先頭が `/` 1 つ、`//`・`..`・スキームなし、200 文字以内）だけを残す（`isHealthHref`）。
- 呼出しは admin か `settings` ロール、かつ所属が店舗・拠点限定でないこと（`assertHealthAccess`。会社設定と同じ境界）。
- 規約: 点検の結果には接続先・秘密値・ファイルパス・例外の文を入れない。運用の点検は真偽と件数だけを返す（メール・OIDC は設定の有無、移行は件数、保存先は書込み可否）。
- API の運用点検を registry に登録せず `extra` で渡すのは、サーバーごとの設定（識別情報・保存先）を process 全体の registry に持ち込まないため（試験で複数のサーバーを作っても重複しない）。

## 却下した案

- **zod の `.meta()` / `.describe()` に表示情報を載せる**: JSON Schema の `title` / `description` は単一文字列で、`{ ja, en }` の規約（[コード規約](../conventions/code-style.md)）と合わない。独自 key を JSON Schema に混ぜると、API の schema を検証器に渡す利用者が困る。
- **設定画面の側に key ごとのラベル表を持つ**: module を足すたびに apps/web を変えることになり、ADR-0013 の「宣言だけから導出する」に反する。pack の設定にも届かない。
- **勘定科目コードを `ref`（id）で保存する**: 既存の保存値・pack の既定値・l10n seed がすべてコード文字列で、移行が要る。会社をまたいでコードの意味が保たれる利点もある。コードのまま保存し、画面の選択と警告で入力誤りを防ぐ。
- **存在しない科目コードを `PUT` で拒否する**: module ごとに「どの entity のコードか」を kernel が知る必要があり、科目を後から作る導入手順（設定 → 科目追加）も壊す。転記時の `INVALID_STATE` と画面の警告で扱う。

## 帰結

+ module / pack の作者は `fields` を書くだけで、設定画面が日英のラベル・選択式・既定値・履歴付きになる。
+ 定義の誤り（property 名の綴り違い、既定値の型違い）が import 時に落ちる。
− 既存の設定定義に表示属性を書いた（module 7: tax・sales・purchase・payment・inventory・contract・industry-operations、pack 3: example・retail・real-estate）。object 設定の細目ラベルと enum のラベルを書き忘れると単体試験が落ちる。
− `packs.applied` のような記録用の設定は、画面では「既定に戻す」を出さない（既定値の宣言が無い JSON 入力の記録。`canReset`）が、API の `DELETE /meta/settings/packs.applied` と JSON の編集ではまだ消せる。読取専用の表示属性は B4 の `setup.progress` と合わせて検討する。
− 「既定に戻す」はテンプレートが書いた値ではなく module の既定値に戻す（§5）。
