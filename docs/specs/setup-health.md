# Spec: setup-health（導入チェック）

- 状態: draft
- モジュール: `apps/api`（`GET /meta/health`）、各 module の点検 provider、`apps/web`（`/admin/health`） ／ 依存: [settings-console](settings-console.md)、[company-admin](company-admin.md)（`company.profile`）、[ui-kit](ui-kit.md)
- ADR: 不要（読取専用の点検。秘密値を返さない規約を spec に記す）
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) B3

## 目的（1段落）

運用を始める前に「今日を含む会計期間が開いていない」「税率の有効期間が切れている」「請求書の発行者が未設定」のような設定漏れに気づけず、最初の伝票を確定するときに初めて失敗する。管理者が導入時と日常に、会社の設定と運用状態を一覧で点検し、直す画面へ移動できるようにする。セットアップウィザード（[setup-wizard](setup-wizard.md)）の完了判定にも同じ点検を使う。

## 受入基準（EARS）

- AC-1 WHEN admin または settings ロールの利用者が `GET /meta/health` を呼んだ THE SYSTEM SHALL 点検項目の配列 `[{ id, status: 'ok' | 'warn' | 'fail', label: Label, detail: Label, href? }]` と、点検した日時を返す。店舗・拠点限定の所属は拒否する。
- AC-2 THE SYSTEM SHALL 会計の点検として、今日（会社の業務日付）を含む会計期間が存在し未締めか（無い・締め済みは `fail`）、次の 30 日以内に期間が尽きるか（`warn`）を返す。
- AC-3 THE SYSTEM SHALL 税の点検として、標準税率の区分について今日に有効な税率が存在するか（無ければ `fail`）を返す。
- AC-4 THE SYSTEM SHALL 会社情報の点検として、`company.profile` の正式名称と、請求書の発行者（`sales.issuer` または `company.profile`）の名称が解決できるか（できなければ `warn`）、登録番号の形式（不正なら `warn`）を返す。
- AC-5 THE SYSTEM SHALL 在庫の点検として、売上・仕入請求書からの自動入出庫が有効で、既定倉庫コードに一致する倉庫が無い場合を `fail`、有効な物品の品目が 1 件も無いのに自動入出庫が有効な場合を `warn`（在庫を使わない業種向けの案内）として返す。
- AC-6 THE SYSTEM SHALL 運用の点検として、メール配送と OIDC の設定有無（真偽のみ）、未配送の業務イベント（outbox）の件数、添付の保存先へ書き込めるか、を返す。接続先・秘密値・ファイルパスは返さない。
- AC-7 THE SYSTEM SHALL 各点検を module が登録する provider として実装し、ある provider が例外を投げた場合はその項目を `warn`（「点検できませんでした」）として他の項目を返す。
- AC-8 THE SYSTEM SHALL 各項目の `href` をアプリ内の既知の経路（会社設定のタブ、会計期間の一覧、税率の一覧、倉庫の一覧、利用者管理など）に限る。
- AC-9 WHEN 管理者が `/admin/health` を開いた THE SYSTEM SHALL 項目を `fail`・`warn`・`ok` の順に並べ、状態を色と文字の両方で示し、各項目から直す画面へ移動できる。「再点検」で取得し直す。
- AC-10 THE SYSTEM SHALL 画面を「設定・管理」分野に表示し、admin または settings ロールでない利用者には表示しない。文言は日本語と英語、390px 幅で操作できる。

## 関係するファイル・インターフェース（名指し）

- kernel: 点検 provider の登録（`registry.registerHealthCheck` などの小さな port。ADR が必要な規模になった場合は ADR-0027 に追記）
- modules: accounting（会計期間）、tax（税率）、sales（発行者）、inventory（倉庫・自動入出庫）、kernel 内の運用点検（outbox・storage・identity 設定）
- api: `apps/api/src/routes/health.ts`（新規、または `meta.ts` に追加。既存の `/health` 生存確認とは別）
- web: `apps/web/src/pages/health-page.tsx`（新規）、`apps/web/src/router.tsx`、`apps/web/src/lib/navigation-data.ts`
- docs: `docs/manual/08-admin.md`、`docs/manual/03-setup.md`

## データ・業務ルール（出典）

- 会計期間と転記の関係、税率の期間付きデータ — 既存の [accounting](accounting.md)、[tax](tax.md) 仕様。新しい制度値はない。

## スコープ外（明記）

- バックアップの最終時刻（setup の状態ファイルは API から読まない。運用手順の確認事項として案内のみ）
- 点検の定期実行と通知
- 自動修正（点検は読取専用で、直すのは各画面）

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`
2. DB: 各点検の ok / warn / fail を作る（期間を締める、税率の有効期間を外す、発行者を空にする、倉庫コードを不一致にする）、provider の例外、店舗限定の拒否、応答に接続文字列や秘密値が含まれないこと（AC-1〜AC-8）
3. ブラウザ: fail を含む状態で画面を開き、リンクから直して再点検で ok になる、390px（AC-9、AC-10）
4. `pnpm gate:full`

## 未決事項（利用者の判断待ち）

- 「30 日以内に期間が尽きる」の日数を会社設定にするか（初版は固定）。
