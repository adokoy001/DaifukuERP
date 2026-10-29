# Spec: document-links（伝票の複製・関連伝票・クイック操作）

- 状態: draft
- モジュール: `kernel`（関連記録の読取）、`apps/api`（`GET /api/:entity/:id/related`）、`apps/web`（汎用フォーム） ／ 依存: [ui-kit](ui-kit.md)
- ADR: 不要（既存の読取権限と作成 API の組合せ）
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) C2

## 目的（1段落）

毎月ほぼ同じ請求書を作る、請求書から入金を記録する、取消した伝票の訂正版や自動仕訳を確かめる、といった操作で、利用者は一覧と画面を何度も往復している。伝票の画面から、複製・関連する記録の確認・次の伝票の作成を直接行えるようにし、伝票 1 件あたりの手数を減らす。

## 受入基準（EARS）

- AC-1 WHEN 利用者が create 権限のある entity の記録で「複製」を押した THE SYSTEM SHALL 新規作成画面を開き、元の記録の入力可能な値と明細を初期値として入れる。system 列・`serverOwned`・採番・状態・`unique` な field（コードなど）・訂正元は持ち越さない。保存するまでは何も作成しない。
- AC-2 WHEN `GET /api/:entity/:id/related` が呼ばれた THE SYSTEM SHALL この記録を `ref` で参照する記録（逆参照）と、この記録が `ref` で参照する記録（順参照）を、entity ごとに最大 50 件、番号または表示名・状態・日付つきで返す。`amendedFrom` による訂正元・訂正先と `journalEntryId` による仕訳を含める。
- AC-3 THE SYSTEM SHALL 関連記録の読取に、要求者の read 権限・行の権限・会社・拠点・本人の境界を entity ごとに適用し、読めない entity は結果に含めない（件数も返さない）。
- AC-4 WHEN 記録の画面を開いた THE SYSTEM SHALL 「関連」パネルに AC-2 の結果を entity ごとにまとめて表示し、各記録へ移動できる。読込は画面の表示を妨げない。
- AC-5 THE SYSTEM SHALL 次のクイック操作を確定済みの記録に表示する: 売上請求書 →「入金を記録」、仕入請求書 →「支払を記録」。押すと入出金の新規画面を、区分・取引先・金額（未消込残高）・消込明細（その請求書）を初期値として開く。操作は入出金の create 権限がある場合だけ表示する。
- AC-6 THE SYSTEM SHALL クイック操作の対応を `apps/web/src/lib/quick-actions.ts` の宣言で管理し、対象 entity が meta に無い会社では表示しない。
- AC-7 IF 初期値に使う元の記録を読み直した結果が版の変化や権限の喪失で取得できない THEN THE SYSTEM SHALL 新規画面を初期値なしで開かず、理由を表示する。
- AC-8 THE SYSTEM SHALL 文言を日本語と英語で持ち、390px 幅で操作できる。

## 関係するファイル・インターフェース（名指し）

- kernel: `kernel/src/related.ts`（新規。`registry` の ref から逆参照・順参照を求め、`Repository` の list で読む）、`kernel/src/index.ts`
- api: `apps/api/src/routes/rest.ts`（`/related` を既存の entity 経路と同じく action へ委譲、または派生 action）
- web: `apps/web/src/pages/entity-form-page.tsx`、`apps/web/src/components/related-panel.tsx`（新規）、`apps/web/src/lib/duplicate.ts`、`apps/web/src/lib/quick-actions.ts`（新規）、`apps/web/src/components/record-form.tsx`（初期値の受け取り）
- docs: `docs/manual/02-basics.md`、`docs/manual/05-daily.md`

## データ・業務ルール（出典）

- 訂正（`amendedFrom`）と確定済み伝票の不変 — ADR-0006。消込の検証は既存の入出金の規則（[payment](payment.md)）に従う。

## スコープ外（明記）

- 見積 → 受注などの商流の変換（既存の trade 画面で対応済み）
- 複数記録の一括複製、定期的な自動複製
- 関連記録の図示

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`（kernel を変更するため DB 全件へ昇格）
2. DB: 逆参照・順参照・訂正・仕訳の取得、読めない entity の除外、行の権限、50 件上限（AC-2、AC-3）
3. 単体: 複製で持ち越さない field の判定、クイック操作の初期値（AC-1、AC-5、AC-6）
4. ブラウザ: 確定済み請求書の複製 → 保存で新しい下書き、「入金を記録」→ 保存 → 確定で請求書が消し込まれる、関連パネルに入金と仕訳が出る、390px（AC-1〜AC-8）
5. `pnpm gate:full`

## 未決事項（利用者の判断待ち）

- 複製時に日付を今日へ置き換えるか（初版は置き換える。元の日付は表示のみ）。
