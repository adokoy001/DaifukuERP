# 汎用 UI（apps/web）が meta から推論する規約

apps/web は `GET /meta`・`GET /auth/me`・アクションの出力だけから画面を作る（ADR-0002, 0009）。meta に明示の宣言が無いものは、次の**名前・形の規約**で推論する。モジュールがこの規約に乗れば画面は追加実装なしで付く。規約から外れると「何も出ない」（エラーにはならない）ので、新しいモジュールはここを見てから名前を決める。

実装の場所は括弧内。規約を変えるときはこの表・実装・unit テストを同時に直す。

## 一覧

| 規約 | meta / 出力の形 | UI がすること | 実装 |
|---|---|---|---|
| レポート | アクションの `resultKind: 'table'`（出力が TableResult、docs/conventions/reports.md） | 「分析・レポート」の入口と `/r/<action>`。入力フォームは `inputSchema` から | `api/reports.ts`, `pages/report-page.tsx` |
| レポートの入力 | `inputSchema` のプロパティ名 | `from`/`to`/`date`/`…Date` は日付入力、`<entity>Id`（snake_case にしたエンティティが /meta にある）は ref 検索。レポート画面は明示default/titleを保持し、認識できる日付・年月・年を補完する | `lib/schema.ts`、`lib/report.ts` |
| レポートの題名 | `description` の最初の文 | `試算表を返します。…` → 「試算表」 | `lib/report.ts reportTitle` |
| レポートの合計 | `totals` のキー | 列 key と一致 → 表の合計行。一致しない（`output_tax_total` など）→ 表の下に「合計」のキー・値リスト（キーはそのまま、値は小数の表示規則）。CSV も同じ順で末尾に `key,value` 行 | `lib/report.ts columnTotals / extraTotals`, `lib/csv.ts`（web-phase15 AC-7） |
| レポート結果の操作 | 受信した `TableResult.rows` | 結果内検索・小数の正確な並替え・25/50行ページング。合計は再計算せず、元の帳票全体の集計値として表示 | `lib/report.ts reportRowsPage`、`components/report-table.tsx` |
| 明細グリッド | document の `lines: [{ entity, parentField }]` | ヘッダの下に明細ごとのグリッド。列は明細エンティティの `views.list`。ただし kernel 既定（非 hidden の先頭 6 項目）と同じ並びは「未宣言」とみなし全項目。親 ref と `seq` は出さない。必須かつ既定値なしの項目は必ず列に足す | `lib/lines.ts gridColumns` |
| 多相参照（明細セル） | 明細の uuid/text 項目 `<x>Id` と、同じ明細の enum 項目 `<x>Entity`（値が /meta のエンティティ名） | id 入力の下に参照先の `number`（無ければ displayField）をリンクで表示（例: `payment_allocation.invoiceId` + `invoiceEntity` → INV-2026-000006） | `lib/lines.ts polymorphicTarget`, `components/line-grid.tsx`（web-phase15） |
| ext フィールド | `EntityMeta.extFields[]`（`name: 'ext.<key>'`、ADR-0014） | フォームの「追加項目」fieldset に同じウィジェットで描画。値は `row.ext[key]`。保存時は `ext` を丸ごと送る（kernel が置換するため、フォームに無いキーは記録の値を残す。空欄はキー削除）。update は ext の値が変わったときだけ `patch.ext` を付ける | `lib/ext.ts`, `components/record-form.tsx`（web-phase15 AC-3） |
| ext の一覧列 | `views.list` に `ext.<key>` | その ext フィールドの列を出す（API が ext の orderBy をできないので並べ替え不可）。※ 現在の kernel は定義時検証で `views.list` に ext を書けない（ADR-0014 帰結）ので、将来のビュー定義用 | `lib/ext.ts listColumns`, `components/data-table.tsx` |
| ext の提出後編集 | `allowOnSubmit` | `'ext'` があれば全 ext フィールド、`'ext.<key>'` があればそのフィールドだけ、確定後も編集可 | `lib/ext.ts isExtFieldEditable` |
| エラーの紐付け | VALIDATION の `details.issues[].path` | `patch.` / `input.` / `body.` を外して先頭の項目へ。`ext.<key>` は ext フィールドへ。`lines.<entity>.<i>.<field>` は明細セルへ。どれでもなければフォーム上部 | `lib/form.ts issuesToFieldErrors`, `lib/lines.ts splitLineIssues` |
| 印刷ビュー | `<entity.module>.render_invoice_html` アクションで、`inputSchema.properties.id` がある | 確定済み document のヘッダに「請求書を表示」 | `lib/print.ts` |
| 消込（入出金の配分） | 下記「消込」 | 明細グリッドの上に 配分合計／未配分 と「未消込の請求書から選ぶ」 | `lib/allocation.ts`, `components/allocation-picker.tsx`（web-phase15 AC-1/AC-2） |
| 金額の桁 | `FieldMeta.money` / `scale`、`/auth/me` の `company.currency` | 下記「小数の表示」 | `lib/format.ts`, `lib/currency.ts`, `api/company.tsx`（web-phase15 AC-4/AC-8） |

