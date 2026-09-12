# 作業記録: 2026-09-12 安全な導入・更新セットアップ

- 担当: apps_packs_review ／ 対象: [safe-setup](../specs/safe-setup.md)
- 計測: tokens=null, agent_minutes=null, human_minutes=null, rework_lines=null, gate_failures=null（未計測）

## 決めたこと

既定を読取専用の計画とし、対象識別子・保守停止確認を持つ実行だけを受け付ける。利用者が事前作成した owner/app と DB を使用し、既存設定・DB・role を変更する導入補助処理を持たない。更新前には明示した別の空 DB に実復元を行い、backup・復元先を保全する。owner に CREATEDB を要求しない。

owner は専用 DB 所有者・BYPASSRLS・非superuser、app は `daifuku_app`・非管理権限とし、role と password を両方分離する。業界 sample の導入は管理画面の明示操作に分ける。core seed は初回だけ、更新は保存済み設定と credentials を保持する。

## 実装

- `apps/api/src/setup/`: 秘密ファイル・対象/権限・migration履歴・schema検査、plan/execute、snapshot付きdumpと実復元、checkpoint、原子的bootstrapとの連携、ランダム資格情報、env往復同値、秘密を省いたエラー。
- `scripts/setup.sh`: WSL/Linuxの入口。OS install・DB作成・resetは行わない。
- `scripts/setup-test-cluster.mjs`: 明示した未作成ディレクトリと未使用portに限定する受入fixture。強い秘密を生成し、新cluster内だけに試験DB/roleを作成する。既存roleを変更せず、ownerへCREATEDBも付けない。
- [運用ガイド](../operations/setup.md): 事前準備、計画と実行、初回秘密の扱い、更新/再開、DB以外のbackup、復元と切替、試験再現手順。
- `apps/api/test/operations-migration.db.test.ts`: 統合担当から委譲された0008→0009の履歴データ回帰。migration SQL自体は統合担当所有。

## 検証

- [実測] `apps/api/test/setup.test.ts` の9単体テスト: 引数、localhost、弱い/共通秘密、履歴改変、保護ファイル、source.env保全、ログredaction、quote/backslash往復、不完全runtime拒否。
- [実測] `pnpm test:setup` を PostgreSQL 16.15 の新規専用clusterで実行。初回導入、backup→別DB復元・全表件数/履歴一致、admin commit直後の中断、異なるpassword指定での再開と既存hash/runtime維持、完了no-op、実データあり0008→0009、synthetic migration失敗rollback/修正版再開、非空復元先拒否が通過。
- [実測] 独立レビュー後、`migrated`直後中断→誤ったupgrade再開拒否→正規install再開→admin commit直後中断→再開も追加し通過。稼働接続拒否、NULL制約drift拒否も確認。
- [実測] 配布する新cluster fixture scriptも `localhost:55443` で起動・実受入を通過。後続の修正確認は同じく専用の `localhost:55442` の新規試験DB群で実施。既存の業務/デモDBは変更していない。
- [実測] 0009回帰3件: 2tenant×2company×3userの所属、admin判定、defaultCompany、password、会社設定を保全。旧締め12件の金額/docstatus/取消日を保持し、実収・レビュー証跡を捏造しない。appのtenant RLSと他tenant INSERT拒否を確認。不正role JSONは移行全体をrollbackし、明示的な元データ修正後に再実行できる。
- [実測] API typecheck、追加ソース/テスト/fixtureのESLint通過。全体gateは統合担当の記録を参照。
- [レビュー] PostgreSQL16の公式pg_dump/pg_restore/Password File/psql手順と整合。独立レビューはdomain_reviewが担当。

## 発見した問題と修正

- [独立レビュー] 中断installをupgradeで再開するとbootstrapを飛ばしてcompleteになった。stateに実行modeを記録し、未完状態のmode変更を拒否する回帰を追加。
- [独立レビュー] 計画後にenvを再読込すると別対象へ切り替わり得た。1回読込した接続秘密を計画/実行で固定し、実行時のDB識別子とcheckpoint対象も再照合。
- [独立レビュー/単体] dotenvへJSON.stringifyすると引用符やliteral backslashを含む秘密が変わった。Node parseEnvの往復同値を確認して表現を選び、不完全な既存runtimeも拒否。
- [実測/試験fixture修正] Drizzle初期化後のpostgres.sql.jsonにobjectを渡す旧版fixtureが失敗した。歴史データは明示JSON文字列と`::jsonb`へ変更。既存期待値は維持。
- [実測/試験fixture修正] BYPASSRLS ownerの照会はtenant settingだけでは絞られない。履歴比較にはtenant_idを明示し、分離自体はapp roleで検証した。
- [独立レビュー/実測] pnpm組込みsetupと同名だった。`pnpm help setup`だけで衝突を確認し、ガイド/CLI usageを`pnpm run setup`へ統一。実受入のplan子プロセスもこのpackage script導線を使い、state無変更と秘密不出力を照合する。

## 限界・未実施

- backupはPostgreSQLのみ。添付本体・秘密・rolesの別保管と業務単位の復旧確認を運用手順に残した。
- 任意外部ライターの強制停止、OS/service構成、本番切替、遠隔TLS環境の実受入は行っていない。
- schema比較は表/列/型/NULL制約。独自index/trigger/function/policyの完全な意味比較は行っていない。restoreは全表件数/履歴とdump SHA256であり、全レコード内容hashの照合ではない。
- FORCE RLSフラグとapp RLSを実測した。非BYPASSのmigration実行者による更新は今回の専用owner契約とは異なり、実測していない。
- 受入用clusterとdumpは保全した。停止方法は運用ガイドに記載し、自動削除は行わない。
