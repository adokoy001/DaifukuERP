# Spec: 安全な導入・更新セットアップ

- 状態: 実装済み・専用受入確認済み（全体gateは統合記録を参照）
- 対象: `apps/api/src/setup/**`, `scripts/setup.sh`, `docs/operations/setup.md`
- 作成: 2026-09-12

## 目的

WSL/Linux上の、利用者が事前作成した専用PostgreSQLへ、安全に大福を初期導入・更新する。既定は読取専用の計画表示。既存の接続設定・業務データ・認証情報を上書きせず、移行前バックアップを別の明示された空DBへ実復元して検証する。

## 受入基準

- AC-1 WHEN install/upgradeを実行する THEN 既定はplanとし、対象識別子・状態・移行一覧・バックアップ先・復元検証先・実行要件を秘密なしで表示する。明示execute、識別子一致、保守停止確認が揃うまでDB・設定を変更しない。
- AC-2 WHEN 接続を確認する THEN 同一対象のowner/app別ロール、DB所有者、ownerのRLS bypass、appの非superuser/非bypass/非所有者/非管理権限継承、PG16以上・非待機系・非読取専用、他の稼働接続を検証する。非localhostは明示許可とverify-fullが必要。計画から実行まで接続秘密を固定し、実行接続の対象識別子を再照合する。
- AC-3 WHEN 移行を計画する THEN 全インストール済catalogとsnapshotの一致、journal順序とhash、適用済履歴の完全なprefix、対象DBの表・列・型・NULL制約を検証し、改変・未来版・未知DBを拒否する。
- AC-4 WHEN 変更を実行する THEN 毎回先にpg_dumpを保護ファイルへ取り、明示RESTORE_CHECK_URLの空DBへpg_restoreし、同じsnapshotの全表件数・移行履歴を照合する。backup/復元検証の失敗時は導入先の移行を開始しない。復元DBは保全し、自動CREATE/DROP DATABASEやrole作成・管理権限付与はしない。migration runnerによるappの表grant/RLS再設定は行う。
- AC-5 WHEN 初回導入する THEN tenant/company/adminを明示指定し、秘密は非表示TTY・0600ファイルまたは生成ファイルで扱う。JWT未指定時は暗号学的生成を行い、runtime.envを新規作成する。productionでは既知demo秘密・弱いpasswordを拒否する。
- AC-6 WHEN 再実行/途中失敗から再開する THEN 対象と導入identity・未完操作のinstall/upgradeを照合し、checkpointで未完部分だけ進める。既存adminのpassword、保存済runtime.env、会社設定・業務データを変更せず、完了済み再実行はno-opになる。envのquoteを含む秘密はNode parseEnvで往復同値を検証し、不完全な既存runtime.envは上書きせず拒否する。
- AC-7 WHEN エラーになる THEN 秘密・接続URL・子プロセスの生ログを出さず、段階と安全なエラーコードを表示する。失敗したDBトランザクションはrollbackされるが、backup/stateを残し、自動reset・backupからの自動巻戻しはしない。
- AC-8 WHEN 導入する THEN HOSTは127.0.0.1を生成既定とし、業界pack/demo/sampleを自動適用しない。初回adminのmembershipはkernel bootstrapで原子的に作成する。

## インターフェース

`pnpm run setup install|upgrade --env /abs/private.env --state-dir /abs/operations`。pnpm組込みsetupとの衝突を避けるためrunを省略しない。install時はtenant-name/company-code/company-name/admin-email/admin-nameを追加。明示実行は `--execute --confirm-target <plan識別子> --maintenance-confirmed`。初回passwordは `--admin-password-file /abs/private` または `--generate-admin-password`、省略時は非表示TTY。envはDATABASE_URL_OWNER、DATABASE_URL、RESTORE_CHECK_URLと、更新時は既存JWT_SECRETを含む。URL/passwordを引数で渡さない。

## 範囲外

OS/package/PostgreSQL本体のインストール、既存role/password/DB設定の変更、DB新規作成・削除、業務DBのreset、自動本番切替・プロセス再起動、マルチホストの書込元を強制停止する機構、添付ファイルのDB内バックアップ。添付・runtime.env・rolesの保管と復元手順は運用ガイドに明記する。独自index/trigger/function/policyの完全な意味比較、全row内容hash、遠隔TLS環境の実受入は対象外。明示実行の試験fixture scriptだけが未作成ディレクトリへ新cluster/role/試験DBを作成し、業務setupとは分離する。

## 検証

専用新規DBと毎回新規の明示復元DBのみで、plan無変更、初回導入、同じidentity再実行、追加migration更新、失敗注入と再開、既存password/設定保全、復元件数照合、対象/roles/履歴/非空復元先拒否を確認。CLIのstdout/stderrに秘密が含まれない回帰を置く。全体gateは統合担当。