## 業務分野と画面検索

ホーム・サイドバー・全画面検索・業務分野入口・パンくずは共通の `lib/navigation.ts` のカタログを使う。metadataに存在する画面と専用画面の利用条件から構築し、hrefで重複を除く。従属明細は親伝票から操作し、空の分野は表示しない。未知moduleの安全な入口は「その他」に残す。

サイドバーに全entity・全report・全moduleメニューを展開しない。`/workspaces` の画面検索と種類・ページングで探し、`/workspaces/<workspace>` では目的別の専用画面とマスター・記録を選ぶ。table帳票は分析・レポートへ集約する。既存のURLとAPI認可を保持し、module menuの外部・曖昧・未対応URLを転送しない。

画面検索はNFKC、大小文字、カタカナ/ひらがなを正規化し、複数語をANDで照合する。記録データの横断検索ではない。ホームの伝票件数は詳細を開いて選択したmoduleだけ取得する。パンくずとメニューは既存routerを使って未保存保護を通す。drawerのEscapeとフォーカス復帰を共通shellで扱う。詳細は [ナビゲーションの構造](../architecture/navigation-workspaces.md)、操作は [付録N](../manual/appendix-n-navigation.md) を参照。

## 2026-09-12 UI更新の規約

| 契約 | UIの動作 | 実装 |
|---|---|---|
| `FieldMeta.serverOwned` / `readOnly` / `defaultValue` | 自動計算値は新規入力・必須検証・送信から除外し、保存後は読取専用。リテラル既定値を初期表示し、既存の false/null は保持する | `lib/form.ts`, `lib/save.ts` |
| 明細の `ref: 'product'` | 品目から利用可能な `description` / `uomId` / `taxCategory` / `unitPrice` 入力列を補完。`purchase_` 明細は仕入単価、その他は販売単価。自動計算列は上書きせず、未登録の価格は補わない | `lib/product-fill.ts` |
| 読取専用 JSON `taxSummary` | 配列の各行の `category`, `rate`, `taxable`, `tax`, `gross`（任意 `label`）を区分・税率・税抜・税額・税込の表で表示。再計算せず、不明形式は原文を表示 | `lib/tax-summary.ts`, `components/tax-summary.tsx` |
| 未保存・保存中・文書の `version` | 変更中は確定/取消/削除等を無効化し、移動時は破棄を確認。再取得で未保存入力を消さず、保存・文書操作に `expectedVersion` を送る | `lib/dirty.ts`, `components/record-form.tsx`, `components/doc-actions.tsx` |
| 取消確認の任意 `correctionDate` | 送信時の実入力を取得。空欄はキーを省略して元日付、指定時は訂正日で取消を依頼する | `components/action-confirm.tsx` |

操作の変更点はユーザーマニュアルの [新UI補遺](../manual/appendix-c-ui-refresh.md) を参照。小数の表示桁と利用可能な業務通貨は別の契約であり、現在の請求・決済フローは JPY のみ。

## レポートとピボットの入力・表示

既存の `/r/<action>` ではスキーマの明示defaultを優先し、未指定の `date` 型 `from` を当月1日、`to` / `asOf` / `date` を今日へ補完する。`text` 型 `period` / `month` は `YYYY-MM`、数値型 `year` は西暦年。日本時間を使い、会社の会計年度・参照UUID・業務設定を作らない。生成された項目名だけを日本語ラベルへ置き換え、明示title・descriptionを保持する。初期補完は画面が送る入力であり、未指定の場合にサーバーが解決する会計年度の既定値とは別。

