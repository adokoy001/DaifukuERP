# ADR-0010: 金額・数量は Decimal。float 禁止

- 状態: 採択／ 確信度: 高

## 決定
- DB: `numeric(20,6)`（金額）、`numeric(20,6)`（数量）。通貨マスタが表示桁数（JPY=0, USD=2）を持つ。
- TS: `Decimal`（decimal.js のラッパ）値オブジェクト。`f.money()` / `f.quantity()` は Zod で文字列（`"1234.50"`）として受け、Decimal に変換する。API の JSON でも文字列。
- 丸めは `Rounding` 関数群（`roundHalfUp / roundDown / roundUp`）を通し、消費税の丸めは「丸める単位」（納品書/請求書、税率ごと1回）を設定で持つ（research/04 §B1）。
- lint: `parseFloat` 禁止。`number` 型のフィールドは `f.int()` のみ（件数・順序など）。
