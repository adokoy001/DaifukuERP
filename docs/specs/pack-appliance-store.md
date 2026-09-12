# Spec: pack-appliance-store（電器店）

- 状態: approved ／ 作成: 2026-09-12 ／ pack: appliance_store ／ package: @daifuku/pack-appliance-store
- 対象: 地域の家電小売、設置・修理受付。販売・仕入・入出金・在庫・保守契約は既存moduleを再利用。

## 受入基準（EARS）

- AC-1 WHEN 電器店packを適用する THE SYSTEM SHALL 商品のメーカー・型番・標準保証月数をextとして表示し、顧客機器（顧客、商品、製造番号、設置場所、購入日、保証期限、任意の保守契約）を会社内で管理する。顧客機器と契約の顧客不一致を拒否する。
- AC-2 WHEN 設置・修理を受け付ける THE SYSTEM SHALL appliance_store_service documentに顧客、機器、受付日、予定日、種別、症状・依頼、担当者、作業報告、完了日、請求区分、有償の品目明細を記録する。別顧客の機器、日付逆転、非正数数量・負単価を拒否する。
- AC-3 WHEN start_serviceを実行する THE SYSTEM SHALL 親をロックし受付状態から作業中へ進める。WHEN complete_serviceまたは汎用submitを実行する THE SYSTEM SHALL 作業中・作業報告・妥当な完了日を要求し、作業完了として確定する。状態・請求紐付け・計算額の公開書込を拒否し、確定後の通常変更と明細変更を拒否する。
- AC-4 WHEN invoice_serviceを実行する THE SYSTEM SHALL 有償の完了受付から既存sales_invoiceを作成・確定して紐付ける。同じ受付の再実行・同時実行で二重請求しない。保証等の無償受付は請求を拒否する。売上の税・仕訳・在庫処理はcoreの設定と処理を使う。
- AC-5 WHEN 請求済受付を取り消す THE SYSTEM SHALL 紐付く請求を同じtransaction・訂正日で取り消す。入金済等で請求取消が拒否される場合は受付も元に戻す。単独の請求取消は確定受付の依存関係で拒否する。取消後はamendで新しい受付を作る。
- AC-6 WHEN open_servicesを参照する THE SYSTEM SHALL 未完了または有償未請求の受付を、予定日・顧客・機器・担当・状態とともに一覧化する。上限を越える場合は切詰めを明示し、会社・権限の範囲を守る。
- AC-7 WHEN seed/sampleを再適用する THE SYSTEM SHALL 同じコードのマスタ・サンプル受付を重複させず、既存値を上書きしない。サービス品目、家電商品、顧客、仕入先、顧客機器、修理・設置のサンプルを用意する。
- AC-8 WHEN 未適用会社・読取専用利用者が書込操作を実行する THE SYSTEM SHALL 拒否する。version競合、会社/顧客不一致、確定明細、二重請求、請求失敗rollbackをDB回帰で確認する。

## 公開API

ApplianceStorePack、ApplianceDevice、ApplianceService、ApplianceServiceLine、startServiceAction/startService、completeServiceAction/completeService、invoiceServiceAction/invoiceService、openServicesAction/openServices、seedApplianceStore、sampleApplianceStore。操作名は appliance_store.start_service / complete_service / invoice_service / open_services。汎用CRUD・submit/cancel/amendも使用可能。

## スコープ外と制限

- 家電リサイクル券・電子申請・法令台帳・廃棄処理、メーカー保証査定/請求、メーカー連携、巡回経路、シリアル別在庫、貸出代替機、分割請求は対象外。法令対応を保証しない。
- 保証期限と保証月数は記録情報であり、自動的に無料と判断しない。受付者が有償/無償を決める。
- 保証作業の部品消費・返品はcoreの在庫伝票で別途記録する。有償明細の在庫移動は既存inventory自動出庫設定に従う。保存済設定をpackが勝手に変更しない。
- 金額はcoreの日本円契約。税率は既存tax moduleの有効日データを使い、packに法定値を持たない。

## 検証

docs/domain/scenario-appliance-store.mdの架空台本、専用PG16 DB回帰、型/lint/境界、rootによる統合gate/UIを実行・記録する。runtime登録とmigrationはrootが担当する。
