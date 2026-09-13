# 給与・年末調整・勤務制度の実装地図

[給与・勤務制度仕様](../specs/enterprise-payroll.md) / [制度版仕様](../specs/payroll-rule-versions.md) / [ADR-0024](../adr/0024-payroll-rule-releases.md) / [一次資料](../domain/japan-payroll-automation.md) / [運用](../operations/payroll-automation.md)。変更範囲、不変条件、検証の入口を示す。

## 構成

以下の module 内の相対パスは `modules/workforce/src/` を基準とする。

| 層 | ファイル | 責務 |
| --- | --- | --- |
| JSON契約 | `fiscal-contract.ts`, `payroll-rules/contract.ts`, `work-system-contract.ts`, `shift-contract.ts` | Zod strict入力、制度一覧・導入確認DTO、本人/本部の表示範囲 |
| 宣言スキーマ | `entities/fiscal.ts`, `entities/payroll-rule-release.ts`, `entities/work-system.ts` | 会社/RLS/本人行制約、serverOwned、年調docstatus、制度資料と承認記録 |
| 国別port | [payroll-rules/port.ts](../../modules/workforce/src/payroll-rules/port.ts) | bundle・manifest・算定結果型と `workforce.country_payroll_rules` override |
| 日本の配布資料 | [l10n/jp/src/payroll/bundles/2026-regular/](../../l10n/jp/src/payroll/bundles/2026-regular/data.json) | 旧payloadの `data.json`、出典の `sources.json`、方式・期間の `manifest.json`、追加算定パラメータの `parameters.json` |
| 日本provider | [l10n/jp/src/payroll/provider.ts](../../l10n/jp/src/payroll/provider.ts), `schema.ts`, `catalog.ts` | 配布allowlist、入力schema・期間連続性・表順序・等級・方式・丸めprofileの検証 |
| 日本の純粋算定 | [l10n/jp/src/payroll/algorithms/regular-v1/](../../l10n/jp/src/payroll/algorithms/regular-v1/monthly-tax.ts) | 月税・社会保険・年税・控除を渡された資料からDecimalで算定 |
| 選択・導入 | `payroll-rules/resolver.ts`, `actions.ts`, `hash.ts` | 会社の導入済み資料、複数期間、一意性、内容hash、承認、訂正版の関係 |
| 給与資料 | `payroll-source.ts`, `fiscal-source.ts`, `fiscal-evidence.ts`, `year-end-source.ts` | 許可済repo経由の資料取得、本人条件、snapshot、確定給与の課税証跡 |
| 操作 | `actions/fiscal-payroll.ts`, `payroll.ts`, `year-end.ts`, `fiscal-portals.ts`, `work-system.ts` | 専用操作、版/状態/自己承認禁止、確定・取消・精算 |
| 勤務制度 | `services/work-system.ts`, `work-system-pay.ts`, `pay-calculation.ts`, `pay-types.ts` | 全日事前所定、変形/フレックス清算、既存給与への時間分類。共通入力型で計算間の循環参照を避ける |
| シフト | `shift-work-system.ts`, `shift-source.ts`, `scheduling/*` | 個人日別上限、固定所定/自由選択、他週を差し引く月/期間残枠 |

## 制度資料から計算まで

`JapanModule` は `WorkforceModule` に依存し、国別portへ `jp-regular` providerを登録する。workforceからl10nへの逆importは行わない。resolverは会社の国・通貨に一致するproviderが一つであることを要求する。provider自体はDB・Context・ネットワークを持たない。

配布catalogは導入可能な内容を検証するallowlistである。resolverは会社のRepositoryから読んだ `code / taxYear / data / sources / verifiedOn` と承認manifestをbundleとして検査し、そのDB由来bundleをproviderの `monthly / insurance / annual / validateCondition` へ渡す。算定はこのbundleのparse結果を使う。catalogの2026データへ差し替えて計算する経路はない。

