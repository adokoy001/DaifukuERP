# Daifuku 開発の再開

更新: 2026-09-12。現在地は [STATUS](STATUS.md)、導入・初回起動は [README](../README.md)、変更と検証は [CONTRIBUTING](../CONTRIBUTING.md) を参照する。

## 再開の手順

1. [AI_INDEX](../AI_INDEX.md)、`AGENTS.md` / `CLAUDE.md`、`docs/STATUS.md`、最新の `docs/log/` を読む。
2. clone した Linux/WSL 内の checkout で Git/Node/pnpm を実行する。`git status` とブランチ・差分を確認し、進行中の編集を上書きしない。業務用ディレクトリ・DB とは分離する。
3. 従業員基盤は `docs/architecture/workforce.md` と `docs/specs/workforce-platform.md`、15業界は `docs/specs/industry-catalog.md`。GitHub 公開準備は `docs/specs/public-release.md`、導入・権限・運営・BI は `docs/specs/operations-control.md` と ADR-0018、業界テンプレートは `docs/specs/industry-templates.md` を参照。共通基盤は ADR-0016/0017 と `docs/specs/foundation-*.md`、UI は `docs/specs/ui-refresh.md` に契約を残している。
4. 管理対象への導入・更新は `docs/operations/setup.md` の `pnpm run setup install|upgrade` を使う（`pnpm setup` は pnpm 自身の別コマンド）。既定は読取専用の計画。既存 DB を通常の再開で `db:reset` しない。
5. 品質改善は [quality-foundation](specs/quality-foundation.md) と [計画](quality-roadmap.md) を参照。本人設定のパスワード変更は実装済みで、メール再設定とは別です。
6. 変更後は `pnpm gate`、Web 変更時は `pnpm --filter @daifuku/web test`、`pnpm --filter @daifuku/web typecheck` と `build`、該当する画面/E2E も確認する。ブラウザ試験は CONTRIBUTING の専用空 DB 手順に従う。

## データと実行環境

最新 migration は `0010_workforce_platform.sql`（13の従業員業務表・領収書1表・業種別案件10表・会社所属のsiteIds）。`0009_operations_control.sql` は所属・営業計画と利用者/日次報告状態の追加。前版の業界追加は `0008_industry_templates.sql`（15 表）。既存伝票を残す追加移行で、適用後に API/MCP を再起動する。0009 適用前の JWT は無効で再ログインが必要。

認証と会社選択はタブ単位。会社所属変更は次の API で反映し、パスワード/有効状態/テナント管理者変更は sessionVersion で失効する。画面操作は [運営ガイド](manual/appendix-e-operations-control.md) にまとめた。

実行時の接続情報、DB、添付、バックアップ、検証ツールはソースに含めない。ローカル環境を再利用するときは接続先と既存プロセスを確認して重複起動を避ける。新規開発用のデモ資格情報は README の合成データに限り使う。

## 公開履歴と配布

公開先は `adokoy001/DaifukuERP`。初回は精査したソースから新しい公開履歴を開始し、私的な開発セッションへのリンクを含む元の Git 履歴はローカルだけに保全する。文書中の過去 commit 番号は公開前のローカル検証時の参照で、GitHub 上のリンクではない。

`scripts/bundle-all.sh` は clean な HEAD の追跡ソースだけを ZIP に出力する。`.git`・未追跡ファイル・実 DB・秘密を同梱しない。古い「履歴込み一式 ZIP」の記述は過去の作業記録として扱う。旧環境の手順は `docs/archive/` に要約して保存し、現在の再開手順には用いない。

## 続く検証課題

多通貨、国別制度パック、受発注・分納と請求の分離、在庫評価の遡及再計算、外部配信 worker、SSO/MFA・メールによるパスワード再設定、実製品比較は次の独立した仕様として扱う。円・国内向け試験業務で得た不変条件を、15業界と従業員業務の台本を足場に広げる。