日付範囲には今月・先月・直近12か月、年月には今月・先月、基準日だけなら今日・先月末、年だけなら今年・前年の簡単入力を出す。12か月は当月を含む月初から今日まで。送信前に認識できる日付の実在性と `from <= to` を検証し、API側の検証も維持する。

結果内検索・並替え・ページングは追加取得しない。金額と整数の比較は十進文字列で行い、同値は受信した行のindexで安定させ、空値は昇順・降順とも最後に置く。受信行数・一致行数・表示範囲を示す。新しい結果では検索・並替え・ページを初期化し、検索・並替え・ページサイズ変更でも先頭へ戻す。`totals` と参照リンクは保持する。入力条件の変更は前回結果との不一致を表示し、再実行までCSV出力を止める。結果内検索はCSVの対象条件を変更しない。

ピボットは `/analytics` の専用画面で、既存の `TableResult` の合計を再集計する機能ではない。APIの許可対象・項目・初期状態を使い、対象切替で軸と指標を初期化する。行列各3階層・指標3個、Workerでの十進集計、最大5万行と10万集計状態、相対期間と保存設定の分離を保つ。表は行50・列12グループずつ、グラフは行の最下層を軸順に先頭24個まで表示する。保存は同じブラウザの利用者・tenant・会社ごとの設定のみで、端末間共有ではない。詳細は [分析の構造](../architecture/reporting-pivot.md)、操作は [付録M](../manual/appendix-m-analytics.md) を参照。

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

## UI キットとトークン（UI kit and tokens）

2026-10-29 に `apps/web/src/ui/` を追加した（[spec](../specs/ui-kit.md)）。新しい画面・置き換える画面はこの部品と意味トークンで作る。見た目の作り直しではなく土台であり、既存の `.btn` / `.input` / 専用画面のクラスはそのまま使える。

### どの部品を使うか

