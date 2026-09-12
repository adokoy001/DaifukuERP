# 金額・数量・日付

- 金額・数量: `Decimal`（@daifuku/kernel）。JSON では文字列 `"1234.50"`。DB は numeric(20,6)。
- 丸め: `Rounding.halfUp / down / up`、桁は通貨マスタ。消費税は「1適格請求書につき税率ごとに1回」（docs/domain/japan-tax.md#rounding）。丸める単位（納品書/請求書）は会社設定。
- 業務日付（伝票日付・会計日付）は `LocalDate`（`YYYY-MM-DD` 文字列、DB `date`）。タイムゾーンを持たない。
- 事象時刻（作成・更新・転記）は `timestamptz`。JSON は ISO 8601 UTC。
- 会計期間の判定は業務日付で行う。表示用の和暦変換は l10n/jp（内部は常に西暦）。
- 税率・控除率・閾値は「値×有効期間」の行として持つ。コード内の定数にしない。
