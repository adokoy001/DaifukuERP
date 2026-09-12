# ADR-0013: ヘキサゴナルは「カーネルの縁」に置く。モジュールは永続化ライブラリを知らない

- 状態: 採択（2026-09-10、利用者の方向性「モジュラーモノリス＋ヘキサゴナル／拡張・規模・カスタマイズに強く」を受けて）／ 確信度: 中
- 関連: ADR-0001（モジュラーモノリス）、0002（DSL）、0008（拡張機構）

## 文脈
ヘキサゴナル（ポート＆アダプタ）の狙いは「業務ロジックを、DB・Web・外部サービスの都合から切り離す」こと。
一方、AI エージェントが大量に書くコードでは、モジュールごとに interface/adapter/DTO を用意する「教科書どおりのヘキサゴナル」はボイラープレートとドリフト（重複・不揃い）の温床になる（research/03: GitClear の重複増加、OpenAI の「不揃いなパターンも複製する」）。

## 決定
1. **六角形は1つ（システム全体）**。駆動側アダプタ = `apps/*`（REST、MCP、UI、worker）。アプリケーション層 = `defineAction` のハンドラ（ユースケース）。ドメイン = `modules/*/src/services/`（純粋関数）と DSL 定義そのもの。被駆動側ポート = kernel が提供する下記。
2. **モジュール／国パック／業種パックは、永続化・HTTP・外部サービスのライブラリを直接 import しない**（`drizzle-orm`, `postgres`, `fastify`, `node:fs`, `fetch` 直呼び等）。使ってよいのは kernel のポートだけ。dependency-cruiser で機械的に禁止する。
3. **kernel のポート（2026-09-10 時点）**: `repo()`（永続化＋権限＋監査）、`ctx.emit()`（イベント）、`registry.override(point)`（差し替え点: `document.numbering` ほか）、`registry.registerHook()`、`ctx.now()`（時計）、`newId()`（ID）、`ctx.log`（ログ）。Phase 1 で追加予定: `storage`（証憑ファイル）、`tax`（税計算エンジン差し替え）、`clock/calendar`（会計期間・営業日）、`report`（読み取りモデル定義）、`http`（外部 API 呼び出しの共通クライアント：郵便番号・公表サイト等）。
4. **カスタマイズの4層**（上ほど軽い。下ほど強いがコードが要る）:
   - L1 設定: 会社設定（`companies.settings`）、税・採番・丸めなどのパラメータ（率×有効期間のデータ）
     - 2026-09-10 追記: モジュールは `registry.registerSetting({ key: '<module>.<name>', label, schema })` で設定を宣言する。kernel の `getSetting/setSetting` が同じ schema で検証し、apps/api は `GET /meta/settings`（`[{ key, label, schema(JSON Schema), value }]`）と `PUT /meta/settings/:key`（admin または `settings` ロール）を、apps/web は `/settings` 画面を、宣言だけから導出する（docs/specs/web-phase1.md AC-5）。
   - L2 メタデータ: ext フィールド定義、ワークフロー遷移、帳票テンプレート、一覧/フォームのビュー定義（テナントごとに上書き可、コード不要）
   - L3 フック/差し替え: `registerHook` / `registerOverride` / イベント購読（小さなコード。テナント別に有効化）
   - L4 パック: `defineEntity`/`defineAction` を含む独立モジュール（業種・顧客固有の追加業務）
   「カスタマイズ＝AI エージェントが L3/L4 の小さなパックをハーネスの下で書く」を第一級の運用にする。ノーコード（L1/L2）は薄く保ち、Salesforce/Frappe 型の「全部メタデータ」には進まない（ADR-0003）。
5. **規模の伸ばし方**: コード規模 = モジュール追加（境界 lint が守る）。実行規模 = テナント/会社は RLS（ADR-0004）、読み取りは読み取りモデル/分析分離（ADR-0012）、非同期は outbox+worker。モジュールが kernel ポートしか知らないので、将来サービス抽出するときはアダプタ側だけ差し替える。

## 帰結
+ 業務ロジックのテストは DB なしで書ける（services/ の純粋関数）。永続化の入れ替え（DB-per-tenant、別ストア）はカーネル内で閉じる。
+ エージェントが書くモジュールの形が一様になり、レビューと lint が効く。
− 複雑な集計クエリ（会計レポート等）は kernel の `report` ポートが要る。Phase 1 冒頭で設計する（それまでモジュールは repo の list/count で我慢する）。
− kernel が肥大しやすい。kernel 内部も `db/` `repository/` `actions/` のように内部境界を持ち、「業務用語を kernel に入れない」規約で抑える。

## 最強の反論
ポートを kernel に集約すると、結局 kernel が「神クラス」になり、ヘキサゴナルの利点（差し替え可能性）が名ばかりになる。モジュールごとに自分のポートを宣言し DI する方が正しい。→ 実験の観点では「エージェントが一様に書ける」方を優先する。kernel のポート数が 15 を超えたら再検討する。
