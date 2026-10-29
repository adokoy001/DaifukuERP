# Spec: navigation-assist（コマンドパレット・最近の記録・お気に入り・画面の説明）

- 状態: draft
- モジュール: `apps/web`（画面カタログ、サイドバー、現在位置） ／ 依存: [ui-kit](ui-kit.md)、[navigation-workspaces](navigation-workspaces.md)
- ADR: 不要（表示層のみ。保存はブラウザ内）
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) D2

## 目的（1段落）

画面は業務分野と全画面検索から探せるが、毎日使う画面や直前に見た伝票へ戻るには、分野を開き直すか一覧を検索し直す必要がある。また画面の操作説明はマニュアルにあるが、画面からたどれない。キーボードで画面を開くコマンドパレット、最近開いた記録とお気に入り、画面ごとの説明リンクを足し、迷う時間を減らす。

## 受入基準（EARS）

- AC-1 WHEN 利用者が `Ctrl+K`（macOS は `⌘+K`）を押すか、上部の検索ボタンを押した THE SYSTEM SHALL コマンドパレットを開き、入力欄に焦点を移す。`Escape` で閉じ、開く前の要素へ焦点を戻す。
- AC-2 WHEN パレットに入力した THE SYSTEM SHALL 既存の画面カタログの検索（`searchNavigation`）で権限のある画面を、続けて最近開いた記録を候補に出し、上下キーで選択、`Enter` で移動する。候補は listbox と option の役割で読み上げられる。
- AC-3 WHEN 利用者が記録の画面を開いた THE SYSTEM SHALL entity・id・表示名・開いた日時を、利用者・tenant・会社ごとにブラウザ内へ最大 30 件保存する。会社を切り替えた場合や記録が読めなくなった場合は、その会社の記録だけを表示し、読めない記録は開いたときに通常の権限エラーになる。
- AC-4 WHEN 利用者が画面の「お気に入り」ボタンを押した THE SYSTEM SHALL その画面を同じ境界でブラウザ内に保存し、サイドバーの「お気に入り」に表示する。権限を失った画面は表示しない（カタログに無い href は除く）。
- AC-5 THE SYSTEM SHALL サイドバーに「最近」（直近 5 件）と「お気に入り」を表示する。どちらも 0 件なら見出しごと表示しない。
- AC-6 THE SYSTEM SHALL 画面の経路からマニュアルの章への対応表（`apps/web/src/lib/help.ts`）を持ち、現在位置（`ScreenTrail`）に「この画面の説明」リンクを表示する。リンク先の基点は `VITE_MANUAL_URL`（既定は公開リポジトリの `docs/manual/`）とし、対応の無い画面には表示しない。
- AC-7 IF ブラウザ内の保存が使えない（例外・容量超過・プライベートモード）THEN THE SYSTEM SHALL 最近とお気に入りを表示しないだけで、他の操作を妨げない。
- AC-8 THE SYSTEM SHALL 文言を日本語と英語で持ち、390px 幅ではパレットを全幅で表示する。

## 関係するファイル・インターフェース（名指し）

- `apps/web/src/components/command-palette.tsx`（新規）、`apps/web/src/lib/recent-records.ts`、`apps/web/src/lib/favorites.ts`、`apps/web/src/lib/help.ts`（新規）
- `apps/web/src/router.tsx`（ショートカットの登録、上部ボタン）、`apps/web/src/components/sidebar.tsx`、`apps/web/src/components/screen-trail.tsx`、`apps/web/src/pages/entity-form-page.tsx`（最近への記録）
- 保存境界は `apps/web/src/lib/analytics-storage.ts` と同じ（利用者・tenant・会社）
- docs: `docs/manual/appendix-n-navigation.md`、`docs/architecture/navigation-workspaces.md`

## データ・業務ルール（出典）

- 業務データは保存しない（entity 名・id・表示名だけ）。表示名に個人情報を含む entity（従業員など）は表示名を保存しない。

## スコープ外（明記）

- 記録データの全文横断検索（サーバー側の索引が必要）
- 端末間でのお気に入り共有
- マニュアルのアプリ内表示（外部リンクで開く）

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:quick`、`pnpm gate:light`
2. 単体: 保存境界（会社切替で混ざらない）、上限 30 件、保存失敗時の動作、個人情報を含む entity の表示名を保存しない、help の対応表と未対応画面（AC-3〜AC-7）
3. ブラウザ: `Ctrl+K` で画面を開く、記録を開いて最近に出る、お気に入りの追加と削除、焦点の戻り、390px（AC-1〜AC-8）
4. `pnpm gate:full`

## 未決事項（利用者の判断待ち）

- 個人情報を含む entity の判定方法（初版は `workforce_` で始まる entity と従業員関連を対象外にする）。
