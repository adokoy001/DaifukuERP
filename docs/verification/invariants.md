# 業務条件と検証根拠の台帳

正本は各仕様と現行ソースです。この台帳は、前提・検査・変更時の再確認先への索引です。`pnpm verify:assurance`が形式と参照先、`pnpm verify:assurance --changed <base>`が直接リンクしたファイルの変更（未追跡の新規ファイルを含む）を確認します。依存関係や制度変更をすべて自動判定するものではありません。

具体的な実行結果は[今回の作業記録](../log/2026-09-13-practical-verification.md)を参照してください。例での確認、生成範囲での確認、有限モデル検査、外部受入は異なる証拠です。形式に合う文書を「業務上の正しさが証明済み」と扱いません。

## PV-DECIMAL-01
- 条件: 金額・数量の大小比較と丸めが、対応する最小単位整数の比較・丸めと一致する。
- 前提: 十進文字列、選択した桁数と40桁精度内の演算。参照値はBigIntで独立計算する。
- 仕様: [十進演算ADR](../adr/0010-money-decimal.md)
- 実装: [Decimal](../../kernel/src/decimal.ts)
- 試験: [独立した整数参照](../../kernel/test/decimal-reference.test.ts)、[既存代数則](../../kernel/test/decimal.test.ts)
- 根拠: 固定した丸め境界とseed 930601/930602/930603の生成入力。mutationは同ファイル全体を対象とする。
- 失効条件: 精度、入出力、丸め方式、比較演算、decimal.jsまたは数値表現の変更。
- 限界: 任意精度での数学的等式や、誤って入力された現実の金額の正しさは保証しない。

## PV-ACCOUNTING-01
- 条件: 仕訳の貸借、明細の片側正額、反対仕訳の純額を検査する。
- 前提: 同一会社・通貨、Decimal、承認された仕訳の正規経路。取消の監査履歴は残す。
- 仕様: [会計仕様](../specs/accounting.md)
- 実装: [貸借検査](../../modules/accounting/src/services/balance.ts)、[変異構成](../../stryker.config.mjs)、[変異の結果検査](../../verification/mutation/report.mjs)
- 試験: [代数則と具体例](../../modules/accounting/test/balance.test.ts)、[科目集合と整数純額](../../modules/accounting/test/balance-reference.test.ts)、[実DB](../../modules/accounting/test/accounting.db.test.ts)
- 根拠: 純粋関数とRepository双方の試験。mutationで重要条件を壊し、検出結果と生存変異の理由を記録する。
- 失効条件: 明細検証、計上、反対仕訳、通貨、税の丸め、直接更新経路の変更。
- 限界: 貸借一致だけでは、科目選択や元の取引が事実であることを判断できない。

## PV-TRADE-01
- 条件: 受注明細ごとに有効数量が0 ≤ 請求B ≤ 履行F ≤ 受注Qを満たす。
- 前提: 同一会社・1品目/倉庫・固定UOM・JPY・税exempt・同日・0.25単位・固定価格/原価。下書き/取消を除外し、打切の操作可否を数量差と区別する。
- 仕様: [商流仕様](../specs/trade-workflow.md)
- 実装: [数量](../../modules/trade/src/quantities.ts)、[生成](../../modules/trade/src/generate.ts)、[取消・打切](../../modules/trade/src/lifecycle.ts)
- 試験: [生成操作列](../../modules/trade/test/workflow-model.db.test.ts)
- 根拠: 売上/仕入の両方向、必須の成功・拒否・再送prefixと生成tailを独立した数量状態へ照合する。
- 失効条件: 分納、単位換算、親ロック、docstatus、取消順序、過剰履行/請求の許可条件の変更。
- 限界: 任意長・任意並行順の証明ではない。移動平均の任意順序入替を要求しない。

## PV-TRADE-02
- 条件: 同一要求の再送が重複伝票を作らず、請求/請求取消で在庫が二重に動かない。
- 前提: 正規action、同じ要求IDとpayload、Repositoryトランザクションと原資料の所有関係を維持する。
- 仕様: [商流仕様](../specs/trade-workflow.md)
- 実装: [生成](../../modules/trade/src/generate.ts)、[転記](../../modules/trade/src/posting.ts)、[ライフサイクル](../../modules/trade/src/lifecycle.ts)
- 試験: [操作列と効果](../../modules/trade/test/workflow-model.db.test.ts)、[競合の具体例](../../modules/trade/test/trade.db.test.ts)
- 根拠: 数量だけでなく在庫量/価額・全在庫履歴の数量/原価/取消印・AR/AP純額・失敗後の文書状態を比較する。取消履歴の消去は要求しない。
- 失効条件: 再送キー、payload正規化、在庫自動連携、トランザクション範囲、監査/転記の変更。
- 限界: ネットワーク全体や外部機器の物理的なexactly-onceを意味しない。

