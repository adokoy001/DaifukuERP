# 作業記録: 2026-10-30 フォームのセクション・エラー要約・ショートカット・モバイル操作バー（D3）

- セッション: 完成度向上計画 D3（workflow の作業項目、worktree `wip/form-ergonomics`、基点 `ff65a6c`）／ 担当: agent ／ 対象: [docs/specs/form-ergonomics.md](../specs/form-ergonomics.md)
- 計測: tokens=null（未計測）, agent_minutes=約110（設計と読込 約20、実装と単体 約45、ブラウザ試験と修正 約20、文書 約25。gate の待ち時間を除く）, human_minutes=0, rework_lines=約30（後述の StrictMode の退避削除の修正、狭い画面の案内文）, gate_failures=0

## 決めたこと（と理由）

- **`views.form` は混在可の後方互換な拡張（ADR-0002 追補、新しい ADR 番号なし）。** グループは `string[]` か `{ label, fields }`。`/meta` は従来の形のグループを `string[]` のまま出すので、ラベルを使わない entity の meta は変わらない。定義時に未知・重複の field、日英どちらかが空のラベル、空のラベル付きグループを拒否する。従来 `views.form` は未検査だったため、全 module を読み込む単体・DB の全 suite で既存定義に違反が無いことを確かめた。
- **狭い画面はタブ（草案の「節の目次」から変更）。** 計画 D3 と統合担当の指示がタブだったため。タブは他の節を隠すので、エラーのある節のタブに件数を出し、保存失敗時と要約のリンクはその節のタブを開いてから焦点を移す。ラベル付きの節（追加項目を含む）が 4 つ以上で 768px 未満のときだけ。新規作成で入力できる節が 2 つしかない売上請求書の新規画面はタブにならない（編集画面は 4 節でタブ）。
- **要約が唯一の `role="alert"`。** 各項目の下のエラーは alert をやめ、入力欄の `aria-describedby`（エラー → 補助文の順）で読ませる。設定・レポート入力の `FieldWidget` は従来どおり alert（`alertError` の既定値 true）。要約は保存の試行ごとに出し、焦点は新しい試行のときだけ動かす（直して要約が縮んでも焦点は動かない）。配分超過など項目の無い文はリンクなしで先頭に置く。
- **`Ctrl+Enter` の意味は「進める」。** 従来は保存。未保存の変更・新規・確定できない記録では従来どおり保存し、未保存の変更が無い下書き document だけ確定の確認を開く。見出しの「確定」と同じ確認を出すため、`DocActions` に React 19 の `ref` で `request('submit')` を足した（確定の可否の判定を 2 か所に書かない）。`Ctrl+S` は記録の画面のどこからでも保存し、ブラウザの「ページを保存」を常に止める。モーダルが開いている間はどちらも何もしない（`Ctrl/⌘+K` と同じ規則）。修飾キーはプラットフォームのものだけ。
- **明細の `Enter` は行方向。** 計画どおり、同じ行の次の入力セル → 次の行の先頭 → 最終行の後ろで行を追加。旧来の「同じ列の下の行へ」から変わるが、既存のブラウザ試験（最終行の最後の入力欄で Enter → 行追加）はそのまま通る。参照欄は焦点を受けると候補一覧を開くため、何も入力・選択していない状態の Enter は候補を選ばずに先へ渡すようにした（従来は読込が終わっていると 1 件目を選んでいた。ヘッダでは他のテキスト欄と同じく Enter で保存になる）。`Alt+↑/↓` は参照欄でも取らずにグリッドへ渡す。
- **`Ctrl+Delete` の行削除は入れない。** 入力欄での「次の単語を削除」と衝突し、`Ctrl+Shift+Delete` はブラウザの閲覧履歴削除。spec の未決事項を「初版に含めない」で閉じた。
- **狭い画面のバーは sticky のまま。** 761〜767px はサイドバーが出るため `position: fixed` だと重なる。既存の sticky バーに確定（`SubmitControl`）を足し、768px 未満だけ表示、見出しの確定はその幅で隠す（確定ボタンは常に 1 つ。既存の 390px のブラウザ試験の `getByRole('button', { name: '確定' })` が一意のまま）。`scroll-padding-bottom` で焦点の入力欄がバーに隠れないようにした。キーボードの案内文は 768px 未満で隠す。
- **退避は変更分だけ、境界は navigation-assist と同じ。** 記録の全値をタブに複製しないため、変更した値と変更した明細の行だけを `sessionStorage` に書く。キーは `[tenant, user, company, entity, target]`。読取専用・サーバー所有・非表示・利用者に見えない項目に加え、権限の field group に属する項目（`FieldMeta.restricted`、今回 `/meta` に追加）も書かない。個人情報の entity（`workforce_`・`filing_payroll_`）は退避しない。版が変わった記録は提案せず消して知らせる。明示的なログアウト（既存の `forgetRecentNames` に追加）ですべて消し、401 の期限切れでは残す（同じ利用者の再ログインで戻る）。403/404 で記録が読めなくなったらその記録の退避を消す。新規は `new`、複製・クイック操作の新規は seed ごとに `new:<seed key>`。提案は自動では当てず、提案中に入力を始めたら提案を取り下げる。12 時間で無効。
- **前後移動はページを越える。** 一覧は表示中の id 列・条件・総件数を router state で渡し（複製の seed と同じくセッションに結び付ける）、記録の画面はページの端で同じ条件の隣のページを読む。一覧と同じ `where` を作るため `lib/record-nav.ts listStateOf` に寄せ、一覧もそれを使うようにした。移動は履歴を置き換える。「← 一覧名」と削除後の移動は元の条件の一覧へ。
- **ラベルは 5 entity。** 取引先（7 節）・売上請求書（4 節）・仕入請求書（5 節）・入出金（4 節）・契約（5 節）。売上請求書は `currency`・`taxSummary`・`controlAccountId` を節に入れ、末尾の見出しなしの枠を無くした。
- **新しい部品はトークンだけ。** `form-sections.tsx`・`form-error-summary.tsx`・`form-draft.tsx`・`form-shortcuts-help.tsx`・`record-nav.tsx` を `token-usage.test.ts` の `CONVERTED` に足した。分岐点は 768px（`max-width: 767px`）だけ。

