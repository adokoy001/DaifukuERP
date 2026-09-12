# 汎用 UI（apps/web）が meta から推論する規約

apps/web は `GET /meta`・`GET /auth/me`・アクションの出力だけから画面を作る（ADR-0002, 0009）。meta に明示の宣言が無いものは、次の**名前・形の規約**で推論する。モジュールがこの規約に乗れば画面は追加実装なしで付く。規約から外れると「何も出ない」（エラーにはならない）ので、新しいモジュールはここを見てから名前を決める。

実装の場所は括弧内。規約を変えるときはこの表・実装・unit テストを同時に直す。

## 一覧

| 規約 | meta / 出力の形 | UI がすること | 実装 |
|---|---|---|---|
| レポート | アクションの `resultKind: 'table'`（出力が TableResult、docs/conventions/reports.md） | サイドバー「レポート」と `/r/<action>`。入力フォームは `inputSchema` から | `api/reports.ts`, `pages/report-page.tsx` |
| レポートの入力 | `inputSchema` のプロパティ名 | `from`/`to`/`date`/`…Date` は日付入力、`<entity>Id`（snake_case にしたエンティティが /meta にある）は ref 検索 | `lib/schema.ts` |
| レポートの題名 | `description` の最初の文 | `試算表を返します。…` → 「試算表」 | `lib/report.ts reportTitle` |
| レポートの合計 | `totals` のキー | 列 key と一致 → 表の合計行。一致しない（`output_tax_total` など）→ 表の下に「合計」のキー・値リスト（キーはそのまま、値は小数の表示規則）。CSV も同じ順で末尾に `key,value` 行 | `lib/report.ts columnTotals / extraTotals`, `lib/csv.ts`（web-phase15 AC-7） |
| 明細グリッド | document の `lines: [{ entity, parentField }]` | ヘッダの下に明細ごとのグリッド。列は明細エンティティの `views.list`。ただし kernel 既定（非 hidden の先頭 6 項目）と同じ並びは「未宣言」とみなし全項目。親 ref と `seq` は出さない。必須かつ既定値なしの項目は必ず列に足す | `lib/lines.ts gridColumns` |
| 多相参照（明細セル） | 明細の uuid/text 項目 `<x>Id` と、同じ明細の enum 項目 `<x>Entity`（値が /meta のエンティティ名） | id 入力の下に参照先の `number`（無ければ displayField）をリンクで表示（例: `payment_allocation.invoiceId` + `invoiceEntity` → INV-2026-000006） | `lib/lines.ts polymorphicTarget`, `components/line-grid.tsx`（web-phase15） |
| ext フィールド | `EntityMeta.extFields[]`（`name: 'ext.<key>'`、ADR-0014） | フォームの「追加項目」fieldset に同じウィジェットで描画。値は `row.ext[key]`。保存時は `ext` を丸ごと送る（kernel が置換するため、フォームに無いキーは記録の値を残す。空欄はキー削除）。update は ext の値が変わったときだけ `patch.ext` を付ける | `lib/ext.ts`, `components/record-form.tsx`（web-phase15 AC-3） |
| ext の一覧列 | `views.list` に `ext.<key>` | その ext フィールドの列を出す（API が ext の orderBy をできないので並べ替え不可）。※ 現在の kernel は定義時検証で `views.list` に ext を書けない（ADR-0014 帰結）ので、将来のビュー定義用 | `lib/ext.ts listColumns`, `components/data-table.tsx` |
| ext の提出後編集 | `allowOnSubmit` | `'ext'` があれば全 ext フィールド、`'ext.<key>'` があればそのフィールドだけ、確定後も編集可 | `lib/ext.ts isExtFieldEditable` |
| エラーの紐付け | VALIDATION の `details.issues[].path` | `patch.` / `input.` / `body.` を外して先頭の項目へ。`ext.<key>` は ext フィールドへ。`lines.<entity>.<i>.<field>` は明細セルへ。どれでもなければフォーム上部 | `lib/form.ts issuesToFieldErrors`, `lib/lines.ts splitLineIssues` |
| 印刷ビュー | `<entity.module>.render_invoice_html` アクションで、`inputSchema.properties.id` がある | 確定済み document のヘッダに「請求書を表示」 | `lib/print.ts` |
| 消込（入出金の配分） | 下記「消込」 | 明細グリッドの上に 配分合計／未配分 と「未消込の請求書から選ぶ」 | `lib/allocation.ts`, `components/allocation-picker.tsx`（web-phase15 AC-1/AC-2） |
| 金額の桁 | `FieldMeta.money` / `scale`、`/auth/me` の `company.currency` | 下記「小数の表示」 | `lib/format.ts`, `lib/currency.ts`, `api/company.tsx`（web-phase15 AC-4/AC-8） |

## 2026-09-12 UI更新の規約

