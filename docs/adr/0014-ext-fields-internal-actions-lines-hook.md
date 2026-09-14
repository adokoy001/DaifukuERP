# ADR-0014: ext フィールドはコードで登録して Repository で検証する。internal アクションと after_lines_saved を足す

- 状態: 採択（2026-09-11、docs/specs/kernel-phase15.md）／ 確信度: 中
- 関連: ADR-0003（型付きコア＋JSONB `ext`）、0008（拡張機構: フック一覧）、0009（アクションの REST/MCP 自動公開）、0010（Decimal）、0013（ポートとカスタマイズ 4 層）

## 文脈
- ADR-0003 は `ext` に「定義」で型を与える方針だったが、Phase 1 の `ext` は `z.record(string, unknown)` のままで、pack が項目を足しても検証・一覧フィルタ・検索・汎用フォーム（meta）のどれにも乗らなかった。導入テンプレート（pack）が「コアを改変せずに項目を足す」には、この L2 のポートが要る。
- エンティティの zod（`buildSchemas`）は `defineEntity` の時点で作られる。pack の ext 登録はそれより後（モジュール import の後）に来るので、定義時スキーマに ext を焼き込めない。
- 伝票明細の再計算: sales / purchase は明細の after_create / after_update / after_delete ごとにヘッダを再保存していた。汎用 create/update の replace-all（`saveLines`）で N 明細を保存すると N 回再計算になる（sales の 3 明細作成でヘッダ version 4、監査の update 行 3 件）。
- `sales.record_payment` / `purchase.record_payment` は payment モジュールが同一トランザクションで呼ぶ内部 API（会計転記をしない）だが、ADR-0009 の「全アクション自動公開」で REST・OpenAPI・/meta・MCP に出ており、エージェントが転記なしで消込だけ動かせる経路になっていた。
- web は会社通貨を知る手段がなく JPY 固定、`/meta` には金額と数量の区別も無かった（docs/log/2026-09-11-web-polish.md の判断待ち）。

## 決定
1. **ext フィールドはコードで登録する**: `registry.registerExt(entityName, fields: FieldMap, { source })`。フィールドはエンティティと同じ `f.*` ビルダ。登録時チェック（`kernel/src/dsl/ext.ts`、全部通るまで何も登録しない）:
   - エンティティ未登録 → `DependencyError`（HAS_DEPENDENTS を「定義時の依存欠落」に流用。hint は定義モジュールの import）
   - システム項目・伝票項目・そのエンティティ自身の項目との衝突、camelCase でないキー、JSONB に置けない種別（`lines` 等）、列専用オプション（`unique` / `index` / `immutable`）と `default`、`ext: false` のエンティティ → `ValidationError`（`ext.<key>` の issue）
   - 同じエンティティへの同じキーの二重登録 → `Conflict`（hint に双方の `source`）
   - `ref` は許可（uuid として検証、JSONB 内なので FK は無い）。`searchable: true`（TextOpts）は ext 専用で、エンティティ項目に付けると定義エラー（エンティティは `views.search`）。
   - 既存の `ext_field_definitions` テーブルは今回使わない。pack はコードとして入る（ADR-0013 L3/L4）ので、定義もコードと一緒にレビュー・テスト・ゲートに乗せる。テナント別のノーコード定義（L2 の DB 定義）が要るときは、テーブルから同じ登録 API に流し込むアダプタを足す。
2. **検証は Repository の parse 直後の別ステップ**（`kernel/src/ext.ts` `validateExt`）。ext 用 zod はレジストリから遅延生成し、エンティティごとの `registry.extVersion(entity)`（登録で単調増加、`reset` をまたいでも戻らない）でキャッシュを無効化する。
   - 登録キーはフィールドの zod（required / enum / decimal 文字列 / date / uuid / normalize）で検証。未登録キーはそのまま保存（ADR-0003 の自由形式を残す）。
   - Decimal は正規形の文字列（`'100000.50'` → `'100000.5'`）、timestamp は ISO 文字列で JSONB に入る。
   - insert は必須 ext キーを要求（`ext` 自体を省略しても）。update は patch に `ext` があるときだけ検証（`ext` は丸ごと置換される既存の意味を変えない）。
