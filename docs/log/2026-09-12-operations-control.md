# 2026-09-12 安全な導入・運営管理・権限・BIの統合

## 指示・場所・基準

利用者から、安全な導入セットアップ、チェーン店運営側の管理、権限管理、BI分析/レポーティングを磨き上げる依頼。起点 `cfa1826`、branch `feat/operations-control`。独立した趣味用WSLリポジトリ `<checkout>`。外部公開・push・実環境導入は行わない。

統合仕様は [operations-control](../specs/operations-control.md)。担当仕様と実測は [setup](2026-09-12-safe-setup.md)、[権限](2026-09-12-access-management.md)、[運営/BI](2026-09-12-restaurant-operations.md)。実装は同一repoのファイル所有を分け、セットアップは別担当が独立レビューした。

## 結果

- 導入: WSL/Linuxの新規専用DB・既知スキーマの更新。読取専用計画、明示target確認、owner/app/秘密の検査、別空DBへの実復元、資格情報を上書きしない再開。`pnpm`自身の組込みsetupとの衝突を確認し、導線を `pnpm run setup` に統一した。
- 権限: tenantAdminとcompany membershipを分離。店舗限定のfail-closed宣言をDSL/Repository/Action/Metaで適用。REST/MCPは現在の有効状態・membershipを毎回読む。password/active/tenantAdmin変更はsessionVersionで401、membership変更は現在の権限で403となる。現在会社が失効した画面でも残り会社を選んで復帰できる。
- 管理UI: 利用者作成、状態/資格情報変更、会社ロールと担当店舗、監査before/after。未保存入力を保持する固定baselineVersion、実409後の明示reload、ページ/利用者/会社切替の破棄確認。テナント管理者だけに公開する。
- 運営: 営業予定・目標、ゼロ売上/休業報告、店舗提出→店長承認/差戻し→本部確定。直接の親子編集も提出後は拒否。本部確定の財務・在庫処理を一つの取引で実行する。
- BI/UI: KPI、日別推移、店舗比較、50件単位の日次一覧、根拠伝票、HQ向け消込/残高、全分野レポート検索。金額/比率はサーバーのDecimal、グラフの座標だけにBigIntから有界数値を使う。未点検/nullは「—」。条件変更/再取得失敗で古い結果を新結果として扱わず、CSVはfresh再認可・再集計する。
- 共通レポートの既存custom actionsへ出力元宣言を付与し、移行によって既存CSVが一律使えなくなることを防いだ。任意の未宣言actionはexportとして実行しない。
- 新しい管理/BI画面は遅延読込し、初期JSの単一大容量chunk警告を解消。PC/390pxの画面を確認した。

## 発見して直した点

セットアップの独立レビューで、未完installをupgradeとして完了扱いする経路、計画後env差替えによる別DB実行、dotenv秘密の引用符/部分設定を検出して修正・回帰追加した。実CLIの標準出力/標準エラーに秘密が出ず、計画でstate-dirも作らないことを試した。

BIでは請求読取と取消履歴集計の並行競合を検出し、ID順のread lock内で現行伝票と有効履歴を読む。最後の画面/業務契約の独立照合で、同条件での再集計が売上queryだけを更新していた経路を検出し、入金残高queryも同時に再取得、取得中は旧残高表を表示しないよう修正した。売上が期間内の計上/取消増減であることと、営業計画の登録が本部権限であることも手順書に明記した。管理UIの実ブラウザー試験で、兄弟要素の重複React keyによる旧利用者フォーム残存、ネストform、selectラベル参照を修正した。確認待ち状態の日本語表示と会社失効時の選択不能も修正・実操作した。初回fullgateで他tenant会社IDへの400応答が復帰fallbackに吸収される既存回帰1件を検出したため、復帰対象を同tenant内の会社に限定し、他tenant/存在しない会社は従来どおり拒否する。

