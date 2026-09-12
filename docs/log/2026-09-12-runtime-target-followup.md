# 作業記録: runtime設定とデモ適用先の追補

- 担当: kernel_review ／ 対象: foundation-refresh AC-2、ADR-0017、明示的tenant識別
- 計測: tokens=null、agent_minutes=null、human_minutes=0、rework_lines=null、gate_failures=null

## 決定と変更

- 最終独立レビューで、pack名の`in`検査がObjectの継承プロパティを許すことを実行確認。選択・ロード両方をown-key検査に変え、constructor/toString/__proto__を拒否する。
- 同じメールの別tenantを許す認証契約に合わせ、デモのtenant名・会社コード・利用者メールを組み合わせる共通resolverをseed/pack CLIで使用する。完全一致が複数なら処理を拒否し、利用者のdefaultCompanyId変更にも適用先を追従させない。
- --companyの値不足・不正値・重複指定を拒否する。明示された会社が存在しない場合もデモ会社へフォールバックしない。
- runtime単独型検査にNode型とtestディレクトリを含めた。

## 検証

- [実測] 専用PG18.6 DBでruntime catalog、CLI引数、demo identity、既存migration/resetの4ファイル11試験通過（56.21秒）。同メール別tenant、複数完全一致、default会社変更、seed冪等性、明示対象を検証した。
- [実測] runtime/API型検査、変更ファイルESLint、diffチェック通過。依存検査は505 modules / 2495 dependenciesで違反なし。
- [分担] rootが追補後の全体静的検査・unitと、PG16全体/追加業務DB試験を実行する。

## 判断待ち

- なし。追加レビューを拡張せず、検出した2件を修正して完了。
