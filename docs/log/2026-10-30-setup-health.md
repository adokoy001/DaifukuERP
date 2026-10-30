# 作業記録: 2026-10-30 導入チェック（B3）

- セッション: 完成度向上計画 B3（workflow の作業項目、worktree `wip/company-admin`、B2 のコミット `26d212f` の上）／ 担当: agent ／ 対象: [docs/specs/setup-health.md](../specs/setup-health.md)
- 計測: tokens=null（未計測）, agent_minutes=約70, human_minutes=0, rework_lines=約10（試験の id 一覧の作り直し、SQL の probe の書き方、表示の微調整）, gate_failures=0

## 決めたこと（と理由）

- **module は kernel の登録 port で点検を足す（ADR-0027 §7 に追記）。** `registry.registerHealthCheck({ id, label, order?, run })` を kernel に足し、accounting・tax・sales・inventory が `defineModule` の `hooks` で登録する。API は module の内部を import しない。spec が「ADR が必要な規模なら ADR-0027 に追記」としていたので新しい番号は取らなかった。
- **kernel の点検は registry に登録せず、実行時に必ず含める。** `company.profile` と `system.outbox` は kernel が持つデータの点検で、`registry.reset()` の後でも消えないように `KERNEL_HEALTH_CHECKS` として `runHealthChecks` が先頭に足す。
- **API の運用点検は `extra` で渡す。** メール・OIDC の有無、移行の件数、保存先の書込み可否は API の設定（識別情報・保存先・移行一覧）を読むので、`apps/api/src/health.ts` に置き、route が `runHealthChecks(ctx, extra)` に渡す。process 全体の registry にサーバーごとの設定を持ち込まない（試験で複数のサーバーを作っても重複しない）。
- **呼出し元の権限のまま、点検ごとに savepoint。** バイパスは作らない。settings ロールだけの利用者は会計期間・倉庫・品目を読めないので、その項目は「点検する権限がありません」の `warn`。SQL エラーも savepoint で巻き戻し、後の点検が同じトランザクションで動く。例外の文はログだけに出す（パスや接続先を含むことがあるため）。
- **href はアプリ内の相対パスだけ。** kernel が `isHealthHref`（先頭 `/` 1 つ、`//`・`..`・スキームなし、200 文字以内）で外し、画面も同じ判定で router に渡す。
- **在庫は伝票の確定と同じ解決順で判定。** 計画は「既定倉庫コードに一致する倉庫が無ければ fail」だったが、`resolveDefaultWarehouse` は既定に指定した倉庫へ代わるので、両方無いときだけ `fail`、代わるときは `warn`。
- **outbox は失敗だけを `warn`。** 配送の worker（F1）が無いので未配送は溜まるのが通常。件数は表示する。
- **OIDC は未設定でも `ok`。** 任意機能。メールは未設定だと招待・再設定メールが使えないので `warn`。
- **移行の件数は readiness と同じ読み方。** `expectedMigrations` と既定の移行ディレクトリを `deployment/readiness.ts` から export して共有した。適用記録の表が無い DB は `warn`。
- **バックアップの最終時刻は読まない（spec のスコープ外のまま）。** 計画には「setup の状態ファイルがあれば」とあったが、状態ファイルは setup の実行者が 0700 で持つ運用ディレクトリにあり、場所は setup の引数で API は知らない。画面に案内とマニュアルへのリンクを出した。
- **axe は自分の spec の中で実行した。** 共有の `a11y.spec.ts` の画面一覧（単体試験が 8 画面・32 件に固定）は、同じ round の D3 と衝突しないよう変えず、同じ判定を `/admin/health` に適用した。統合後に一覧へ足すかは統合担当に委ねる（integrationNotes）。

## やったこと

