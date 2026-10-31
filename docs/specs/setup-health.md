# Spec: setup-health（導入チェック）

- 状態: implemented（2026-10-30、[作業記録](../log/2026-10-30-setup-health.md)）
- モジュール: `kernel`（点検の登録 port と実行、会社プロフィール・業務イベントの点検）、各 module の点検 provider（accounting・tax・sales・inventory）、`apps/api`（`GET /meta/health` と運用の点検）、`apps/web`（`/admin/health`） ／ 依存: [settings-console](settings-console.md)、[company-admin](company-admin.md)（`company.profile`、発行者の解決）、[ui-kit](ui-kit.md)
- ADR: [ADR-0027](../adr/0027-setting-presentation.md) §7 に追記（`registry.registerHealthCheck` の port と、秘密値を返さない規約）
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) B3。2026-10-30 実装時に改訂（下の「実装時の確認と変更」）

## 目的（1段落）

運用を始める前に「今日を含む会計期間が開いていない」「税率の有効期間が切れている」「請求書の発行者が未設定」のような設定漏れに気づけず、最初の伝票を確定するときに初めて失敗する。管理者が導入時と日常に、会社の設定と運用状態を一覧で点検し、直す画面へ移動できるようにする。セットアップウィザード（[setup-wizard](setup-wizard.md)）の完了判定にも同じ点検を使う。

## 受入基準（EARS）

- AC-1 WHEN admin または settings ロールの利用者が `GET /meta/health` を呼んだ THE SYSTEM SHALL 点検項目の配列 `[{ id, status: 'ok' | 'warn' | 'fail', label: Label, detail: Label, href? }]` と、点検した日時 `checkedAt` を返す。店舗・拠点限定の所属と、admin / settings 以外のロールは拒否する（403）。
- AC-2 THE SYSTEM SHALL 会計の点検 `accounting.fiscal_period` として、今日（会社の業務日付）を含む会計期間が存在し未締めか（無い・締め済みは `fail`）、今日から 30 日後を含む期間が無いか（`warn`）を返す。
- AC-3 THE SYSTEM SHALL 税の点検 `tax.standard_rate` として、標準税率の区分について今日に有効な税率が存在するか（無ければ `fail`）を返す。
- AC-4 THE SYSTEM SHALL 会社情報の点検として、`company.profile` の正式名称があるか・保存値が定義に合うか（`company.profile`。無い・合わないは `warn`）と、請求書の発行者（`sales.issuer`。`sales.issuer` が有効ならそれ、無ければ `company.profile`）が会社名以外の名称に解決できるか、登録番号を印字できるか（免税事業者を除く）、保存値が定義に合うか（できない・合わないは `warn`）を返す。
- AC-5 THE SYSTEM SHALL 在庫の点検 `inventory.stock_settings` として、売上・仕入請求書からの自動入出庫が有効で、既定倉庫コードに一致する倉庫も既定に指定した倉庫も無い場合を `fail`、コードに一致する倉庫が無く既定に指定した倉庫で代わる場合と、有効な物品の品目が 1 件も無いのに自動入出庫が有効な場合を `warn`（在庫を使わない業種向けの案内）として返す。自動入出庫が両方無効なら `ok`。
- AC-6 THE SYSTEM SHALL 運用の点検として、メール配送（`system.mail`）と OIDC（`system.oidc`）の設定有無（真偽のみ）、未適用の更新の件数（`system.migrations`。リリースの移行一覧と適用記録の件数の比較のみ）、添付の保存先へ書き込めるか（`system.storage`）、未配送の業務イベント（outbox）と送信待ちの配送行の件数、配送に失敗して止まったもの（停止した outbox 行と `dead` の配送行。[event-delivery](event-delivery.md) AC-24 で規則を変更）の有無（`system.outbox`）を返す。接続先・秘密値・ファイルパス・例外の文は返さない。
- AC-7 THE SYSTEM SHALL 各点検を kernel の登録 port（`registry.registerHealthCheck`）に module が登録する provider として実装し、各 provider を呼出し元の権限のまま savepoint の中で実行する。ある provider が例外を投げた、または不正な結果を返した場合はその項目を `warn`（「点検できませんでした」、権限不足なら「点検する権限がありません」）として他の項目を返す。
- AC-8 THE SYSTEM SHALL 各項目の `href` をアプリ内の経路（先頭が `/` 1 つの相対パス。`//`・`..`・スキームを含まない）に限り、それ以外は項目から外す。使う経路は会社設定のタブ、会計年度の作成、会計期間の一覧、月次締め、税率の一覧、倉庫の一覧。
- AC-9 WHEN 管理者が `/admin/health` を開いた THE SYSTEM SHALL 項目を `fail`・`warn`・`ok` の順に並べ、状態を色と文字（要対応・注意・OK）の両方で示し、各項目から直す画面へ移動できる。「再点検」で取得し直し、結果の要約を読み上げ領域に出す。
- AC-10 THE SYSTEM SHALL 画面を「設定・管理」分野に表示し、admin または settings ロールでない利用者には表示しない（直接開くと権限が無いことを説明する）。文言は日本語と英語、390px 幅で操作できる。

