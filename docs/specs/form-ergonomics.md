# Spec: form-ergonomics（フォームのセクション・エラー要約・ショートカット・モバイル操作バー）

- 状態: implemented（2026-10-30）
- モジュール: `kernel`（`views.form` のラベル付きグループ、`FieldMeta.restricted`）、`apps/web`（汎用フォーム・明細グリッド・一覧からの前後移動） ／ 依存: [ui-kit](ui-kit.md)、[list-workbench](list-workbench.md)、[document-links](document-links.md)、[navigation-assist](navigation-assist.md)
- ADR: [ADR-0002](../adr/0002-declarative-entity-dsl.md) への追補（`views.form` の後方互換な拡張）。新しい ADR 番号は使わない
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) D3。2026-10-30 に実装担当が実装に合わせて改訂（末尾「改訂の記録」）

## 目的（1段落）

汎用フォームは `views.form` のグループを見出しの無い枠で並べ、保存に失敗すると各項目の下にだけエラーが出る。長い伝票では、どこが間違っているかを探してスクロールする必要があり、保存・確定はマウス操作が前提で、スマートフォンでは操作ボタンが画面外に出る。フォームに見出し付きの節、エラーの要約と焦点移動、保存と確定のショートカット、明細グリッドのキーボード操作、狭い画面の操作バー、入力の一時退避、一覧からの前後移動を加える。

## 受入基準（EARS）

- AC-1 THE SYSTEM SHALL `views.form` の各グループに、従来の field 名の配列に加えて `{ label: Label; fields: string[] }` の形を受け付け、`/meta` でラベルを返す（ラベル付きは `{ label, fields }`、従来の形は `string[]` のまま）。従来の形は変更なく動く。定義時に、未知の field・同じ field の重複・日英どちらかが空のラベル・field の無いラベル付きグループを拒否する。
- AC-2 WHEN グループにラベルがある THE SYSTEM SHALL グループを見出し付きの節（`fieldset` と `legend`、UI キットの `FormSection as="fieldset"`）で表示する。768px 未満の幅でラベル付きの節（追加項目を含む）が 4 つ以上ある場合は、節を UI キットの `Tabs` で切り替えて表示し、エラーのある節のタブにその件数を示す。
- AC-3 WHEN 保存が検証エラー（画面での必須・形式の検査、または API の VALIDATION、配分超過）で失敗した THE SYSTEM SHALL フォームの先頭に `role="alert"` の要約（件数と、各項目へのリンク）を表示し、最初の不正な項目へ焦点を移す（狭い画面ではその項目のタブを開く）。明細のエラーは明細名・行番号・列名で示す。項目のない文（配分超過など）はリンクなしで示す。各項目の下のエラーは `role="alert"` にせず `aria-describedby` で入力欄に関連付ける。
- AC-4 THE SYSTEM SHALL 入力が必要な項目（必須・既定値なし・編集可能）に視覚的な印と支援技術向けの `required`（`aria-required`）を付け、field の説明を補助文として常に表示して `aria-describedby` で関連付ける。
- AC-5 WHEN 記録の画面で `Ctrl+S`（macOS は `⌘+S`）を押した THE SYSTEM SHALL ブラウザの保存ダイアログを開かずに保存を実行する（保存できない状態では何もしない）。WHEN フォームに焦点がある状態で `Ctrl+Enter`（`⌘+Enter`）を押した THE SYSTEM SHALL 未保存の変更がある・新規・確定できない記録では保存し、未保存の変更が無い確定可能な下書き document では確定の確認ダイアログ（見出しの「確定」と同じ）を開く。保存中・未保存の変更がある場合の既存の制限は維持し、モーダルが開いている間はキーをモーダルに任せる。
- AC-6 WHEN 明細グリッドのセルで `Enter` を押した THE SYSTEM SHALL 同じ行の次の入力セルへ、行の最後の入力セルなら次の行の先頭の入力セルへ移り、最終行の最後の入力セルでは編集可能な場合に新しい行を追加してその先頭へ移る。`Alt+↑` / `Alt+↓` で行を移動し、焦点は同じセルに残る。何も入力していない参照欄（焦点で開いただけの候補一覧）では `Enter` が候補を選ばず次へ進む。
- AC-7 WHILE 画面幅が 768px 未満 THE SYSTEM SHALL 保存・確定などの主操作をフォーム下部の固定バー（スクロール領域の下端に貼り付く sticky）に表示し、見出しの「確定」はバーへ移す。入力欄を隠さない（スクロール領域の下端にバーの高さ分の余白 `scroll-padding-bottom` を確保する）。
- AC-8 WHEN 未保存の入力がある状態で画面を離れた、または再読込した THE SYSTEM SHALL 入力値を利用者・テナント・会社・entity・id（新規は `new`、複製・クイック操作の新規は `new:<seed>`）ごとにタブ内（`sessionStorage`）へ退避し、同じ画面を開き直したときに「前回の入力を復元しますか」と提案する。退避するのは変更した値と変更した明細の行だけで、読取専用・サーバー所有・非表示・`restricted`（権限の field group に属する）項目と、利用者に見えない（マスクされた・出力しない）項目は保存も復元もしない。個人情報の entity（`workforce_`・`filing_payroll_`）は退避しない。保存に成功したら退避を消す。版が変わった既存記録には復元を提案せず、退避を消してその旨を示す。明示的なログアウトでタブ内の退避をすべて消す（期限切れの再ログインでは残す）。記録が 403/404 で読めなくなったらその記録の退避を消す。
- AC-9 WHEN 一覧から記録を開いた THE SYSTEM SHALL 一覧と同じ条件（検索・絞り込み・並べ替え・ページ）の前後の記録へ移動する「前の記録」「次の記録」と位置（例 `2 / 3 件`）を表示する。ページの端では同じ条件の隣のページを読んで移る。未保存の変更がある場合は既存の破棄確認を通す。一覧へ戻るリンクは元の条件の一覧を開く。一覧を経由しない（直接開いた・別の利用者や会社の）記録には表示しない。
- AC-10 THE SYSTEM SHALL 文言を日本語と英語で持ち、ショートカットの一覧をフォームのバーの `?` ボタンで表示する。

