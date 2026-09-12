# module・packの拡張手順

[全体像](README.md) / [pack規約](../conventions/packs.md) / [層の規約](../conventions/layers.md)

## どの層へ置くか

| 変更 | 置く場所 | 避けること |
| --- | --- | --- |
| 全業務に共通の権限/型/トランザクション機能 | kernel + ADR | 特定業種の名前をkernelの条件分岐へ足す |
| 複数業界で使う取引や従業員の業務 | modules | packから同じロジックをコピーする |
| 日本制度の定義・帳票・有効期間 | l10n/jpまたは制度対象moduleの明示設定 | 税率・保険料率を全国一律の定数にする |
| 業界固有項目、完了条件、初期値、メニュー | packs | coreの業務actionを書き換える |
| HTTP/MCP/画面での入力・表示 | apps | adapterだけに承認・金額計算・認可を置く |

## 1機能を追加する順序

1. `docs/specs/` に入力、結果、権限、状態、対象外、検証方法を書く。
2. 必要なentity/documentをDSLで定義し、field、ref、unique、serverOwned、role、行/拠点policyを宣言する。
3. 業務actionを作り、ContextとRepositoryだけを通して処理する。数量/金額はDecimal、二重処理はbusiness lockと一意性、競合はexpectedVersionで扱う。
4. 公開indexから必要な型/定義だけをexportし、package名で依存する。内部ソースへ相対importしない。
5. 共通moduleはruntime catalog、業界packはruntime pack catalogへ追加する。schema生成時は全登録packを読み、runtimeで無効なpackの既存データも保持する。
6. メタデータで汎用UIを使うか、連続した操作に適した専用画面を作る。どちらも同じactionを呼ぶ。
7. migrationを生成・確認し、新規DBと旧版DBからの更新を試す。
8. 拒否/並行実行/再適用を含む試験と文書を整え、gateを通して作業ログを残す。

## packの契約

登録されていることと、会社で適用済みであることは別です。会社別適用を確認しないままpackのentity/actionを使わせません。初期設定を再適用しても業務伝票や確定状態を消さないようにします。

固有性はカード名だけで表現しません。対象業務、固有項目、完了条件、sampleと再現可能な台本を持たせます。共通の案件処理をfactoryで再利用しても、各packの入力/完了条件/制約は独立に確認します。

新しい拠点限定entity/actionは境界を明示します。共通参照をsharedReadにする場合も、その項目が給与・個人情報を漏らさないことを確認します。集計/CSVのexport元entityを宣言し、現在の権限を再照合します。

## 追加時のチェック例

「拠点の申請を承認する」機能なら、正常承認だけでなく、別会社、別拠点、本人の申請、無効利用者、古い版、二重承認、汎用CRUDでの承認状態偽造、MCP代理での自己承認、CSV/監査の漏れも確認します。テスト対象は実際の契約であり、実装と同じ式を書き写すだけにしません。

機能を公開する前に [文書の管理方法](documentation-contract.md) に沿って地図・規約・操作手順を更新してください。
