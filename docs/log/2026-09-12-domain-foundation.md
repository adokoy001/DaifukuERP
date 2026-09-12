# 2026-09-12 業務基盤の整合性修正

仕様: [foundation-domain.md](../specs/foundation-domain.md)。レビュー D01〜D09、F01〜F06 と小売/不動産 A4/A5/A7 を現行機能の範囲で実装。敷金 A3 は別担当の deposit-identity 仕様/試験に記録。

## 変更

会計出所・残高・転記済み分類・発行 snapshot・添付ストレージ情報を serverOwned にし、正規処理には kernel の opaque capability を使用した。汎用操作から出所リンクを消して取消を空振りにする経路、独立逆仕訳と取消逆仕訳の再反転、確定棚卸明細の移動を拒否する。明細は最大500件、会計/在庫の業務読取も超過を明示拒否する。

入出金は最初の請求残高読取から行ロックし、過入金検証・残高更新・有効日付き消込事実・会計転記を一体で行う。売掛/買掛と滞納の時点集計はその履歴を読む。請求時の統制勘定を消込に使用し、発行者/顧客/単位/税等の表示 snapshot を保存する。税集計は転記時分類を使い、欠落した旧分類は現在値で代用しない。

会社内会計年度/期間の重複・年度外期間を拒否し、締めと転記の系列を直列化する。在庫は最新有効日以前への遡及を制限し、小売月締めと同じ会社系列ロック・締め日台帳を使う。月次の重複締めは同じ結果を返す。入居確定は部屋ごとに排他制御し、重複期間と確定後の部屋変更を拒否する。

請求・入出金を JPY とし、小数の最終支払額を拒否する。取引の単位コードを保持し、商品種別/在庫単位の後変更と goods の暗黙換算を拒否する。配送単位丸めは未実装として設定から除く。登録済みの共通分析項目を出所→仕訳→逆仕訳へ引き継ぐ。

## 検証と旧テストの変更理由

レビュー専用 PostgreSQL 16 (`127.0.0.1:55440/daifuku_review_domain`) を使用。製品DBをリセットしない。会計・型・UI等の全体 gate は統合担当の実行結果を参照。

旧テストの金額/貸借/在庫 golden は保持した。システム項目の改変については「黙って無視」から PERMISSION_DENIED に期待を変更した。在庫取消 golden は明示的な訂正日を指定し、過去への移動平均書換えを前提にしない。シナリオ初回 pack.apply は、保存済み設定を維持する新共通契約のもとでテスト自身が選ぶ設定を force:true と明記した。

新規 DB 回帰: payment/foundation（同一残高への並行消込、将来支払/取消の時点残高、元勘定、出所保護、発行 snapshot、501行/JPY）、inventory/foundation（棚卸明細移動、過去日/差異ゼロ棚卸）、retail/foundation（同月並行締め、在庫締め、期首引継）、real-estate/lease-period（並行重複、境界日、別部屋、期間延長/部屋変更）。最終件数・実行結果を完了時に追記する。

## 残る拡張範囲

全業種ERP完成ではない。多通貨・単位換算・履行文書・製造工程・契約改定版管理・負在庫再評価等は上記仕様に明記した将来範囲。元資料がない旧発行 snapshot/分類/消込履歴を復元したとは扱わない。

## 完了時の検証結果

- 最新 focused DB 再実行: 6 files / 35 tests 全通過（sales既存9、retailシナリオ16、payment新規4、inventory新規2、retail新規2、lease新規2）。ログ `../review/domain-db5.log`。
- 直前の共有基盤修正後の既存契約8、在庫10、請求連動在庫7、payment8、purchase8、attachments10も各通過。旧契約に依存した販売/小売の失敗を修正した結果が上記の最新再実行。
- typecheck / modules・l10n・packs ESLint 通過。全unitは直前382 tests通過、新分類/分析項目の追加unitは別ログ `../review/domain-final-unit.log` に記録。
- kernel担当による会計19 tests通過は PostgreSQL18 の補助結果。最終統合 gate の PostgreSQL16実行が全体の判定となる。

最終追補: 有効日順の消込累積が全日で 0..請求総額となることを、同じ請求ロック下で日付 keyset pagination により全グループ検証する。後日取消後の過去日入金が過去時点だけ過消込になる経路を拒否した。payment既存8+新4の12件通過、さらに502有効日・2ページ目だけの過消込を含む最新版payment foundation5件全通過（`../review/domain-history-final.log`、`../review/domain-history-pagination.log`）。最終typecheck/変更箇所ESLint通過。追加unitは分類7+分析項目1の8件全通過。

独立再点検で取消有効日の2点を修正した。小売締めの取消が訂正日を子へ渡さないため翌期訂正できない経路を修正。売上/仕入請求の取消に、支払済額ゼロに加えて日別純消込が残る最後の日以後という検証を追加した。例えば8/1請求、9/2入金、9/5入金取消後に請求を8/1へ遡及取消し、9/2〜4のGLと補助簿が乖離する操作を拒否する。同日入金/同日取消の相殺は維持する。回帰は `modules/payment/test/invoice-cancel-history.db.test.ts` と `packs/retail/test/cancel-period.db.test.ts`。

取消追補の検証: PG16で小売翌期取消1件、既存payment foundation5件、請求取消履歴4件を確認。初回9/10で購買帳票の列名期待のみ誤記（totalではなくbalance）を修正し、該当ファイル4/4再実行通過。`../review/domain-cancel-final.log` / `../review/domain-cancel-retest.log`。型・変更箇所ESLint・diff --check通過。
