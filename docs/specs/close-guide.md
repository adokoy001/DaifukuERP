# Spec: close-guide（月次締めガイド）

- 状態: draft
- モジュール: `modules/accounting`（`accounting.close_readiness`）、`apps/web`（`/finance/close`） ／ 依存: [ui-kit](ui-kit.md)（D1）
- ADR: 不要（既存 action と読取権限の組合せ。新しい書込経路なし）
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) C4

## 目的（1段落）

月次の締めは [マニュアル 06](../manual/06-monthly.md) の手順（下書きの確認 → 消込 → 試算表 → 消費税集計表 → 年齢表 → 在庫評価 → 期間の締め）を人が順に確かめる運用で、未確定の下書きが残ったまま期間を締めると、その伝票は後から確定できなくなる。経理担当者が、締める前に残っている作業を件数で把握し、該当の一覧へ移動し、条件を満たしたときだけ締められる画面を用意する。

## 受入基準（EARS）

- AC-1 WHEN `accounting.close_readiness { periodId }` が accounting または admin ロールから呼ばれた THE SYSTEM SHALL 期間（id・コード・開始日・終了日・締め状態）と点検項目の配列と `ready` を返す。点検項目は `{ id, label: Label, count, blocking, href? }` で、読取専用（`mutates: false`）とする。
- AC-2 THE SYSTEM SHALL 登録済みの document entity のうち、要求者が read でき、会社に適用済み（pack 由来なら適用済み）で、業務日付の field（`date` / `postingDate` / `documentDate` / `transactionDate` の最初に存在するもの）を持つものについて、期間内の日付の下書き（docstatus 0）の件数を entity ごとの点検項目として返す。件数は `Repository` の count を通し、行の権限と会社・拠点の境界を適用する。
- AC-3 THE SYSTEM SHALL `journalEntryId` field を持つ document と `journal_entry` 自身の下書きを `blocking: true`、それ以外の document の下書きを `blocking: false`（注意）とする。
- AC-4 THE SYSTEM SHALL 期間終了日までに確定した入出金のうち未配分額が 0 より大きいものの件数を注意として返す（payment module が登録され読める場合）。banking module が適用・読取可能な場合は、期間内の未照合の銀行明細の件数を注意として返す。
- AC-5 IF 直前の会計期間が締まっていない THEN THE SYSTEM SHALL その旨を注意として返す。
- AC-6 THE SYSTEM SHALL `ready` を「期間が未締め、かつ blocking 項目の件数がすべて 0」のときだけ true にする。
- AC-7 IF 要求者が読めない entity THEN THE SYSTEM SHALL その entity を点検項目に含めず、件数も返さない（存在を漏らさない）。
- AC-8 WHEN `/finance/close` を開いた THE SYSTEM SHALL 会計期間を選ばせ（既定は終了日が今日より前の最も古い未締め期間、無ければ今日を含む期間）、点検項目、関連レポート（試算表・総勘定元帳・消費税集計表・売掛金/買掛金年齢表・在庫評価）への期間指定付きリンクを表示する。
- AC-9 WHEN 点検項目に `href` がある THE SYSTEM SHALL 該当の一覧へ移動できるリンクを表示する。下書き件数の項目は `/e/<entity>?status=draft&from=<開始日>&to=<終了日>` 相当の絞り込み済み一覧を指す（一覧が絞り込みを解釈できない段階では entity の一覧を指し、件数と期間を表示する）。
- AC-10 WHILE `ready` が false WHEN 利用者が締めを実行しようとした THE SYSTEM SHALL ボタンを無効にし、残っている blocking 項目を示す。WHEN `ready` が true で確認ダイアログを承認した THE SYSTEM SHALL 既存の `accounting.close_period` を実行し、結果を表示して点検をやり直す。
- AC-11 WHEN 締め済みの期間を選んだ THE SYSTEM SHALL 締め済みであることと、再開（既存 `accounting.reopen_period`、確認付き）と訂正日による取消の案内を表示する。
- AC-12 THE SYSTEM SHALL 画面を「会計・資金」分野の専用画面として画面検索・分野一覧に表示し、`accounting.close_readiness` を呼べない利用者には表示しない。
- AC-13 THE SYSTEM SHALL 画面の文言を日本語と英語で持ち、390px 幅で操作できる。

## 関係するファイル・インターフェース（名指し）

- `modules/accounting/src/actions/close-readiness.ts`（新規）、`modules/accounting/src/index.ts`（登録）
- `apps/web/src/pages/close-page.tsx`（新規）、`apps/web/src/router.tsx`、`apps/web/src/lib/navigation-data.ts`
- `docs/manual/06-monthly.md`、`docs/conventions/ui.md`（必要なら）

## データ・業務ルール（出典）

- 締めた期間の日付で仕訳を転記できないこと、取消の訂正日 — 既存の [accounting 仕様](accounting.md) と [付録 C](../manual/appendix-c-ui-refresh.md)。新しい制度値はない。

## スコープ外（明記）

- 締めの自動実行、締め前の自動確定、在庫期間の締め（`inventory.close`）の自動連動
- 決算整理仕訳の提案、年度締め
- 一覧の絞り込み UI そのもの（[実装計画](../completion-plan.md) C1）

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`
2. DB: 下書き売上請求書 1 件を期間内に作ると blocking 件数 1・`ready` false、確定後に 0・true。読めない entity が出ないこと（権限の狭いロール）。直前期間未締めの注意（AC-1〜AC-7）
3. ブラウザ: 期間選択、下書きが残る状態で締めボタンが無効、確定後に締めを実行して締め済み表示、再開の確認、390px（AC-8〜AC-13）
4. `pnpm gate:full`

## 未決事項（利用者の判断待ち）

- 注意項目（未配分の入出金・未照合明細）を blocking にする会社設定を設けるか（初版は設けない）。
