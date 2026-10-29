# Spec: setup-wizard（初回セットアップウィザード）

- 状態: draft
- モジュール: `apps/web`（`/setup` とホームのチェックリスト）、`kernel`（`setup.progress` 設定）、`apps/api`（`GET /meta/setup-status`） ／ 依存: [settings-console](settings-console.md)、[company-admin](company-admin.md)、[setup-health](setup-health.md)、[ui-kit](ui-kit.md)
- ADR: ADR-0027 に `setup.progress` を追記（新しい書込経路を作らない方針を含む）
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) B4

## 目的（1段落）

導入直後の管理者は、会社情報・会計年度・税率・請求書の発行者・在庫の扱い・業界テンプレート・利用者を、別々の画面と設定カードで正しい順序に整える必要がある。順序と完了状態が分からないため、在庫を使わない業種で自動出庫が有効なまま請求書を確定できない、といったつまずきが起きる（[マニュアル 03](../manual/03-setup.md)）。既存の設定 API と action を順番に呼ぶだけの段階式の画面で、初期設定を中断・再開しながら完了できるようにする。

## 受入基準（EARS）

- AC-1 THE SYSTEM SHALL `/setup` に次の段階を順に表示する: (1) 会社情報（`company.profile`）、(2) 会計年度、(3) 勘定科目の確認、(4) 税率と端数処理、(5) 請求書の発行者、(6) 在庫の扱い、(7) 業界テンプレート、(8) 利用者、(9) 勤怠・給与（任意）。
- AC-2 THE SYSTEM SHALL 各段階の保存を既存の API（`PUT /meta/settings/:key`、`POST /actions/accounting.open_fiscal_year`、`pack.apply`、`/admin/users` の作成・招待、`workforce.initialize_policy`）で行い、新しい書込経路を作らない。各 API の権限検査をそのまま適用する。
- AC-3 WHEN 会計年度の段階を開いた THE SYSTEM SHALL `company.profile` の決算月から開始日を提案し、既存の年度と重なる場合は作成せずに既存年度を表示する。
- AC-4 WHEN 在庫の扱いの段階で「在庫を使わない」を選んだ THE SYSTEM SHALL 売上・仕入請求書からの自動入出庫を無効にする設定を保存し、「使う」を選んだ場合は既定倉庫の存在を確認する。
- AC-5 THE SYSTEM SHALL 各段階の完了を保存の有無ではなく実データの条件で判定する（[導入チェック](setup-health.md) の該当項目が `ok`、会計年度が今日を含む、利用者が 2 人以上 など）。`GET /meta/setup-status` が段階ごとの `{ id, status: 'done' | 'todo' | 'skipped', reason? }` を返す。
- AC-6 WHEN 利用者が段階をスキップした THE SYSTEM SHALL 理由を会社設定 `setup.progress` に記録し、チェックリストに「スキップ（理由）」として残す。ブラウザを閉じても再開できる。
- AC-7 WHILE 未完了の段階がある WHEN admin がホームを開いた THE SYSTEM SHALL 「セットアップを続ける」カードに完了数と次の段階を表示する。すべて完了またはスキップした場合はカードを表示しない（`/setup` からはいつでも開ける）。
- AC-8 IF 利用者が admin でない THEN THE SYSTEM SHALL `/setup` とホームのカードを表示しない。
- AC-9 THE SYSTEM SHALL 各段階で入力途中の値を未保存のまま他の段階へ移るときに確認を求める（既存の未保存保護と同じ）。
- AC-10 THE SYSTEM SHALL 画面の文言を日本語と英語で持ち、390px 幅で操作できる。段階の一覧はキーボードで移動でき、現在の段階を `aria-current="step"` で示す。

## 関係するファイル・インターフェース（名指し）

- kernel: `setup.progress` 設定の登録（`category: 'system'`）
- api: `apps/api/src/routes/setup-status.ts`（新規。導入チェックの provider を再利用）
- web: `apps/web/src/pages/setup-page.tsx` と `apps/web/src/components/setup-*.tsx`（新規）、`apps/web/src/pages/home-page.tsx`、`apps/web/src/router.tsx`、`apps/web/src/lib/navigation-data.ts`。既存の設定カード・テンプレート画面・利用者作成の部品を再利用する
- docs: `docs/manual/03-setup.md`（ウィザードを主手順に書き換え）、`docs/manual/01-install.md`（初回ログイン後の案内）

## データ・業務ルール（出典）

- 会計年度・税率・発行者・在庫設定の意味は既存の仕様とマニュアル 03 に従う。新しい制度値はない。

## スコープ外（明記）

- 他システムからのデータ移行（[csv-import](csv-import.md)、期首残高は別項目）
- テナントや最初の会社の作成（setup CLI の範囲）
- 段階の追加を module が宣言する仕組み（初版は固定の 9 段階）

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`
2. DB: `setup-status` の判定（実データの条件）、スキップの記録、admin 以外の拒否（AC-5、AC-6、AC-8）
3. ブラウザ: 新しい会社で 9 段階を通し、売上請求書の確定まで行う。途中で閉じて再開する。在庫を使わない選択で物品なしの請求書が確定できる。390px（AC-1〜AC-10）
4. `pnpm gate:full`

## 未決事項（利用者の判断待ち）

- 段階 (9) を従業員機能を使う会社だけに表示する判定（初版は常に任意として表示）。
