# Spec: source-consistency

- 状態: implemented（最終CIの成否は対象PRのChecksで確認）
- 作成: 2026-09-14
- 対象: 宣言の読みやすさ、エラー規約、基盤boolean列、文書状態、責務ヘッダ
- 前提: review-hardening の後続。既存試用データを空と仮定しない。

## 目的

人とAIが局所的な変更を安全に行えるよう、意味のある一貫性を整える。規約や行数を満たすための分割・冗長なコメントを増やさず、既存の業務契約とデータを保つ。

## 受入基準

- AC-1 WHEN ソースを検査する THE SYSTEM SHALL `one-var: ['error', 'never']` により通常の変数宣言を個別に保つ。機械修正は初期化順、束縛、型、コメント、ループのスコープを保持し、他の挙動変更と別コミットにする。
- AC-2 WHEN 開発者がエラーを選ぶ THE DOCUMENTATION SHALL 業務・入力・認可で呼出元が対処する `DaifukuError` 系と、定義の誤り・内部不変条件違反の `Error` を区別し、拡張登録等の既存構造化エラー契約を保持する。未知の内部エラーをAPIへそのまま公開しない。
- AC-3 WHEN 基盤の既存5列をbooleanへ移行する THE SYSTEM SHALL 元の0/1値を事前検査し、想定外値は失敗させ、真偽・既定値・関連索引・他のデータを保持する。過去migrationは編集せず、新規DBと既存DBの両方で最新schemaと一致させる。
- AC-4 WHEN 認証・MFA・利用者管理・リレー認証を行う THE SYSTEM SHALL boolean列を一貫して読み書きし、公開APIの真偽値と権限・失効の契約を維持する。
- AC-5 WHEN 文書遷移を定義する THE SYSTEM SHALL `DOCSTATUS` の名前付き値を使い、draft→submitted／submitted→cancelledの許可と不正遷移の拒否を維持する。
- AC-6 WHEN 非自明なkernel/modulesの処理を新設・実質変更する THE DOCUMENTATION SHALL 責務・重要な不変条件・仕様への入口を短く説明するヘッダの例と判断基準を提供する。自明な宣言・再exportへ一律の雛形を挿入しない。

## 実装範囲

ESLintの宣言ルールと機械整形、code-style/errors/header規約、代表的な責務ヘッダ、`kernel/src/dsl/entity.ts` の状態比較。boolean対象は `users.active` / `tenant_admin` / `mfa_enabled`、`ext_field_definitions.required`、`relay_credentials.active` の5列。業務DSLの `f.bool` は既にbooleanであり変更しない。

## 検証

機械修正の構文・初期化順の比較とlint/format、既存の文書遷移単体試験、0/1双方と不正値を含む既存DB移行試験、schema差分、認証・MFA・会社認可・リレーのDB試験を確認する。最後に `pnpm gate`、API/Web/edgeビルド、既存ブラウザ・identity・setup・各OS CIを実行し、対象commitと実測を記録する。

## スコープ外

AWS反映、実運用DBの更新、APIの認証方式変更、業務ロジック変更、過去migrationの編集、一律のファイル分割・全ファイルへの定型ヘッダ、plain Errorの機械置換。

## 更新時の扱い

5列の型変更はアプリ停止を伴う保守時間にmigrationと新アプリを組み合わせて適用する。旧アプリと新boolean列を混在させない。バックアップ・復旧条件と具体的な検証結果は運用文書と作業ログへ記録する。

根拠（2026-09-14確認）: [PostgreSQL 16 ALTER TABLE](https://www.postgresql.org/docs/16/sql-altertable.html)、[行セキュリティ](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)、[ESLint one-var](https://eslint.org/docs/latest/rules/one-var)。
