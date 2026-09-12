# 権限と分担の境界

[全体像](README.md) / [ADR-0007](../adr/0007-authorization.md) / [ADR-0018](../adr/0018-company-and-store-access.md)

## 許可の積み重ね

操作できるかは、認証済みであることだけで決まりません。次の制約をすべて満たします。

```text
有効なセッション
AND 選択会社への現在の所属
AND roleが許可するoperation/action
AND 対象業界packの会社別適用
AND tenant/companyの一致
AND 担当拠点の一致
AND 本人などの行条件
AND 読める/書ける項目
AND 業務状態・承認・版の整合性
```

[company-access](../../kernel/src/company-access.ts) は選択会社への所属を解決します。[permissions](../../kernel/src/permissions.ts) はoperation、rowRules、fieldGroupsを扱い、[Repository scope](../../kernel/src/repository/scope.ts) はtenant/companyと担当境界を組み合わせます。

## roleとscope

roleは「何をするか」、scopeは「どこまで届くか」です。複数roleを持っても担当範囲をallへ広げません。adminの高い権限も、明示的な拠点制約を取り除く仕組みにはしません。

従来の `stores/storeIds` は飲食チェーンの店舗境界です。従業員機能は業界非依存の拠点を対象にし、同じ店長がチェーン運営と労務を担当できるよう明示した割当を扱います。全社のHR/給与と、担当拠点のmanager、本人のemployeeを分けます。詳細な新規契約は [workforce-platform](../specs/workforce-platform.md) にあります。

rowRulesは許可されたrole間でORされます。本人限定entityへ制限なしの閲覧roleを安易に追加すると他人の行を読めるため、ロール追加時は合成roleも試験します。拠点条件はこのORの外側でANDされます。

## 内部項目の公開境界

`hidden: true`は汎用画面での表示設定です。値をAPIから秘匿する指定ではありません。`serverOwned: true`は書込権限、fieldGroupsは利用者ごとの読取制約を扱い、用途が異なります。

`outputHidden: true`は保存先キーなど、管理者を含めて公開しない内部項目に使います。[public-output](../../kernel/src/public-output.ts) が汎用CRUD・明細の応答と監査の保存/読取から除去し、公開JSON schemaとmetadataにも含めません。既存の監査snapshotも読取時に除去します。フィルタ・並べ替え・集約・グループ化でこの項目を指定すると拒否し、汎用検索対象にも含めません。登録extの指定にも同じ境界を適用します。

サーバー内部のRepository.get/listが返す行は値を保持し、証憑downloadなどの正規処理に使えます。独自action/reportが任意の別名やJSONへ写して返す場合は、moduleが公開DTOを明示して内部値を含めない責任を持ちます。`outputHidden`はデータベース暗号化や任意の独自DTOの自動検査を行う機能ではありません。

## 認証情報の寿命

JWTは利用者を識別する情報です。所属や権限を長期間固定して信頼しません。RESTとMCPは現在の利用者、会社所属、sessionVersionを再確認します。無効化や権限変更後に古い画面が表示されていても、次の操作は現在の権限で検査します。

テナント管理者は利用者と所属を管理する強い権限を持ちます。通常の店舗運営担当に付けません。自分の権限変更や最後の有効な管理者を失う操作は管理APIが拒否します。

本人のパスワード変更と全端末ログアウトは、会社ではなく認証済み本人を対象にします。現在パスワードの検証、sessionVersion更新、監査記録を同じトランザクションで処理し、並行操作でも失効済みの認証を通しません。[操作とAPI契約](../operations/account-security.md) を参照してください。

## 各入口の確認項目

| 入口 | 境界を守る場所 | 回帰で確かめること |
| --- | --- | --- |
| list/get/search | Repository scope + row filter | IDを知っていても他社/他拠点/他人へ届かない |
| create/update | 参照先の所属・serverOwned・版 | 別user/siteへ移す入力、承認状態の偽造を拒否 |
| action | runAction + business guard | 自己承認、二重処理、状態/期限の変化を再確認 |
| CSV/集計 | export権限 + 元行の条件 | 非表示行の件数・合計・給与を推定できない |
| audit/添付 | 元行の可視性 + field制約 | 過去値や証憑で通常の非表示項目が漏れない |
| UI | meta + roleに応じた導線 | サーバー側の拒否を見える形で扱い、旧会社のデータを残さない |

## 失敗時の設計

未宣言の境界は拒否します。所属0件や担当リスト空を全社アクセスへ読み替えません。権限を通すために `systemContext()`、roleの書換え、owner接続による業務readを加えません。systemContextはmigration/seed用です。

承認では申請者と処理者を実ユーザーIDで比較します。MCP代理操作ではactor.onBehalfOfも扱い、AI名へすり替えて自己承認を通しません。給与は下書きと本人公開済み明細を区別し、拠点管理者というだけで金額への閲覧を許可しません。
