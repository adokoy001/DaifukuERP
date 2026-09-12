# 作業記録: 2026-09-11 Phase 1.5 — 「完成」の定義を満たす（未実施の消化・pack 機構・inventory/contract）

- セッション: Claude（claude-fable-5-1）アーキテクト役 ＋ 実装サブエージェント 7 本（**Opus**、利用者の「Fable の週次リミット対策」指示で切替）
- 対象: PLAN v0.4 §6 Phase 1.5（`docs/specs/{kernel-phase15,tax-period-summary,web-phase15,pack,inventory,contract,phase15-cleanup}.md`）
- 計測: サブエージェント合計 ≈ 2.51M トークン（kernel 428k / tax 255k / web 394k / pack 277k / inventory 488k / contract 350k / cleanup ≈320k）、合計 ≈ 238 分。本体（Fable）は未計測。人手 0 分。`docs/metrics/features.jsonl` 24 行。

## 決めたこと（と理由）
- **「完成」の定義を Claude が置いた**（PLAN v0.4 §6 Phase 1.5）。利用者の「完成と呼べる状態になったらテンプレート」に対し、機械的に確認できる条件（未実施上位の消化、内部アクション、pack 機構の実証、inventory/contract、CI 定義、HANDOFF）にした。
- **消費税集計は accounting に置く**（`accounting.tax_period_summary`、Phase 1 ログの `tax.period_summary` から改名）: 日本の会計実務どおり仕訳の税区分から集計する。tax → accounting の依存は逆向きになるため。`account.taxRole`（output_tax/input_tax）を追加し、l10n/jp が 2200/1500 に設定。
- **pack は常時ロード、適用は会社単位**（ADR-0015 の v1 の割り切り）: `defineEntity` がインポート時に登録する設計上、pack の有効/無効をプロセス単位でしか切れない。ラベル上書きもグローバル。会社ごとの切替は Phase 3 以降。
- **サブエージェントは Opus に切替**。品質差は今回の範囲では観測されず（7 本すべて仕様を満たし、ゲート失敗はゼロか少数）。【推測】設計が spec に十分書かれていれば実装モデルの差は小さい。
- **inventory の自動出庫は既定 on、負在庫は既定 off** のままにし、個人事業の台本では設定で無効化。→ サービス業の導入では「在庫を使わない」設定が要る（マニュアルに書く）。
- spec の数値誤りを 2 件、エージェントが手計算で訂正: inventory golden（avg 120 → **115**）、cleanup の試算表合計は spec 修正後（863,899）で一致。**spec を盲信しない指示が効いた**。

## やったこと
- kernel: `registerExt`（ext フィールドの型・検証・meta・where/search）、`after_lines_saved`、`internal` アクション（record_payment を非露出）、TableResult を kernel へ、`/auth/me` company.currency と money の scale、permissions の `$in: []` / `$ne: null` バグ修正、`definePack`/`applyPack`/`pack.apply`/`pack.list`。
- modules: accounting.tax_period_summary（+taxRole、migration 0004）、inventory（7 エンティティ、移動平均、自動入出庫、棚卸、4 レポート）、contract（契約、按分、冪等な月次請求生成、請求予定）、payment の after_lines_saved 化。
- packs/example（ext・設定既定・ラベル上書き・小エンティティ・seed/sample）、`pnpm pack:apply`。
- web: 消込パネル（未消込一覧から allocation）、ext フィールドの描画、通貨桁の表示規則、レポートの追加合計、e2e 4 本追加（合計 7）。
- 台本 INV4（軽減税率 3 行、税率ごと丸め 266 vs 行ごと 264）とステップ 11（消費税集計表）。CI（GitHub Actions、未実行）。migration 0005（inventory/contract/example_tag）。

## 検証（何を・どう確認したか）
- [実測] `pnpm gate` 統合後: tsc7 0、eslint 0/0、depcruise 0 違反（403 modules / 1,911 deps）、unit **348**、db **229**。
- [実測] `pnpm db:reset` → `pnpm pack:apply example --sample` → 実機で Playwright **7/7**（smoke 2、phase1 1、payment 2、phase15 2）。スクリーンショット: 取引先一覧に pack のラベル上書き「得意先/仕入先」、サイドバーに 在庫/契約/消費税集計表（`screenshot-pack-partner-list.png`）、消費税集計表の画面（`screenshot-tax-summary.png`）。
- [実測] 台本 11 ステップ（INV4 込み）が手計算の期待値と一致（cleanup エージェント 3 回連続、本体で統合後 1 回）。
- [レビュー] 各エージェントの最終報告を読み、意図的にコードを壊してテストが落ちることを確認したという報告（kernel/web/pack/inventory/contract/cleanup）を採用。本体では再現していない。
- [未検証] CI ワークフローの実行、MCP からの pack/inventory/contract 操作、契約→請求生成の UI 操作、purchase 方向の消込 UI、在庫の同時実行。

## 見つけた問題と修正（発見経路つき）
- 権限の行ルール `$in: []` が全行一致にコンパイルされていた（kernel エージェントの発見 → cleanup エージェントが修正・実測: 修正前は行が漏れていた）。**セキュリティ上の欠陥**だった。
- 金額入力欄がフォーカス時に整形値へ追記していた（`1,100` に `7` → `11007`。web エージェントが e2e で発見 → 修正）。
- `apps/web` に `test` スクリプトが無く `pnpm --filter @daifuku/web test` が何もせず成功していた（web エージェント → 追加）。Phase 1 の「web unit 緑」は空振りだった可能性がある。
- `pnpm metrics:add -- ...` が `"": true` を混入（cleanup エージェント → 本体でスクリプト修正）。
- `saveLines` が親の update 権限を要求するため、sales ロールの自動出庫が失敗（inventory エージェント → 行を個別 create で回避。kernel 側の課題として残す）。
- spec の誤り 2 件（上記）。

## 未実施（減らさない）
- [ ] kernel: 「モジュールのコードだけが書けるエンティティ」の宣言（inventory/contract がフックで代用）、`saveLines` の権限、savepoint、`naming.dateField`、ジョブ（月次の請求生成）
- [ ] MCP resource `daifuku://meta` に currency / applied packs を渡す
- [ ] `views.list` に `ext.<key>`、明細エンティティの ext 描画
- [ ] contract のメニューに「請求予定」（module.ts の menus 確認）、purchase 方向の消込 UI 確認
- [ ] 経過措置 1 億円上限、docs/conventions/layers.md と ADR-0013 L4 の pack 追記
- [ ] Phase 1 からの持ち越し: worker、GitHub push、トークンの本体分計測、多態参照
- [ ] 税率×期間の「飲食料品」の範囲の出典（japan-tax.md）

## 判断待ち（利用者、急がない）
- pack の常時ロード方式（会社ごとに有効/無効にしたいか）。
- inventory の既定（自動出庫 on／負在庫 off）。
- contract: 終了済み契約の終了月までの請求を許す（エージェントの判断）で良いか。

## 次
- Phase 2T: packs/retail、packs/real-estate（台本＋シナリオテスト）。
