# Spec: ui-kit

- 状態: implemented
- 対象: apps/web（`src/ui/`、`src/styles.css`、汎用画面、状態表示、`i18n.tsx`）／ 依存: なし
- ADR: 0002（meta 駆動 UI）、0009（Web アプリ）。新しい ADR は不要（依存追加・API 変更なし）
- 作成: 2026-10-29 ／ 作成者: agent（完成度向上計画 D1、ブランチ `wip/ui-kit`）
- 計画: 完成度向上の実装計画 D1、改善・拡張候補 3-1 / 3-4

## 目的（1段落）

汎用画面（一覧・フォーム・設定・アクション・レポート・状態表示）は Tailwind の色ユーティリティを直書きし、専用画面は手書き CSS で色を hex で持っている。以後の B1・C1・D3 などが同じ部品と色の意味で画面を足せるよう、`apps/web/src/ui/` に小さな型付き部品と意味トークンを置き、汎用画面をそれに載せ替える。見た目の作り直しではなく土台の整理であり、既存の配色・配置・ブラウザ試験のセレクタを保つ。あわせて、読込中・0 件・失敗の表示を「次に何をすればよいか」が分かる形にそろえ、英語表示で `<html lang>` が `ja` のままになる不具合を直す。

## 受入基準（EARS）

- AC-1: THE SYSTEM SHALL `apps/web/src/ui/index.ts` から `PageHeader`、`Toolbar`、`Card`、`EmptyState`、`Skeleton`（`SkeletonRows` / `SkeletonCard` を含む）、`Button`（`buttonClass`）、`Badge`、`Tabs`（`TabPanel`）、`Dialog`、`FormSection`、`DataTableShell` を公開し、依存パッケージを追加しない。`PageHeader` はアイコンと文字の塊を折り返さない 1 行に置き、幅が足りないときは `actions` だけを次の行へ回す。`FormSection` の既定は見出しで名前を付けた `role="group"`（landmark にしない）で、`landmark` 指定のときだけ `<section>`、`as="fieldset"` では `legend` を最初の子にする。
- AC-2: THE SYSTEM SHALL `styles.css` の `:root` に意味トークン `--surface`、`--surface-muted`、`--border`、`--text`、`--text-muted`、`--accent`、`--accent-strong`、`--danger`、`--success`、`--warning`（と `*-soft` / `*-muted` / `*-border` / `*-on-soft` / `*-on-muted` / `*-strong` などの派生）を定義し、**色のトークンはすべて** `@theme inline` で同名の Tailwind 色（`bg-surface`、`text-text-muted`、`border-border` など）として使えるようにする。値は既存の色を写し、見た目を変えない。例外はコントラスト（WCAG AA）のための次の変更だけとする: `--focus-ring` を `#8f6cee` に（`--canvas` 上で 3:1 以上）、汎用の表見出しの文字を `--text-muted` に（4.5:1 以上）、技術名（`ui-code`）と記録のシステム情報のラベルを `--text-muted` に。キットの大きさは Tailwind の theme 変数（`--text-xs`、`--text-sm`、`--spacing`、`--radius-sm`）で書き、置き換えたユーティリティと同じ計算値にする。
- AC-3: WHEN 汎用画面（`entity-list-page`、`entity-form-page`、`settings-page`、`action-page`、`report-page`、`status-views`、`data-table`、`toast`、`docstatus-badge`、`action-confirm`）と UI キットのソースを検査する THE SYSTEM SHALL hex の色リテラルと Tailwind の生パレット色ユーティリティ（`text-red-700`、`bg-neutral-50` など）を含まない（unit テストで走査）。
- AC-4: WHEN 一覧が 0 件で検索語が無い THE SYSTEM SHALL 空状態（説明文）を表示し、IF 画面上のエンティティ操作（`ops`）に `create` がある THEN 「<エンティティ名>を登録する」導線（`/e/:entity/new`）を表示する。空状態は表の後ろ（表の枠の中）に置き、列が多く表が画面より広くても、見えている枠の幅に収める。IF 一覧の取得に失敗した THEN 0 件とは表示せず「読み込みに失敗しました」と再試行を出し、再試行を押したら焦点を検索欄へ移す。
- AC-5: WHEN 一覧が 0 件で検索語がある THE SYSTEM SHALL 「検索条件に一致する記録はありません」と検索語を表示し、「検索をクリア」で検索語を消して焦点を検索欄へ移す。
- AC-6: WHILE 一覧の初回取得中、またはページ・検索・並べ替えの変更後に前の結果を表示している間 THE SYSTEM SHALL 前の行を半透明で出す代わりに骨格行（`aria-hidden`）を表示し、表の枠に `aria-busy="true"` を付け、枠の外の `aria-live="polite"`（`sr-only`）で「読み込み中…」を伝える。同じ条件の再取得中は行を残し、`aria-busy` と上端の細い帯で示す。
- AC-7: WHILE 画面のメタデータ等を読み込んでいる間 THE SYSTEM SHALL `LoadingView` で骨格表示（骨格の容器に `aria-busy="true"`）と、その容器の外に支援技術向けの「読み込み中…」（`aria-live="polite"`、`sr-only`）を出す。
- AC-8: IF 読込が失敗した THEN THE SYSTEM SHALL `MetaError` で「読み込みに失敗しました」、エラーコードに応じた人向けの説明、サーバーのメッセージを先に表示し、コード・HTTP 状態・hint は閉じた `<details>`（技術情報）の中に置き、「再試行」を出す。`role="alert"` は 1 つのまま保つ。
- AC-9: WHEN エラーのトーストを出す THE SYSTEM SHALL サーバーのメッセージを題名にし、hint を次の行、エラーコードを補助の小さな文字で示す（情報は削らない）。
- AC-10: WHEN 言語を切り替えた、または保存済みの言語で起動した THE SYSTEM SHALL `document.documentElement.lang` をその言語（`ja` / `en`）にする。
- AC-11: THE SYSTEM SHALL `Tabs` を `role="tablist"` / `tab` / `tabpanel`、`aria-selected`、`aria-controls`、選択中だけ `tabIndex=0` の roving tabindex で描画し、← → Home End で無効なタブを飛ばして移動・選択する。
- AC-12: WHEN `Dialog` が表示される THE SYSTEM SHALL native `<dialog>` を modal で開き、題名で `aria-labelledby`、説明文で `aria-describedby` を付け、`data-autofocus` の要素（`ActionConfirm` では「戻る」）に最初の焦点を置き、Escape・閉じるボタン・「戻る」で `onClose` を呼ぶ。WHEN 呼び出し側が `Dialog` を外す（unmount）THE SYSTEM SHALL 外す前に閉じて、開いた要素へ焦点を戻す（焦点の閉じ込めは native）。`ActionConfirm` は `Dialog` の上に作り直し、既存の題名・ボタン名・訂正日のラベルを保つ。
- AC-13: THE SYSTEM SHALL `Button` の variant を既存クラスに対応させる（primary → `btn btn-primary`、default → `btn`、danger → `btn btn-danger`、ghost → `btn btn-ghost`）。既定の `type` は `button`。
- AC-14: THE SYSTEM SHALL `DataTableShell` で表の枠・固定見出し（`position: sticky`）・数値列の右寄せ（`ui-cell-num`）・空状態・骨格行を提供し、汎用一覧の `DataTable` はそれを使う。並べ替えの `aria-sort` は並べ替え中の列見出し（`th`）だけに付ける。
- AC-15: THE SYSTEM SHALL 新規・置換した CSS の画面幅の分岐点を 480 / 768 / 1024 / 1280 px に限り、Tailwind の `sm` を 480px（30rem）にし `2xl` を無効にする。
- AC-16: THE SYSTEM SHALL 置き換えた画面で、ブラウザ試験と Web unit が使う `data-testid`・role・アクセシブル名・ラベル文言・id（`#f-name`、`#r-from` など）・クラスを保ち、ブラウザ試験の全件（industry と chromium の 2 project）が通る。