## 点検項目の id（安定。B4 のウィザードが完了条件に使う）

| id                         | 持ち主     | ok                                             | warn                                                           | fail                       | href                                                                   |
| -------------------------- | ---------- | ---------------------------------------------- | -------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------- |
| `accounting.fiscal_period` | accounting | 今日を含む期間が開いている                     | 30 日後を含む期間が無い                                        | 期間が無い・締め済み       | `/e/fiscal_period`、`/a/accounting.open_fiscal_year`、`/finance/close` |
| `tax.standard_rate`        | tax        | 今日に有効な標準税率がある                     | —                                                              | 無い                       | `/e/tax_rate`                                                          |
| `company.profile`          | kernel     | 正式名称がある                                 | 正式名称が無い・保存値が定義に合わない                         | —                          | `/settings?tab=company`                                                |
| `sales.issuer`             | sales      | 名称と登録番号を印字できる（免税なら番号不要） | 会社名しか印字できない・登録番号が無い・保存値が定義に合わない | —                          | `/settings?tab=company`、`/settings?tab=sales`                         |
| `inventory.stock_settings` | inventory  | 自動入出庫が無効、または既定倉庫と物品がある   | 既定に指定した倉庫で代わる・物品が無い                         | 倉庫が解決できない         | `/settings?tab=inventory`、`/e/warehouse`                              |
| `expense.accounts`         | expense    | `expense.accounts` の 3 科目と仮払消費税の科目がある（2026-10-30 [expense-settlement](expense-settlement.md) AC-19） | どれかの科目が無い | — | `/settings?tab=accounting`（仮払消費税だけなら `/settings?tab=purchase`） |
| `system.mail`              | api        | SMTP 設定済み                                  | 未設定                                                         | —                          | —                                                                      |
| `system.oidc`              | api        | 設定済み／未設定（どちらも ok。任意機能）      | —                                                              | —                          | —                                                                      |
| `system.migrations`        | api        | 全件適用済み                                   | 適用記録の表が無い（setup で作っていない DB）                  | 未適用・版に無い記録がある | —                                                                      |
| `system.storage`           | api        | 書き込める／未作成（最初の添付で作る）         | 保存先が未設定                                                 | 書き込めない               | —                                                                      |
| `system.outbox`            | kernel     | 停止した行なし（未配送と送信待ちの件数を表示。再試行中だけなら ok） | 停止した outbox 行か `dead` の配送行がある（admin には `/admin/event-deliveries?status=dead`） | —                          | —                                                                      |

並びは `order` の昇順（表の順）。同じ `order` なら kernel・module・API の順。module が足す点検は `<module>.<name>` の id で登録する。

## 関係するファイル・インターフェース（名指し）