| 目的 | 部品（`import { … } from '../ui/index.ts'`） | 要点 |
|---|---|---|
| 画面の題名 | `PageHeader` | `h1` は画面に 1 つ。`back`（戻るリンク）、`eyebrow`、`meta`（技術名・番号・状態）、`icon`、`subtitle`、`actions`（右側の主操作）、`titleTestId`。`icon` と文字は折り返さない 1 行（`ui-page-header-main`）で、幅が足りないときは `actions` だけが下の行へ回る。専用画面の見た目を保つときは `className` に既存クラス（`control-heading` など）を渡し、その CSS で `flex-wrap: nowrap` などを決める |
| 検索・絞り込みの行 | `Toolbar` | `end` は右寄せ（件数・ページ送り）。`role="toolbar"` ではない（Tab 順を変えない）。名前を付けるときだけ `label` |
| 囲み | `Card` | `as="form"` でフォーム全体を 1 枚にできる（フォーム専用の属性は `as="form"` のときだけ型が通る） |
| 入力のまとまり | `FormSection` | 題名・説明・右側の操作。既定は見出しで名前を付けた `role="group"`（landmark にしない。フォームの中に並べても landmark 一覧が増えない）。ページの大きな区画にするときだけ `landmark`（`<section>`）。入力群は `as="fieldset"`（`legend` が最初の子） |
| 0 件・未実行 | `EmptyState` | 何が無いかと次の一手（新規・検索をクリア・取込）。live region にしない。画面の区画の主内容なら `titleAs="h2"`、画面全体なら `titleAs="h1"`（`NotFoundView` など） |
| 読込中 | `Skeleton` / `SkeletonRows` / `SkeletonCard`、画面単位は `LoadingView` | 骨格は `aria-hidden`。骨格の容器に `aria-busy="true"`。「読み込み中…」は `sr-only` の `aria-live="polite"` で、busy の容器の**外**に置く（中に置くと busy の間読まれないことがある）。`role="status"` にしないのは、トーストの `getByRole('status')` と重ならないようにするため |
| 表 | `DataTableShell` | 枠・固定見出し・数値列の右寄せ（`cellAlignClass('right')` = `ui-cell-num`）・空状態・骨格行。`skeleton` は初回と条件変更後（前の結果が誤解を招くとき）、`busy` だけなら行を残して上端の帯で示す。`fill` で高さを画面に合わせ、見出しを固定する。`loadingLabel` を渡すと骨格行の間だけ live region が「読み込み中…」と言う。空状態は表の後ろ（枠の中）に出すので、列が多く横に長い表でも見えている枠の幅に収まる。`aria-sort` は並べ替え中の列見出しだけに付ける（`ariaSortFor`） |
| ボタン | `Button`、リンクには `buttonClass()` | variant は primary / default / danger / ghost（既存 `.btn` 系クラスへ対応）、size は md / sm。既定の `type="button"` |
| 状態・件数 | `Badge` | tone は neutral / accent / success / warning / danger。伝票状態は `DocstatusBadge` |
| タブ | `Tabs` + `TabPanel` | `idPrefix` で tab と panel を対応させる。roving tabindex、← → Home End、無効タブは飛ばす |
| ダイアログ | `Dialog` | native `<dialog>` を modal で開く（焦点の閉じ込めと Escape は native）。題名が `aria-labelledby`、`description` が `aria-describedby`。最初の焦点は `data-autofocus` を付けた安全な操作（戻る）。React の `autoFocus` はダイアログが開く前に走るので効かない。閉じるときは呼び出し側が部品を外す（unmount）前提で、`Dialog` が外される直前に `close()` して開いた要素へ焦点を戻す（開いたままの `<dialog>` を DOM から外すとブラウザは焦点を戻さないため）。開いた要素は `Dialog` を最初に描画した時点で焦点があった要素（StrictMode の再実行でも取り直さない）。確認中に開いた要素を `busy` で無効にしてよい: 外す commit の後に焦点を戻し直す。開いた要素が消えた、または確定後の処理中で無効なままなら焦点は戻らないので、確定後の焦点はその画面で決める。**新しいダイアログは `Dialog` を使う**。既存の `WorkforceDialog` / `CommerceDialog` / `ControlDialog` は触ったときに寄せる |
| 読込の失敗 | `MetaError`（`pages/status-views.tsx`） | 「読み込みに失敗しました」→ コード別の説明 → サーバーのメッセージ → 閉じた「技術情報」（コード・HTTP・hint）→ 再試行。`role="alert"` は 1 つ |
| 操作の失敗 | `toast.error(e)` | 題名はメッセージ、次に hint、最後にコード。表示内容は `lib/error-view.ts` の `toastFromError` |

部品は翻訳済みの文字列を受け取り、`useLocale()` を呼ばない（`renderToStaticMarkup` で単体検査できるようにするため）。`ui/` が import してよいのは React と `components/icon.tsx` だけ。

`Tabs` の最初の利用者は設定画面（`/settings`、[settings-console](../specs/settings-console.md)）。ブラウザ試験 `e2e/settings-console.spec.ts` で、roving tabindex（選択中のタブだけが Tab 順に入る）、← → による移動と選択（端で反対側へ回る）、Home / End、Tab でタブ一覧からパネルへ出ることを確かめた。無効タブを飛ばす動きは、無効タブを持つ画面がまだ無いため `nextTabIndex` の unit だけで確かめている。選択を URL に残す画面は `onSelect` で `navigate({ search: { tab }, replace: true })` し、`validateSearch` で知らない値を捨て、`resolveTab` のように表示中のタブに無い値は先頭のタブへ倒す。タブ一覧が枠より広いとき（390px の設定画面は 8 タブ）は一覧の内側だけが横に動き、選択中のタブを一覧の見える範囲に入れる（`scrollToShow`。URL から選ばれたタブも読み込み時に見える。ページ全体はスクロールさせない）。端のフェードなど「続きがある」手がかりはまだ無い。

### 大きさ

`html` の文字の大きさは 14px。キットの CSS は Tailwind の theme 変数（`--text-xs` = 10.5px、`--text-sm` = 12.25px、`--spacing` = 3.5px、`--radius-sm`）で書き、置き換えたユーティリティ（`text-xs`、`p-3` など）と同じ大きさになるようにしている。固定の px は元の規則が px だったものだけ（画面題名の 22px、11px のリンク、操作部品の高さ 40px）。新しい部品も同じにする。

### 意味トークン