本番の配布資料は `jp-2026-regular-20260912-v1` のみ。`data.json` は旧 `FISCAL_DATA` と数値・文字列の区別を含め同一で、出典配列と `verifiedOn: 2026-09-12` も保持する。旧算定コードにあった保険年齢、折半・端数条件、生命保険等の係数は `parameters.json` へ移した。manifestへ組み込まれるため、追加パラメータも版の内容同一性検査に含まれる。資料再照合日は[一次資料文書](../domain/japan-payroll-automation.md)に別記する。

hashの境界は [hash.ts](../../modules/workforce/src/payroll-rules/hash.ts) に置く。

- `payloadHash` は `stableJson({ code, taxYear, data, sources, verifiedOn })` のSHA-256。
- `manifestHash` はparametersと適用期間を含むmanifest全体の `stableJson` のSHA-256。
- `stableJson` はobjectキーを整列し、配列順序と文字列/数値の区別を保つ。旧 `sourceFingerprint` はこの正規化JSON文字列自体で、SHA-256へ変更しない。

内容hashは改変・版違いの検知に使う。公式機関の署名や、全適格条件の法令監修を示すものではない。

## 日付と選択

| 判定 | 入力・manifest | 現2026bundleの対応範囲 |
| --- | --- | --- |
| 月次所得税 | `paymentDate` → `paymentDates` | 2026-01-01〜2026-12-31 |
| 健康・介護等 | `insurancePeriod` → `insuranceMonths` | 2025-12〜2026-12 |
| 雇用保険 | 給与対象月末 → `wageCutoffDates` | 2025-12-01〜2026-12-31 |
| 年末調整 | `taxYear` と `adjustedOn` → `adjustmentDates` | 税年2026、実施日2026-12-01〜2027-01-31 |
| 年調の年齢判定 | `yearEndFactsOn` | 2026-12-31 |
| 通常年調の最終支払要件 | `requiredFinalPaymentFrom` | 2026-12-01以後の年内給与証跡が必要 |

月次は三つの期間をすべて満たす導入済み版、年調は税年と実施日を満たす版が一つの場合だけ算定する。未導入、未知方式、資料不一致、期間外、競合は拒否する。前年や最新年への算定fallbackは行わない。通常給与は月末締め、対象月末以降かつ翌月までの支払、保険対象は支払月か前月という既存の入力範囲も検査する。

