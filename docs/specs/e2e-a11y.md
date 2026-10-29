# Spec: e2e-a11y（主要画面のアクセシビリティ自動検査）

- 状態: draft
- モジュール: `apps/web/e2e`、必要に応じて `apps/web/src` の修正 ／ 依存: [test-tiers](test-tiers.md)（A1 の `@smoke` と階層）、[ui-kit](ui-kit.md)（D1）
- ADR: 不要
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) A2

## 目的（1段落）

画面には aria 属性・スキップリンク・経路変更時の焦点移動などの配慮があるが、自動検査が無いため、変更で崩れても気づけない。主要画面を日本語・英語、デスクトップ・390px で axe により検査し、重大な違反を CI で止める。既に存在する違反は直すか、理由付きの例外として記録する。

## 受入基準（EARS）

- AC-1 WHEN `apps/web/e2e/a11y.spec.ts` が実行された THE SYSTEM SHALL ログイン、ホーム、取引先一覧、売上請求書フォーム（新規）、会社設定、`/me`、`/workforce`、`/analytics` の 8 画面を、日本語・英語 × 1280px・390px の 4 条件で axe（WCAG 2.1 A/AA のタグ）により検査する。
- AC-2 IF `serious` または `critical` の違反があり、`apps/web/e2e/a11y-exceptions.json` に一致する例外（rule id と画面と対象 selector の組、理由、期限または追跡先）が無い THEN THE SYSTEM SHALL 試験を失敗させ、違反の rule・対象・説明を出力する。
- AC-3 THE SYSTEM SHALL 例外ファイルの各項目に理由を必須とし、使われなかった例外を試験失敗として報告する（古い例外を残さない）。
- AC-4 THE SYSTEM SHALL 検査開始時に既存の違反を修正し、修正できないものだけを例外に登録する。修正は UI キットとトークン（D1）の範囲で行い、見た目の大きな変更は伴わない。
- AC-5 THE SYSTEM SHALL a11y 試験のうち日本語・1280px の 8 件に `@smoke` を付け、`pnpm e2e:smoke` で実行されるようにする。
- AC-6 THE SYSTEM SHALL 依存の追加を `@axe-core/playwright`（devDependency、固定版）に限り、`pnpm-lock.yaml` を更新して `THIRD_PARTY_NOTICES.md` の規約に従う。

## 関係するファイル・インターフェース（名指し）

- `apps/web/e2e/a11y.spec.ts`（新規）、`apps/web/e2e/a11y-exceptions.json`（新規）、`apps/web/package.json`
- 違反の修正対象となる `apps/web/src/**`
- `docs/conventions/testing.md`、`docs/conventions/ui.md`、`THIRD_PARTY_NOTICES.md`

## データ・業務ルール（出典）

- WCAG 2.1（W3C 勧告）の A/AA 達成基準を axe の rule tag で参照する。法令上の適合認定は主張しない。

## スコープ外（明記）

- 全画面・全業界の網羅、手動の支援技術による検証、色覚シミュレーション
- `moderate` / `minor` の違反の失敗化（出力はするが失敗にしない）

## 検証手順（E2E、実行して記録する）

1. 例外なしで一度実行し、検出された違反を一覧にして log に残す。
2. 違反を修正し、残りを理由付きで例外に登録して成功させる。
3. 例外を 1 件削除すると失敗すること、存在しない例外を足すと失敗することを確認する（AC-2、AC-3）。
4. `pnpm e2e:smoke` に 8 件が含まれることを確認する。
5. `pnpm gate:full`

## 未決事項（利用者の判断待ち）

- `moderate` 以下の違反をいつ失敗化するか。
