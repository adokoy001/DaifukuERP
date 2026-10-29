# Spec: form-ergonomics（フォームのセクション・エラー要約・ショートカット・モバイル操作バー）

- 状態: draft
- モジュール: `kernel`（`views.form` のラベル付きグループ）、`apps/web`（汎用フォーム・明細グリッド） ／ 依存: [ui-kit](ui-kit.md)
- ADR: ADR-0002 への追補（`views.form` の後方互換な拡張）
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) D3

## 目的（1段落）

汎用フォームは `views.form` のグループを見出しの無い枠で並べ、保存に失敗すると各項目の下にだけエラーが出る。長い伝票では、どこが間違っているかを探してスクロールする必要があり、保存・確定はマウス操作が前提で、スマートフォンでは操作ボタンが画面外に出る。フォームに見出し付きの節、エラーの要約と焦点移動、保存と確定のショートカット、明細グリッドのキーボード操作、狭い画面の操作バー、入力の一時退避を加える。

## 受入基準（EARS）

- AC-1 THE SYSTEM SHALL `views.form` の各グループに、従来の field 名の配列に加えて `{ label: Label; fields: string[] }` の形を受け付け、`/meta` でラベルを返す。従来の形は変更なく動く。
- AC-2 WHEN グループにラベルがある THE SYSTEM SHALL グループを見出し付きの節（`fieldset` と `legend`、または見出しと `role="group"`）で表示する。768px 未満の幅でラベル付きのグループが 4 つ以上ある場合は、節の目次（ページ内リンク）を表示する。
- AC-3 WHEN 保存が検証エラーで失敗した THE SYSTEM SHALL フォームの先頭に `role="alert"` の要約（件数と、各項目へのリンク）を表示し、最初の不正な項目へ焦点を移す。明細のエラーは行番号と列名で示す。
- AC-4 THE SYSTEM SHALL 必須項目に視覚的な印と支援技術向けの `aria-required` を付け、field の説明を `aria-describedby` で関連付ける。
- AC-5 WHEN フォームに焦点がある状態で `Ctrl+S`（macOS は `⌘+S`）を押した THE SYSTEM SHALL ブラウザの保存ダイアログを開かずに保存を実行する。`Ctrl+Enter` は確定できる状態の document で確定の確認ダイアログを開く。保存中・未保存の変更がある場合の既存の制限は維持する。
- AC-6 WHEN 明細グリッドのセルで `Enter` を押した THE SYSTEM SHALL 同じ行の次の入力セルへ、行末なら次の行の先頭へ移り、最終行の末尾では編集可能な場合に新しい行を追加する。`Alt+↑` / `Alt+↓` で行を移動し、`Ctrl+Delete`（確認付き）で行を削除する。
- AC-7 WHILE 画面幅が 768px 未満 THE SYSTEM SHALL 保存・確定などの主操作を画面下部の固定バーに表示し、入力欄を隠さない（バーの高さ分の余白を確保する）。
- AC-8 WHEN 未保存の入力がある状態で画面を離れた、または再読込した THE SYSTEM SHALL 入力値を entity・id（新規は entity と `new`）ごとにタブ内（`sessionStorage`）へ退避し、同じ画面を開き直したときに「前回の入力を復元しますか」と提案する。保存に成功したら退避を消す。版が変わった既存記録には復元を提案しない。
- AC-9 WHEN 一覧から記録を開いた THE SYSTEM SHALL 一覧と同じ条件の前後の記録へ移動する「前へ」「次へ」を表示する（未保存の変更がある場合は既存の破棄確認を通す）。
- AC-10 THE SYSTEM SHALL 文言を日本語と英語で持ち、ショートカットの一覧をフォームのヘルプ（`?` ボタン）で表示する。

## 関係するファイル・インターフェース（名指し）

- kernel: `kernel/src/dsl/types.ts`（`ViewsConfig.form`）、`kernel/src/meta.ts`（グループのラベル出力）、定義時検証
- web: `apps/web/src/components/record-form.tsx`、`apps/web/src/lib/form.ts`（グループ解釈）、`apps/web/src/components/line-grid.tsx`、`apps/web/src/lib/form-draft.ts`（新規、退避）、`apps/web/src/pages/entity-form-page.tsx`、`apps/web/src/pages/entity-list-page.tsx`（前後移動の id 列を渡す）
- modules: 主要な伝票（売上請求書・仕入請求書・入出金・契約）の `views.form` にラベルを付ける
- docs: `docs/adr/0002-declarative-entity-dsl.md`（追補）、`docs/conventions/ui.md`、`docs/manual/02-basics.md`

## データ・業務ルール（出典）

- 確定済み伝票の不変と未保存保護 — ADR-0006、[ui-refresh](ui-refresh.md)。退避は端末内だけで、サーバーへ送らない。

## スコープ外（明記）

- フォームの項目配置を利用者が変更する機能
- 明細の Excel からの貼り付け（次版）
- 退避の端末間共有

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`（kernel を変更するため DB 全件へ昇格）
2. 単体: グループ解釈（新旧の形）、エラー要約の項目対応、ショートカットの判定、退避の保存と破棄、版の変化（AC-1〜AC-5、AC-8）
3. ブラウザ: 売上請求書で必須項目を空にして保存 → 要約と焦点、`Ctrl+S` で保存、明細の `Enter` 移動と行追加、390px の操作バー、再読込後の復元提案、一覧からの前後移動（AC-2〜AC-10）
4. `pnpm gate:full`

## 未決事項（利用者の判断待ち）

- `Ctrl+Delete` の行削除を初版に含めるか（誤操作の懸念。確認付きで含める）。
