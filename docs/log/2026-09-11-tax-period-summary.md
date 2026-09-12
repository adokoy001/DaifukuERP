# 作業記録: 2026-09-11 消費税集計表（accounting.tax_period_summary）

- セッション: 実装エージェント（Claude）1 ラン ／ 担当: agent ／ 対象: docs/specs/tax-period-summary.md
- 計測: tokens=null, agent_minutes=20, human_minutes=0, rework_lines=0, gate_failures=0（typecheck / lint / boundaries / unit / db とも初回で通過）
- 編集範囲: modules/accounting、l10n/jp の勘定科目シード、apps/api/drizzle/migrations（生成物）、docs/domain/japan-tax.md、本記録。kernel・apps/web・apps/api/src・sales/purchase/payment は未編集。`pnpm install` / `db:reset` / `db:migrate`（daifuku_dev）は実行していない。

## 決めたこと（と理由）
- **分類は純粋関数（services/tax-summary.ts）、DB は集計ポート 1 回＋科目の id 読み込み**。`journal_line` を `(accountId, taxCategory, taxRate)` で group し（Σdebit, Σcredit, count）、科目の `type` / `taxRole` で振り分ける。規則:
  - `taxRole ≠ none` が最優先で**税額行**。output_tax → 売上（貸方 − 借方）、input_tax → 仕入（借方 − 貸方）。
  - `taxRole = none` かつ `taxCategory` が null → **除外**（売掛金・預金・元入金・購買の「控除対象外消費税」行）。AC-5 の注記「控除対象外消費税は費用側に乗るので集計に含まれない」はこの規則で満たす。
  - revenue → 売上の税抜額（貸方 − 借方: 値引き・逆仕訳は減算）、expense / asset → 仕入の税抜額（借方 − 貸方: 返品・逆仕訳は減算）、liability / equity → 除外。
  - 税額行で taxCategory **または** taxRate が欠ける → `(side, 'unclassified', '')`（AC-4）。率が無いと行に対応付けられないので「どちらか欠け」を未分類とした。基礎行で率だけ欠ける場合は `(side, category, '')` の行になる。
- **行の値**: `side` は spec の値そのまま（'売上' / '仕入'）。`taxCategory` はコード（AC-4 の `'unclassified'`、AC-6 の `non_taxable` 行に合わせる）。spec の「taxCategory (label)」は **`taxCategoryLabel` 列（日本語ラベル: 標準税率・軽減税率・非課税・未分類…）を 1 列追加**して満たした（コードとラベルの両方が画面・CSV・MCP に出る）。
- **`taxRate` は text 列の文字列で最低 2 桁、桁は落とさない**（'0.1' → '0.10'、'0.075' → '0.075'、率なし → ''）。decimal 列にすると web の表示規則（通貨桁 0 で末尾 0 を落とす）で '0.1' と表示されるため。
- **`count` = その行に集計した転記済み明細の数（税抜額の行＋税額の行）**。伝票数ではない（集計ポートに count distinct が無い）。逆仕訳の組は金額 0・count 2 の行として残す（消えるより見える方を選んだ）。
- **並び順**: 売上 → 仕入、税区分は TAX_CATEGORIES の順（standard, reduced, exempt, non_taxable, out_of_scope）→ unclassified、同じ税区分内は税率の高い順、率なしは最後。
- **totals は spec の 3 キーのみ**（`output_tax_total`, `input_tax_total`, `net_tax_due`、Decimal 文字列）。列キーではない。
- **タイトル `消費税集計表 <from>〜<to>`**（試算表・総勘定元帳と同じ流儀。spec の「titled 消費税集計表」は前方一致で満たす）。meta は `{ from, to }`、集計が 10,000 グループに達したら `truncated: true`。
- **入力 `{ from, to }` は必須（既定値なし）**。期間を取り違えた税額が黙って出るのを避けるため。`from > to` は VALIDATION（path `to`）。permission は spec どおり `journal_entry.read`（sales / purchasing も journal_entry read を持つので呼べる）。`tx: 'none'`, `mutates: false`。メニュー「消費税集計表」（order 35、試算表の次）。
- **`account.taxRole`**: `f.enum(['none','output_tax','input_tax'], { required, default 'none', label 消費税の役割, labels })`。フォームは `['taxCategoryDefault','taxRole']` と `['partnerRequired','isActive']` の 2 行に分けた。
- **l10n/jp シードは 2 行ではなく 5 行の変更**: 2200 / 1500 の 2 行に加え、`SeedAccount` に `taxRole?` が無く `toInsert` も渡さないため、型 import・インタフェース・受け渡しの 3 行が必要だった。
- **migration 0004** は `pnpm db:generate account_tax_role`（cli の generate は名前引数を取る。省略時は `auto`）。事前に `pnpm db:schema` で pendingStatements 0（他者の未生成スキーマ変更が混ざらない）を確認し、生成物は `ADD COLUMN tax_role text DEFAULT 'none' NOT NULL` と CHECK 制約の 2 文だけ。生成後の pendingStatements 0。
- **AC-5（転記側の確認）: 変更不要**。sales `services/posting.ts` は仮受消費税行（`taxLines`）と売上行の両方に `taxCategory`/`taxRate` を付けている（税抜は明細ごと、税込は税率グループごと）。purchase `services/posting.ts` は仮払消費税行と費用行に付け、控除対象外消費税の行だけ付けない（意図どおり）。payment の転記は預金・売掛金・買掛金・前受/前払のみで税の行を持たない。