## 関係するファイル・インターフェース（名指し）

- kernel: `kernel/src/dsl/types.ts`（`FormGroup`、`ViewsConfig.form`）、`kernel/src/dsl/entity.ts`（定義時検証 `validateFormGroups`）、`kernel/src/meta.ts`（`FormGroupMeta`、`FieldMeta.restricted`）
- web（純粋）: `apps/web/src/lib/form.ts`（`formSections` / `sectionLayout` / `needsInput`）、`lib/form-errors.ts`（要約）、`lib/form-shortcuts.ts`（キー判定）、`lib/form-draft.ts`（退避）、`lib/record-nav.ts`（前後移動）
- web（画面）: `components/record-form.tsx`、`components/form-sections.tsx`、`components/form-error-summary.tsx`、`components/form-draft.tsx`、`components/form-shortcuts-help.tsx`、`components/record-nav.tsx`、`components/line-grid.tsx`、`components/fields/*`、`components/doc-actions.tsx`（確定の確認を開く handle）、`pages/entity-form-page.tsx`、`pages/entity-list-page.tsx`（id 列と条件を router state で渡す）、`api/navigation-assist.ts`（ログアウト時に退避を消す）
- modules: 取引先・売上請求書・仕入請求書・入出金・契約の `views.form` にラベルを付ける
- docs: `docs/adr/0002-declarative-entity-dsl.md`（追補）、`docs/conventions/ui.md`、`docs/manual/02-basics.md`

## データ・業務ルール（出典）

- 確定済み伝票の不変と未保存保護 — ADR-0006、[ui-refresh](ui-refresh.md)。退避は端末内（タブ内）だけで、サーバーへ送らない。一時障害時の入力保持（[quality-foundation](quality-foundation.md) AC-5）の延長であり、拒否・失効時に機微データを残さない規則に従う。
- 日本の制度値は扱わない（出典不要）。

## スコープ外（明記）

