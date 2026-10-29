# Spec: ui-kit

- 状態: implemented
- 対象: apps/web（`src/ui/`、`src/styles.css`、汎用画面、状態表示、`i18n.tsx`）／ 依存: なし
- ADR: 0002（meta 駆動 UI）、0009（Web アプリ）。新しい ADR は不要（依存追加・API 変更なし）
- 作成: 2026-10-29 ／ 作成者: agent（完成度向上計画 D1、ブランチ `wip/ui-kit`）
- 計画: 完成度向上の実装計画 D1、改善・拡張候補 3-1 / 3-4

## 目的（1段落）

汎用画面（一覧・フォーム・設定・アクション・レポート・状態表示）は Tailwind の色ユーティリティを直書きし、専用画面は手書き CSS で色を hex で持っている。以後の B1・C1・D3 などが同じ部品と色の意味で画面を足せるよう、`apps/web/src/ui/` に小さな型付き部品と意味トークンを置き、汎用画面をそれに載せ替える。見た目の作り直しではなく土台の整理であり、既存の配色・配置・ブラウザ試験のセレクタを保つ。あわせて、読込中・0 件・失敗の表示を「次に何をすればよいか」が分かる形にそろえ、英語表示で `<html lang>` が `ja` のままになる不具合を直す。

## 受入基準（EARS）

- AC-1: THE SYSTEM SHALL `apps/web/src/ui/index.ts` から `PageHeader`、`Toolbar`、`Card`、`EmptyState`、`Skeleton`（`SkeletonRows` / `SkeletonCard` を含む）、`Button`（`buttonClass`）、`Badge`、`Tabs`（`TabPanel`）、`Dialog`、`FormSection`、`DataTableShell` を公開し、依存パッケージを追加しない。
- AC-2: THE SYSTEM SHALL `styles.css` の `:root` に意味トークン `--surface`、`--surface-muted`、`--border`、`--text`、`--text-muted`、`--accent`、`--accent-strong`、`--danger`、`--success`、`--warning`（と `*-soft` / `*-strong` などの派生）を定義し、`@theme inline` で同名の Tailwind 色（`bg-surface`、`text-text-muted`、`border-border` など）として使えるようにする。値は既存の色を写し、見た目を変えない。
- AC-3: WHEN 汎用画面（`entity-list-page`、`entity-form-page`、`settings-page`、`action-page`、`report-page`、`status-views`、`data-table`、`toast`、`docstatus-badge`、`action-confirm`）と UI キットのソースを検査する THE SYSTEM SHALL hex の色リテラルと Tailwind の生パレット色ユーティリティ（`text-red-700`、`bg-neutral-50` など）を含まない（unit テストで走査）。
- AC-4: WHEN 一覧が 0 件で検索語が無い THE SYSTEM SHALL 空状態（説明文）を表示し、IF 画面上のエンティティ操作（`ops`）に `create` がある THEN 「<エンティティ名>を登録する」導線（`/e/:entity/new`）を表示する。IF 一覧の取得に失敗した THEN 0 件とは表示せず「読み込みに失敗しました」と再試行を出す。
- AC-5: WHEN 一覧が 0 件で検索語がある THE SYSTEM SHALL 「検索条件に一致する記録はありません」と検索語を表示し、「検索をクリア」で検索語を消す。
- AC-6: WHILE 一覧の初回取得中、またはページ・検索・並べ替えの変更後に前の結果を表示している間 THE SYSTEM SHALL 前の行を半透明で出す代わりに骨格行（`aria-hidden`）を表示し、表の枠に `aria-busy="true"` を付ける。同じ条件の再取得中は行を残し、`aria-busy` と上端の細い帯で示す。
- AC-7: WHILE 画面のメタデータ等を読み込んでいる間 THE SYSTEM SHALL `LoadingView` で骨格表示と、支援技術向けの「読み込み中…」を出す（`aria-busy="true"`）。
- AC-8: IF 読込が失敗した THEN THE SYSTEM SHALL `MetaError` で「読み込みに失敗しました」、エラーコードに応じた人向けの説明、サーバーのメッセージを先に表示し、コード・HTTP 状態・hint は閉じた `<details>`（技術情報）の中に置き、「再試行」を出す。`role="alert"` は 1 つのまま保つ。
- AC-9: WHEN エラーのトーストを出す THE SYSTEM SHALL サーバーのメッセージを題名にし、hint を次の行、エラーコードを補助の小さな文字で示す（情報は削らない）。
- AC-10: WHEN 言語を切り替えた、または保存済みの言語で起動した THE SYSTEM SHALL `document.documentElement.lang` をその言語（`ja` / `en`）にする。
- AC-11: THE SYSTEM SHALL `Tabs` を `role="tablist"` / `tab` / `tabpanel`、`aria-selected`、`aria-controls`、選択中だけ `tabIndex=0` の roving tabindex で描画し、← → Home End で無効なタブを飛ばして移動・選択する。
- AC-12: WHEN `Dialog` が表示される THE SYSTEM SHALL native `<dialog>` を modal で開き、題名で `aria-labelledby` を付け、Escape と閉じるボタンで `onClose` を呼ぶ（焦点の閉じ込めと復帰は native に任せる）。`ActionConfirm` は `Dialog` の上に作り直し、既存の題名・ボタン名・訂正日のラベルを保つ。
- AC-13: THE SYSTEM SHALL `Button` の variant を既存クラスに対応させる（primary → `btn btn-primary`、default → `btn`、danger → `btn btn-danger`、ghost → `btn btn-ghost`）。既定の `type` は `button`。
- AC-14: THE SYSTEM SHALL `DataTableShell` で表の枠・固定見出し（`position: sticky`）・数値列の右寄せ（`ui-cell-num`）・空状態・骨格行を提供し、汎用一覧の `DataTable` はそれを使う。並べ替えの `aria-sort` は列見出し（`th`）に付ける。
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
- axe による自動検査（A2）

