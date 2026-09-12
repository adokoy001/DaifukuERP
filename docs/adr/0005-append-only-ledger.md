# ADR-0005: 複式台帳は append-only の独立モジュール（Phase 1 で実装）

- 状態: 採択（設計のみ。実装は modules/accounting）／ 確信度: 高
- 出典: research/02 §4（Modern Treasury、Square Books、TigerBeetle、Formance、RDB 実装）

## 決定
- `journal_entry`（ヘッダ: 会社、仕訳帳、`effective_date`、`posted_at`、番号、docstatus、`reversal_of`）と `journal_line`（勘定、通貨、`debit numeric`, `credit numeric`（XOR）、機能通貨換算額、ディメンション列: 部門/プロジェクト/取引先/税区分…）。
- 転記後の行は UPDATE/DELETE 禁止（トリガーで拒否）。訂正は逆仕訳＋新仕訳。
- 貸借一致は**通貨ごと**に deferrable constraint trigger で検証。締め済み期間への転記は拒否。
- 採番は転記時に no-gap（`SELECT … FOR UPDATE`）。
- 分析軸は勘定コードのセグメントではなくディメンション列。
- 残高は期間別集計テーブルにキャッシュ（再構築可能）。

## 最強の反論
TigerBeetle / Formance のような専用台帳を組み込む方が「台帳で犯しがちな失敗」を最初から回避できる。→ ERP 固有要件（期間・ディメンション・多通貨再評価）を満たすため自作するが、インターフェースは差し替え可能に保つ。
