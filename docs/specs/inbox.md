# Spec: inbox（やること受信箱）

- 状態: draft
- モジュール: 各 module の `<module>.todo` action、`apps/web`（ホームと `/inbox`） ／ 依存: [ui-kit](ui-kit.md)
- ADR: 不要。`*.todo` の命名と出力の規約を `docs/conventions/ui.md` に追加する
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) C3

## 目的（1段落）

承認待ちの勤怠訂正・有給・経費は `/workforce` の「確認待ち」、店舗の日次報告は運営画面、照合待ちの銀行明細は銀行画面、と未処理の仕事が画面ごとに分かれている。担当者がログイン直後に「自分が処理すべきもの」を一覧で把握し、該当画面へ移動できるようにする。各 module が自分の権限と境界で件数を数え、画面はそれを集めるだけにする。

## 受入基準（EARS）

- AC-1 THE SYSTEM SHALL 名前が `<module>.todo` の action を受信箱の提供元とし、入力 `{}`、`mutates: false`、出力 `{ items: [{ key, label: Label, count, href, severity: 'info' | 'warn' }] }` とする。件数は提供元 module の `Repository` の count など既存の読取経路で数え、権限・会社・拠点・本人の境界をそのまま適用する。
- AC-2 THE SYSTEM SHALL 初版の提供元として、workforce（承認待ちの勤怠訂正・有給申請・経費、確認待ちの給与）、payment（期日を過ぎた未消込の売上請求、未配分の入出金）、banking（照合待ちの銀行明細）、restaurant_chain（承認待ち・未提出の日次報告。pack 適用時のみ）、edge-integration（結果確認が必要な機器ジョブ）、tax-filing（確認待ちの申告準備資料）を実装する。件数 0 の項目は返さない。
- AC-3 IF 要求者が提供元 action を実行できない、または pack が未適用 THEN THE SYSTEM SHALL その提供元を受信箱に含めない（`/meta` に現れる実行可能な action だけを呼ぶ）。
- AC-4 WHEN ホームを開いた THE SYSTEM SHALL 実行可能な提供元を並行して呼び、件数の合計と上位の項目をカードで表示する。WHEN `/inbox` を開いた THE SYSTEM SHALL 全項目を提供元ごとにまとめて表示し、各項目から `href` へ移動できる。
- AC-5 IF ある提供元の呼び出しが失敗した THEN THE SYSTEM SHALL その提供元だけを「取得できませんでした」と表示し、再試行の操作を出し、他の提供元の表示を妨げない。
- AC-6 THE SYSTEM SHALL `href` をアプリ内の既知の経路に限り、外部 URL や未知の経路は表示しない（画面カタログの `findNavigationEntry` で検査する）。
- AC-7 THE SYSTEM SHALL 受信箱の再取得を画面表示時と手動の更新操作に限り、定期的な自動取得は行わない（通知は [実装計画](../completion-plan.md) F1 で扱う）。
- AC-8 THE SYSTEM SHALL 受信箱を画面検索・分野一覧に表示し、提供元が 1 つも実行できない利用者には表示しない。
- AC-9 THE SYSTEM SHALL 画面の文言を日本語と英語で持ち、390px 幅で操作できる。

## 関係するファイル・インターフェース（名指し）

- `modules/workforce/src/actions/todo.ts`、`modules/payment/src/actions/todo.ts`、`modules/banking/src/actions.ts`（または `todo.ts`）、`packs/restaurant-chain/src/...`、`modules/edge-integration/src/...`、`modules/tax-filing/src/...`（いずれも新規 action）
- `apps/web/src/api/inbox.ts`、`apps/web/src/pages/inbox-page.tsx`、`apps/web/src/components/inbox-card.tsx`（いずれも新規）、`apps/web/src/pages/home-page.tsx`、`apps/web/src/router.tsx`、`apps/web/src/lib/navigation-data.ts`
- `docs/conventions/ui.md`（規約）、`docs/manual/appendix-n-navigation.md`（操作）

## データ・業務ルール（出典）

- 承認・確認の状態は既存の各 module の仕様に従う（[workforce-platform](workforce-platform.md)、[restaurant-operations](restaurant-operations.md)、[bank-integration](bank-integration.md)、[deployment-edge](deployment-edge.md)、[tax-filing-preparation](tax-filing-preparation.md)）。新しい状態は追加しない。

## スコープ外（明記）

- 通知（メール・ブラウザ通知）と既読管理
- 受信箱からの直接承認（各専用画面で操作する）
- 件数の履歴・推移

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`
2. DB: 提供元ごとの件数、本人・拠点・会社の境界（他拠点の申請を数えない）、権限のないロールで action が拒否されること（AC-1〜AC-3）
3. 単体: 提供元の選択、失敗時の表示、`href` の検査（AC-4〜AC-6）
4. ブラウザ: 承認待ちの経費を作ってホームの件数と `/inbox` から承認画面へ移動、提供元の 1 つを失敗させた表示、390px（AC-4〜AC-9）
5. `pnpm gate:full`

## 未決事項（利用者の判断待ち）

- 件数が多い会社での集計負荷（初版は count のみ。計測して必要なら上限付きにする）。
