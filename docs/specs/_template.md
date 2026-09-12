# Spec: <feature-slug>

- 状態: draft | approved | implemented | verified
- モジュール: modules/<name> ／ 依存: <他モジュール>
- ADR: 関連する ADR 番号
- 作成: <date> ／ 作成者: <human|agent-session-id>

## 目的（1段落）
何のために、誰が使うか。

## 受入基準（EARS）
- WHEN <条件/イベント> THE SYSTEM SHALL <振る舞い>
- WHILE <状態> WHEN <イベント> THE SYSTEM SHALL <振る舞い>
- IF <望ましくない条件> THEN THE SYSTEM SHALL <振る舞い>
（各項目は少なくとも1つのテスト（unit/property/golden/e2e）に対応させ、テスト名に `AC-n` を含める）

## 関係するファイル・インターフェース（名指し）
- kernel: ...
- modules/<name>/src/...: ...

## データ・業務ルール（出典）
- <ルール> — docs/domain/<file>.md#<anchor>（一次出典URL、確認日）

## スコープ外（明記）
- ...

## 検証手順（E2E、実行して記録する）
1. `pnpm gate`
2. `pnpm dev:api` を起動し、`curl ...` で ...
3. 画面で ... を確認（スクリーンショットを docs/log に添付）

## 未決事項（利用者の判断待ち）
- ...
