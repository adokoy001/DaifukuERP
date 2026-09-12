# 作業記録: 2026-09-12 共通kernelの不変条件

- 担当: kernel_review ／ 対象: docs/specs/foundation-kernel.md、ADR-0016
- 計測: tokens=null、agent_minutes=null、human_minutes=0、rework_lines=null、gate_failures=null

## 決めたこと（と理由）

- 公開CRUDと業務内部書込みの所有権、同じ親をロックする集約変更、会社ごとのpack適用を共通化した。別業界が共通kernelを使っても入口の違いで不変条件を迂回できないことを優先した。
- 保存済み設定の値だけから管理者の意図を推測しない。初期化冪等性の識別子にはtenantIdを使用する。

## やったこと

- tenant/company複合FK、会社所属、参照scope、明細所有・500件上限、versionロック、確定遷移、監査・検索・集計マスク、精度・tenant出力、outbox原子性を修正。
- serverOwned・内部capability・repo.lock・withLock・withSavepoint・取消correctionDateを業務/UI担当へ共有し、実装を接続。
- pack登録のsourceをhook/guard/subscriberへ引き継ぎ、会社適用scopeで実行するよう変更。未適用専用entity/actionの実行も拒否。

## 検証

- [実測] PG18.6、専用daifuku_review_kernelでkernel unit/db 102件通過（2026-09-12、最終97.79秒、循環依存修正・capability操作制限・ext参照/所有・専用入口の適用確認を含む）。
- [実測] lint:boundaries は498 modules / 2473 dependenciesで違反ゼロ。初回全体gateで見つかった6循環を、入力所有検査とtoken、outbox書込と配信、親整合性とRepositoryの分離で解消した。
- [実測] ドメイン担当から依頼された会計2試験の旧契約を更新。accounting.db 14件、tax-period-summary.db 5件通過。公開stamp拒否、source所有逆仕訳、会計年度日付固定、同時刻の監査内容検証を維持した。
- [実測] 統合追補: 未適用packのmodule全体をmetaから除外し、route-only/core-entityメニューが残る事例をunit fixtureで追加検証（12件通過）。敷金用capabilityのoperations未指定にupdateを明記し、不動産scenario/deposit-identity 17件通過。kernel/real-estate型検査と変更ファイルESLintも通過。Contextのgrants引継ぎ消失ではなく、capability定義の操作不足だった。
- [実測] kernel TypeScriptとESLintを実行。会社を跨ぐRepository/SQL参照、capability偽造、明細version/freeze/501、delete-submit競合、マスク情報の推定、outbox失敗rollback・同時claim、会社別packを追加試験。
- [レビュー] PostgreSQLのFK生成順を確認し、参照scopeのuniqueIndexをCREATE TABLE内のunique制約へ変更。FKがunique index作成前に実行される初回移行を修正。
- [実測] submit hook内の子stampによる自己競合と、コンテキスト複製時のstorage getter評価を回帰試験で修正。

## 未実施

- rootによるPG16.15での全体gate・移行・UI統合確認は別担当の記録を参照。
- 外部副作用exactly-once、会社別ユーザー役割、既存不正データ自動修復は今回の範囲外。

## 判断待ち

- なし。ユーザーの基盤強化・レビュー不具合修正指示の範囲内で実装。