## PV-BANK-01
- 条件: 有効照合が一意で、解除と再照合・古い解除要求の再送が現在の残高を壊さない。
- 前提: 安定した銀行明細ID、同一口座・正の整数JPY・逐次操作・固定日付・1明細と重複支払候補。新規入出金作成と既存関連付けを別遷移として扱う。
- 仕様: [銀行仕様](../specs/bank-integration.md)
- 実装: [照合](../../modules/banking/src/reconcile.ts)、[取込](../../modules/banking/src/imports.ts)
- 試験: [照合の生成操作列](../../modules/banking/test/reconciliation-model.db.test.ts)、[取込と競合](../../modules/banking/test/banking.db.test.ts)
- 根拠: 入金/支払×新規/既存の4方向で、成功・拒否・解除・再送を実DBへ通し、独立した残高と照合状態を比較する。
- 失効条件: 明細ID、照合ロック、既存入出金の扱い、日付順序、再送契約の変更。
- 限界: 銀行側での送金やAPI認可、銀行明細そのものの真実性を検証しない。

## PV-BANK-02
- 条件: 全銀形式の固定長、件数、合計金額、改行の有無によるバイト列の関係が一致する。
- 前提: 対応する総合振込形式、文字コードと許容文字、1〜500件、固定した支払予定の保存値。
- 仕様: [銀行仕様](../specs/bank-integration.md)
- 実装: [全銀formatter](../../modules/banking/src/zengin.ts)、[再出力](../../modules/banking/src/transfers.ts)
- 試験: [独立byte読取](../../modules/banking/test/zengin-property.test.ts)、[固定例](../../modules/banking/test/files.test.ts)
- 根拠: formatterを期待値に使わず、固定位置読取とBigInt合計で生成したファイルを検査する。
- 失効条件: レコード配置、文字コード、改行、件数/桁制限、保存形式の変更。
- 限界: 各銀行の契約・取込設定・実際の受入成功は別の確認が必要。

## PV-FILING-01
- 条件: 別担当確認と根拠の鮮度が出力の前提であり、元資料変更/取消後に旧資料をそのまま出力しない。
- 前提: JP HOT010一般商工業Ver.3.0・税抜JPY・FY2026の独立法人・2件の仕訳。保存snapshot/hash、別担当者、正規ロック、訂正は新しい版。
- 仕様: [申告準備仕様](../specs/tax-filing-preparation.md)
- 実装: [申告workflow](../../modules/tax-filing/src/workflow.ts)、[出力action](../../modules/tax-filing/src/actions.ts)
- 試験: [根拠変更の生成操作列](../../l10n/jp/test/filing-source-model.db.test.ts)、[画面の競合](../../apps/web/e2e/filing-concurrency.spec.ts)
- 根拠: 科目名/profile設定/会計期間の変更、確認、取消、再作成を検査し、全pack件数・ID集合・previousId鎖・過去snapshotの保持を確認する。
- 失効条件: 制度年、profile版、元資料の収集範囲、確認者権限、更新ロック、公式取込仕様の変更。
- 限界: 生成操作は仕訳金額変更や給与申告を含まない。ハッシュ一致は原資料の正しさや行政での受理を意味しない。銀行の保存bytes再取得とは異なる。

## PV-SCOPE-01
- 条件: 権限内データと利用者を固定したとき、他社/権限外拠点の生成変更が許可された観測へ混じらない。
- 前提: 同一利用者とroles、会社と拠点の境界を分けたfixture、明示共有設定を変更対象から除外する。
- 仕様: [会社/店舗の権限ADR](../adr/0018-company-and-store-access.md)、[実用検証仕様](../specs/practical-verification.md)
- 実装: [Repository scope](../../kernel/src/repository/scope.ts)、[権限](../../kernel/src/permissions.ts)、[pack](../../kernel/src/pack.ts)
- 試験: [2状態の生成比較](../../kernel/test/noninterference.db.test.ts)
- 根拠: 一覧/ページ/件数/集計/検索/子行/metadata、権限内書込の成功、権限外書込の拒否を確認する。
- 失効条件: RLS、会社/拠点条件、親参照、許可roleの合成、pack適用範囲、集計/検索経路の変更。
- 限界: 応答時間等の全情報漏えいの証明ではない。明示許可した本部の連結情報には同じ非干渉条件を置かない。

## PV-SHIFT-01
- 条件: 小規模な通常制度の割当について、本体検査の許可/禁止が独立した全探索と一致する。
- 前提: 最大3人×4枠、有効な同日内勤務、月曜開始の通常制度。変形/flexと清算期間拡張はoracle対象外として拒否する。
- 仕様: [シフトADR](../adr/0020-browser-shift-planning.md)、[実用検証仕様](../specs/practical-verification.md)
- 実装: [推薦](../../modules/workforce/src/scheduling/optimize.ts)、[検査](../../modules/workforce/src/scheduling/evaluate.ts)、[制約](../../modules/workforce/src/scheduling/rules.ts)
- 試験: [全探索との比較](../../modules/workforce/test/shift-oracle.test.ts)
- 根拠: 本体は型のみ共有するoracleで検算。各生成問題に非空の許可/禁止例を含め、最小欠員との差を測る。
- 失効条件: 禁止条件、対象期間、休暇の扱い、連勤の取得範囲、勤務制度、目的関数の変更。
- 限界: 推薦が常に最適とは要求しない。数学的配置可否と法令全体・本人権限・DB排他の正しさは別。