## やったこと
- 読んだもの: CLAUDE.md、spec、conventions（layers / code-style / errors / testing / money-and-dates / reports / lint）、domain（japan-tax / scenario-kojin）、modules/accounting の src 全部と DB テスト、kernel の aggregate / table-result / decimal / dsl(fields, action) / meta / testing / errors、sales / purchase / payment の posting、l10n/jp の勘定科目シードと DB テスト、apps/api の db cli / migrations / meta route / main / config、scenario.db.test.ts・migrations.db.test.ts、apps/web の report-table / reports / format（描画の確認のみ）、payment の作業記録。
- 新規: `modules/accounting/src/services/tax-summary.ts`（150 行）、`src/actions/tax-period-summary.ts`（87 行）、`test/tax-summary.test.ts`（unit: 例 4 件＋ property 2 件 × 200 runs）、`test/tax-period-summary.db.test.ts`（Postgres 5 件）。
- 変更: `src/entities/account.ts`（TAX_ROLES / TAX_ROLE_LABELS / taxRole）、`src/module.ts`（アクション・メニュー）、`src/index.ts`（公開 API）、`l10n/jp/src/seeds/chart-of-accounts.ts`（5 行）、`apps/api/drizzle/migrations/0004_account_tax_role.sql` + `meta/0004_snapshot.json` + `meta/_journal.json`（生成）、`docs/domain/japan-tax.md`（出典の追記）。
- AC-6 の DB テストは台本 10 月の仕訳明細を sales / purchase が実際に作る形（scenario.db.test.ts が行単位で検証済みの形）で `postFromSource` により再現した。accounting は sales / purchase を import できない（依存方向）ため。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）
- [実測] `pnpm typecheck`: エラー 0。`pnpm lint`（eslint . + depcruise）: 0、`no dependency violations found (323 modules, 1436 dependencies cruised)`。
- [実測] unit: `npx vitest run --project unit modules/accounting` **3 files, 23 tests passed**。unit 全体 **29 files, 257 tests passed**。
- [実測] db（daifuku_test_accounting）: `modules/accounting` **2 files, 19 tests passed**（既存 14 + 新規 5）。
- [実測] db（daifuku_test_l10n）: `l10n/jp` **1 file, 4 tests passed**（既存テストは taxRole を見ない。1500/2200 の taxRole は下の台本ステップで間接的に実測）。
- [実測] db（daifuku_test_api）: `apps/api` **5 files, 46 tests passed**。migrations テストで 0000〜0004 が空 DB に適用・冪等・pending 0。scenario（未編集、10 ステップ）も通過。
- [実測] AC-7 の追加ステップ: scenario.db.test.ts は編集せず、末尾にステップ 11 を足した一時コピー `apps/api/test/.tmp-tax-step-scenario.ts` を、そのファイルだけを include する一時 vitest 設定（scratchpad）で daifuku_test_scenario に対して実行 → **11 tests passed**（l10n/jp のシードで taxRole が付いた実科目・実転記で 23,900 / 5,900 / 18,000）。実行後に一時ファイルは削除済み。
- [実測] 依存側の回帰: db `modules/sales` 9、`modules/purchase` 8、`modules/payment` 8、`apps/mcp` 2 files 18、いずれも passed（各専用テスト DB）。
- [実測] HTTP: 上の台本実行後の daifuku_test_scenario に対して `tsx src/main.ts`（PORT 3997、一時起動）→ `/auth/login` → `POST /actions/accounting.tax_period_summary {from:'2026-10-01',to:'2026-10-31'}` が DB テストと同じ 4 行と totals を返す。`GET /meta`: `resultKind: 'table'`、`inputSchema.required = ['from','to']`、メニュー `/r/accounting.tax_period_summary`、account の `taxRole` フィールドメタ（enum・ラベル・valueLabels）。サーバは停止確認済み（停止時の `pkill -f` が自分のシェルにも一致して exit 144 になったが、他のプロセスは該当なし）。
- [実測] テストの効き: services/tax-summary.ts に 5 種の手動ミューテーション（借方を無視、率なし税額行を未分類にしない、税区分なし基礎行を数える、count を group 数にする、asset を仕入にしない）→ すべて unit または db テストが失敗することを確認し、元に戻した。
- [レビュー] AC-6 の期待値は台本からの手計算: 売上税額 15,000 + 3,000 + 5,900 = 23,900（課税売上 150,000 + 30,000 + 59,000 = 239,000、明細 5 + 税額 3 = count 8）、仕入 標準 税抜 20,000（BILL1）+ 50,000（BILL2。控除対象外 1,500 は税区分なし行で除外）= 70,000、税額 2,000 + 3,500 = 5,500（count 4）、軽減 8% 税抜 5,000・税額 400（count 2）、非課税 家賃 80,000・税額 0（count 1）、仕入控除税額 5,500 + 400 = 5,900、差引 23,900 − 5,900 = 18,000。
- [未検証] web のレポート画面 `/r/accounting.tax_period_summary` をブラウザで表示。コードレビュー上は `resultKind === 'table'` で一覧に出て表は描画されるが、**totals の 3 キーは列キーではないので `TotalsRow`（列キーの totals だけを描く）にも CSV にも出ない**（下の gap）。
- [未検証] `pnpm gate` の一括実行（`test:db` 全体は既定の daifuku_test を共有するため、関係するパッケージを専用 DB で個別に実行した。kernel / partner / product / tax / attachments / web の db テストは今回未実行）。

