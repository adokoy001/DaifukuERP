# エッジ実行の有限モデルとトレース照合

[practical-verification AC-7/8](../../docs/specs/practical-verification.md) の検査です。製品の実装を書き換える生成器ではありません。TLA+モデル、手で対応付けた実装投影、実機の保証を区別します。

## 実行

Node 22以上、Java 21、既存workspace依存を用います。モデルだけの検査にDBは不要です。

```sh
node verification/edge/check.mjs
pnpm exec vitest run --project unit apps/edge/test/model-traces.test.ts
pnpm exec vitest run --project db modules/edge-integration/test/model-traces.db.test.ts
```

DB試験は既存の隔離テスト用DB環境を必要とし、通常の開発・本番DBには向けません。CLIは `--only base|mutations|witnesses|traces`、`--java /absolute/path/to/java`、`--jar /absolute/path/to/tla2tools.jar` にも対応します。外部jarも固定hash照合を省略しません。

TLCは公式安定版 [v1.7.4](https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4) に固定します。[tool.json](tool.json) のURLから取得し、サイズとSHA-256の一致後だけJavaで実行します。公開release記載のSHA-1との一致を確認した公式assetからSHA-256を計算しました。独立した署名検証やpublisher提供のSHA-256とは称しません。取得物は `.cache/tla` に置き、各実行時に再検査します。ツール変更はpinと検査結果をレビューします。

各実行は `coverage/edge-model/<UUID>/` にconfig、TLC全文log、`result.json` を残します。seed=1、fingerprint polynomial=0、worker=1、heap上限768MiB、各TLC起動のtimeout=240秒です。timeout、構文エラー、異なるinvariantの違反は成功扱いしません。初回取得は30秒で打ち切ります。

## 有限化と状態の対応

| モデル | 今回の範囲・実装への対応 |
|---|---|
| 機器 | 1 gateway・1機器。2件のjobは初期状態でqueued |
| job | 8つの実state、attempt=0..2、開始済み記録、解決済み記録、保存結果 |
| worker | 2つの論理的な呼出主体。各workerは一度だけclaimを受領し、明示Crashは最大1回。別workerが旧attemptと現attemptを保持できる |
| journal | none / starting / executing / result / reported。`result`は実enumではなく「永続resultがある」投影、実`accepted`はexecutingへ投影 |
| 応答 | 開始要求送信、サーバーcommit、応答到着/喪失を分離。完了も送信、commit、応答到着/喪失を分離 |
| 機器 | 許可を受信→executing journal保存→機器送信→結果保存を別遷移にする。結果はsucceeded/uncertainの代表2種類 |
| 期限 | 実時間を増やさず、未開始lease切れ、開始済みlease切れ、開始前job期限切れを明示遷移として抽象化 |
| 手動解決 | uncertainをfailedへ確定する代表経路。元結果を保存し、以後の遅着完了は明示的に無視 |

`CommitStart` / `CommitComplete` は、[gatewayの業務ロック](../../modules/edge-integration/src/common.ts) 内のDBトランザクションに対応します。ネットワークやjournal、物理送信を同じ原子的遷移に含めません。旧attemptのstartに対するHTTPエラーも「開始許可なし」へ抽象化します。

`ReplayStart` とreported後の `SendComplete` は重複するHTTP入力を表します。端末が回復時にstartを自動再送するという仮定ではありません。[実際の回復処理](../../apps/edge/src/agent.ts) は、結果照会またはuncertainの報告へ進みます。

## 検査する条件

| 台帳ID | TLC invariant | 実装の入口 |
|---|---|---|
| EDGE-START-001 | StartUnique / NoStartedRequeue | [startJob](../../modules/edge-integration/src/relay.ts)、[sweepGateway](../../modules/edge-integration/src/common.ts) |
| EDGE-FENCE-001 | FencingSafe / ResolvedSafe | [completeJob](../../modules/edge-integration/src/relay.ts)、[resolveJob](../../modules/edge-integration/src/human.ts) |
| EDGE-CLAIM-001 | ClaimSafe | [claimJob](../../modules/edge-integration/src/relay.ts) |
| EDGE-JOURNAL-001 | JournalBeforeSend / NoAutomaticResend | [実行](../../apps/edge/src/execution.ts)、[永続journal](../../apps/edge/src/journal.ts)、[IPP送信](../../apps/edge/src/drivers/ipp.ts) |

ClaimSafeは「Claim成立時に同機器の別のclaimed/executing/uncertainがない」という**遷移の条件**です。「常にblocking jobが1件以下」とはしません。旧jobへの開始前uncertain報告が遅着すると、その時点では別jobが既にclaimedである場合もあります。

