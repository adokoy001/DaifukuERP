# ADR-0024: 給与制度の国別providerと不変の承認版

- 状態: 採用（移行・公開の受入結果は仕様で追跡）
- 日付: 2026-09-13
- 仕様: [payroll-rule-versions](../specs/payroll-rule-versions.md)
- 関連: [ADR-0011](0011-l10n-country-packs.md)、[ADR-0013](0013-hexagonal-ports.md)、[実装地図](../architecture/payroll-automation.md)、[一次資料](../domain/japan-payroll-automation.md)

## 背景

旧実装は2026制度をworkforceのTypeScript定数で持ち、DB資料が定数と一致することを確認した後、算定器も同じ定数を参照していた。これではDBに新しい有効期間の資料を保存しても、その資料を計算入力にできない。また、旧年調のsourceは制度行全体を含むため、同じ行にmanifest等を追加すると元資料fingerprintが変わる。

年度をコードへ埋め込む方式と、旧行を変更する移行を避ける。国別の計算方式を明示し、既存資料の再検査に必要な旧形式を保持する。

## 決定

workforceは公開port `workforce.country_payroll_rules` を所有し、国・通貨で一意のproviderを選ぶ。日本provider、JSON資料、方式 `jp-regular-v1` の純粋算定器はl10n/jpに置く。`JapanModule` がworkforceに依存して登録し、workforceはl10nをimportしない。providerはDBやContextを受け取らない。

年間の通常給与bundleを導入単位にする。bundleは旧payload識別項目とmanifestを持ち、manifestはschema、package/revision、国・通貨・制度区分、税年、algorithmVersion、parameters、複数の対応期間を持つ。本番配布は既存の確認済み2026版だけとし、資料・出典配列・`verifiedOn: 2026-09-12` を変更しない。

会社のRepositoryから取得したpayloadを検証し、その値を算定器へ渡す。配布catalogは許可内容との同一性確認に使う。任意JSONやJavaScriptをアップロードする仕組みは作らない。未知schema、方式、丸めprofile、不正な表、内容hash不一致、未導入・期間外・競合を拒否する。

支払日、保険対象月、月末締切、税年、年調実施日、年齢判定日、通常年調の最終給与条件を分ける。最新年や前年への算定fallbackを行わない。画面の初期表示年度と自動算定の可否も分離する。期間の終期は製品の対応範囲を含み、法定失効日や実務手続の完了を意味しない。

## 保存と導入

既存 `workforce_payroll_rules` を保持し、承認情報は `workforce_payroll_rule_release` に保存する。migrationはcompanionの追加のみで、旧制度行への列追加、backfill、日時/version更新を行わない。旧2026行が配布内容と完全一致すれば、その行を再利用して承認記録を追加できる。

payload hashは `stableJson({ code, taxYear, data, sources, verifiedOn })`、manifest hashはparametersを含むmanifest全体のSHA-256とする。承認者・承認日時・DBのcompanion idはmanifestの外に置く。hashは同一性検査であり、公式署名や法令監修の証明ではない。

導入actionは会社指定、給与本部/admin、全社スコープ、出典の明示確認、previewのhashを再検査する。同版の再導入は冪等にし、資料とcompanionは追記専用とする。旧制度準備actionは現2026版への互換経路として維持する。読取りで暗黙導入しない。

訂正は別packageを追加する。明示した旧承認版と同じ税年・制度区分で、revisionを増やし、旧版の対応期間をすべて覆う。置換元の欠落・分岐・未解決の期間重複を拒否する。訂正版は新規算定に使用し、既存draftには再計算を要求する。確定済み結果を自動更新しない。

## 旧証跡と新証跡

旧snapshot v1の形とcanonical JSONのfingerprintを保持する。旧年調の制度行全体も変えない。旧形式として扱えるのは、配布payload・manifestとの一致を検証した現2026互換版である。`legacySnapshotSchema = 1` はその検証済みmanifestに含め、DBでflagだけを書き換えても互換扱いにしない。

新月次は `calculation.statutory.snapshotSchema = 2`、新年調は `calculation.fiscalSnapshotSchema = 2` とする。勤怠の既存 `calculation.version` とは分ける。新しい `ruleSelection` に資料id/version、package、hash、方式、対応期間を含め、companion idや承認日時を含めない。同内容の承認追加だけではv1/v2の再検査結果を変えない。

確定時は保存形式に対応するserializerで根拠を再生成して比較する。月次は制度証跡、本人条件、控除・手当、合計額を再比較し、年調はsource fingerprint、計算JSON全体、各保存金額を再比較する。同じ資料なら旧draftはv2へ変換せず確定でき、資料変更や改変なら再計算を要求する。元のJSON・確定結果を一括更新する移行はしない。

再検査に必要な旧bundleと方式は保持する。配布catalogから旧版を取り除くと、その導入資料は対応なしとしてresolverが停止する。過去結果の閲覧と新しい自動算定の対応年度は別であり、給与申告準備の年度・CSV契約もこの変更で拡張しない。

## 代替案と帰結

年次TypeScript定数を追加し続ける案では、資料追加と算定方式変更が結合したままになる。旧制度行へmanifestや承認列を足す案では、旧年調fingerprintとの互換を壊す。全snapshotを新形式へ変換する案では、既存の確定証跡を移行が書き換える。そのため、国別provider、DB入力、immutable companion、保存形式別の再検査を採用する。

この構成では資料版と方式版の両方を保守し、配布内容の審査と会社内の導入確認を分ける必要がある。同じ方式を使う将来年度は本番未登録の合成fixtureで検証し、未検証の正式値を出荷しない。検証には旧HEAD由来のgolden、旧DB復元後のmigrationとdraft確定、同内容採用、改変拒否、会社/本人/権限境界を含める。数値転記照合、計算試験、実務上の適格性確認を同一の保証として扱わない。