## 見つけた問題と修正（発見経路つき）
- なし（ゲート失敗 0）。下記は仕様・運用上の gap。

## gap（本ランでは編集していない）
- **web が totals の非列キーを表示しない**。`output_tax_total / input_tax_total / net_tax_due` は API・MCP には出るが、レポート画面の合計行と CSV には出ない。web 側で「列に対応しない totals をキー: 値で表示する」対応が要る（apps/web）。
- **既存 DB（daifuku_dev など）では 1500 / 2200 の taxRole が 'none' のまま**。migration 0004 は既定 'none' で列を足すだけで、l10n/jp のシードは既存コードを上書きしない。この状態だと 1500 の明細が仕入の税抜額に数えられ、2200 は無視される（税額合計 0）。`db:reset` するか `account.update` で 1500 → input_tax、2200 → output_tax を設定する必要がある。
- 規則上の限界（spec どおり）: 資産科目の貸方に税区分がある取引（固定資産の売却＝課税売上）は仕入の減算になる。税込経理の会社は税額行が無いので税額が出ない。免税事業者からの仕入（BILL2）は税抜 50,000 が全額 standard 行に入り、70% 控除は税額側（3,500）にだけ現れる。

## 未実施（減らさない。完了したら「済」を付けて残す）
- scenario.db.test.ts へのステップ 11 の追加（本体が管理。コードは最終報告に貼付、一時コピーで実測済み）。
- web で totals の非列キーを表示（apps/web）。
- ブラウザでの `/r/accounting.tax_period_summary` 表示確認。
- `pnpm gate` 一括。
- 既存 DB の 1500 / 2200 への taxRole 付与（データ移行の方法は判断待ち）。
- 簡易課税・2 割特例・申告書様式・課税売上割合・1 億円上限（spec スコープ外）。

## 判断待ち（利用者）
- 既存会社の taxRole 付与: l10n/jp のシードに「既存の 1500 / 2200 で taxRole が none なら補う」冪等ステップを足すか、手作業（account.update）で運用するか。
- `count` の意味（明細数）で良いか、伝票数（仕訳数）にするか（後者は集計ポートに count distinct が要る = kernel）。
- `side` を日本語値（'売上' / '仕入'）のままにするか、コード＋ラベルに揃えるか。

## 次のセッションへ
- API/MCP: `accounting.tax_period_summary { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }` → TableResult（行 `[side, taxCategory, taxCategoryLabel, taxRate, taxableAmount, taxAmount, count]`、totals `output_tax_total / input_tax_total / net_tax_due`）。分類規則は `classifyGroup`（services/tax-summary.ts）。
- 出典: docs/domain/japan-tax.md#tax-period-summary。
