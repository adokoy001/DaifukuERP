# Decimal・貸借検査のmutation

[仕様](../../docs/specs/practical-verification.md) / [台帳](../../docs/verification/invariants.md) / [実測記録](../../docs/log/2026-09-13-practical-verification.md)

Node 22以降と固定pnpmで `pnpm install --frozen-lockfile` の後、`pnpm verify:mutation` を実行する。DB・実取引・資格情報は不要。通常gateとは別のCI jobで実行する。ローカル所要時間は約9分。

対象は [Decimal](../../kernel/src/decimal.ts) と [貸借検査](../../modules/accounting/src/services/balance.ts) のファイル全体。[StrykerJS 10.0.0](https://stryker-mutator.io/docs/stryker-js/configuration/)を固定し、[構成](../../stryker.config.mjs)に対象・runner・終了条件を置く。対象を広げずに計算基盤から始める。

## 空振りを防ぐ

初回のVitest内蔵runnerでは、反対仕訳の戻り値を空にする変異まで生存した。原因の全てを上流バグと断定せず、同じ2変異の対照実験で毎回新しいCLIを起動するcommand runnerへ替え、両方の検出を確認した。[専用Vitest構成](vitest.config.mts)はworkspaceのkernel importも変異コピーへ解決する。

Strykerの終了閾値は100%。さらに[結果検査](report.mjs)が、固定版・全ファイル指定・runner・現行ソースとの一致・90+57の変異件数・全件`Killed`を確認する。command runnerは起動失敗もKilledと数え得るため、各結果には対象4ファイル21試験の完走サマリーと名前付き失敗試験を要求する。起動失敗・途中終了・未処理エラー、生存、未実行、無被覆、除外、コンパイル/実行エラー、タイムアウトは成功にしない。結果検査単独は過去のテスト内容の鮮度まで保証しないため、公開判断には毎回 `pnpm verify:mutation` 全体を使う。

製品ソースまたはStryker更新で件数が変わった場合、全実行の結果をレビューしてinventoryを更新する。行番号で狭めた調査結果を全体成功として流用しない。構成を緩めたり、エラーを検出成功に読み替えたりしない。

## 初回の不足と補強

fresh CLIによる初回147変異は139検出・8生存だった。いずれも現状では等価変異として除外せず、次を補った。

| 生存した変更 | 補った観測 |
| --- | --- |
| 公開丸め方式一覧の空化・文字列欠落（4） | 公開契約の3方式を明示照合 |
| 最低明細数のメッセージ空化（1） | 利用者が修正できる不足理由の返却 |
| 片側正額エラーの親検査への伝播削除（2） | 貸借が一致していても不正な各行を拒否 |
| 科目別集計の全削除（1） | 空でない科目集合と正/負/ゼロの純額を独立BigInt計算と比較 |

[Decimal独立参照](../../kernel/test/decimal-reference.test.ts) と [会計独立参照](../../modules/accounting/test/balance-reference.test.ts) は期待値に本体の同じ処理を呼ばない。既存の代数則も維持する。最終実測は上記作業記録を参照する。

生成結果は`coverage/mutation/`、コピーは`.stryker-tmp/`に置き、Git・通常Vitest・lintから除外する。CIは合成試験のレポートだけ7日保存する。mutation scoreはこの対象と変異演算子に対する検出率であり、会計制度・全業務・未知のバグの正しさの証明ではない。