3. **一覧の `where` と `search`**（`kernel/src/repository/ext-query.ts`）:
   - `where: { 'ext.<key>': … }` は登録済みキーのみ（typo は登録キー一覧を hint に VALIDATION）。`(ext ->> '<key>')` のテキスト比較で、等価・`null`・`$in`（空なら偽）・`$ne`・text 種別の `$like`。範囲演算子は拒否（テキスト順は数値順ではない）。decimal 項目の比較値は正規形にしてから比べる。`$or`/`$and` の中、rowRules の domain でも同じ規則。
   - キーは登録時の正規表現（`^[a-z][A-Za-z0-9]*$`）を通ったものだけなので SQL にリテラルとして埋め込み、値はバインドする。完全一致の `equalityIndex: true` は、[ADR-0026](0026-ext-equality-indexes.md) の内部計算列と B-tree で候補を絞り、全文比較を残す。RLS 下での利用を実行計画で検査する。
   - `searchable: true` の text ext は汎用 `search` の OR 条件に加わる（normalize も同じ）。`orderBy` の ext は対象外。
4. **meta と入力スキーマ**: `EntityMeta.extFields: FieldMeta[]`（`name` は `ext.<key>`、`source`・`searchable` 付き、登録が無ければ `[]`。`fields` には混ぜない）。汎用 `<entity>.create` / `.update` の `input`（OpenAPI・MCP tool の inputSchema の元）は、`registerCrudActions` の後に登録された ext も含めて `ext` の形を載せる（input を getter にして extVersion が変わったら再生成。明細エンティティの ext も lines 入力に載る）。これらのアクションは lenient なので、スキーマは説明用で、検証は 2. の Repository が行う。
5. **`after_lines_saved` フック**: `HOOK_PHASES` に追加。`saveLines` 1 回につき 1 回、全明細セットの置換が終わってから発火（汎用 create/update・`amendDocument`・直接呼び出しのどれでも）。`HookArgs.row` は親の再読込（フックごとに読み直すので、前のフックの更新が見える。他の after_* と同じく DB の生の行）、`HookArgs.lines` は伝票の全明細セット（`lineEntity → 行[]`、seq 順、Decimal）。
   - 明細側のフックが「いま saveLines の途中か」を知るために `isSavingLines(ctx, documentName, id)` を公開する（読み取り専用。発火前に false に戻る。失敗時も戻る）。
   - sales / purchase は `after_lines_saved` でヘッダを 1 回再計算し、明細の after_* フックの再計算は saveLines 中は何もしない。明細を repo や `<line>.create/update/delete` で直接書く経路は従来どおり 1 行ごとに再計算する（REST/MCP で明細を直接書いてもヘッダが古くならない）。純粋な再計算サービスはそのまま。
6. **internal アクション**: `ActionConfig.internal?: boolean`（既定 false、`ActionDef.internal` は必ず boolean）。`runAction` では従来どおり実行できる（権限・入出力検証も同じ）。apps は `registry.actions()`（既定で internal を除外、`{ includeInternal: true }` で全部）から `/actions/*` ルート・OpenAPI・/meta の actions・MCP tools を作る。`registry.allActions()` は全件のまま。`POST /actions/<internal>`（汎用 catch-all）と REST sugar は `callAction` で 404 NOT_FOUND（hint: 内部アクション）。MCP の `tools/call` も「存在しない tool」。`sales.record_payment` / `purchase.record_payment` を internal にした。
7. **通貨桁**: `currencyScale(currency)`（`kernel/src/settings.ts`。JPY / KRW → 0、その他 2。表示のヒントであり、税の丸めは modules/tax の規則）。`findCompany(ctx)`（会社が無ければ null）を足し、`getCompany` はその上に置く。
   - `f.money()` は `money: true` を持ち、既定の `scale: 6` を外した（列は常に numeric(20,6) なのでスキーマ変更なし）。`entityMeta / appMeta(ctx, { currency })` で money の `FieldMeta.scale` を会社通貨から解決する。明示の `scale` が優先、通貨が渡されなければ従来どおり 6。`FieldMeta.money: true` で数量・率と区別できる。apps/api の `/meta` と `/meta/entities/:name` は呼び出し側の会社の通貨を渡す。
   - `/auth/me` は `company: { id, name, currency } | null` を返す（settings は含めない。設定は `/meta/settings`）。