## 検証手順（E2E、実行して記録する）

1. `pnpm install --frozen-lockfile`（依存の追加が無いことを `git diff package.json pnpm-lock.yaml` で確認）
2. `pnpm format:check`、`pnpm typecheck`、`pnpm lint`、`pnpm test`（unit 全件）
3. `pnpm --filter @daifuku/web typecheck`、`pnpm --filter @daifuku/web build`
4. `node scripts/check-doc-links.mjs`
5. 隔離した fixture DB でブラウザ試験の全件（industry → chromium）。新規の `e2e/ui-kit.spec.ts` を含む
6. 置換前後の汎用画面（一覧・0 件・フォーム・設定・レポート・アクション・読込中・失敗・トースト）をデスクトップと 390px で撮影し、配色と配置が保たれていることを目視で確認する（記録用。比較の自動化はしない）

## 未決事項（利用者の判断待ち）

- 一覧の見出しは「題名＋新規」の行と「検索＋件数・ページ送り」の行（`Toolbar`）に分けた。390px で検索欄とページ送りが折り返さず並ぶようにするための小さな配置の変更であり、既存の要素・名前は変えていない。
- 設定画面の題名は他の汎用画面と同じ大きさ（22px）の `PageHeader` になった（以前は本文と同じ大きさ）。
- 一覧の表は画面の残りの高さで内側スクロールし、見出し行を固定する。外側のページ全体のスクロールよりも列名が見えることを優先した。
- 空状態の「登録する」導線は見出しの「+ 新規」と同じく画面上の `ops` で判断する。従業員・勤怠管理の専用画面で作成するエンティティは `workforceEntityForUi` が `create` を外しているため、どちらも出ない（確認済み: `api/queries.ts`）。導線の名前は「+ 新規」と重ならない「<名前>を登録する」にした（既存のブラウザ試験は `/新規/` で見出しのリンクを 1 つに特定している）。
- Web unit の DOM 検査は依存を足さず `react-dom/server` の `renderToStaticMarkup` と `React.createElement` を使う `.test.ts` にした（vitest の include は `**/src/**/*.test.ts` のままで、設定は変えない）。
