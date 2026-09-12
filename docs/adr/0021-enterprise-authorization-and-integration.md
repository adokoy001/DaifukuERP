# ADR-0021: 会社横断業務の認可とトランザクション

日付: 2026-09-12。状態: accepted。仕様: [enterprise-operations](../specs/enterprise-operations.md)、[enterprise-commerce](../specs/enterprise-commerce.md)。

## 問題

連結資料には複数会社の会計が含まれる。呼出元の本部 role を会社 ID だけ変更して流用すると、異なる会社への権限昇格や退職・所属解除後の閲覧が起きる。モジュールから DB や owner 接続を直接触る方式は採用しない。

## 決定

kernel の `authorizedCompanies(ctx)` は同一 tenant の現時点で許可された会社名一覧だけを返す。`withAuthorizedCompany(ctx, companyId, work)` は有効ユーザー、sessionVersion、現在の tenant 管理者状態と会社所属、全拠点 scope を確認し、同じ transaction 内に子 Context を作る。user と membership は SHARE lock で更新・削除との競合を直列化する。社員代理 agent は onBehalfOf を再確認し、利用者のない system/agent は拒否する。

子 Context は対象会社の最新 roles と設定済み pack、元の audit actor/requestId/locale/時計を持つ。親の内部書込 capability は引き継がない。業務モジュールは対象会社ごとに entity の read/export 等を通常どおり検査する。会社名一覧は会計内容の読取許可を意味しない。店舗・拠点限定 Context はこの port を利用できない。

## 結果と検証

会社横断読取・生成物への書込を一つの transaction に保ち、失敗時は全体を rollback する。退職、所属削除、role 変更、session 失効、別 tenant、限定拠点、agent 委任、子 Context の監査と rollback を DB テストで確認する。連結 snapshot の保存後も、各対象会社への認可を毎回再確認する責任は業務モジュールにある。