| 契約 | UIの動作 | 実装 |
|---|---|---|
| `FieldMeta.serverOwned` / `readOnly` / `defaultValue` | 自動計算値は新規入力・必須検証・送信から除外し、保存後は読取専用。リテラル既定値を初期表示し、既存の false/null は保持する | `lib/form.ts`, `lib/save.ts` |
| 明細の `ref: 'product'` | 品目から利用可能な `description` / `uomId` / `taxCategory` / `unitPrice` 入力列を補完。`purchase_` 明細は仕入単価、その他は販売単価。自動計算列は上書きせず、未登録の価格は補わない | `lib/product-fill.ts` |
| 読取専用 JSON `taxSummary` | 配列の各行の `category`, `rate`, `taxable`, `tax`, `gross`（任意 `label`）を区分・税率・税抜・税額・税込の表で表示。再計算せず、不明形式は原文を表示 | `lib/tax-summary.ts`, `components/tax-summary.tsx` |
| 未保存・保存中・文書の `version` | 変更中は確定/取消/削除等を無効化し、移動時は破棄を確認。再取得で未保存入力を消さず、保存・文書操作に `expectedVersion` を送る | `lib/dirty.ts`, `components/record-form.tsx`, `components/doc-actions.tsx` |
| 取消確認の任意 `correctionDate` | 送信時の実入力を取得。空欄はキーを省略して元日付、指定時は訂正日で取消を依頼する | `components/action-confirm.tsx` |

操作の変更点はユーザーマニュアルの [新UI補遺](../manual/appendix-c-ui-refresh.md) を参照。小数の表示桁と利用可能な業務通貨は別の契約であり、現在の請求・決済フローは JPY のみ。

## 消込（allocation）

meta に宣言的なヒントは無い（web-phase15 時点）。次の**全部**を満たす document に消込パネルを付ける:

1. document に `partnerId`（ref）と `direction`（enum）がある。`amount`（decimal）があれば、既定額の上限と「未配分」に使う。
2. `lines` の中に、エンティティ名が **`_allocation` で終わる**明細があり、その明細に `invoiceId`（uuid / text / ref）、`invoiceEntity`（enum）、`amount`（decimal）がある。
3. アクション **`<document.module>.outstanding`**（無ければ `<document.name>.outstanding`）が `resultKind: 'table'` で /meta にあり、`inputSchema` を持つなら `partnerId` と `direction` を受け取る。

動き:
- 「未消込の請求書から選ぶ」は区分と取引先が入力されるまで押せない。押すとフォームの**現在の値**で `POST /actions/<action> { partnerId, direction }` を呼ぶ（保存前でもよい）。
- 出力 TableResult の行から `invoiceId`・`number`・`date`・`dueDate`・`balance` を読む（`invoiceId` と小数の `balance` が無い行は出さない）。請求書エンティティは `meta.invoiceEntity`、無ければ `invoiceId` 列の `ref`。
- チェックした行の既定額 = min(残高, 未配分)。未配分 = 金額 − グリッドの配分合計 − 先にチェックした行の額。0 未満にはしない。金額が未入力なら残高。
- 額は 0 より大きく残高以下でないと「選択した請求書を追加」できない（サーバも同じ検査をする）。グリッドに既にある請求書はチェック不可（「追加済み」）。
- 追加は明細グリッドへの行の追加だけ。保存は通常の保存（ヘッダと明細を 1 リクエスト）。
- 配分合計 > 金額 のあいだは「保存」を送信前に止め、保存済みの記録でも 配分合計 > 金額 なら「確定」を押せない（サーバは確定時に再検証する）。
- 計算はすべて `lib/decimal.ts` の文字列演算（ADR-0010）。

## 小数の表示（web-phase15 AC-4 / AC-8）

- 最小桁: money（`FieldMeta.money: true`）は `FieldMeta.scale`（kernel が会社通貨から解決。JPY = 0）。scale が無いか 6 以上（kernel が通貨を知らなかったときの保存桁）なら `/auth/me` の `company.currency` の最小単位（ISO 4217、未知の通貨は 2、会社が無ければ 0）。money でない decimal（数量・率）は 0。TableResult の decimal 列は money の区別が無いので通貨の桁。
- 最大桁: 6（numeric(20,6)）。有効な小数は切り捨てずに見せる: JPY で `150` → `150`、`33.3` → `33.3`、`1234.500000` → `1,234.5`。USD なら `100` → `100.00`。
- 入力欄: フォーカス中は生の文字列、非フォーカス時は同じ規則の表示形（6 桁を超えて入力された値は生のまま見せる）。フォーカス時の差し替えは focus イベント内で DOM に反映し、Tab や全選択の選択範囲を保つ。貼り付けのカンマは除去。
- ハードコードの会社通貨は無い。`/auth/me` の読込前・会社なしは最小 0 桁。
