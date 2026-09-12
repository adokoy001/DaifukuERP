# ADR-0012: 分析は OLTP から分離（Phase 4）。当面はマテリアライズドビュー

- 状態: 採択（実装は Phase 4）／ 確信度: 中
- 出典: research/02 §8

## 決定
Phase 1〜3 は PostgreSQL のマテビュー＋期間集計テーブルで報告書を出す。Phase 4 で CDC/Parquet → DuckDB とセマンティックレイヤーに移す。読み取りモデルはテナント分離を必ず継承する。