## PV-EDGE-01
- 条件: 開始許可は同一jobで一度、開始後は自動でqueuedに戻らず、旧attempt/手動解決後の結果を拒否する。
- 前提: gatewayの排他、資格とattempt、正規遷移。Claim成立時の他blocking job不在を検査する。
- 仕様: [機器の認可とfencing](../adr/0023-outbound-relay-principal-and-fencing.md)、[実用検証仕様](../specs/practical-verification.md)
- 実装: [relay](../../modules/edge-integration/src/relay.ts)、[期限処理](../../modules/edge-integration/src/common.ts)、[有限モデル](../../verification/edge/Edge.tla)、[検査runner](../../verification/edge/check.mjs)
- 試験: [実DBのモデルtrace](../../modules/edge-integration/test/model-traces.db.test.ts)
- 根拠: 有限TLA+モデル、到達性witness、意図的ガード破壊、共通トレースから実装への再現。具体的範囲と結果はモデルREADME/作業記録を参照。
- 失効条件: enum、排他範囲、attempt、開始許可、期限切れ、失効/手動解決、遅着報告の扱いの変更。
- 限界: blocking jobは全時点で常に1件以下とは限らない。実機の物理効果のexactly-onceや任意台数の証明ではない。

## PV-EDGE-02
- 条件: 開始応答や結果応答が失われた場合、永続記録を使って結果を報告し、結果不明の物理命令を自動再送しない。
- 前提: サーバー状態・応答・永続journal・揮発状態・機器送信を別遷移とし、未知の結果は確認待ちにする。
- 仕様: [機器仕様](../specs/deployment-edge.md)、[実用検証仕様](../specs/practical-verification.md)
- 実装: [開始処理](../../apps/edge/src/execution.ts)、[再起動回復](../../apps/edge/src/agent.ts)、[traceモデル](../../verification/edge/EdgeTrace.tla)、[共通trace](../../verification/edge/traces.json)
- 試験: [端末のモデルtrace](../../apps/edge/test/model-traces.test.ts)、[既存端末試験](../../apps/edge/test/agent.test.ts)、[実DBのモデルtrace](../../modules/edge-integration/test/model-traces.db.test.ts)
- 根拠: 共通3traceのサーバー状態を実DBで全段階照合し、端末では対応するcheckpointを実TLS・永続journal・合成IPPで確認する。送信受付時にも別Journalからexecutingの永続化を確認する。
- 失効条件: journal永続化の順序、driverの照会/再送契約、再起動/時計/接続回復処理の変更。
- 限界: 進行には通信/端末の回復と再試行、公平性、人による確認等の前提がある。サーバーが実機停止を証明するものではない。

## PV-ASSURANCE-01
- 条件: 重複ID・前提欠落・参照切れ・例だけの台帳を成功扱いにしない。
- 前提: 所定Markdown項目、相対ファイル参照、必要なら既存行へのLアンカー。コードフェンスの例は件数へ含めない。
- 仕様: [実用検証仕様](../specs/practical-verification.md)
- 実装: [台帳検査](../../verification/assurance.mjs)、[CLI](../../scripts/check-assurance.mjs)
- 試験: [正常/破損/外部参照/例の拒否](../../verification/test/assurance.test.ts)
- 根拠: 合成台帳で正常と拒否の両方を実行し、直接リンクしたファイルの変更を抽出する。
- 失効条件: 文書の書式、ID/参照規約、Git差分の対象、実装/試験ファイルの移動。
- 限界: テストの意味や制度上の妥当性を自動証明するものではない。直接参照していない依存の変更は人とAIが確認する。

## PV-BANK-SAVED-01
- 条件: 確認済み振込ファイルの再取得が保存済みbytesと一致し、出力だけでは送金済みや入出金計上にならない。
- 前提: 未送信、1件の正のJPY支払、CSV/CRLF・全銀/改行なし・全銀/CRLFの対応形式。
- 仕様: [銀行仕様](../specs/bank-integration.md)
- 実装: [保存と再出力](../../modules/banking/src/transfers.ts)
- 試験: [保存ファイルの生成操作列](../../modules/banking/test/saved-export-model.db.test.ts)
- 根拠: 生成→出力→受取人口座更新→再出力→取消→出力拒否を行い、元bytes/snapshotと入出金/仕訳件数を照合する。
- 失効条件: snapshot固定、format/改行、状態遷移、支払予約/取消、銀行送信の追加。
- 限界: 実際の銀行受理や振込実行を確認しない。申告の鮮度再検査とは別の契約。