0009のFK参照先UNIQUE制約が後に生成される順序を修正し、生成時の制約順序補正も追加。旧ロールはtenantごとの明示所属へ移す。旧fixtureは新bootstrapを旧schemaへ使わず、歴史的な列でidentityを作る。既存テストの期待を緩めず、0008からの回帰で過去事実を保持する。

## 検証と証跡

`pnpm gate` はexit 0。型/lint/依存境界（643モジュール・3,241依存）、単体409件/47ファイル、DB371件/58ファイルがすべて通過した。単体84.69秒、DB674.65秒。Web型/lint/buildも通過。ブラウザーは全体16件に、最終認可APIでの会社復帰1件と入金/取消後の再集計1件を追加し、計18シナリオを確認した。同じシナリオの再実行は重複して数えない。安全な導入・実復元・失敗再開の実CLI受入も通過。専用PG16.15:55440でunit/DB、API:3100・Web:5173の既存デモでブラウザー試験。DB用 `daifuku_test`、UI用 `daifuku_ui_refresh` は分離した。セットアップ実受入は別の新規cluster:55442/:55443で強い別role/秘密、CREATEDBなしのowner/appを使用し、完了後そのclusterだけを停止、DB/dump/state/envは保全した。

- `../review/operations-gate-final.log`: 修正後の全体型/lint/単体/DB。初回の会社一覧応答回帰は `operations-gate.log` に残す。
- `../review/operations-full-e2e.log`: 既存と追加の実画面台本16件。
- `../review/access-recovery-final-e2e.log`: 最新認可APIで、失効した会社から残り所属会社への復帰1件。
- `../review/operations-refresh-e2e.log`: 表示したまま別APIで400円入金/取消を実行し、同じ条件で残高1,100→700→1,100円を再集計・表示する1件。すべて自作の店舗・伝票を使用。ブラウザー起動に必要な配置/共有ライブラリを指定して再実行した。
- `../review/operations-final-e2e.log`: UI最終調整後のBI/店舗承認フロー2件の再実行。
- `../review/setup-acceptance-dispatch-final.log`: `pnpm run setup` 実導線を含む導入・実復元・旧版更新・失敗再開。
- `../review/operations-migration.log`: 2tenant×2company×3userと12旧締め、role/admin/defaultCompany/password/金額/取消日保持、app RLS、旧不正JSONによる0009全rollback→明示修正。
- `../review/operations-final-build.log`: 再集計修正後のWeb型/lint/build。新しい3画面の遅延読込で初期chunkは441 KB。
- `../review/operations-manual-build.log`: 16章・39画像の統合HTMLを再生成。
- `../review/backups/ui-before-operations-control.dump`: 0009適用前のUIデモDB custom dump（0600、一覧検査済み）。

UI DBは既存伝票を残して0009を適用し、APIを最新ソースで再起動した。テストの新利用者・新店舗は練習用データとして残す。業務用DB・PC共通のPGサービス・元の開発DB・既存利用者パスワードは変更していない。今回の共通権限追加はH3の「パック追加だけで共通ソース無改変」という測定とは別の基盤改修として扱う。

## 受入基準の対応と残る範囲

AC-1/2はsetup専用受入、AC-3/4は管理API/Kernel/MCP/ブラウザー、AC-5/6はチェーンDB/ブラウザー、AC-7はCSV export境界/条件変更/失効/同条件の外部入金・取消後再集計ブラウザー、AC-8は歴史schema DB回帰と実UI更新で確認する。

1法人内の店舗・国内JPYが今回の対象。SSO/MFA、招待メール/本人パスワード再設定、POS連携、連結/FC精算、会計上の未実装原価配賦、任意SQL/外部BI、定期配信、公開/常駐化、実運用負荷試験は含まない。CLIのbackupはDB単位であり、添付実体/秘密/roleの保全は手順で分ける。遠隔TLS接続の実受入は未実施。自動試験の通過を制度適合・実運用認定・人間の業務審査の代わりにしない。