`styles.css` の `:root` に定義し、**色のトークンはすべて** `@theme inline` で同じ名前の Tailwind 色にしている（`ui/token-usage.test.ts` が両方の一覧の一致を確かめる）。ユーティリティ名は「プロパティ接頭辞 + トークン名」（`bg-surface`、`text-text-muted`、`border-border`、`text-danger-text`、`border-danger-border`）。CSS では `var(--surface)` のように直接使う。影と角丸（`--shadow-raised`、`--radius-*`）は CSS 専用。

| 系統 | トークン |
|---|---|
| 面 | `--canvas`（ページ背景）、`--surface`、`--surface-muted`（表の見出しなど）、`--row-stripe` / `--row-hover`（表の縞と hover） |
| 線 | `--border`、`--border-subtle`、`--border-strong`（入力欄） |
| 文字 | `--text`、`--text-strong`、`--text-heading`、`--text-secondary`、`--text-muted`、`--text-subtle`、`--text-faint`、`--text-on-accent` |
| 強調 | `--accent`、`--accent-strong`（hover）、`--accent-soft`、`--accent-border`、`--accent-on-soft`、`--link`、`--focus-ring` |
| 状態 | `--danger` / `--success` / `--warning` と、それぞれの `-soft`（通知の背景）・`-muted`（バッジの背景）・`-border`（通知の枠）・`-on-soft`（通知の文字）・`-on-muted`（バッジの文字）。トーストの枠は 1 段濃い `--danger-border-strong` / `--success-border-strong`。`--danger-strong`、`--danger-text`（白背景上の文字） |
| その他 | `--neutral-muted` / `--neutral-on-muted`（中立バッジ）、`--skeleton` / `--skeleton-shine`、`--shadow-raised`、`--radius-control`、`--radius-card` |

値は既存の配色を写したもの。ダークモードはこの `:root` を再定義すれば足せる（現在は対象外）。例外はコントラストのために変えた 2 点: `--focus-ring` は旧 `#9e7ef1` から 1 段濃い `#8f6cee`（ページ背景 `--canvas` 上で 3:1 以上）、汎用の表見出しの文字は旧 `#6e7990`（4.1:1）から `--text-muted`（4.6:1）。

コントラスト（WCAG AA）:

- 情報を伝える文字は `--text-muted` 以上の濃さを使う（`--canvas` / `--surface` / `--surface-muted` のどれの上でも 4.5:1 以上）。
- `--text-subtle`（`--canvas` 上で 3.0:1）と `--text-faint`（1.5:1）は**アイコン・区切り・装飾専用**。技術名やラベルなど読ませる文字に使わない（unit テストが `ui/` と置き換えた画面を走査する）。

規則:

- 置き換えた画面（`ui/token-usage.test.ts` の `CONVERTED`）と `ui/` には hex の色リテラルと Tailwind の生パレット色（`text-red-700`、`bg-neutral-50`、`bg-white` など）を書かない。unit テストが走査する。画面を置き換えたらそのファイルを `CONVERTED` に足す。
- 新しい色が必要なら、まずトークンを足し（値は既存色から選ぶ）、`@theme inline` にも同じ名前で足す。部品の CSS は `ui/ui.css` の `@layer components` に書き、色は `var(--token)` だけを使う。
- キットの規則は `@layer components` にあるため、layer の外にある規則（`styles.css` の `.page-content th` など汎用の規則や、専用画面の CSS）が常に勝つ。汎用の規則もトークンで書き、キットの規則と同じ値にしておく（表の見出し・縞・hover はそうしてある）。
- 専用画面の手書き CSS は、触った画面から順にトークンへ寄せる。一括書き換えはしない。

### 画面幅の分岐点

新規・置き換えの CSS は 480 / 768 / 1024 / 1280 px だけを使う（`max-width: 479px` / `767px` / `1023px` / `1279px`、または `min-width` の同じ値）。Tailwind の responsive 接頭辞は `sm` = 480px、`md` = 768px、`lg` = 1024px、`xl` = 1280px で、`2xl` は無効にしている。既存の専用画面にある 600 / 760 / 1200 px などは触ったときに寄せる。

### 状態表示の決まり

