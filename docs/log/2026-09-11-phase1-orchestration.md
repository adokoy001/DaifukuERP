# 作業記録: 2026-09-10〜11 Phase 1 — 汎用コア＋日本パック、台本1か月の完走

- セッション: Claude（claude-fable-5-1）アーキテクト役 ＋ 実装サブエージェント 13 本（うち 4 本はレート制限で中断→再開）
- 対象: PLAN v0.3 Phase 1（マスタ→会計コア→販売→購買→入出金→l10n/jp）と Phase 2 の台本 `docs/domain/scenario-kojin.md`
- 計測: サブエージェント合計 ≈ 3.9M トークン（実測: 各エージェントの usage 合計。中断分 0.93M を含む）／ 本体セッション 推定 1.0M（未計測）／ human_minutes 0 ／ 詳細は `docs/metrics/features.jsonl`（**注意**: tax/accounting/attachments/web-phase1 の agentMinutes は再開後の分だけ。中断された初回（各 13〜16 分）は含まない）

## 決めたこと（と理由）
- **kernel の Phase 1 ポート**を先に足してからモジュールを並列実装: 伝票明細（lines: 置換保存・汎用 create/update/get に `lines` 同梱）、aggregate（report ポート）、company settings、storage。ADR-0013 の「モジュールは kernel のポートだけ」を守るために必要だった。
- **汎用 create/update の入力検証を lenient に**（`inputMode`）: H1 計測の product エージェントが「必須項目のフック既定値が API 経由だと表現できない」と報告。アクション境界では形だけ見て、Repository が `before_validate` フック後に厳密検証する。OpenAPI/MCP は引き続き厳密スキーマを表示。
- **設定キーは snake_case**（`tax.price_includes_tax`）: spec を kernel に合わせた（逆より変更が小さい）。
- **amend は明細も複製し `<元番号>-n` で採番**（ADR-0006 どおりに kernel を修正）。sales/purchase のテストは「複製されない」前提で書かれていたので期待値を更新（挙動変更を明記）。
- **accounting ロールに sales_invoice/purchase_invoice の update を付与**: 入出金の消込が伝票の allowOnSubmit 項目（paidAmount/balance/status）を更新するため。spec AC-8 を改訂。
- **並列実装の衝突回避**: パッケージ骨格と test DB（`daifuku_test_<module>`）を先に作り、エージェントは `pnpm install` 禁止・自パッケージ以外の編集禁止・`modules.ts`/`server.ts` は本体が配線。
- **H1 の 2 点目**は product を「CLAUDE.md＋docs＋kernel だけ」の新規コンテキストで実装させて測った（他モジュールの閲覧禁止）。

## やったこと（成果物）
- kernel: lines / aggregate / settings / storage / lenient input / kana 検索正規化 / amend 複製＋採番 / json 既定値 / JST today / orderBy 既定 asc / registerSetting。
- modules: product(+uom), tax（率×期間、税率ごと丸め、golden）, accounting（勘定科目・会計年度/期間・仕訳＋明細・逆仕訳・試算表・総勘定元帳・期間締め）, attachments（電帳法メタデータ、検索、差替え、API upload/download）, sales（売上請求書・適格請求書 HTML・年齢表・消込関数）, purchase（仕入/経費請求書・経過措置 override・年齢表）, payment（入出金・消込明細・転記・未消込一覧）。
- l10n/jp: 勘定科目 31 件、税率/設定既定、経過措置テーブル（80/70/50/30/0）、適格請求書レイアウト（和暦・軽減税率※・税率ごと合計）、和暦/金額整形。
- apps: api に添付ルート・設定 API・`/meta` の inputSchema/resultKind、web に明細グリッド・レポート画面・添付パネル・設定画面・小数桁整形・請求書表示・ホーム。migration 0001〜0003。
- Phase 2 台本 `docs/domain/scenario-kojin.md`（手計算の期待値つき）と `apps/api/test/scenario.db.test.ts`（10 ステップ、約 150 アサーション）。