- フォームの項目配置を利用者が変更する機能
- 明細の Excel からの貼り付け（次版）
- 退避の端末間共有
- 明細行の削除ショートカット（`Ctrl+Delete`。改訂の記録を参照）
- pack の `labelOverrides` で節の見出しを変えること

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`（kernel を変更するため DB 全件へ昇格）
2. 単体: `kernel/test/form-groups.test.ts`（AC-1 の定義時検証と `/meta` の形、AC-8 の `restricted`）、`apps/web/src/lib/form-ergonomics.test.ts`（グループ解釈の新旧の形、タブの条件、必須の印、エラー要約の項目対応、ショートカットと明細キーの判定、退避の保存・読込・版の変化・破棄・復元・ログアウト、前後移動）、`apps/web/src/components/form-ergonomics-ui.test.ts`（節・タブ・要約・補助文の描画、ショートカット一覧）
3. ブラウザ: `apps/web/e2e/form-ergonomics.spec.ts`（売上請求書で必須を空にして保存 → 要約と焦点・明細セルへのリンク、`Ctrl+S` で保存しブラウザの既定動作を止める、`Ctrl+Enter` で確定の確認／未保存なら保存、明細の `Enter` 移動と行追加・`Alt+↑↓`、390px の操作バーとタブ、390px で別タブの項目へ要約から移動、再読込後の復元提案・保存で消える・版の変化で提案しない・新規の離脱、一覧からの前後移動）と、変更した画面を使う既存の spec（`a11y.spec.ts` のフォーム画面を含む）
4. `pnpm gate:full`（統合担当）

## 未決事項（利用者の判断待ち）

- なし（下の改訂で決めた事項は、利用者が別の判断をすれば変える）。

## 改訂の記録（2026-10-30、実装担当）

- AC-2: 草案は「768px 未満で 4 節以上なら節の目次（ページ内リンク）」だったが、計画 D3 と統合担当の指示はタブ。タブを採用した。タブは他の節を隠すため、エラーのある節のタブに件数を出し、要約のリンクと保存失敗時の焦点移動でその節のタブを開く（AC-3 に追記）。追加項目（ext）も 1 つのラベル付きの節として数える。ラベルの無いグループはタブ上で「その他」。
- AC-3: 各項目の下のエラーを `role="alert"` から外した（要約と同時に複数の alert が読まれるため）。フォーム以外（設定・レポート入力）の項目は従来どおり alert のまま。
- AC-5: `Ctrl+Enter` は従来「保存」だった。確定できる下書き document で未保存の変更が無いときだけ確定の確認を開き、それ以外は従来どおり保存する（既存の利用者の操作を壊さないため）。`Ctrl+S` はフォームの外（見出しなど）に焦点があっても記録の画面ならブラウザの保存を止めて保存する。
- AC-6: `Ctrl+Delete`（確認付きの行削除）は初版から外した。入力欄での「次の単語を削除」と衝突し、`Ctrl+Shift+Delete` はブラウザの閲覧履歴削除に使われているため。行の「×」ボタンは従来どおり。旧来の「Enter で同じ列の下の行へ」は「同じ行の次の欄へ」に変わる（最終行の最後の欄で行を追加する点は同じ）。
- AC-7: 固定バーは `position: fixed` ではなく既存の sticky バーを使う。761〜767px ではサイドバーが表示されるため fixed のバーはサイドバーに重なる。sticky はスクロール領域の中に収まり、フォームの末尾では本来の位置に戻るので入力欄を隠さない。途中の入力欄は `scroll-padding-bottom` で隠れないようにした。
- AC-8: 退避するのは変更した値だけ（記録の全値をタブに複製しない）。権限の field group に属する項目は利用者が見えても退避しないため、`/meta` に `FieldMeta.restricted` を加えた（現在の module に field group を使う entity は無い。テストの entity で確認）。提案中に入力を始めたら提案を取り下げ、新しい入力で退避を置き換える。退避は 12 時間で無効。離脱の確認文は、退避できたときは「入力はこのタブに一時保存され、この画面に戻ると復元できます」に変わる。
- AC-9: 一覧のページの端では同じ条件で隣のページを読む（計画の「一覧の id 列」だけでは 50 件ごとに止まるため）。router state は複製の seed と同じくセッション（テナント・利用者・会社）に結び付け、違うセッションでは使わない。移動は履歴を置き換える（戻るで一覧へ戻る）。
- ラベル付きグループは 取引先・売上請求書・仕入請求書・入出金・契約 の 5 entity に付けた。売上請求書は `currency`・`taxSummary`・`controlAccountId` を節に含め、末尾の「その他」の枠を無くした。
