# Spec: l10n/jp（日本パック: 勘定科目表・税率・経過措置・適格請求書レイアウト・和暦）

- 状態: approved ／ パッケージ: l10n/jp（`@daifuku/l10n-jp`）／ 依存: kernel, accounting, tax（sales/purchase には依存せず、**override 名で**接続する: ADR-0008）
- ADR: 0008, 0011, 0013 ／ 作成: 2026-09-11 ／ 出典: docs/domain/japan-tax.md, docs/specs/{sales,purchase}.md の override 契約

## 受入基準（EARS）
- AC-1 Seed (idempotent, per company) the **chart of accounts** for a small business / 個人事業 (中小会計要領・青色申告決算書に寄せる), codes fixed as follows: 1000 現金, 1100 普通預金, 1300 売掛金 (partnerRequired), 1400 商品, 1500 仮払消費税, 1900 前払金, 2100 買掛金 (partnerRequired), 2150 未払金, 2200 仮受消費税, 2300 未払消費税, 2400 前受金, 2500 預り金, 3000 元入金, 3100 事業主貸, 3200 事業主借, 4000 売上高 (taxCategoryDefault standard), 4100 雑収入, 5000 仕入高 (standard), 6100 給料手当 (out_of_scope), 6200 地代家賃 (non_taxable), 6300 通信費, 6400 消耗品費, 6500 旅費交通費, 6600 支払手数料, 6700 減価償却費 (out_of_scope), 6800 租税公課 (out_of_scope), 6900 雑費, 6950 水道光熱費, 6960 広告宣伝費, 6970 接待交際費, 6980 外注費 — types asset/liability/equity/revenue/expense accordingly; subtype = the Japanese group name. Existing codes are left untouched (no overwrite).
- AC-2 Seed tax rates if missing (delegates to the tax module's seed) and set default company settings when unset: `tax.rounding = { mode: 'down', unit: 'invoice' }`, `tax.price_includes_tax = false`.
- AC-3 Register `registry.registerOverride('purchase.exempt_supplier_credit_ratio', fn)` returning, for exempt suppliers, the 経過措置 ratio by date from a **data table with validity periods** (`services/transitional-credit.ts`): 0.8 until 2026-09-30, 0.7 2026-10-01〜2028-09-30, 0.5 2028-10-01〜2030-09-30, 0.3 2030-10-01〜2031-09-30, 0 after (国税庁 令和8年度税制改正特集, 確認 2026-09-10); registered suppliers → 1. Unit tests at every boundary date.
- AC-4 Register `registry.registerOverride('sales.invoice_html', fn)` rendering the 適格請求書 in Japanese layout: 「請求書」title, 登録番号 (T+13), 発行日・支払期限 (西暦 and 和暦 in parentheses), 宛名「御中」, 明細表 (品名・数量・単価・金額・税区分; 軽減税率対象に「※」), 「税率ごとの合計」table (税抜金額・消費税額・税込金額 per rate, 8% rows marked 軽減税率対象), 合計, 振込先, 備考. The input is the render data object defined by the sales spec (`InvoiceRenderData` exported from `@daifuku/mod-sales` — since l10n must not import sales, copy the type locally and validate at runtime with zod; the orchestrator will reconcile). Output valid HTML with inline CSS only.
- AC-5 Export utilities: `toWareki(date: 'YYYY-MM-DD') → '令和8年9月11日'` (元号 table 明治/大正/昭和/平成/令和 with start dates; extensible), `formatJpy(decimal) → '¥3,420'`, `toHalfwidthKana` re-export.
- AC-6 The package registers a module `l10n_jp` (`defineModule({ name: 'l10n_jp', depends: ['accounting', 'tax'], entities: [], hooks, seed })`) with no entities of its own.
- AC-7 Tests: seed idempotency (run twice → same count), CoA sample assertions, transitional ratio boundaries, wareki, invoice HTML snapshot (golden file with a fixed render data sample; assert key strings: 登録番号, 軽減税率対象, 税率ごと totals).

## 関係するファイル
l10n/jp/{package.json (name @daifuku/l10n-jp; deps kernel, mod-accounting, mod-tax, zod), tsconfig.json, src/{index.ts, module.ts, seeds/{chart-of-accounts.ts, settings.ts}, services/{transitional-credit.ts, wareki.ts, format.ts, invoice-html.ts}}, test/{l10n-jp.db.test.ts, services.test.ts, golden/invoice.html}}. テスト DB: `daifuku_test_l10n`。

## スコープ外
全銀フォーマット出力、JP PINT、郵便番号 API、公表サイト照合（Phase 2〜3）。
