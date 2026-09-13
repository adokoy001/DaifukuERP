# Spec: practical-verification

- 状態: implemented（ローカル受入完了。公開候補のCIはActions参照）
- モジュール: kernel、trade、banking、tax-filing、workforce、edge-integration、開発検証ツール
- 作成: 2026-09-13 / 承認: 利用者の自律実装指示
- 関連: [検証・公開](../architecture/verification-and-release.md)、[テスト規約](../conventions/testing.md)、[シフトADR](../adr/0020-browser-shift-planning.md)、[機器ADR](../adr/0023-outbound-relay-principal-and-fencing.md)

## 目的

業務上の不変条件を既存仕様・実装・検査根拠へ結び、固定した具体例だけでは発見しにくい操作列・会社境界・通信障害・共有計算の誤りを再現可能な方法で検出する。数学的モデルと実装、検査範囲と外部環境の保証を区別する。

## 受入基準

- AC-1 WHEN 検証台帳を検査するとき THE SYSTEM SHALL 重複ID、未解決の仕様/実装/テスト参照、欠落した前提・失効契機を拒否し、少なくとも8件の重要条件を人とAIが読めるMarkdownに記録する。
- AC-2 WHEN 商流の履行・請求・取消・打切・再送の生成操作列を実DBで実行するとき THE SYSTEM SHALL 各操作の直後に有効数量 `0 ≤ B ≤ F ≤ Q`、在庫/会計効果、拒否時の原子性を独立した参照状態と比較し、実行された正常/拒否操作を確認する。
- AC-3 WHEN 銀行の取込・照合・解除・再照合・古い要求再送を実DBで実行するとき THE SYSTEM SHALL 新規入出金の作成と既存入出金への関連付けを区別して有効照合の一意性、残高、元帳効果を検査する。全銀出力の固定長・合計・改行は独立読取で比較する。
- AC-4 WHEN 権限内データと利用者を固定し他社/権限外拠点のデータだけを生成変更するとき THE SYSTEM SHALL 権限内の一覧・件数・集計・検索・metadataが変化しないことを実Repositoryで比較する。明示的な共有設定/本部の連結権限は対象外とする。
- AC-5 WHEN 小さなシフト問題を検算するとき THE SYSTEM SHALL 本体の制約関数を使わない独立した全探索で許可/禁止を比較し、推薦の制約充足と最小欠員との差を確認する。全問題で推薦の最適性を要求しない。
- AC-6 WHEN 金額/数量の重要条件に限定したmutation検査を実行するとき THE SYSTEM SHALL 対象・再現方法・結果・生存変異の理由を記録し、条件を意図的に破壊した場合に関連検査が失敗することを確認する。既存試験の削除/弱体化で成功扱いにしない。
- AC-7 WHEN エッジの開始許可・応答消失・期限切れ・再起動・結果再送・手動解決を有限モデルで探索するとき THE SYSTEM SHALL jobごとの開始許可一意性、開始後の自動再待機禁止、旧attempt/解決後結果の拒否、Claim成立時の他blocking job不在を検査する。サーバー/応答/journal/物理送信を別遷移とする。
- AC-8 WHEN モデルと実装を検査するとき THE SYSTEM SHALL 代表的な故障/遅着トレースを実DBまたは端末実装へ再現し、有限の範囲・通信回復等の前提・実機の非保証・到達した故障経路を記録する。
- AC-9 WHEN 申告資料の準備・別担当確認・原資料更新・取消を行うとき THE SYSTEM SHALL 保存された根拠を保持し、最新版確認と出力の状態条件を検査する。銀行の保存bytes再取得と申告の根拠再検査を混同しない。
- AC-10 WHEN 文書とCIを更新するとき THE SYSTEM SHALL 実行可能なコマンド・固定したツール依存・通常gateと追加検査の使い分け・失敗再現手順を記録し、既存CIとUIの業務契約を維持する。

## 設計方針

金額・数量はDecimal、参照用の最小単位整数にはBigIntを使う。生成モデルは本体の計算結果を期待値へ転用しない。正常/拒否/障害操作の実行確認で空虚な成功を避け、fast-checkのseed/pathを保存可能にする。今回の生成配列にはfc.commands専用のreplayPathは不要。固定seedの通常試験と広い任意探索を分ける。

検証台帳は既存specを正本とする索引であり、別の巨大DSLにしない。共有インフラ・依存追加はrootが統合する。発見した不具合は原因と反例を記録して修正する。

## スコープ外

ERP全体の形式証明、会計残高のCRDT化、本番ブラウザへのSMT/WASM追加、銀行への実送金、行政への実申告、法令全体の適合証明、実機のexactly-once保証、製品UIの全面変更。型の全面置換やPact基盤は実際の契約需要が生じた段階で別specとする。

## 検証手順

1. 各追加unit/DB試験を専用fixtureで実行し、実行範囲・最小反例を記録する。
2. `pnpm gate`、API/Web型検査・Web/edgeビルドを実行する。UI変更がない場合に新規ブラウザ操作試験は要求しない。製品修正の影響に応じて既存E2Eを実行する。
3. 追加mutationコマンド、有限モデル検査、検証台帳の検査を実行する。意図的に壊した隔離入力で失敗を確認する。
4. docs/architecture・AI_INDEX・STATUS・規約・作業記録を実測に合わせて更新し、commit/PRのCI結果を確認する。

## 参考

- [利用者の記事](https://nikki.yokoda.okinawa/posts/2026/08/2026-08-20-007/)（2026-09-13確認）
- [fast-check model-based testing](https://fast-check.dev/docs/advanced/model-based-testing/)（2026-09-13確認）
- [TLA+ tools](https://lamport.azurewebsites.net/tla/tools.html)（2026-09-13確認）
- [StrykerJS configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)（2026-09-13確認）