- kernel: `kernel/src/health.ts`（新規。`runHealthChecks`、`assertHealthAccess`、`isHealthHref`、kernel の点検 2 件）、`kernel/src/registry.ts`（`HealthCheckDef`、`registerHealthCheck`、`healthChecks`）、`kernel/src/index.ts`
- modules: `modules/accounting/src/health.ts`、`modules/tax/src/health.ts`、`modules/sales/src/health.ts`、`modules/inventory/src/health.ts`（各 module の `hooks` で登録）
- api: `apps/api/src/routes/health.ts`（新規。既存の `/health` 生存確認とは別）、`apps/api/src/health.ts`（新規。運用の点検 4 件）、`apps/api/src/deployment/readiness.ts`（移行一覧の読取を共有）、`apps/api/src/server.ts`（`storageDirectory`・`migrationsDirectory`）、`apps/api/src/main.ts`
- web: `apps/web/src/pages/health-page.tsx`（新規）、`apps/web/src/api/health.ts`（新規）、`apps/web/src/lib/health.ts`（新規）、`apps/web/src/router.tsx`、`apps/web/src/lib/navigation-data.ts`、`apps/web/src/lib/help.ts`
- docs: `docs/manual/08-admin.md`、`docs/manual/03-setup.md`、ADR-0027 §7

## データ・業務ルール（出典）

- 会計期間と転記の関係、税率の期間付きデータ — 既存の [accounting](accounting.md)、[tax](tax.md) 仕様。登録番号（`T`+13 桁）と免税事業者 — [日本の制度事実](../domain/japan-tax.md)（国税庁 タックスアンサー No.6625）。新しい制度値はない。

## スコープ外（明記）

