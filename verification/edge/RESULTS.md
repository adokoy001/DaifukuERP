# エッジ有限モデルの検査結果

確認日: 2026-09-13。`feat/practical-verification` の初回実装に対する担当範囲の測定です。プロジェクト全gate・公開CIの完了を意味しません。

## 再現条件

- TLC公式release 1.7.4 / 実行表示 `TLC2 Version 2.19 ... rev: 5a47802`。jarのpinは [tool.json](tool.json)。公式配布から自動取得する既定コマンドでもhash検査後に完走。
- WSL Linux x64、Temurin Java 21.0.12.1、Node 22.23.2。TLC worker=1、seed=1、fingerprint polynomial=0。
- job=2、worker=2、attempt上限=2、各workerのclaim上限=1・明示Crash上限=1。[範囲と非保証](README.md)を適用。
- 実行: `node verification/edge/check.mjs`。独立レビュー修正後の14チェックすべて予期した結果。TLC起動時間合計75.9秒、正常探索47.7秒。並行して他検査が動作する開発環境の測定で、CI性能の保証ではない。

モデル入力のSHA-256:

```text
Edge.tla      9304212e522ef77cf400ee5c9c831ca19127a7ea5cc7d021635708a12f97575c
EdgeTrace.tla abe15a337dd95f78cdb81e3f55e032a7e81edad316e69c3c7ccf42b62e241dc2
traces.json   ef19ae58b016d22f823724f708067ca455d1e434a454fb8029b8d4f30a446c96
```

## TLCの結果

正常モデルは1,972,185生成状態、512,373異なる状態、探索深さ39、残queue=0で完走し、対象invariant違反はありませんでした。TLCのfingerprint衝突確率表示はoptimistic `4.1E-8`、actual fingerprints基準 `8.6E-9` です。このツール出力を数学的な無限範囲の証明へ読み替えません。

| 検査 | 結果 | 反例の状態数 |
|---|---|---:|
| 開始許可を再付与する変異 | StartUnique違反を検出 | 6 |
| 開始済みをqueuedへ戻す変異 | NoStartedRequeue違反を検出 | 6 |
| attempt照合を省く変異 | FencingSafe違反を検出 | 8 |
| 手動解決検査を省く変異 | ResolvedSafe違反を検出 | 10 |
| blocking検査を省く変異 | ClaimSafe違反を検出 | 3 |
| 開始応答喪失への到達 | NotLostStartの反例を取得 | 6 |
| 完了応答喪失への到達 | NotLostCompleteの反例を取得 | 7 |
| 旧attempt完了への到達 | NotObsoleteの反例を取得 | 8 |
| 手動解決後の完了への到達 | NotResolvedの反例を取得 | 10 |
| 機器送信への到達 | NotPhysicalSendの反例を取得 | 8 |
| EDGE-TRACE-LOST-START | 全投影一致、終点到達 | 18 |
| EDGE-TRACE-OBSOLETE | 全投影一致、終点到達 | 28 |
| EDGE-TRACE-PHYSICAL-UNKNOWN | 全投影一致、終点到達 | 18 |

モデルの意図的変異と逆invariantは、対象名の違反・終了code=12・反例本文見出し・State数が1以上の全条件を要求して成功判定しました。固定トレースは、単にTLCが正常終了するだけでは成功にせず、最終段階に到達したTraceUnfinished違反を要求しています。

## 実装との照合

| コマンドの対象 | 実測 |
|---|---|
| `vitest run --project db modules/edge-integration/test/model-traces.db.test.ts modules/edge-integration/test/workflow.db.test.ts` | 追加3＋既存8の11件PASS、33.4秒。実Repository/トランザクションを使用 |
| `vitest run --project db modules/edge-integration/test/model-traces.db.test.ts` | 独立レビュー修正後3件PASS、14.7秒。保存済み成功結果のCrash/Recoverも照合 |
| `vitest run --project unit apps/edge/test/model-traces.test.ts` | 独立レビュー修正後3件PASS、3.2秒。実TLS、実journal、合成IPPで送信数と回復を確認 |
| `pnpm typecheck` | PASS |
| 担当2試験・check.mjsへのESLint | PASS |
| `git diff --check` | PASS |

改変した合成jarを `--jar` に指定し、存在しないJava名を `--java` に指定した負例では、Java起動に到達せず `TLC asset hash mismatch`、終了code=1で拒否しました。

独立レビューで、IPP送信受付時のjournal確認、回復時に既存結果を保持する投影、反例本文のState数確認を補強しました。IPP fixtureの受付hookでは別Journalをopenしてexecuting保存と送信数を照合し、その検査Promiseを試験本体でもawaitして、fixtureのHTTPエラー応答によるassertionの取りこぼしを防いでいます。既存OBSOLETEトレースへ成功結果保存後のCrash/Recoverを追加し、回復後も保存済みsucceededと一致することを実測しました。

初期検証中には、固定トレースの文字列表現の誤りによりTLCが途中19状態で正常終了したケースをrunnerが失敗扱いしたことも確認しています。期待列を実装に合わせて緩めず、モデルのイベント表現を修正した後、26状態の終点到達と各投影一致を再確認しました。

各実行の全文log・config・機械可読結果はgit対象外の `coverage/edge-model/<UUID>/` に生成します。今回の最終測定IDは `d3337bb4-3705-44ac-8e2e-7093563d85dd`。継続CIはこの中のresult.json・tlc.log・config・modelを保存し、変更後の測定を追跡します。TLC内部のstates作業ファイルは成果物に含めません。