各 AC は少なくとも 1 つのテスト名に `AC-n` を含める（unit: `apps/web/src/ui/*.test.ts`、`apps/web/src/lib/error-view.test.ts`、`apps/web/src/components/list-empty-state.test.ts`、ブラウザ: `apps/web/e2e/ui-kit.spec.ts`）。AC-16 は既存ブラウザ試験の全件実行で確かめる。

## 関係するファイル・インターフェース（名指し）

- `apps/web/src/ui/`: `button.tsx`、`badge.tsx`、`page-header.tsx`、`toolbar.tsx`、`card.tsx`、`form-section.tsx`、`empty-state.tsx`、`skeleton.tsx`、`tabs.tsx`、`dialog.tsx`、`data-table-shell.tsx`、`cx.ts`、`ui.css`、`index.ts`
- `apps/web/src/styles.css`: 意味トークン（`:root`）、`@theme inline` の色対応、分岐点、`.btn-ghost` / `.btn-sm`
- `apps/web/src/lib/error-view.ts`: エラーの人向け表示（`describeError`、`toastFromError`）
- `apps/web/src/components/list-empty-state.tsx`: 一覧の空状態
- 置換: `pages/entity-list-page.tsx`、`pages/entity-form-page.tsx`、`pages/settings-page.tsx`、`pages/action-page.tsx`、`pages/report-page.tsx`、`pages/status-views.tsx`、`components/data-table.tsx`、`components/toast.tsx`、`components/docstatus-badge.tsx`、`components/action-confirm.tsx`、`pages/home-page.tsx`（ボタンのクラスのみ）
- `apps/web/src/i18n.tsx`: `syncDocumentLang`
- 文書: `docs/conventions/ui.md`「UI キットとトークン」、`docs/manual/appendix-c-ui-refresh.md` 追補