- kernel: `health.ts`（新規。`runHealthChecks`・`assertHealthAccess`・`isHealthHref`・`healthChecks`・kernel の点検 2 件）、`registry.ts`（`HealthCheckDef`・`HealthOutcome`・`registerHealthCheck`・`healthChecks`、`reset` で消す）、`index.ts`
- modules: `accounting/src/health.ts`（`accounting.fiscal_period`、30 日の先読み）、`tax/src/health.ts`（`tax.standard_rate`）、`sales/src/health.ts`（`sales.issuer`、B2 の `resolveIssuer` を使う）、`inventory/src/health.ts`（`inventory.stock_settings`）。各 `module.ts` の `hooks` で登録、各 `index.ts` で export
- api: `routes/health.ts`（新規。`GET /meta/health`）、`health.ts`（新規。`system.mail`・`system.oidc`・`system.migrations`・`system.storage`、`migrationCounts`・`storageState`）、`deployment/readiness.ts`（移行一覧の読取を export）、`server.ts`（`storageDirectory`・`migrationsDirectory`）、`main.ts`（保存先を渡す）
- web: `pages/health-page.tsx`（新規、UI キット）、`api/health.ts`・`lib/health.ts`（新規）、`router.tsx`（`/admin/health`）、`lib/navigation-data.ts`（`settings` 条件の項目）、`lib/help.ts`（08 章の新しい節）、`ui/token-usage.test.ts` の `CONVERTED`
- tests: `apps/api/test/setup-health.db.test.ts`（17 件）、`kernel/test/health.test.ts`（15 件）、`apps/api/test/setup-health.test.ts`（7 件）、`apps/web/src/lib/health.test.ts`（5 件）、`apps/web/e2e/setup-health.spec.ts`（3 件）、`apps/web/src/lib/help.test.ts` に経路を追加
- 文書: ADR-0027 §7、マニュアル 08（「導入チェック」の節と項目の表）・03（冒頭から導入チェックへの案内）、spec（implemented、項目 id の表、実装時の確認と変更、未決事項）

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] API の DB 試験 `apps/api/test/setup-health.db.test.ts` 17 件成功（`daifuku_test_w1`。日付は `ctx.now` を 2026-10-15 / 12-15 / 2027-02-01 に固定）: HTTP の形（`checkedAt`、10 項目の id と順序、日英のラベル・詳細、保存先と移行ディレクトリのパスを含まない）、sales ロールの 403 と未ログインの 401、settings ロールは可・sales と店舗限定・拠点限定は拒否。会計期間（ok、12-15 で warn、翌年 2 月で fail、期間を締めて fail）、標準税率（終了日を過去にして fail、戻して ok）、会社プロフィールと発行者（未設定で両方 warn、正式名称と登録番号で ok、番号なしで warn、免税で ok、定義に合わない保存値で warn、`sales.issuer` で ok）、在庫（ok、コード不一致で既定倉庫に代わって warn、既定指定も外して fail、物品を無効にして warn、自動入出庫を止めて ok）、outbox（失敗行で warn、エラー文を含まない）、メール・OIDC（未設定・設定済み。client secret・鍵・IdP のホスト・client id・接続文字列・パスを含まない）、移行（記録なしで warn、1 件不足で fail、全件で ok、版に無い記録で fail）、保存先（書込み可・未作成で ok、ファイルで fail、未設定で warn）、例外・SQL エラー・不正な結果・外部 URL と `//` の href・権限不足の項目、実際の結果の href がすべて既知の経路。
- [実測] 単体: `kernel/test/health.test.ts`（登録の検査・重複・並び・reset、href の判定 12 例）、`apps/api/test/setup-health.test.ts`（移行の件数 6 例、保存先の状態）、`apps/web/src/lib/health.test.ts`（並び・表示・要約・リンク・ナビゲーション）、`help.test.ts`・`token-usage.test.ts`・`navigation.test.ts`・`setting-labels.test.ts` 成功（7 ファイル 242 件）。
- [実測] ブラウザ（`e2e-run.sh … 1`、新しい fixture DB、`--project=chromium --no-deps`）: `setup-health.spec.ts` 3 件と `company-admin.spec.ts` 3 件、計 6 件成功（43.6 秒）。B2 の画面で作った会社の標準税率を前日で終わらせ、画面検索から導入チェックを開くと税率が先頭の「要対応」、並びが fail → warn → ok、会社プロフィールが「注意」。「直す（標準税率の有効期間）」で税率の一覧へ移動し、レコードの画面で適用終了日を空にして保存、導入チェックで「再点検」を押すと税率が「OK」になり読み上げ領域に要約が出る。390px で横はみ出しなし、英語表示、axe（日本語 390px・英語 1280px）で serious / critical なし。sales ロールの利用者には画面検索に項目が出ず、直接開くと権限が無い旨、API は 403。スクリーンショット（デスクトップの fail 表示、390px）を目視で確認した。表示の微調整（状態の札の幅、要約と点検日時の区切り）の後に、navigation・navigation-assist・settings-console を加えて再実行し 28 件中 27 件成功（3.4 分）。失敗の 1 件 `navigation.spec.ts` AC-3/10 は飲食チェーンのテンプレート適用（industry project）に依存する試験で、`--no-deps` では業界会社が無いため失敗する（B1 の作業記録と同じ。今回の変更と無関係）。industry project 込みで `navigation.spec.ts` を再実行し 8 件すべて成功（1.4 分）。店舗・拠点限定の所属が 403 を受けたときの説明を足した最終状態で `setup-health.spec.ts` と `company-admin.spec.ts` を再実行し 6 件成功（40.8 秒）。
- [実測] `pnpm gate:quick` 成功（191.9 秒。unit は全件に拡大）。画面の最後の修正（店舗・拠点限定の所属への 403 の説明）の後にも再実行して成功（182.3 秒）。
- [実測] `pnpm gate:light` 成功（1,162.5 秒＝19.4 分。kernel の変更で DB を全件に昇格: 134 ファイル 877 件 914.5 秒、unit 159 ファイル 1,595 件 95.0 秒、format:check・docs・台帳・typecheck（root / api / web）・lint・test:deploy も成功。負荷 6〜7 の共有コンテナで、並行してブラウザ試験も実行していた）。最後の修正は Web の画面 1 ファイルだけで DB 試験に影響しないため、gate:light は再実行せず gate:quick とブラウザ試験で確認した。
- [未検証] `pnpm gate:full`（統合担当が実行）。実際の SMTP・OIDC を設定した API プロセスでの表示（DB 試験で設定済みの識別情報を渡して確認したのみ）。本番の移行ディレクトリと適用記録での `system.migrations`（DB 試験の一時ディレクトリで確認）。

## 見つけた問題と修正（発見経路つき）

- なし（試験は初回から成功。表示の微調整はスクリーンショットの目視で決めた）。

## 未実施（減らさない。完了したら「済」を付けて残す）

- バックアップの最終時刻の点検（spec のスコープ外。setup が API から読める場所へ時刻だけを書き出す方式なら可能）。
- 共有の `a11y.spec.ts` の画面一覧への `/admin/health`・`/admin/companies` の追加（統合担当の判断）。
- B4 のウィザードがこの項目 id を完了条件に使う（`accounting.fiscal_period`・`tax.standard_rate`・`company.profile`・`sales.issuer`・`inventory.stock_settings`）。

## 判断待ち（利用者）

- spec の未決事項: 30 日の先読みを会社設定にするか、バックアップ時刻の点検、settings ロールだけの利用者への会計・在庫の点検結果の見せ方。

## 次のセッションへ

- 新しい点検は module の `hooks` で `registry.registerHealthCheck` を呼び、spec の項目 id の表と 08 章の表に足す。