- バックアップの最終時刻（setup の状態ファイルは API から読まない。運用手順の確認事項として画面に案内とマニュアルへのリンクを出す）
- 点検の定期実行と通知
- 自動修正（点検は読取専用で、直すのは各画面）

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:light`
2. DB: 各点検の ok / warn / fail を作る（期間を締める・日付を進める、税率の有効期間を外す、発行者とプロフィールを空にする・定義に合わない値にする、倉庫コードを不一致にする、物品を無効にする、outbox に失敗行を入れる、移行一覧と適用記録をずらす、保存先をファイルにする）、provider の例外と SQL エラー（ログに SQL・束縛値が出ないこと）、読取専用のトランザクションで書く点検が `warn` になること、権限不足の項目、店舗・拠点限定と sales の拒否、応答に接続文字列や秘密値・パスが含まれないこと（AC-1〜AC-8）— `apps/api/test/setup-health.db.test.ts`
3. 単体: 登録 port と並び・href の判定（`kernel/test/health.test.ts`）、移行件数と保存先の状態（`apps/api/test/setup-health.test.ts`）、画面の並び・表示・リンク（`apps/web/src/lib/health.test.ts`）
4. ブラウザ: fail を含む状態で画面を開き、リンクから直して再点検で ok になる、再点検の失敗（前回の結果を残し失敗を知らせる、ボタンのフォーカスを保つ）、390px、英語、axe、権限の無い利用者（AC-9、AC-10）— `apps/web/e2e/setup-health.spec.ts`
5. `pnpm gate:full`（統合担当が実行）

## 実装時の確認と変更（2026-10-30）

- **登録 port**: `registry.registerHealthCheck({ id, label, order?, run })`。module は `defineModule` の `hooks` で登録する（設定の登録と同じ場所）。kernel 自身の点検（`company.profile`、`system.outbox`）は `KERNEL_HEALTH_CHECKS` として実行時に必ず含め、API の運用点検は `runHealthChecks(ctx, extra)` の `extra` で渡す（サーバーごとの設定を process 全体の registry に登録しないため）。API は module の内部を import しない。
- **権限**: 各点検は呼出し元の Context のまま実行する（バイパスなし）。settings ロールだけの利用者は会計期間・倉庫・品目を読めないので、その項目は「点検する権限がありません」の `warn` になる（税率は settings も読める）。
- **savepoint**: 点検ごとに `withSavepoint` で囲み、SQL エラーでも要求のトランザクションを使い続けられるようにした（DB 試験で確認）。応答には例外の何も出さない。ログには点検 id・request id・エラーコードと、kernel のエラーならその文、それ以外は `safeErrorDiagnostics`（SQLSTATE）だけを書き、生の例外の文（SQL と束縛値を含みうる）は書かない（2026-10-30 レビュー指摘で変更。DB 試験で確認）。
- **読取専用のトランザクション**: `GET /meta/health` は `withRequestContext(..., { readOnlySnapshot: true })` で実行する。書こうとした点検は DB が拒否し、その項目だけが `warn` になる（DB 試験で確認）。
- **在庫の倉庫**: 計画は「既定倉庫コードに一致する倉庫が無い場合を fail」だったが、伝票の確定（`resolveDefaultWarehouse`）は既定に指定した倉庫へ代わるので、両方無いときだけ `fail`、代わるときは `warn` にした。
- **移行の件数**: readiness と同じ方法（`meta/_journal.json` と各 SQL の sha256、`drizzle.__drizzle_migrations` を owner 接続で読む）。返すのは件数だけ。適用記録の表が無い DB（試験用に直接作った DB）は `warn`。owner 接続は要求の処理の中で使う例外になるため、点検には owner の `Database` を渡さず、固定の読取だけを行う関数（`apps/api/src/deployment/readiness.ts` の `appliedMigrationsReader`）を渡す（ADR-0027 §7 に例外として記録。2026-10-30 レビュー指摘で変更）。
- **再点検の失敗**: 再点検の取得に失敗しても TanStack Query は前回の結果を残すので、画面は前回の結果を表示したまま「再点検できませんでした。前回の結果を表示しています。」を読み上げ領域と項目の上の通知（技術情報は閉じた `<details>`）に出す。「再点検」ボタンは取得中も `aria-disabled` で、押したボタンからフォーカスを失わせない（2026-10-30 レビュー指摘で変更）。
- **保存先**: 書込み可なら `ok`、まだ無い（親に書ける）なら `ok`（最初の添付で作られる）、ファイル・書込み不可なら `fail`、API に保存先が渡されていなければ `warn`。readiness の「本人だけが読める権限」の検査は readiness 側に残し、ここでは書込み可否だけを見る。
- **outbox**: 未配送の件数だけでは `warn` にしない。F1（[event-delivery](event-delivery.md) AC-24）で配送 worker と再試行が入ったため、規則を「`last_error` のある未配送行で `warn`」から「停止した outbox 行（`dead_at`）か `dead` の配送行で `warn`、再試行を待つ行だけなら `ok`」に変えた。会社の管理者には失敗タブへの `href` を付ける。
- **OIDC**: 任意機能なので、未設定でも `ok`（「パスワードでログイン」と表示）。
- **バックアップの最終時刻**: 計画には「setup の状態ファイルがあれば」とあったが、状態ファイルは setup の実行者が 0700 で持つ運用ディレクトリにあり（`apps/api/src/setup/files.ts`）、場所は setup の引数で API は知らない。読むには API に新しい環境変数とファイル読取が要り、「ファイルパスを返さない」の規約とも緊張するため、初版は読まない（spec のスコープ外のまま）。画面に案内とマニュアルへのリンクを出す。
- **axe**: 共有の `a11y.spec.ts` の画面一覧（単体試験が 8 画面・32 件に固定）は変えず、`setup-health.spec.ts` の中で同じ判定を `/admin/health` に適用した。

## 未決事項（利用者の判断待ち）

- 「30 日以内に期間が尽きる」の日数を会社設定にするか（初版は固定。`FISCAL_PERIOD_HORIZON_DAYS`）。
- バックアップの最終時刻を画面で点検するか（setup が API から読める場所へ時刻だけを書き出す方式なら可能。初版は案内のみ）。
- settings ロールだけの利用者にも会計期間・在庫の点検結果を見せるか（見せるには、その利用者に該当 entity の読取権限を付ける運用か、件数だけを返す専用の権限の設計が要る。初版は「権限がありません」と表示）。
