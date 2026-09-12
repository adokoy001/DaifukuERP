# チェーン本部の運営管理とBI

対象は同一会社の店舗厨房。既存の日次締め・会計・在庫台帳を再利用し、予算会計や会計損益の複製は行わない。時刻はUTCで記録し、営業日・「今日」はAsia/Tokyo（現基盤には会社別timezoneなし）。

## 受入条件（EARS）

- AC-1 WHEN 本部が営業計画を設定する THEN 店舗×日付の確定計画に営業予定と税込売上目標を保持する。plan_daysは期間・営業曜日・日次目標から作成する。同条件の再実行は重複させず、異なる既存計画を上書きしない。過去日や一度でも締めが確定した日の計画確定/取消を拒否し、事後目標変更を防ぐ。目標は円整数・非負、休業予定日は0。確定計画はcancel+amendのみ。
- AC-2 WHEN 店舗担当が締めを提出する THEN 自店の下書き/差戻しだけを受け付け、売上・決済内訳・レシピ・ゼロ日の理由を検証する。提出中・承認済みの親/明細の直接更新・削除・saveLinesを拒否し、提出後に内容を変えられない。
- AC-3 WHEN 店長がreviewする THEN 提出中を承認でき、提出中/承認済みを差戻しでき、差戻し理由は必須。提出/審査の担当者・日時・理由をserverOwnedで保存し、繰返しの経緯は通常監査に残す。本部all scopeだけがfinalizeで承認済みを確定し、会計/在庫へ転記する。本部の既存直接確定はdocstatusが下書きなら維持（提出/確認の強制はしない）。店舗限定Contextは金融・在庫の転記権限を持たない。
- AC-4 WHEN 売上ゼロ日/休業日を記録する THEN dayStatusをno_sales/closedとし理由を必須にする。売上明細・決済内訳は0、no_salesでは材料廃棄のみ許可、closedでは廃棄も不可。架空の売上請求・入金を作らない。営業予定なのに未提出、明示した売上ゼロ、計画休業、実際の休業、計画なしを区別する。
- AC-5 WHEN 現金差を表示する THEN 入力された実受領現金売上cashSalesCounted（開始釣銭や別入出金を除外）とcashAmountとの差を使う。未計数はnull、0と見なさない。これはレジ内現金残高の照合や差額仕訳ではない。
- AC-6 WHEN operations_snapshotを参照する THEN 可視店舗×期間の全日を母集団とし、overview/series/stores/submissions/sourceTableを同じContextで返す。Decimalはstring、分母0の率や未計測値はnull、件数はnumber。目標達成率は合計実績/合計目標、店舗比率の平均ではない。比較は直前の同じ暦日数の期間。from<=to<=asOf<=今日、最長366日・店舗日セル上限10000。上限超過はエラーで部分集計を返さない。
- AC-7 WHEN 売上・現金・材料消費/廃棄を集計する THEN 元営業日に正、取消有効日に負の固定事実を使い、asOfより後の事実を除く。sourceTableの合計がoverview/series/storesと一致し、closingIdと番号で元伝票へ辿れる。取消日のない取消済みデータは誤集計せず拒否する。利益・売上原価という表示を使わず、材料消費/廃棄は在庫補助簿の移動平均評価額と明示する。
- AC-8 WHEN 提出ボードを表示する THEN ワークフローは現在状態を示す（workflowBasis=current）、金融実績はasOf有効日を示す。過去の提出状態を現在のheaderから復元したと偽らない。日次目標は確定後/過去日の変更を拒否して保存する。未来日は計画作成で扱い、実績比較に混ぜない。
- AC-9 WHEN settlement_evidenceを参照する THEN 本部all scopeに限定し、対象締めの請求に対する消込履歴からasOf残高を求める。請求ID順にread権限の行ロックを保持し、並行する入金・取消と請求状態/履歴の読取を直列化する。未復元の履歴を0にしない。店舗限定のBIは金融マスタ/請求/消込を読まず、未入金指標を「本部のみ」nullとして扱う。カードとQRの未収は合算された請求残であり、決済会社別残高と呼ばない。
- AC-10 WHEN 一覧・BI・CSVを参照する THEN 店舗scopeを親/子/計画に同じように適用し、bodyのstoreIdで越境できない。CSVはoperations_sources/settlement_evidenceのfresh Context再実行で取得し、export権限を別途検証する。店舗限定者は未宣言core entity/actionを利用できない。親の店舗は作成後不変、共有レシピ/品目/単位/税率は読取のみ。

## API/表示契約

- plan_days: {storeId,from,to,openWeekdays:['mon','tue','wed','thu','fri','sat','sun'],dailyGrossSalesTarget}; 結果{created,kept}。期間最大366日。
- record_day_status: {storeId,date,dayStatus:'no_sales'|'closed',reason}; 下書きを返す。
- submit_for_review: {closingId,expectedVersion?}; review: {closingId,decision:'approve'|'return',note?,expectedVersion?}; finalize: {closingId,expectedVersion?}。
- operations_snapshot: {from,to,asOf?,storeId?} → {range,overview,series:TableResult,stores:TableResult,submissions:TableResult,sourceTable:TableResult}。operations_sourcesは同入力でsourceTableのみ。
- settlement_evidence: 同入力→TableResult（HQのみ）。店舗側の未入金表示は利用不可とし、0と表示しない。

submissions主要列: storeId/store/date/closingId/docstatus/reviewStatus/version/dayStatus/status/plannedOpen/targetSales/grossSales/submittedAt/submittedBy/reviewedAt/reviewedBy/reviewNote。該当なしはnull。
series主要列: date/grossSales/targetSales/cashSales/cardSales/qrSales/consumptionCost/wasteCost/cashDifference。
stores主要列: storeId/store/grossSales/targetSales/achievementPct/previousGrossSales/changeAmount/changePct/cashDifference/consumptionCost/wasteCost/expectedOpenDays/missingDays/reviewPendingDays/finalizePendingDays。
sourceTable: closingId/closingNumber/storeId/store/date/effectiveDate/entryKindと符号付き金額。CSVはこの根拠表を対象とする。

## 対象外

法人間連結、予算会計、利益計算、在庫評価の再計算、勤怠・人件費、決済会社別債権/差引手数料、自動現金差仕訳、予測AI、前年同曜日補正、過去ワークフロー状態の時点復元。

## 検証

2店舗で日別計画、未提出/ゼロ/休業、staff提出/manager承認/HQ転記、差戻し編集、直接親子更新拒否、同時操作、目標と実績の加重比率、同期間比較、取消日を跨ぐ数字、元伝票根拠照合、現金差未測定null、未入金asOf、店舗越境/CSV拒否をPG16で回帰する。既存11件も維持する。共通認証・exportport・Web・migration・fullgateは別担当。
