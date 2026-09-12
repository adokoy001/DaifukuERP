# 作業記録: 2026-09-12 チェーン本部運営管理とBI

- 担当: domain agent。対象: [仕様](../specs/restaurant-operations.md)、[業務台本](../domain/scenario-restaurant-chain.md)。
- tokens / agent_minutes / human_minutes / rework_lines: 未計測（null）。人手の業務受入審査は未実施。

## 決めたこと

- 店舗担当の下書き→提出→店長確認→本部確定。店舗スコープは自店の入力・提出・確認にとどめ、会計・在庫転記と決済債権は本部が扱う。既存本部の直接確定も維持する。
- 営業予定と日次目標は独立した確定文書。過去日と一度でも確定締めがある日の変更を拒否し、後から目標を都合よく書き換えない。未計画を未提出とは呼ばない。
- 営業日基準はAsia/Tokyo。実績は計上/取消有効日、提出ボードは現在状態。比較は直前の同じ暦日数。店舗の比率を平均せず合計値から率を算定する。
- 現金売上実収額は釣銭準備金等を除く点検値で、未入力は不明。材料消費/廃棄は在庫補助簿評価額で、会計上の利益・売上原価ではない。
- 通常sampleは従来どおりマスタ・確定レシピのみ。営業予定や実績・決済は利用者の明示操作で作る。

## 実装

- restaurant_chain_day_plan、新しいclosingのdayStatus/cashSalesCounted/reviewStatus/担当者・日時・理由。新しい内部writerでレビュー項目を保護し、親/明細の凍結と日単位ロックを追加。
- plan_days / record_day_status / submit_for_review / review / finalize。
- operations_snapshot（概要・日次推移・店舗比較・提出ボード・元伝票表）、operations_sources（CSV用）、本部用settlement_evidence（有効日付き消込履歴）。すべてRepository+Context経由。
- kernel担当のstoreAccess契約へ店舗・締め・子明細・計画を宣言し、品目・単位・税率・レシピは店舗から共有読取。exportEntitiesを明示し、元伝票CSVはfresh export経路で再計算する。
- 仕様、既存pack仕様の範囲、具体的台本を更新。既存11回帰を残して新11回帰を追加。

## 検証

- [実測] PG16（127.0.0.1:55440、専用daifuku_review_farm）で `pnpm exec vitest run --project db packs/restaurant-chain`: 4ファイル21件通過、53.23秒。ログ: リポジトリ外 `../review/restaurant-operations-tests.log`。
- [実測] pack typecheck、`pnpm exec eslint packs/restaurant-chain`、全体 `pnpm lint:boundaries` 通過（637 modules / 3218 dependencies）。
- [実測] 店舗越境・店舗からの本部操作、提出後の親/子CRUDとsaveLines、親移動、stale version、差戻し理由監査、同日二重提出、在庫不足時の全体ロールバックと再確定、休業、売上ゼロ日の廃棄と取消。
- [実測] 同一予定の並行作成で作成1・保持1、過去/事後目標変更拒否、計画休業/未提出/未計画/売上ゼロの区別。
- [実測] 売上20800円/目標30000円の達成率69.33%、前日16400円からの差4400円・26.83%、材料消費3800円/廃棄50円、元伝票合計と概要/推移の一致。未点検実収差null。取消日のマイナスと過去基準日の未入金6400円。東京日付境界。
- [実測] 店舗限定operations_sourcesをexport権限確認後に再実行し、自店だけの根拠行になること、他店指定を拒否すること。
- [未検証] この担当ではmigration適用・HTTP/Web/MCPの実利用・全体gateは実施していない。rootが統合検証する。実店舗の人手受入、大規模負荷試験も未実施。

## 検証中に直した点

新規テストのactor識別子をUUIDで作成し直し、公開updateの明細入力を正規のpatch.linesへ訂正した。カーネルの親移動拒否はValidationErrorであり、提出凍結のStateErrorと区別して検証した。custom action内部結果のDecimalを文字列と比較せず、保存後の公開getで金額を確認するようにした。既存の検証内容を弱める変更は行っていない。

## 未実施・対象外

決済会社別債権、現金差額の自動仕訳、会計利益、勤怠/人件費、法人間連結、過去ワークフローの時点復元、前年同曜日補正、AI予測は実装していない。現金点検値がない既存データをゼロへ補完したり、旧確定データに店長承認履歴を推測追加したりしない。

## 最終自己レビュー追補

- [レビュー→修正] 本部債権表のinvoice読取と消込履歴集計の間に別transactionが取消をcommitすると、READ COMMITTEDで状態と履歴がずれる可能性を検出。kernel担当と共通ロック契約を確認し、請求ID順のrepo.lock(id, 'read')で最新請求と履歴を同じロック内から読み直すよう修正した。新しい権限APIやschema変更はない。
- [実測] 請求取消をbefore_cancelで止め、債権表がinvoiceロックを要求した後に取消をcommitさせる競合回帰を追加。`operations.db.test.ts`全7件通過（25.60秒）、ログ `../review/restaurant-operations-final-race.log`。pack全体の登録テスト数は22件。全21件通過後にこの局所修正を行い、対象7件を再実行した。rootの最終全体gateで改めて通す。
- [制約] 本部債権表は対象invoiceの行ロックを保持するため、同じ請求への入金/取消と短時間待合せる。上限10000件は維持するが大規模な負荷試験は未実施。
