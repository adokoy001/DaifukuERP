# POS連携・連結精算表・FC精算の業務根拠

確認日: 2026-09-12。実装範囲は [仕様](../specs/enterprise-commerce.md)。業務フローと提供APIの根拠を区別する。

## POS

[Squareの署名検証](https://developer.squareup.com/docs/webhooks/step3validate)は署名鍵、登録通知URL、raw bodyからHMAC-SHA256を作り、定時間で比較する。リクエストhostから通知URLを推測しない。[Squareの配信仕様](https://developer.squareup.com/docs/webhooks/overview)では順序保証がなく、重複配信と最大24時間の再試行を想定するため、eventIDだけでなく決済/返金の外部IDでも冪等性を持たせる。

[payment.updated](https://developer.squareup.com/reference/square/payments-api/webhooks/payment.updated)と[refund.updated](https://developer.squareup.com/reference/square/refunds-api/webhooks/refund.updated)の型と完了状態を使用する。Webhookの決済総額は税率別売上や品目数量の証拠ではない。初版は決済仮勘定へ転記し、別の売上明細取込と重複して売上計上しない。

国内先行例として[スマレジ公式POS API](https://developers.smaregi.dev/platform-api-reference/apis/pos/)は契約IDを含むAPI境界と店舗/取引取得の独立した型を設ける。Daifukuでも外部merchant/locationと内部会社店舗の明示mappingを要求する。スマレジadapter自体は今回未実装。

## 連結精算表

[ASBJ企業会計基準第22号](https://www.asb-j.jp/jp/wp-content/uploads/sites/4/spc20260602_06.pdf)は、企業集団を単一組織体として扱い、投資と資本、会社間債権債務・取引の相殺等を定める。[資本連結の実務指針](https://www.asb-j.jp/jp/accounting_standards_system/details.html?topics_id=135)は別途複雑な資本連結手続きを扱う。単体試算表を足すだけで法定連結財務諸表ができたとは表現しない。

今回の実装は同一通貨の管理用連結精算表。科目マッピングと期末残高を固定し、人が確認した貸借一致の消去調整を別台帳へ追加する。個社帳簿の修正、支配判定、持分法や税効果の自動算定、正式開示帳票は範囲外。取得元の会社権限を失った利用者に、保存済みsnapshotから個社情報を再公開しない。

## FC精算

[OBIC公式FC管理](https://www.obic.jp/project/proformas/fc_management/01.html)はロイヤリティ計算、請求/精算、立替金等から会計へつなぐ流れを示す（公式検索結果を確認、本文取得は失敗）。[ドトールの公式加盟契約資料](https://www.doutor.co.jp/business/fc/pdf/fc_dcs.pdf)には税抜売上高を基準に月締め請求する実例がある。料率や基準は加盟契約ごとであり、これらの商品/契約条件をシステム共通値にコピーしない。

Daifuku初版では契約に売上基準、率、定額、端数規則、課税区分、有効期間を明示する。売上申告の税込/税抜は確認資料から取得し、決済総額から推測しない。税率は既存の期間付き税マスタを請求日で解決する。相手会社への二重側仕訳生成やオープンアカウント全精算まで対応とは表示しない。
