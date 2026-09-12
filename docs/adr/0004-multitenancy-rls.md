# ADR-0004: 共有テーブル＋tenant_id＋PostgreSQL RLS。tenant → company の2階層

- 状態: 採択／ 確信度: 中
- 出典: research/02 §2（RLS 実践、Azure tenancy models、Salesforce）

## 決定
- 全業務テーブルに `tenant_id uuid not null`。会社スコープのテーブルには `company_id uuid not null`。インデックスは tenant_id を先頭に。
- 各テーブルで `ENABLE ROW LEVEL SECURITY` と `FORCE ROW LEVEL SECURITY`。ポリシーは `tenant_id = current_setting('app.tenant_id')::uuid`。
- アプリは非オーナーロール `daifuku_app` で接続し、トランザクション冒頭で `set_config('app.tenant_id', …, true)`（SET LOCAL 相当）。`SECURITY DEFINER` 関数は禁止。
- オーナーロール `daifuku_owner` は **BYPASSRLS**。マイグレーション・シード・ログイン時のユーザー検索（テナント横断）にのみ使う。アプリのリクエスト処理では決して使わない（`scripts/db-setup.sql`）。
- FORCE ROW LEVEL SECURITY は残す（app ロールが所有するテーブルが将来できても保護されるように）。
- ポリシーは `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid`（設定が無いセッションでは全行不可視）。
- 当面テナントは1つ（実験）。将来のエンタープライズ向け DB-per-tenant 昇格は `Database` 抽象の差し替えで対応する（未実装）。

## 最強の反論
実験段階でマルチテナントは過剰で、RLS bypass のテールリスクを抱える。Odoo 型 DB-per-tenant の方が単純。→ 後付けが事実上不可能なので Day 1 で入れる。コストは tenant_id 列と SET LOCAL だけに抑える。