## やったこと

- kernel: `dsl/types.ts`（`FormGroup`）、`dsl/entity.ts`（`validateFormGroups`）、`meta.ts`（`FormGroupMeta`、`FieldMeta.restricted`）、`index.ts`
- modules: 取引先・売上請求書・仕入請求書・入出金・契約の `views.form`
- web 新規: `lib/form-errors.ts`、`lib/form-shortcuts.ts`、`lib/form-draft.ts`、`lib/record-nav.ts`、`components/form-sections.tsx`、`components/form-error-summary.tsx`、`components/form-draft.tsx`、`components/form-shortcuts-help.tsx`、`components/record-nav.tsx`
- web 変更: `components/record-form.tsx`（節・タブ・要約・焦点・ショートカット・退避・バー）、`components/line-grid.tsx`（Enter / Alt+矢印、セルの `aria-describedby`・`required`）、`components/fields/*`（補助文・必須・`aria-describedby`、参照欄の Enter と Alt+矢印）、`components/doc-actions.tsx`（`ref` の `request`、ボタンのクラス）、`pages/entity-form-page.tsx`（前後移動・確定の受け渡し・403/404 の退避削除）、`pages/entity-list-page.tsx`（router state）、`api/client.ts`（`sessionOwner` を共有）、`components/record-links.tsx`（同）、`api/navigation-assist.ts`（ログアウトで退避を消す）、`lib/form.ts`（`formSections` / `sectionLayout` / `needsInput`）、`strings.ts`、`styles.css`、`api/types.ts`
- テスト: `kernel/test/form-groups.test.ts`（5 件）、`apps/web/src/lib/form-ergonomics.test.ts`（27 件）、`apps/web/src/components/form-ergonomics-ui.test.ts`（6 件）、`apps/web/e2e/form-ergonomics.spec.ts`（9 件）、`ui/token-usage.test.ts` の対象追加
- 文書: spec（implemented、改訂の記録）、ADR-0002 追補、`docs/conventions/ui.md`（表の行と節）、`docs/manual/02-basics.md`（フォーム・キーボード操作・スマートフォン・一時保存・前後移動・明細）

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- （下の「計測の結果」に追記する）

## 見つけた問題と修正（発見経路つき）

- （追記する）

## 未実施（減らさない。完了したら「済」を付けて残す）

- `pnpm gate:full`（統合担当が実行する）。
- pack の `labelOverrides` で節の見出しを変える機能（spec のスコープ外）。
- 明細の行削除のショートカット（入れない判断。必要なら衝突しないキーを利用者と決める）。

## 判断待ち（利用者）

- 狭い画面のタブ（草案は目次）と、`Ctrl+Enter` を「未保存なら保存・保存済みの下書きなら確定の確認」にした判断。別の挙動を望む場合は spec を改める。

## 次のセッションへ

- 他の長いフォームを持つ entity（品目・勘定科目・仕訳・在庫の伝票など）にもラベルを付けると、狭い画面でタブになる。付ける目安は `ui.md` の「フォームの節」。
- `/meta` の `views.form` を読む外部の利用者（MCP の resource）は要素がオブジェクトの場合を扱う必要がある（ADR-0002 追補の帰結）。