5種類の検査用変異は、開始許可の再付与、開始済みのqueued化、attempt照合省略、手動解決検査省略、blocking検査省略です。モデル内の `Mutation` 定数でそれぞれ一つを選び、対応invariant違反の終了code=12と反例本文を要求します。製品のガードは変更しません。これはモデルの検査能力確認であり、TypeScript本体を変異させるmutation scoreではありません。

到達性は「開始応答喪失」「完了応答喪失」「旧attempt完了」「解決済み完了」「実送信」に対して、それが到達不能だとする逆のinvariantを置き、予期した反例を取得します。ガードの事前条件で全操作が実行されない空虚な成功を避けます。

## モデルと実装を結ぶ3トレース

[traces.json](traces.json) はレビュー可能な固定操作列と期待投影です。TLCが生成した全実行を自動的にTSへ変換したものではありません。[EdgeTrace](EdgeTrace.tla) は同じNext関係を操作列で制限し、**各段階のserver state / attempt / grant数 / journal / send数**が一致することと終点到達を検査します。途中で行き詰まるとTraceUnfinished違反が得られず失敗します。

| トレース | 検査する経路 |
|---|---|
| EDGE-TRACE-LOST-START | 開始commit→応答喪失→uncertain結果→完了ACK喪失・再送→後続claim拒否→手動解決→遅着完了無視 |
| EDGE-TRACE-OBSOLETE | 旧start送信→未開始lease切れ→新attempt→旧start/結果拒否→新attemptだけ開始→重複start拒否→成功結果のACK喪失・再起動→保存済み成功結果の再送 |
| EDGE-TRACE-PHYSICAL-UNKNOWN | 開始許可とjournal保存→送信→結果不明→完了ACK喪失→再起動→保存結果だけ再送 |

[実DB試験](../../modules/edge-integration/test/model-traces.db.test.ts) は同じJSONからserver操作を再現し、各操作後のstate/attemptと実際の開始許可回数を比較します。期限遷移は合成時計を進め、実heartbeatのsweepから発生させます。旧attempt・解決済み完了は版・保存行全体が変わらないことも確認します。journalと通信だけの段階はDB投影が変わらない段階として扱います。

[端末試験](../../apps/edge/test/model-traces.test.ts) は実TLS通信、実journalファイル、合成IPPサーバーを使い、共有JSONの対応checkpointでjournalと送信数を照合します。HTTP開始直前とIPP Print-Job受付時のjournalを別インスタンスで読み、送信前のexecuting保存を確認します。機器応答/完了ACKの喪失後に再openしても再印刷しないこと、一般的な完了拒否を勝手にackしないことも検査します。TLS fixtureのサーバー状態機械自体の正しさは実DB試験へ分離しています。

## 活性の前提と保証しないこと

初版のTLC対象は安全性と具体的到達性です。fairness付きの活性証明は行っていません。正常な最終状態や有限上限到達で停止できるためdeadlock検査を無効にしています。これは運用上のdeadlock不存在を確認したという意味ではありません。

「いずれ処理が進む」には、通信・DB・永続ストレージ・端末が回復し、期限処理とpollが実行され、先行するuncertainが適切に解決されるという前提が要ります。通知の配送保証は置かず、実装のpollを前提にできます。人による解決を仮定しなければ、uncertainで止まり続けることは許容されます。[公平性の公式解説](https://lamport.azurewebsites.net/tla/tutorial/session11-2.html)

次のものはこのモデルの保証対象外です。

- 任意台数・任意attempt回数への一般化。初期claim応答の喪失、資格発行/失効・ローテーション、credentialの暗号学的性質、queueページ上限の性能・飢餓、WSS実装。
- 実時間での期限精度、通信遅延やclock drift、OSロック/fsyncやPostgreSQL自体の正しさ。実装側の既存試験と運用条件を別に必要とする。
- 物理的なexactly-once、プリンターが本当に印刷したか、停止要求による過去の機器命令の取消、人の証拠が正しいか。send数はソフトウェアからの送信回数で、印刷枚数ではない。
- モデルとTS全コードのrefinement proof。TLCの有限探索はfingerprintを使う実行結果であり、任意サイズに対する数学的証明ではない。探索範囲・ツール版・logを併記する。

[TLA+の公式説明](https://lamport.azurewebsites.net/tla/high-level-view.html) と[トレース適合の原論文](https://arxiv.org/abs/2404.16075)を方法の参考にしています。Java向け研究実装が当TSへそのまま適用できるとはしていません。

## 再検査の契機

job state/lease/attempt/手動解決、gatewayロック、journal保存順、IPP再送条件、API応答、queue選択を変えるときはモデル・投影・固定トレースを一緒にレビューします。反例を直すためだけにモデルへ実装にない自動回復や強い外部前提を追加しません。実測は同ディレクトリの [検査結果](RESULTS.md) を参照してください。
