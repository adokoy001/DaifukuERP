# Daifuku 開発の再開

更新: 2026-09-13。現在地は [STATUS](STATUS.md)、導入・初回起動は [README](../README.md)、変更と検証は [CONTRIBUTING](../CONTRIBUTING.md) を参照する。

## 再開の手順

1. [AI_INDEX](../AI_INDEX.md)、`AGENTS.md` / `CLAUDE.md`、`docs/STATUS.md`、最新の `docs/log/` を読む。
2. clone した Linux/WSL 内の checkout で Git/Node/pnpm を実行する。`git status` とブランチ・差分を確認し、進行中の編集を上書きしない。業務用ディレクトリ・DB とは分離する。
3. 従業員基盤は `docs/architecture/workforce.md` と `docs/specs/workforce-platform.md`、15業界は `docs/specs/industry-catalog.md`。GitHub 公開準備は `docs/specs/public-release.md`、導入・権限・運営・BI は `docs/specs/operations-control.md` と ADR-0018、業界テンプレートは `docs/specs/industry-templates.md` を参照。共通基盤は ADR-0016/0017 と `docs/specs/foundation-*.md`、UI は `docs/specs/ui-refresh.md` に契約を残している。
4. 管理対象への導入・更新は `docs/operations/setup.md` の `pnpm run setup install|upgrade` を使う（`pnpm setup` は pnpm 自身の別コマンド）。既定は読取専用の計画。既存 DB を通常の再開で `db:reset` しない。
5. 品質改善は [quality-foundation](specs/quality-foundation.md) と [計画](quality-roadmap.md) を参照。本人設定・招待/メール再設定・OIDC/TOTP と企業機能は [拡張構造](architecture/enterprise-operations.md)、[統合仕様](specs/enterprise-operations.md)、[導入設定](operations/enterprise-identity.md) を参照する。
6. 変更後は `pnpm gate`、Web 変更時は `pnpm --filter @daifuku/web test`、`pnpm --filter @daifuku/web typecheck` と `build`、該当する画面/E2E も確認する。ブラウザ試験は CONTRIBUTING の専用空 DB 手順に従う。認証は通常の業務 E2E と別に `pnpm test:identity:e2e` を実行し、専用空 DB と合成 OIDC/TLS SMTP を使う。

## データと実行環境

現行0014までの商流・銀行・申告準備は [統合構造](architecture/commerce-finance.md) と [操作](manual/appendix-l-commerce-bank-filing.md) を参照する。AWS試用は [仕様](specs/aws-trial.md)、[運用](operations/aws-trial.md)、[実測記録](log/2026-09-13-aws-trial.md) が入口。稼働先の実ID・資格情報・開始/停止/保全先は私有runbookで照合し、既存ゲームのTerraformから操作しない。公開templateだけではOS・アプリ・timerは導入されない。

適用対象の最新 migration は checkout の `apps/api/drizzle/migrations/meta/_journal.json` と安全セットアップの計画表示で確認する。`0012_enterprise_operations.sql` は企業機能の17表とuserのMFA状態を追加する。既存0011の社員/公開シフト/パスワード/所属を保持する移行と、0008からの更新・別DB復元を検証済み。作業中の生成物とコミット済みの配布対象を区別する。`0011_auto.sql` はシフト条件・週間希望・計画・公開勤務の4表を追加した移行。社員管理・推薦は [設計](architecture/shift-planning.md) と [仕様](specs/employee-shift-planner.md)、[操作](operations/shift-planning.md) を参照する。通常更新ロックの変更理由はADR-0020に記載。前版の `0010_workforce_platform.sql`（13の従業員業務表・領収書1表・業種別案件10表・会社所属のsiteIds）。`0009_operations_control.sql` は所属・営業計画と利用者/日次報告状態の追加。前版の業界追加は `0008_industry_templates.sql`（15 表）。既存伝票を残す追加移行で、適用後に API/MCP を再起動する。0009 適用前の JWT は無効で再ログインが必要。

認証と会社選択はタブ単位。会社所属変更は次の API で反映し、パスワード/有効状態/テナント管理者変更は sessionVersion で失効する。画面操作は [運営ガイド](manual/appendix-e-operations-control.md) にまとめた。

実行時の接続情報、DB、添付、バックアップ、検証ツールはソースに含めない。ローカル環境を再利用するときは接続先と既存プロセスを確認して重複起動を避ける。新規開発用のデモ資格情報は README の合成データに限り使う。

## 公開履歴と配布

公開先は `adokoy001/DaifukuERP`。初回は精査したソースから新しい公開履歴を開始し、私的な開発セッションへのリンクを含む元の Git 履歴はローカルだけに保全する。文書中の過去 commit 番号は公開前のローカル検証時の参照で、GitHub 上のリンクではない。

`scripts/bundle-all.sh` は clean な HEAD の追跡ソースだけを ZIP に出力する。`.git`・未追跡ファイル・実 DB・秘密を同梱しない。古い「履歴込み一式 ZIP」の記述は過去の作業記録として扱う。旧環境の手順は `docs/archive/` に要約して保存し、現在の再開手順には用いない。

## 続く検証課題

多通貨、国別制度パック、在庫評価の遡及再計算、認証以外の業務通知配信、必須 MFA と全第二要素紛失時の復旧、本番 IdP/SMTP/Square 接続、法定連結・行政送信、実製品比較は独立した仕様と受入を用意する。受発注・分納と請求の分離は現在の商流仕様の範囲で実装済み。円・国内向け試験業務で得た不変条件を、15業界と従業員業務の台本を足場に広げる。

店舗機器・共通配備の再開は [仕様](specs/deployment-edge.md)、[ADR-0023](adr/0023-outbound-relay-principal-and-fencing.md)、[共通配備](operations/deployment.md)、[agent](operations/edge-agent.md) を読む。`apps/edge` は人間JWT/DBを使わない。開始済み物理jobは不明時に再送せず、手動確認・根拠記録へ進める。
