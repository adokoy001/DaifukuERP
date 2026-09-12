# 作業記録: 電器店テンプレート

- 担当: kernel_review ／ spec: pack-appliance-store ／ branch: feat/industry-templates
- 計測: tokens=null、agent_minutes=null、human_minutes=0、rework_lines=null、gate_failures=null

## 決定

- 家電の機種情報はproduct ext、顧客所有機器・設置/修理受付・作業明細はpack固有entityで管理する。販売・仕入・入金・在庫・保守契約を複製せずcoreを使用する。
- 作業完了と請求を分離し、未完了一覧に有償の請求待ちも表示する。保証期限は記録情報とし、無償判断を自動化しない。
- 公開CRUDから状態、請求ID、明細計算額を書き込ませない。module-private capabilityと親lockを用い、請求の再試行/同時実行を同じ請求書へ収束させる。
- 受付取消がcore請求取消を同じtransaction・訂正日で行う。入金済で取消できないときは受付もrollbackする。
- 受付参照番号は任意メモ識別子で、訂正版へ引き継ぐ。正式番号は確定時のAPS採番とamend枝番。サンプルの重複防止はpack適用lockと固定参照番号による既存検査を使う。

## 実装

- appliance_store pack、device/service/service_line、商品ext3項目、操作4件、メニュー、冪等seed/sample。
- 仕様を先に作成し、台本に実操作と期待値、在庫設定、訂正・無償対応・対象外を記載した。
- pack srcは12ファイル361行。core(kernel/modules)変更0行。appsの登録・汎用操作画面・migrationはroot担当。

## 検証

- [実測] PostgreSQL16.15、専用daifuku_review_appliancesでDB 2ファイル8試験通過（51.14秒）。ログは別reviewフォルダ appliance-store-final-db.log。
- [実測] 通常導入はcore全module seed後にforceなしsample:true。修理8,800円、設置16,500円、無償対応、請求待ち一覧、再適用による商品/機器/受付version保持を確認。
- [実測] 別顧客機器・契約・会社参照、未適用会社/閲覧権限、serverOwned書込、数量ゼロ、version競合、確定明細、作業順序・日付を拒否。
- [実測] 同時請求2要求で請求/仕訳各1件。転記失敗で請求作成rollback、修正後再試行成功。入金済取消拒否で受付保持、入金取消後の請求取消、amend状態初期化を確認。
- [実測] 在庫自動処理を明示設定する追加台本で仕入2台→設置付販売1台（請求115,500円）→在庫1台/60,000円→訂正取消で2台へ復元を確認。
- [実測] package TypeScript、変更ESLint、diff-checkが通過。依存境界は570 modules / 2851 dependenciesで違反なし。rootが統合gateとWeb画面操作を別途検証する。

## 失敗と修正

- 初回はDecimalのメソッド名を誤り、seed/sample明細作成が失敗した。共通Decimal.timesに修正し、入力値の取出しを既存tryDecimalに統一した。既存試験の期待値変更・skipはない。
- サンプル参照番号の一意制約は汎用amendのコピーと衝突するため、正式採番との役割を分離しschema確定前に外した。amendを実行して動作確認した。

## 未実施・対象外

- rootの統合gate/UI検証は本記録のDB通過とは別。法令台帳、リサイクル券/電子申請、メーカー保証連携、製造番号別在庫、代替機貸出は未対応。

## 独立レビュー追補: 数量省略時の金額（domain_review）

- 公開受付createの明細で数量を省略し単価15,000円を指定すると、DSLの数量既定値1が計算hookより後に適用され、数量1・単価15,000円・金額0円で保存される問題を専用PG16で実測した。続く作業完了は正の明細合計がないとして拒否された。再現ログは repository 外 `../review/appliance-review-probe.log`。
- `src/hooks.ts` の金額計算で、新規作成時に数量が未指定なら既定値1を使うよう修正した。更新時は結合済みpreviousの数量を使い、既存数量を1に戻さない。schema変更なし。
- `test/foundation.db.test.ts` に、公開親create（数量省略）→開始→完了→税込16,500円請求と、公開明細create→数量2.5→単価のみ変更→説明のみ変更で数量2.5/金額3,000円を維持する2回帰を追加。既存テストの期待値・実行条件は変更していない。
- [再検証] PostgreSQL16、専用 `daifuku_review_farm` で `pnpm exec vitest run --project db packs/appliance-store` の2ファイル10件が成功（95.63秒）。ログ `../review/appliance-store-default-quantity-db.log`。同pack typecheck・eslint と `git diff --check` も成功。