## 帰結
+ pack がコア改変・マイグレーションなしで項目を足し、検証・保存・一覧フィルタ・検索・meta（汎用フォーム）・OpenAPI/MCP の入力説明まで一通り使える。
+ 伝票保存の再計算回数が明細数に比例しなくなった（sales の 3 明細作成でヘッダ更新 3 回 → 1 回、version 4 → 2。purchase も同様）。ヘッダの監査 update 行も同じだけ減る。
+ 内部 API がエージェント・外部クライアントに露出しない。モジュール間の in-process 呼び出しは変わらない。
+ web が会社通貨の桁と「金額かどうか」を meta / `/auth/me` から得られる。
− ext の登録は process-wide（全テナント共通）。テナントごとに項目を変えるには DB 定義からの流し込みが別途要る。
− 必須 ext を後から登録すると、その値を持たない既存行の amend や、ext を含む update が VALIDATION になる。既存データの補完は pack 側の責任。
− ext の範囲検索・並び替えは未対応。数値範囲で探したい項目は通常列（pack の `defineEntity`）にする。
− `views.list` は定義時検証なので、エンティティ定義に `ext.<key>` を書けない（一覧列に ext を出す仕組みは L2 のビュー定義として別途）。
− money の `FieldMeta.scale` を通貨桁（JPY = 0）にしたので、「scale を超える桁は表示しない」UI では端数のある単価・未丸めの金額（例 1234.5）が切り捨て表示になる。scale を最小桁として扱うか、端数を持つ money 項目に明示 `scale` を付けるかは web 側で判断が要る（kernel-phase15 作業記録の判断待ち）。
− kernel のポートが増えた（`registerExt`、`isSavingLines`、`findCompany` / `currencyScale`、`registry.actions`）。ADR-0013 の「ポート数が 15 を超えたら再検討」に近づいている。
− `DependencyError` を「未登録エンティティ」にも使うので、HAS_DEPENDENTS（409）の意味が「cancel 時の依存文書」だけではなくなった（定義時エラーで HTTP には出ない）。

## 最強の反論
- **ext 定義は ADR-0003 どおり DB（`ext_field_definitions`）に置くべきで、コード登録はテナント別カスタマイズを殺す。** → 本実験の主経路は「エージェントが小さなパックを書く」（ADR-0013）。定義をコードに置けばレビュー・テスト・ゲートがそのまま効き、テナント差分が要るときは DB 定義 → `registerExt` 相当のアダプタを足せば API は変わらない。逆（DB 先行）にすると検証・検索の規則をテーブル駆動で二重に持つことになる。
- **`isSavingLines` は「フックがカーネルの内部状態を覗く」抜け道で、フック同士の相互作用を読みにくくする。saveLines 中は明細の after_* を発火させない方がきれい。** → 明細の after_* を一律に止めると、再計算以外の目的（行ごとのイベント・監査連携）で登録した pack のフックが黙って動かなくなる。問い合わせは読み取り専用で、用途は「親の再計算を after_lines_saved の 1 回にまとめる」に限る（sales / purchase のコメントに明記）。
