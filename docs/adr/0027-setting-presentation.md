# ADR-0027: 会社設定の表示属性は設定定義に持たせ、登録時に schema と照合する

- 状態: 採択（2026-10-29）／ 確信度: 中
- 関連: [ADR-0013](0013-hexagonal-ports.md)（L1 設定 `registerSetting`）、[ADR-0015](0015-packs.md)（pack の設定既定値）、[受入基準](../specs/settings-console.md)、[UI 規約](../conventions/ui.md)
- 追記予定: B2 の `company.profile`（[company-admin](../specs/company-admin.md)）、B4 の `setup.progress`（[setup-wizard](../specs/setup-wizard.md)）をこの ADR に節として足す

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
- ラベル・説明に `ja` と `en` の両方が無い。未知の `category` / `widget`、整数でない `order`。
- `account-code` / `warehouse-code` / `textarea` を string 以外に付けた。`valueLabels` の key が enum 値に無い。
- `default` が schema を通らない。

property 名と enum 値は、API が返すのと同じ `z.toJSONSchema(schema, { io: 'input' })` から読む（`settingShape`）。画面と検査が同じ表現を見るので、zod の包み（`.default()`、`.optional()`、nullable）の違いで食い違わない。

リポジトリ内のすべての object 設定が全 property の日英ラベルを、すべての enum が全値のラベルを持つことは、全 module と全 pack を読み込んで registry を走査する単体試験（`apps/runtime/test/setting-labels.test.ts`）で保つ。

### 3. API

- `GET /meta/settings`: 従来の `key / label / description / schema / value` に `category`（解決済み）、`order`、`fields`、`widget`、`valueLabels`、`defaultValue`（宣言があるとき）、`isDefault`（会社に保存値が無いとき true）を足す。保存値が schema に合わないときは従来どおり `value: null` で、`isDefault: false` になる（画面は「保存値が定義に合わない」と警告する）。
- `DELETE /meta/settings/:key`: kernel の `deleteSetting` が会社の保存値を消す。会社行を `FOR UPDATE` で読み、監査 `company_settings` に op `delete`、変更前 `{ key: 値 }`、変更後 `{ key: null }` を記録する。保存値が無ければ何も書かず監査もしない。どちらも `GET` と同じ形で返す。未宣言の key は 404。
- `GET /meta/settings/:key/audit`: kernel の `settingHistory` が `company_settings` の監査のうち、変更前か変更後の snapshot にその key を持つ行（`setSetting`、`deleteSetting`、pack 適用、seed）を新しい順に 20 件返す。各行は時刻・op・操作者（同じ tenant の利用者なら名前だけを添える。メールは返さない）・その key の変更前後の値。
- 権限は 3 つとも `PUT` と同じ境界: admin か `settings` ロール、かつ所属の `accessScope` が店舗・拠点限定でない。kernel の `setSetting` / `deleteSetting` / `settingHistory` が同じ関数で検査するので、route を経ない呼出しでも同じになる。

### 4. 画面

- `/settings` は設定がある分類だけを kit の `Tabs` で並べ、選択を `?tab=` に保つ。タブ内は `order`、次に表示言語のラベル順。
- object は property ごと、単一値は 1 つの入力（boolean はチェックボックス、enum は選択肢ラベル付きの select、整数は数値）、record などは従来の JSON 入力。
- `account-code` は有効な勘定科目（`isActive: true`）、`warehouse-code` は倉庫を、利用者自身の権限で `GET /api/<entity>` から読んで「コード 名称」の select にする（新しい読取経路は作らない）。保存値が一覧に無ければその値を残したまま警告する。一覧を読めないときはコードの直接入力に戻る。
- 会社に値が無いカードは「既定値を使用中」と既定値を表示し、フォームは既定値から始まる。値があるカードには「既定に戻す」（kit `Dialog` で確認）と、全カードに「変更履歴」を出す。

## 却下した案

- **zod の `.meta()` / `.describe()` に表示情報を載せる**: JSON Schema の `title` / `description` は単一文字列で、`{ ja, en }` の規約（[コード規約](../conventions/code-style.md)）と合わない。独自 key を JSON Schema に混ぜると、API の schema を検証器に渡す利用者が困る。
- **設定画面の側に key ごとのラベル表を持つ**: module を足すたびに apps/web を変えることになり、ADR-0013 の「宣言だけから導出する」に反する。pack の設定にも届かない。
- **勘定科目コードを `ref`（id）で保存する**: 既存の保存値・pack の既定値・l10n seed がすべてコード文字列で、移行が要る。会社をまたいでコードの意味が保たれる利点もある。コードのまま保存し、画面の選択と警告で入力誤りを防ぐ。
- **存在しない科目コードを `PUT` で拒否する**: module ごとに「どの entity のコードか」を kernel が知る必要があり、科目を後から作る導入手順（設定 → 科目追加）も壊す。転記時の `INVALID_STATE` と画面の警告で扱う。

## 帰結

+ module / pack の作者は `fields` を書くだけで、設定画面が日英のラベル・選択式・既定値・履歴付きになる。
+ 定義の誤り（property 名の綴り違い、既定値の型違い）が import 時に落ちる。
− 既存の設定定義に表示属性を書いた（module 7: tax・sales・purchase・payment・inventory・contract・industry-operations、pack 3: example・retail・real-estate）。object 設定の細目ラベルと enum のラベルを書き忘れると単体試験が落ちる。
− `packs.applied` のような記録用の設定も「既定に戻す」で消せる（従来の `PUT {}` と同じ結果）。読取専用の表示属性は B4 の `setup.progress` と合わせて検討する。
