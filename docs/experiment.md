# 実験の仮説と計測（PLAN.md §1, §8 の要約）

| # | 仮説 | 指標 | 中止/見直し基準 |
|---|---|---|---|
| H1 カーネル仮説 | DSL主導カーネル上で、モジュール追加の単位コスト（トークン・人手修正行・spec→マージ時間）はモジュール数が増えても増えない | `metrics/features.jsonl` をモジュール順に並べる | 単調増加なら Phase 2 に進まずアーキテクチャ見直し |
| H2 境界仮説 | 機械ゲートにより、コード量10倍でも escaped defect 率・change failure rate は横ばい | 週次 `metrics/weekly.jsonl` | — |
| H3 縦パック仮説 | 業種パックはコア改変 <5%（コア差分行 / パック差分行）で追加できる | パック実装期間の git diff 集計 | 超過なら拡張点設計をやり直す |
| H4 審査仮説 | 人間審査は1機能30分以内に収まる | `human_minutes` | 破綻点を成果として記録 |

LOC は参考値。評価軸にしない。

## 記録単位（features.jsonl の1行）
```json
{"date":"2026-09-10","feature":"partner-crud","module":"partner","phase":0,"tokens":123456,"tokensEstimated":false,"agentMinutes":40,"humanMinutes":10,"reworkLines":12,"gateFailures":2,"locAdded":800,"locGenerated":0,"testsAdded":14,"notes":"..."}
```
`tokens` は把握できる範囲で（サブエージェント分を含む）。不明なら null と書き、推定なら `"tokensEstimated": true`。開発・審査所要時間、リワーク、ゲート失敗回数も未測定ならnullとする。`humanReviewStatus: "not_reviewed"` は人間の業務審査が未実施であることを表し、`humanMinutes: null`（所要時間未測定）と区別する。キーは camelCase（scripts/metrics-add.mjs が `--agent-minutes` を `agentMinutes` に変換する）。過去の行は当時の計測・記述として保持し、後続の訂正・追補で解釈を明示する。

## 過去時点の観測（2026-09-11の履歴）

以下は当時の記録であり、現在の品質・審査済み状態を表さない。2026-09-12の基盤レビューでは整合性・権限・同時更新・履歴等の不具合を発見し、`81b6124` までに修正した（[基盤補強仕様](specs/foundation-refresh.md)、[業務基盤ログ](log/2026-09-12-domain-foundation.md)）。
- H1/H5(a): partner（前例あり）10 分・ゲート失敗 2・578 行 vs product（新規コンテキスト、docs＋kernel のみ）11 分・2・572 行。マスタ 1 本はほぼ同コスト。複雑モジュールは sales 32 分／purchase 23 分／payment 35 分（いずれもゲート失敗 4〜5）。判定はまだ保留。
- H2: 当時はコード約11k→28k行でgate通過と記録され、統合時の旧テスト期待値更新は6件だった。当時の「escaped defect 0」は運用も測定もない状態の記載であり、欠陥0件の実測ではない。後日のレビューで不具合が見つかったため、現在のescaped defect数・率は未測定（null）として扱う。
- H3: 台本 1 か月を l10n/jp（override 2 点＋seed）だけで満たし、コア改変ゼロ。ただし台本の要求は薄い。
- H4: 当時のfeatures行はhumanMinutes=0と記録されているが、利用者による審査が未実施だったことを表していた。人間が0分で審査を完了できたという測定ではない。H4の測定は未開始。

## H3追補: 3業界初版（2026-09-12の計測スナップショット）

観測対象は `feat/industry-templates`、起点は基盤レビューと不具合修正後のコミット `81b6124`。計測時刻は2026-09-12 10:14 JST（01:14 UTC）。既存の `kernel/src/**`・`modules/**`・`l10n/**` はgit diffで追加0行・削除0行、未追跡ファイルも0だった。前段の基盤補強費用・変更行数はこの期間のコア0行に含めていない。

| 業務固有source | TSファイル数 | 物理行数 | focused DB回帰 |
| --- | ---: | ---: | ---: |
| `packs/farm/src/**/*.ts` | 16 | 475 | 9件通過 |
| `packs/restaurant-chain/src/**/*.ts` | 20 | 562 | 11件通過 |
| `packs/appliance-store/src/**/*.ts` | 12 | 363 | 10件通過 |
| 合計 | 48 | 1,400 | 30件 |

物理行は空行・コメントを含む。テスト・文書・package設定・lockfile・生成migrationは分母に含めない。3packは新設のため、この範囲の既存ファイルとの差分行数とsource総行数が一致する。H3のこの定義では `(コア追加0 + 削除0) / パック追加1,400 = 0%`。既存ポートで今回の限定シナリオを表現できた観測であり、全業界対応・工数低下・H1の成立を示すものではない。

共通導入機能は別枠で追加している。業界一覧・適用、会社選択と切替時の画面/要求の分離、汎用action画面、デモ会社初期化、runtime登録などが該当する。下表は同じ起点から計測時点の `apps/{runtime,api,web}/src/**` の変更で、src内の `.test.*`/`.spec.*` は除外し、新規ファイルは全文を追加として数えた。

| 共通統合source | 追加 | 削除 |
| --- | ---: | ---: |
| runtime | 3 | 0 |
| API | 62 | 0 |
| Web | 351 | 14 |
| 合計 | 416 | 14 |

共通統合のテスト・E2E・migration・package設定・文書も別途変更されているが、このsource表には含めていない。「既存コア0行」はこれらの追加作業が不要だったという意味ではない。全体gateと統合UIの検証はこの計測時点では進行中で、成功を未記録としている。その後の最終確認で全gate（unit393 / DB343）と全E2E13、Web型/buildが通過した。[STATUS](STATUS.md) と [統合ログ](log/2026-09-12-industry-templates.md) を参照する。

トークン、開発所要時間、人間審査所要時間、feature全期間のゲート失敗回数・リワーク行数は未測定（null）。人間の業務審査は未実施。AIレビューでは電器店の数量既定値と計算額の不一致を実測し、数量省略→完了→請求と部分更新の回帰を追加して修正した。これを人間の操作性評価や運用後欠陥率の測定で代用しない。

根拠: [農家ログ](log/2026-09-12-pack-farm.md)、[飲食チェーンログ](log/2026-09-12-pack-restaurant-chain.md)、[電器店ログと数量省略の追補](log/2026-09-12-pack-appliance-store.md)。測定値は `metrics/features.jsonl` に同じ範囲・時刻で追記した。

最終整形で飲食店sourceの末尾空行10行を除去したため、コミット時の同範囲は農家475・飲食店552・電器店363、計1,390行。上表と4件のmetricsは01:14 UTCの計測履歴として保持し、最終validation行に整形後の値を記録した。基盤変更0行・機能と検証結果は変わらない。
