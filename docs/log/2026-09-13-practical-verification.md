# 実用的な検証基盤の補強

- 日付: 2026-09-13
- feature/spec: [practical-verification](../specs/practical-verification.md)
- 状態: 実装・ローカル統合検証完了。公開候補のGitHub結果は対象PRとActionsで確認する。

## 判断

利用者の記事と現行構造を照合し、既存fast-checkを業務の操作列へ広げ、独立検算と前提付きの台帳を追加する。ERP全体の証明や本番ブラウザへのSMT追加は行わない。

## 実測と修正

- 検証台帳checkerの独立レビューで未追跡ファイルの差分漏れ、未検査anchor、コードフェンス内の例を数える問題を発見し、各々を修正・回帰へ追加した。
- StrykerJS 10.0.0のVitest runnerで、逆仕訳の戻り値を破壊した変異2件が生存した。command runnerの新規プロセス＋sandbox側のworkspace解決で同じ2件が検出されることを実測した。最初の不自然な低スコアは検査品質の根拠へ採用しない。
- 一時sandboxの試験が通常Vitestに拾われることを検出し、unit/DBとlintに明示除外を追加した。
- fixtureのコード桁数、想定した拒否経路、参照テストの指数構文は試験側の問題として修正した。製品条件や期待値を緩めて成功扱いにはしていない。
- 商流の全在庫履歴、照合前/解除後の残高拒否への到達、申告packの件数/ID集合/previousId鎖、構造化エラーの照合を独立レビューから補強した。
- command runnerの初回全147変異は139検出・8生存。公開丸め方式一覧、不正明細のエラー伝播、理由文言、空の科目別集計を追加検査へ戻した。等価変異として除外したものはない。
- 補強後の再実行では145検出・2タイムアウトだった。Strykerの集計は100%でも証拠checkerが拒否することを確認した。fresh CLIの正常系起動も並行検証中に17.5秒を要したため、待機余裕を30秒＋初回時間の3倍へ設定し、全件を再実行した。最終147件はすべて実テスト失敗で検出し、タイムアウトを成功として数えない条件も満たした。
- command runnerは起動失敗もKilledと数え得るため、各結果へ対象4ファイル21試験の完走と対象試験の失敗を要求した。欠落、起動失敗、部分実行、無関係なFAIL、Unhandledエラーの負例を追加した。
- エッジの独立レビューでIPP受付時のdurable executing確認、Recover時の既存成功結果保持、TLCの反例State本文検査を追加した。DBは共通traceの全段階、端末は対応するcheckpointを検査する。
- 重い検査を並行した最初のgateでは、既存runtime catalog試験が60秒制限に達した。試験の制限や期待値を変更せず、総合検証を単独で再実行し、全819単体・639 DBの成功を確認した。

## 検証結果

| 対象 | 測定 |
| --- | --- |
| 全gate | 型/lint/依存境界、111単体ファイル819件（66.41秒）、108 DBファイル639件（869.10秒）、配布補助8件、91文書850リンク、13条件台帳すべてPASS |
| 商流・銀行・申告 | 新DB10試験・44生成例PASS、119.25秒。新全銀3試験・210生成例PASS |
| 会社・拠点・pack | 新DB3試験PASS。会社8、拠点8、pack6例で権限内観測を比較、54拒否を実行 |
| シフト | 新5試験PASS。4,096割当、固定割当2,048、生成16問題15,808割当（許可52/禁止15,756）を全探索。既知の最小欠員との差1も観測 |
| 整数参照 | Decimal4・会計2試験PASS。既存を含めmutation用4ファイル21試験 |
| 全mutation | 147 Killed（Decimal90・会計57）、生存/timeout/無被覆/error 0、9分2秒。各21試験の完走証拠と最新checkerもPASS |
| 台帳・証拠checker | 新9試験PASS。13条件の形式/参照先、変更時の再確認先抽出PASS |
| エッジ有限モデル | 全14チェックPASS、512,373異なる状態を完走、75.9秒。5ガード変異、5到達性、18/28/18状態の3共通trace。詳細は[モデル結果](../../verification/edge/RESULTS.md) |
| エッジ実装trace | 新DB3・新agent3試験PASS、既存DB8試験もPASS。実TLS/永続journal/合成IPP |
| API/Web/edge | API/Web型検査、Web/edge build PASS。Web既存の500kB超chunk警告は残る |
| 公開差分 | actionlint 1.7.12 PASS、staged差分のgitleaks 8.30.1検出0、既存production依存の解決値変更なし |
| production依存監査 | high/critical 0、既存moderate 1（下記）。依存更新は今回追加していない |

Node 22.23.2、pnpm 10.28.0、PostgreSQL 16の独立clusterとowner/app role、固定fast-check 4.9.0、StrykerJS 10.0.0、Java 21と固定TLC 1.7.4で測定した。会社/拠点比較と業務生成は別DBで開発し、全gateでは専用の統合試験DBを使う。実env・利用者データ・運用中サービスを変更しない。

[GitHub Actions](https://github.com/adokoy001/DaifukuERP/actions)では対象PRのcommitごとに通常CI、5環境の既存サービス受入、今回のmutation/TLC jobを確認する。対象headの結果とリンクはPR説明へ記録する。ローカルfixtureの成功をGitHub上の合格や本番銀行/行政/実機の受入済みと表現しない。

既存の`drizzle-kit → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild 0.18.20`に[GHSA-67mh-4wv8-2f99](https://github.com/evanw/esbuild/security/advisories/GHSA-67mh-4wv8-2f99)が残る。対象はserveのCORSで、localhostなら安全という意味ではない。installed親packageはtransform/transformSync、現行Daifukuはスキーマ生成APIを使い、対象serve経路は静的確認では未使用。runtime配布に推移依存も含むため「開発用で配布されない」とは扱わない。依存・起動経路の変更時に再評価する。今回は攻撃再現や無関係な依存更新を行っていない。

## 再現・失効・限界

[検証設計](../architecture/practical-verification.md)、[台帳](../verification/invariants.md)、[mutation手順](../../verification/mutation/README.md)、[モデル手順](../../verification/edge/README.md)を入口にする。商流の参照値は同日・税exempt・1品目/倉庫・固定価格/原価・0.25単位。銀行は逐次のJPY照合と保存出力、申告生成はFY2026の会計資料と科目名/profile/期間状態の変更。任意並行順・全税務・銀行受理・実機適合へ一般化しない。

製品src・migration・UIへの変更はない。追加依存は開発用で、業務の動作を重くする検証処理は追加しない。通常の単体/DBに加え、mutationとJavaモデル検査を独立CIで継続する。
