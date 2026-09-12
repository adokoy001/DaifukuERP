# 作業記録: 2026-09-12 会社所属・店舗担当と利用者管理

- セッション: 運営管理基盤 ／ 担当: kernel_review ／ 対象: docs/specs/access-management.md
- 計測: tokens=null, agent_minutes=null, human_minutes=null, rework_lines=null, gate_failures=null

## 決めたこと（と理由）

- テナント管理者と会社のadminロールを分離し、通常利用者の会社アクセスは明示的な所属だけで決める。旧users.rolesへの実行時fallbackは置かず、既存DBは移行で所属を作る。
- 店舗限定アクセスはDSLのstoreAccess宣言とContextの店舗集合で制限する。未宣言entity/actionは拒否し、共通会計・在庫の最終確定は本部だけが行う。
- 認証・所属管理は業務CRUDと別の管理面としてkernel portに閉じ込める。理由と境界をADR-0018に記録した。
- CSVは明示された全参照台帳のexport権限を要求し、元の入力でレポートを再実行する。既に受信済みの情報の手動コピー防止は主張しない。
- 利用者・所属の管理更新はテナント単位のロックとversionで競合を検出する。最後の有効な管理者と自己権限の変更を保護する。

## やったこと

- usersのtenantAdmin/version/sessionVersion、会社所属・ロール・店舗担当を追加した。初回bootstrapは管理者と最初の会社所属を同一トランザクションで作る。
- Repositoryの読取・count・aggregate・参照検索・書込・監査へ店舗条件を適用した。親明細、空店舗集合、共有マスタの読取専用、未宣言操作を共通基盤で制御する。
- API/MCPで呼出しごとに有効状態と会社所属を再検証し、ツール一覧・リソース一覧・メタデータも範囲に合わせた。無効化後の再有効化で古いセッションを復活させない。
- 管理API、利用者別監査、レポートexport APIとcanExportメタデータを追加した。既存の会計・販売・購買・在庫・契約・業界レポートにexportEntitiesを宣言した。
- 利用者管理画面で入力とbaseline versionを再取得から独立させた。競合時は比較対象を再取得し、入力を保持して明示再読込を案内する。利用者・所属先会社・離脱時の破棄確認、処理中の切替防止、店舗ロールの日本語表示、変更前後の監査表示を追加した。

## 検証

- [実測] 全unit 402件 / 46ファイル通過（約78秒）。証跡: `../review/access-unit.log`。後続の画面変更を含む最終統合gateは別途実施する。
- [実測] kernel全DB + MCP全DB + 新管理API試験の86件 / 14ファイル通過（PostgreSQL 16、約86秒）。証跡: `../review/access-final-db.log`。
- [実測] 新規試験では所属外会社・別テナント・他店舗・親明細・集計・監査・CSV・空集合・未宣言操作、ロール/所属変更の次呼出し反映、再有効化、パスワード変更、同時の管理者降格を確認した。
- [実測] kernel/API/MCP型検査、担当範囲ESLint、依存境界（637モジュール、3220依存）、git diff --check通過。Web型検査と担当6ファイルESLintも通過。
- [実測] Chromiumの管理画面E2E 1シナリオ通過（約35秒）。新規利用者作成、会社/店舗/スタッフ所属保存、実APIの409競合、タブ復帰時のcatalog再取得、入力保持、明示再読込の取消/承認、利用者・ページ・所属先会社への切替取消、保存ダイアログ取消、保存後の名前/ロール監査before/afterを確認した。証跡: `../review/access-e2e.log`、`../review/access-management-ui.png`。既存adminのパスワード・権限は変更していない。
- [実測] 会社アクセス復帰E2E 1シナリオ通過（約27秒）。明示選択した店舗会社の所属を削除した後、403案内から残るDemo会社を選び、テンプレート・ホームの表示へ復帰した。証跡: `../review/access-recovery-e2e.log`。
- [実測] 統合gateで検出した会社選択fallbackの追加修正後、companies/access-admin DB試験12件通過（約23秒）。証跡: `../review/company-recovery-db.log`。既存の別テナント会社を400で拒否する期待は維持し、不正形式・空文字・存在しないUUIDの拒否を追加した。
- [レビュー] 管理監査のパスワード非記録、対象会社への監査帰属、未保存入力の安定したkeyとbaseline version、自己変更guardを確認した。

## 見つけた問題と修正

- metadata用Contextをspreadすると遅延storage getterが評価され、無関係なstorage初期化が起きた。DB試験で発見し、prototype/descriptorを保つ導出Contextに変更した。
- 既存users.rolesを直接変更する認証fixtureは新しい明示所属の操作へ修正した。拒否する期待は維持し、旧ロールだけではアクセスできない追加試験を置いた。
- 既存の親明細付替えは共通集約不変条件によりVALIDATIONとなるため、新しい店舗試験の期待コードをその既存契約に合わせた。拒否自体は維持した。
- Webのversion付きkeyは再取得で未保存入力を消していた。利用者/会社identityだけをkeyにし、競合と明示再読込を別に扱った。検索結果の変化でも編集中の利用者を切り替えない。
- E2Eで兄弟コンポーネントのkey重複による旧プロフィール残存を検出し、profile/membershipの接頭辞を分離した。会社/scope選択は明示aria-labelを付け、optionの文言に左右されず参照できるようにした。
- E2Eのブラウザログで確認ダイアログのform入れ子を検出し、外側formの兄弟へ移動した。全体既定ではfocus時の再取得が無効だったため、管理catalogはタブ復帰時に必ず取得する契約を明示した。
- 会社所属が失効した後も会社選択一覧へ到達できるよう、一覧だけは有効な既定会社へ復帰する。業務APIの失効対象会社指定は引き続き拒否する。
- 統合gateで、会社一覧のfallbackが別テナント会社へのPermissionDeniedまで拾う問題を検出した。同一テナント内の会社であることを属性非公開のidentity portで確認し、その範囲だけ復帰するよう限定した。会社一覧の不正/存在しない/別テナントIDは400、業務APIの所属外会社は従来の403を維持する。

## 未実施

- 旧DB移行・全体gateは統合担当が確認する。上記の担当試験だけで全体完了とはしない。

## 次のセッションへ

- 新規membershipを直接fixtureに作る場合も、tenant/companyの一致とscope/storeIdsの契約を守る。新しい店舗対応entity/actionやレポートは明示宣言を追加する。