- 読込中は骨格（文字だけの「読み込み中…」や半透明にしない）。同じ条件の再取得では内容を残す。
- 0 件は `EmptyState` で理由と次の一手。検索語があるときは「検索をクリア」、作成できるときは「<名前>を登録する」（見出しの「+ 新規」と名前を分ける）。取得に失敗したときは 0 件と表示しない。
- 表の中の「検索をクリア」「再試行」を押したら、焦点を検索欄へ移す。押したボタンは再読込で消え、焦点が `<body>` に落ちるため。
- 失敗は人向けの文を先に、技術情報（コード・HTTP・hint）は折りたたみやトーストの補助行に残す。情報は削らない。
- `<html lang>` は表示言語に合わせる（`i18n.tsx` の `syncDocumentLang`）。

## 会社設定の画面（settings console）

2026-10-29 に `/settings` を作り替えた（[spec](../specs/settings-console.md)、[ADR-0027](../adr/0027-setting-presentation.md)）。画面は `GET /meta/settings` の宣言だけから作る。設定を足す module / pack は画面を触らず、`registry.registerSetting` に次を書く。

- `fields`（object schema の property ごと）: `label`（日英）、必要なら `description`、`widget`、enum なら `valueLabels`。**全 property の日英ラベルと全 enum 値のラベルが必須**（`apps/runtime/test/setting-labels.test.ts` が全 module・全 pack を読み込んで検査する）。綴り違いの property 名や型の合わない widget は登録時に `Error` になる。
- 単一値の設定は定義の直下に `widget` / `valueLabels`。boolean はチェックボックス、enum は選択肢、整数は数値の欄になる（JSON 入力にはならない）。record・配列は従来どおり JSON 入力。
- 勘定科目のコードは `widget: 'account-code'`、倉庫のコードは `'warehouse-code'`、住所・振込先などの長文は `'textarea'`。コードの選択欄は有効な勘定科目（`isActive`）・倉庫を利用者自身の権限で `GET /api/<entity>?orderBy=code:asc&limit=500` から読み、「コード 名称」で並べる。保存値はコード文字列のまま。全件数（`total`）が 500 を超えるときは、一覧に無い保存値を `where={"code":…}` で 1 件引いてから「見つかりません」と判断する（`codeIsMissing`）。任意の細目には常に「指定しない」を出す。末尾の「コードを直接入力…」で入力欄に切り替えられる（まだ無いコードを先に設定する導入手順のため。焦点は切り替えた欄へ）。一覧が読めないときは入力欄に倒し、403 は権限の文、それ以外は読込失敗の文にする。説明（`fields[].description`）は select でも入力欄でも `aria-describedby` に入れる。
- `default` に module の `getSetting` の fallback と同じ値を書く。画面は会社に値が無いとき「既定値を使用中」と既定値を表示し、入力欄も既定値から始める。
- `category` は key の先頭から決まる（`tax`→消費税、`payment`→会計、pack・業界の key→業界 など。ADR-0027）。違う分類に置くときだけ書く。`order` はタブ内の並び（無ければラベル順）。

画面の決まり:

- タブは設定がある分類だけ。選択は `?tab=` に残す。タブ内のカードは `components/setting-card.tsx`（kit の `Card` + `FormSection`）。
- 会社の値があるカードに「既定に戻す」を出し、kit の `Dialog` で確認する（最初の焦点は「戻る」）。DELETE の応答待ちの間は確認ボタンを無効にして「戻しています…」と出す。実行後はボタンが消えるので、焦点はそのカードの「保存」に移す。既定値の無い JSON の記録（`packs.applied`）には出さない。テンプレートを適用した会社では、確認の画面に「テンプレートの値ではなく module の既定値に戻る」旨を添える（ADR-0027 §5）。
- 保存値が定義に合わないカードは状態の印を「定義に合わない値」（warning）にし、既定値の有無で文を変えた警告を出す（`storedValueInvalid`、`invalidStoredText`）。
- 「変更履歴」は `GET /meta/settings/:key/audit` の直近 20 件を、時刻・op（変更 / 既定に戻す）・操作者・変わった細目の「変更前 → 変更後」で並べる。会社に値が無かった側は、既定値の宣言があれば「既定値（4000）」、無ければ「未設定」。表ではなくリストにして 390px で横にはみ出さないようにする。
- 表示用の文言とロジック（タブ、並び、既定値の文、履歴の要約）は `lib/settings-console.ts` に置き、unit で確かめる。
