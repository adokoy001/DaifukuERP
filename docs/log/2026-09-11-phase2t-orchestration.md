# 作業記録: 2026-09-11 Phase 2T — 導入テンプレート「小売」「不動産（賃貸管理）」

- セッション: Claude（claude-fable-5-1）アーキテクト役 ＋ 実装サブエージェント 2 本（Opus、並列）
- 対象: PLAN v0.4 §6 Phase 2T（`docs/specs/pack-retail.md`、`docs/specs/pack-real-estate.md`）
- 計測: サブエージェント 447k + 480k ≈ 0.93M トークン、30 + 45 分。本体は統合（配線・migration 0006・2 つの設計変更・実機確認）で約 40 分。人手 0。`docs/metrics/features.jsonl` 26 行。

## 決めたこと（と理由）
- **H3 の最初の実測**: 小売 pack 982 行、不動産 pack 1,401 行に対し、**pack の実装中に必要になったコア改変は 0 行**（両エージェントとも `git diff` で確認）。統合時に本体が入れたコア変更は 3 件・約 45 行（下記）で、いずれも「複数 pack を同時ロードする」ための変更であり、テンプレートの表現力の不足ではない。→ H3 は今のところ支持（【推測】ただし 2 業種とも「請求書＋仕訳」の周辺に収まる業務で、製造や予約のような別種の業務ではまだ試していない）。
- **ラベル上書きは後勝ち＋警告**（Conflict で起動失敗にしない）: retail と real_estate が partner / sales_invoice を両方ラベル替えし、開発環境では両方ロードするため。`registry.warnings()` に記録し API 起動時にログ。ADR-0015 を更新（下記の未実施）。
- **pack のロードは `DAIFUKU_PACKS`（既定 all、`none`、カンマ区切り）で選ぶ**: 導入テンプレートは配備単位で選ぶものという意味論に合わせた。`db:generate` は all で実行する（未ロード pack のテーブルも作られる制限は ADR-0015 v1 の割り切り）。
- **`SettingDef.default` を追加**: l10n/jp の seed が `tax.price_includes_tax=false` を書くと、pack の既定（小売は true）が「管理者の選択」と区別できず適用されない問題（retail エージェントの発見）。モジュールが宣言した既定値と等しい保存値は「未選択」とみなし pack の既定で上書きする。tax と inventory の設定に default を宣言。
- **エンティティ名は pack 接頭辞**（`retail_closing`、`real_estate_unit`）: 規約どおりに統一（spec 側が違っていたので直した）。伝票番号の接頭辞は `REG-` のまま。
- **消費税集計の発行日基準**（real-estate エージェントの判断を採用）: 12 月分家賃を 11-25 に生成しても請求日は 12-01 なので 11 月の集計には入らない。根拠は消費税法基本通達 9-1-20（賃貸借の資産の譲渡等の時期＝支払を受けるべき日）【エージェント報告、一次出典は未確認】。

## やったこと
- packs/retail: `retail_closing`（レジ締め: 税込明細、現金＋カード＝合計の検算、submit で売上請求書＋現金入金＋自動出庫）、`retail.daily_sales`、`retail.close_month`（三分法の期末商品棚卸高、前月分の振替）、seed（5050/5100/6990、店頭客）、sample（品目 4、仕入先）。台本 `docs/domain/scenario-retail.md`（11 月、手計算）とシナリオテスト 16 件。
- packs/real-estate: `real_estate_property/unit/deposit`、契約 ext（部屋・礼金・敷金月数）、税区分の既定（住宅 非課税／事務所・駐車場 課税／1 か月未満の住宅は課税）、`move_in`（開始月の日割り請求＋礼金行）、`receive_deposit`/`return_deposit`（預り金の仕訳）、`move_out`、`rent_roll`、`arrears`。`docs/domain/real-estate.md`（出典、nta.go.jp は proxy で読めず【未確認】あり）、台本 `docs/domain/scenario-real-estate.md`、シナリオテスト 13 件。
- 本体: 配線（api/mcp）、migration 0006、上記 3 つの設計変更、実機確認。

## 検証（何を・どう確認したか）
- [実測] `pnpm gate`: tsc7 0、eslint 0/0、depcruise 0 違反（449 modules / 2,208 deps）、unit **369**、db **258**。
- [実測] 両 pack のシナリオテストが手計算の期待値と一致（各エージェント 3 回連続、本体で統合後に各 1 回＋gate で 1 回）。主要値: 小売 11 月売上 税抜 57,450／税 5,040（8%: 2,820、10%: 2,220）、期末商品 7,700、試算表 413,200、カード売掛 8,760；不動産 11 月 課税売上 208,000／税 20,800、非課税 168,333、預り金 265,000、滞納 T4 8,800（12-05 時点 5 日）、レントロール 233,000（課税 108,000／非課税 125,000）。
- [実測] `pnpm db:reset` → `pack:apply retail --sample` → `pack:apply real_estate --sample` → 実機で Playwright **7/7**。API 起動ログにラベル上書きの警告 3 件（想定どおり）。画面: レジ締めの新規フォーム（明細グリッド付き）、レントロール、部屋一覧、契約一覧、品目一覧（`screenshot-retail-closing-new.png`、`screenshot-re-rent-roll.png` 等）。
- [レビュー] 両エージェントの報告で spec の数値誤りを各 1 件訂正（小売の P4 帳簿数量、不動産の 11 月集計 316,000 案）。
- [未検証] pack の画面操作（レジ締めの入力→確定→在庫→入金までを UI で）、MCP からの pack アクション、複数会社での pack 適用、`DAIFUKU_PACKS=none` での起動。

## 見つけた問題と修正（発見経路つき）
- 2 pack の同時ロードがラベル Conflict で失敗 — 発見: 両エージェント（実測）→ 後勝ち＋警告に変更、kernel の unit テストを更新（理由をテストコメントに記載）。
- l10n seed の値が pack 既定を阻む — 発見: retail エージェント → `SettingDef.default`。
- 汎用フォームで computed 項目（税抜合計など）が必須入力として表示される — 発見: 本体のスクリーンショット → 未修正（DSL に UI 用 `readOnly` ヒントが要る）。
- サイドバーが長くなり pack のメニューが初期表示でスクロール外 — 発見: 本体 → 未修正（グループ折りたたみ）。

## 未実施（減らさない）
- [ ] ADR-0015 の追記（後勝ちラベル、DAIFUKU_PACKS、SettingDef.default）と `docs/conventions/packs.md` の更新
- [ ] DSL の `readOnly`/computed ヒント → 汎用フォームで読み取り専用表示
- [ ] 返品の在庫戻し（inventory は qty ≤ 0 を無視）、カード売上の入金と手数料（小売）
- [ ] 更新料の自動請求、管理会社モード、契約終了時の請求済み月の調整（不動産）
- [ ] 発行日基準の一次出典確認（基本通達 9-1-20）、飲食料品の範囲の出典
- [ ] pack のアンインストール、会社ごとの pack 有効化、未ロード pack のテーブル
- [ ] Phase 1.5 からの持ち越し（`saveLines` の権限、savepoint、`naming.dateField`、ジョブ、MCP resource の currency/packs）

## 判断待ち（利用者、急がない）
- 発行日基準（12 月分家賃の請求日 12-01 → 12 月の課税売上）で良いか。
- 小売の返品を在庫に戻す仕様を module（inventory）側に足すか。

## 次
- Phase 2M: ユーザーマニュアル。