## データ・業務ルール（出典）

- 業務ルールの変更なし。表示文言は日英の両方を持つ（docs/conventions/code-style.md）。

## スコープ外（明記）

- ダークモード（トークンの再定義で後から足せる形にするだけ）
- 専用画面（業務分野・従業員・勤怠・分析・銀行など）の全面移行と、その CSS の分岐点の一括書き換え
- `WorkforceDialog` / `CommerceDialog` / `ControlDialog` の `Dialog` への置き換え（新しいダイアログは `Dialog` を使う規約だけを定める）
- アイコンセットの変更
- スクリーンショットの比較による回帰試験（CI のフォント差で不安定。自動のスクリーンショット比較は入れない）
- `FieldRow`（計画 D1 の部品候補）。項目の配置を変える D3 で `record-form` / `fields` と一緒に設計する
- `ActionConfirm` を `role="alertdialog"` にすること。15 本以上のブラウザ試験が `getByRole('dialog')` で確認画面を探しており、説明文は `aria-describedby` で読み上げられるため、今回は `dialog` のままにした
- 銀行連携の試験（`e2e/filing.spec.ts`）の会社切替直後の待ち合わせ不足（main でも起きる既存の不安定さで、D1 の変更とは無関係）
- axe による自動検査（A2）

## 検証手順（E2E、実行して記録する）

1. `pnpm install --frozen-lockfile`（依存の追加が無いことを `git diff package.json pnpm-lock.yaml` で確認）
2. `pnpm format:check`、`pnpm typecheck`、`pnpm lint`、`pnpm test`（unit 全件）
3. `pnpm --filter @daifuku/web typecheck`、`pnpm --filter @daifuku/web build`
4. `node scripts/check-doc-links.mjs`
5. 隔離した fixture DB でブラウザ試験の全件（industry → chromium）。新規の `e2e/ui-kit.spec.ts` を含む
6. 置換前後の汎用画面（一覧・0 件・フォーム・設定・レポート・アクション・読込中・失敗・トースト）をデスクトップと 390px で撮影し、配色と配置が保たれていることを目視で確認する（記録用。比較の自動化はしない）
7. 置換前と置換後の build 済み CSS で、同じ要素の置換前・置換後のマークアップの計算済みスタイル（大きさ・色・余白・位置）を Playwright で比較し、差を作業記録に列挙する（意図した差と AC-2 の例外以外が無いこと）

## 未決事項（利用者の判断待ち）

- 一覧の見出しは「題名＋新規」の行と「検索＋件数・ページ送り」の行（`Toolbar`）に分けた。390px で検索欄とページ送りが折り返さず並ぶようにするための小さな配置の変更であり、既存の要素・名前は変えていない。
- 設定画面の題名は他の汎用画面と同じ大きさ（22px）の `PageHeader` になった（以前は本文と同じ大きさ）。
- 一覧の表は画面の残りの高さで内側スクロールし、見出し行を固定する。外側のページ全体のスクロールよりも列名が見えることを優先した。
- 空状態の「登録する」導線は見出しの「+ 新規」と同じく画面上の `ops` で判断する。従業員・勤怠管理の専用画面で作成するエンティティは `workforceEntityForUi` が `create` を外しているため、どちらも出ない（確認済み: `api/queries.ts`）。導線の名前は「+ 新規」と重ならない「<名前>を登録する」にした（既存のブラウザ試験は `/新規/` で見出しのリンクを 1 つに特定している）。
- Web unit の DOM 検査は依存を足さず `react-dom/server` の `renderToStaticMarkup` と `React.createElement` を使う `.test.ts` にした（vitest の include は `**/src/**/*.test.ts` のままで、設定は変えない）。
- レビュー後の修正で意図して変えた見た目（AC-2 の例外以外）: 情報のトースト（「保存しました」など）の枠と文字を、以前の「紫の背景に Tailwind 既定の青の枠・文字」から紫の強調色（`--accent-border` / `--accent-on-soft`）にそろえた。以前の配色は `@theme` が `sky` の 300 と 900 だけ上書きしていなかったことによる偶然の混色と判断した。レポート画面の飾りのグラフアイコンは、390px で 20px 幅に潰れていたのが 32px のまま題名の横に並ぶ。アクション画面の「利用できません」の文は警告の枠付きになった。
- `Tabs` は利用画面が無いまま置いた（AC-1 で名指しされ、B1 が最初の利用者）。「未使用の部品を先に置かない」として `FieldRow` を作らなかった判断とは別扱いの例外。ブラウザでのキー操作は未検証で、B1 の受入試験に ← → Home End と無効タブの飛ばしを入れる。
- 本 spec は実装と同じセッションで確定し、最初のコミットの時点で「状態: implemented」になっていた（spec を先に draft で置く手順を守れていない）。以後の項目では spec を draft でコミットしてから実装する。