## 検証（何を・どう確認したか）
- [実測] `pnpm gate`: tsc7 0 エラー、eslint 0 エラー（警告1）、dependency-cruiser 0 違反（311 modules / 1,343 deps）、unit **236**、db **167**、約 80〜90 秒。
- [実測] Playwright E2E 3/3（取引先 CRUD＋監査、仕訳2行→確定→明細ロック→試算表レポート）。
- [実測] **台本 1 か月**: 期待値の全項目（請求書ごとの税額・期日、経過措置 70%、試算表 11 科目と合計 860,300、売掛 229,900/買掛 60,400、預金 231,000、消費税 23,900/5,900、年齢表、適格請求書の記載）が一致。差異ゼロ（表記差のみ）。
- [実測] API 経由で混在税率の請求書（10%: 100,000、8%: 3,702）→ 税 10,000 + 296（切捨て）= 10,296、合計 113,998。JP レイアウトの HTML をスクリーンショットで目視（登録番号・※・税率ごと合計・和暦）。
- [実測] H1 データ点: partner（前例あり）10 分・ゲート失敗 2・578 行 ／ product（前例なし、docs＋kernel のみ）11 分・2・572 行。**マスタ 1 本の追加コストは「例を見なくても」同程度**。ただし複雑モジュール（sales 32 分、payment 35 分）はドメイン論理に比例して増えており、H1 の判定にはまだ足りない。
- [レビュー] 各エージェントの最終報告と作業記録を読み、kernel への変更要望 12 件のうち 9 件を本体で実装、3 件を未実施に残した。
- [未検証] 実運用規模の性能（明細 100 行超の N+1 再計算）、MCP からの一連の台本実行、同時実行の採番、UI での入出金消込操作（E2E なし）。

## 見つけた問題と修正（発見経路つき）
- 汎用 create の応答が明細保存前のヘッダを返す — 発見: sales/purchase エージェント（テスト）→ kernel で保存後に再読込。
- `f.json({default})` が drizzle-kit で params 不可 — 発見: sales エージェント（createSchemaFromScratch 失敗）→ `sql.raw`。
- date 既定 'today' が UTC — 発見: sales エージェント → `todayLocal`。
- `orderBy` 既定が desc — 発見: l10n エージェント → asc。
- 仕訳明細の `posted` を下書きのうちに立てられる整合性穴 — 発見: accounting 再開エージェントのレビュー → `after_submit` へ移動＋freeze フック（モジュール内）。
- 添付の未知の multipart フィールドが黙って捨てられる — 発見: attachments 再開エージェントのレビュー → 400。
- PUT の CORS 未許可 — 発見: web エージェントの契約確認（実機前）→ server.ts。
- 旧テストの期待が「改善後の挙動」と衝突（全角カナ検索が当たる／`/meta` のエンティティ数／amend の明細複製／accounting の update 権限）— 発見: 統合後の gate → 期待値を更新し理由をテストコメントに記載。
- **レート制限でエージェント 4 本が中断**（2026-09-10 18:xx UTC）。中断時点の成果はディスクに残り、再開エージェントが「読んで続きから」で完走。中断分の分数は metrics に載らない（記録の限界として明記）。

## 未実施（減らさない）
- [ ] `tax.period_summary`（消費税の期間集計 TableResult）— 台本テストは journal_line の aggregate で代用。実製品比較には必要
- [ ] 入出金の消込 UI（未消込一覧から allocation を作る画面）と E2E
- [ ] `after_lines_saved` フック（明細ごとのヘッダ再計算 N 回を 1 回に）
- [ ] TableResult の zod を kernel へ（accounting にコピーがある）
- [ ] 多態参照（payment_allocation.invoiceId が素の uuid）
- [ ] ext フィールド定義の検証、worker アプリ、CI、GitHub push、トークン実測
- [ ] 台本に「割り切れない税額」のケースを足す（切捨てが実際に効く例）
- [ ] 通貨の小数桁の出所（`/auth/me` に company.currency が無い）
- [ ] Phase 0 からの持ち越し（ext 定義、worker、CI）

## 判断待ち（利用者）
- PLAN §10 の 1〜4（特に GitHub）。
- sales/purchase の `record_payment` を REST/MCP に露出したままにするか（転記なしで残高が動く）。
- 免税事業者の 2023-10 以前の控除率＝1、経過措置の年 1 億円上限の扱い（未実装）。
- 台本に丸め誤差ケースを追加してよいか。

## 次のセッションへ
- Phase 2 の比較: 利用者の手元で Odoo Community 19 / ERPNext v16 を Docker で起動できれば、同じ台本を回して `docs/knowledge/comparison-kojin.md` を埋める。本環境では docker デーモンが無いので文書比較になる。
- 未実施の上 3 件（tax.period_summary、消込 UI、after_lines_saved）。