年調の年内証跡集計、無支払月照合は明示された `taxYear` を使う。翌1月の2026年調対応を2027年月次給与対応と扱わない。manifestの終期はこの版の製品対応範囲であり、法定失効日ではない。所定支給日、源泉徴収票の交付状態、控除ごとの資格確認には[一次資料文書の制約](../domain/japan-payroll-automation.md#日付と製品対応期間の前提)がある。

## 導入と権限

catalog閲覧・preview・installは給与本部ロールまたはadmin、会社指定、全社スコープを要求する。店舗/拠点スコープとrelayには許可しない。新導入actionは出典確認の明示入力とpreviewのpayload/manifest hashを再検査する。旧 `initialize_payroll_rules` は現2026互換版への専用経路として残す。

旧 `workforce_payroll_rules` の列を増やさず、[migration 0015](../../apps/api/drizzle/migrations/0015_payroll_rule_versions.sql)で `workforce_payroll_rule_release` を追加する。旧行が完全一致する場合はその行を採用してcompanionだけを作り、旧行のid、version、作成・更新日時を変更しない。新規導入では資料行とcompanionを同一transactionに作る。同版の再導入は既存結果を返す。両entityは専用write capabilityと追記専用guardで一般CRUDからの改変・削除を拒否する。

訂正版は別packageと資料行を追加し、`supersedesPackageCode / supersedesReleaseId` で旧承認版を明示する。同じ税年・制度区分、増加するrevision、旧版の各対応期間を覆うことを要求し、分岐する置換や未解決の重複を拒否する。導入後の新規算定は有効な訂正版を選ぶ。旧版で計算したdraftは再検査で版違いとなり、明示的な再計算が必要になる。確定済み給与・年調・税証跡は自動変更しない。

通常のWeb/REST/MCPは同じactionを使う。`internalWrite` はprivateなserverOwned書込み権限だけを与え、role・会社・店舗・本人行制約を回避しない。一般社員の年調画面は本人申告と本人の確定結果だけを返す。年度候補も本人資料から得る。給与本部は手動課税証跡だけがある年も閲覧候補へ含めるが、`supportedTaxYears` とは区別する。未対応年度の手動証跡を登録・閲覧できても、自動算定や本人申告の新規提出を許可したことにはならない。

## Snapshotと再検査

| 保存形式 | 月次 | 年末調整 |
| --- | --- | --- |
| v1 | `calculation.statutory` に形式番号なし。制度証跡は `{ id, version, data, sources }` | `fiscalSnapshotSchema` なし。sourceに旧制度行全体を保存 |
| v2 | `calculation.statutory.snapshotSchema = 2`、evidenceに `ruleSelection` | `calculation.fiscalSnapshotSchema = 2`、sourceに `ruleSelection` |

既存の勤怠計算の `calculation.version` と制度snapshot番号は別である。`ruleSelection` はprovider、資料id/version、package、税年、payload/manifest hash、algorithmVersion、適用期間を含む。companionのid・承認日時を含めないので、同じ資料への承認記録追加だけでv2の再検査結果を変えない。

v1は配布内容と完全一致し、検証済みmanifestが `parameters.legacySnapshotSchema = 1` を持つ現2026版に限って旧serializerを使う。DB側でflagだけ追加しても配布manifestのhashと一致しない。資料・本人条件・元給与が同じなら、旧JSONをv2へ変換せず確定できる。これは計算を実行せず信用する意味ではなく、旧形式で根拠と金額を再生成して比較し、保存済みの計算JSONを書き換えないという意味である。

自動月次は本人条件3種類（支払日/保険月末/締切日）、制度選択、控除・手当、支給・控除合計・差引を再比較する。従来の外部確認給与には `statutory` を付けない。給与確定と課税証跡の作成は同じtransactionで行う。年調は元資料fingerprintに加えて計算JSON全体と保存金額を再比較する。未知snapshot番号や改変を受け入れない。

給与・制度をまたぐ算定/確定は `workforce:policies` → `workforce:employee:<id>` の順で直列化する。年調申告は submitted → accepted/returned、計算書は draft → confirmed → cancelled。confirmedのみ本人へ公開し、実精算後の取消は拒否する。過去の給与を年調金額で上書きしない。旧勤務制度や年調書類の保存siteIdは履歴値、参照スコープは現在の社員を親にする。

再検査に必要な旧bundleとalgorithmを配布catalogに保持する。導入済み資料に対応する配布版がなければresolverは停止する。任意snapshotを自動再計算する機能や、確定済み資料を新版へ移す機能は設けない。給与申告準備の対応年度・CSV仕様は別契約として維持する。

## 変更時の検証

制度の追加では新しい資料・期間・出典・方式を明示し、既存bundleを上書きしない。同じ方式で扱える変更は資料追加で扱い、方式が変わる場合は対応algorithmを追加する。2027年以降の正式値を外挿しない。将来年度の試験資料は本番catalogへ登録しない。

- `l10n/jp/test/payroll-calculation.test.ts`：移設前からの金額・年齢・端数境界。
- `l10n/jp/test/payroll-provider.test.ts`：旧payload hash一致、合成年度・変更パラメータの反映、schema/方式/期間/allowlist拒否。
- `l10n/jp/test/payroll-rules.db.test.ts`：会社内導入、承認の不変性、同内容採用、期間境界、競合、合成訂正版・将来年度。
- `modules/workforce/test/fiscal-*`, `payroll.db.test.ts`, `work-system-*`, `shift-work-system.test.ts`：業務状態、勤怠・本人条件・年調の既存不変条件。

旧HEADで生成した給与/年調/課税証跡・申告準備資料を使い、migration後の旧draft確定、confirmed保存値、同bundle採用前後、改変拒否を検証する。旧結果を新算定器から生成して互換の根拠としない。共通API/MCP、Web、移行、全gateの受入結果は[制度版仕様](../specs/payroll-rule-versions.md)で追跡する。
