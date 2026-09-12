# 給与・年末調整・勤務制度の実装地図

[仕様](../specs/enterprise-payroll.md) / [一次資料](../domain/japan-payroll-automation.md) / [運用](../operations/payroll-automation.md)。この文書はAIと人が変更範囲・不変条件・試験を辿る入口とする。

## 構成

| 層 | ファイル | 責務 |
| --- | --- | --- |
| JSON契約 | `modules/workforce/src/fiscal-contract.ts`, `work-system-contract.ts`, `shift-contract.ts` | Zod strict入力、DTO、本人/本部の表示範囲 |
| 宣言スキーマ | `entities/fiscal.ts`, `entities/work-system.ts` | 6 entity、会社/RLS/本人行制約、serverOwned、年調docstatus |
| 制度版 | `services/fiscal-data.ts` | 2026適用期間・月次税表・年調表・控除・47支部料率・等級・URL |
| 純粋算定 | `services/monthly-tax.ts`, `social-insurance.ts`, `annual-tax.ts`, `annual-deductions.ts` | Decimalの算定、年齢/支払月/保険月/締切日、端数 |
| 給与資料 | `payroll-source.ts`, `fiscal-source.ts`, `fiscal-evidence.ts`, `year-end-source.ts` | 許可済repo経由の資料取得、一意条件、snapshot、確定給与証跡 |
| 操作 | `actions/fiscal-payroll.ts`, `year-end.ts`, `fiscal-portals.ts`, `work-system.ts` | 専用操作、版/状態/自己承認禁止、確定・取消・精算 |
| 勤務制度 | `services/work-system.ts`, `work-system-pay.ts`, `pay-calculation.ts`, `pay-types.ts` | 全日事前所定、変形/フレックス清算、既存給与への時間分類。共通入力型は `pay-types.ts` に置いて計算間の循環参照を避ける |
| シフト | `shift-work-system.ts`, `shift-source.ts`, `scheduling/*` | 個人日別上限、固定所定/自由選択、他週を差し引く月/期間残枠 |

## 保全と権限

通常のWeb/REST/MCPは同じ action を使う。`internalWrite` はprivateなserverOwned書込み権限だけを与え、role・会社・店舗・本人行制約を回避しない。制度資料と支払税証跡は追記専用。年末調整申告の全員分を店舗管理者へ開示しない。社員の有給理由や税申告はブラウザ推薦問題に含めない。

給与・制度をまたぐ更新は `workforce:policies` → `workforce:employee:<id>` の順で直列化する。シフト公開は途中に拠点/週ロックを取り、対象社員をソートしてロックする。保存/確定前に関連id/versionの完全なJSONを再比較する。企業や社員の許可範囲を広げるSQLは使わない。

自動月次は `calculation.statutory` へ入力・制度版・本人条件3種類（支払日/保険月末/締切日）と全計算を保存する。従来の外部確認給与にはこの印を付けない。既存 `confirm_payroll` で自動結果の再読取・改変検知後に給与と税証跡を同じトランザクションで確定する。

年調は本人申告 submitted → 給与本部 accepted/returned、計算書は draft → confirmed → cancelled。confirmed のみ本人へ公開する。実精算後の取消は拒否する。過去の給与を年調金額で上書きしない。旧勤務制度や年調書類の保存siteIdは履歴値、参照スコープは現在の社員を親にして本人の異動後参照を保つ。

## 変更時の検証

税表を変えるときは新コードと適用期間を追加し、過去のFISCAL_DATA行を更新しない。一次資料に新たな税表がない年は推定で計算しない。新しい給与支払パターンや勤務制度はスコープを先に仕様化し、境界と精算例、権限・競合・snapshot回帰を追加する。

`modules/workforce/test/fiscal-*`, `work-system-*`, `shift-work-system.test.ts` が新機能の入口。既存 `payroll.db.test.ts` と全workforce DBも実行し、従来の通常勤務・勤怠訂正・有給台帳の不変条件を保つ。共通API/MCP・Web・移行は統合の検証に含める。
