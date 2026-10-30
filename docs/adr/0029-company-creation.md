# ADR-0029: 会社の作成はテナント管理者の要求の中で行い、module の初期データ投入だけを同じトランザクションの system context で実行する

- 状態: 採択
- 日付: 2026-10-30
- 関連: [マルチテナントと RLS](0004-multitenancy-rls.md)、[認可](0007-authorization.md)、[ポートとカスタマイズ層](0013-hexagonal-ports.md)、[会社と店舗の権限](0018-company-and-store-access.md)、[設定の表示属性](0027-setting-presentation.md)（`company.profile`）、[受入基準](../specs/company-admin.md)

## 背景

最初の会社とテナント管理者は `pnpm run setup install`（`bootstrapTenant` を owner 接続で実行し、続けて module の `seed` を会社ごとに system context で実行する）が作る。2 社目以降を作る画面・API は無く、開発用の `db:reset` や業界デモの準備（owner 接続で `companies` に直接挿入）に頼っていた。会社の作成を要求経路に置くには、次を決める必要があった。

- 誰が作れるか（会社の `admin` か、テナント管理者か）。
- `companies` への挿入を、要求が使う app role（RLS あり、BYPASSRLS なし）で行えるか。行えないなら owner 接続を要求経路に持ち込むことになる。
- 新しい会社の初期データ（勘定科目・税率・会計年度・倉庫など、module の `seed`）を、誰の権限で、どのトランザクションで入れるか。`systemContext()` は移行と seed 専用という規約（CLAUDE.md 規約 2）との関係。

## 確認した事実（2026-10-30、コードと DB 試験）

- `companies` は tenant の RLS policy（`for all`、`using` と `with check` が `tenant_id = app.tenant_id`）を持ち、`enforcePolicies` が app role に `SELECT, INSERT, UPDATE, DELETE` を与えている（`kernel/src/db/migrate.ts`。除外は `tenants` と `identity_rate_limits` だけ）。したがって要求のトランザクション（`withContext` が `app.tenant_id` を設定済み）から、**自テナントの会社行を app role で挿入できる**。別テナントの `tenant_id` を持つ行は `with check` で拒否され、別テナントの会社は読めない（`kernel/test/company-admin.db.test.ts` の RLS 試験）。
- `companies.tenant_id` の外部キー先 `tenants` は RLS 対象外で、app role には権限が無いが、PostgreSQL の外部キー検査は参照先表の所有者の権限で行われるため、app role の挿入は成功する（同じ試験で確認）。
- `user_company_memberships`、`audit_log`（INSERT のみ）、module の表も app role で書ける。

よって owner 接続を要求経路へ持ち込む必要は無い。setup と owner 接続の共有は行わない。

## 決定

1. **kernel の `createCompany(ctx, input, { modules? })`**（`kernel/src/company-admin.ts`）が、呼出し元のトランザクション（API では要求の `withContext`）の中で次を順に行う。
   1. `assertAccessAdmin(ctx, true)`: 有効なテナント管理者で、所属が店舗・拠点限定でないこと（`users` 表を読み直す。JWT の属性だけに頼らない）。テナント単位の access-admin advisory lock で、利用者管理と会社作成を直列にする。
   2. 入力の検証（`code` は `^[A-Z0-9_-]{1,20}$`、テナント内で一意。`country` は ISO 3166-1 の 2 文字で既定 `JP`、`currency` は ISO 4217 の 3 文字で既定 `JPY`）。重複は一意索引に任せず、lock の下で先に調べて検証エラーにする。
   3. 会社行の挿入（app role、RLS の `with check` を通る）。
   4. 作成者（agent の場合は代理元の利用者）の所属 `roles: ['admin']`、`accessScope: 'all'`。作成者に既定の会社が無ければこの会社にする（`putCompanyMembership` と同じ扱い）。
   5. 監査: `company`（op `create`、変更後に会社の公開属性）と `company_membership`（op `create`）。どちらも新しい会社を `companyId` として記録する。
   6. **初期データ**: `modules` の順に各 `seed` を、**同じトランザクションのまま** `makeContext(ctx.db, systemParams(tenantId, 新会社 id))` で実行する。API は setup・`db:reset` と同じ runtime の module 一覧（`apps/api/src/modules.ts`）を渡す。省略時は `registry.allModules()`（登録順＝依存順）。
2. **system context の範囲**: 新しい会社に対しては、作成者の所属が作られた直後でも業務ロールの組合せが決まっておらず、seed は「会社が空のときに既定のマスタを入れる」処理で、利用者の権限で行う操作ではない。そこで seed だけを system context（actor `system`、ロール `admin`）で実行し、seed が書く記録の監査は actor `system` になる。これは規約 2 の「seed 専用」の範囲内であり、要求の残りの処理（会社行・所属・監査）は要求の context のまま行う。seed 以外の処理に system context を使うことはしない。
3. **原子性**: どれかの seed が失敗したら `StateError`（module 名と原因、元の kernel エラーの本文を `details` に含む）を投げ、会社行・所属・監査・それまでの seed の書込みをすべて巻き戻す。setup の「module ごとに確定して checkpoint」とは異なる: setup は中断後の再開を、会社作成は「作れたか、何も残らないか」を優先する。
4. **編集**: `updateCompany(ctx, id, { name?, country? })` は会社行を `FOR UPDATE` で読み、監査 `company`（op `update`、変更前後）を書く。`code` と `currency` は作成後不変で、本文に含めると検証エラー（変更しない値でも拒否）。会社の削除・無効化は提供しない。
5. **一覧**: `listCompanies(ctx)` はテナントの全会社（コード・名称・国・通貨・作成日時）と、呼出し元の所属の有無を返す。テナント管理者だけ。
6. **API と画面**: `GET / POST /admin/companies`、`PATCH /admin/companies/:id`（`apps/api/src/routes/company-admin.ts`）。権限の判定は kernel が行い、route は context を渡すだけ。画面 `/admin/companies` は作成後に「切り替えて会社プロフィールを入力／会計年度を確認」を出し、切替は会社ピッカーと同じ経路（保存した選択＋ページの再読込）を使う。

## 却下した案

- **会社の `admin` にも作成を許す**: 会社の業務ロールはその会社の中の権限で、テナントの構成（会社の数・コード）を変える権限ではない（ADR-0018）。利用者管理と同じテナント管理者に揃えた。
- **owner 接続で会社行を挿入する（setup と同じ経路）**: RLS で足りることを確認したので、要求経路に BYPASSRLS の接続を持ち込む理由が無い。owner 接続はログイン照会・移行・setup に限る（ADR-0004）。
- **seed を作成者の context で実行する**: seed は勘定科目・税率など各 module の表へ書き、作成者の会社ロールが決まる前に走る。作成者を `admin` にした直後なので権限上は書けるが、監査上「利用者が勘定科目を 1 件ずつ作った」記録になり、setup・`db:reset` で入った会社の記録（actor `system`）と食い違う。
- **seed を module ごとのトランザクションに分ける（setup と同じ）**: 失敗時に「会社はあるが税率だけ無い」状態が残る。画面から作る会社では、やり直しのために会社を消す手段（削除）が無いので、全体を 1 トランザクションにした。seed は冪等なので、将来 setup と同じ再開方式に変える余地は残る。
- **`companies` に住所・登録番号などの列を足す**: 移行が要り、項目の追加のたびに表を変えることになる。会社の基本情報は kernel が登録する設定 `company.profile`（ADR-0027 §6）として `companies.settings` に置いた。

## 結果

- テナント管理者は画面・API から会社を作れ、新しい会社には setup と同じ初期データが入る（見本の取引先・品目も入る点は setup と同じ）。
- 会社作成の要求は、全 module の seed を 1 トランザクションで実行する。この開発コンテナで、API の DB 試験の作成要求は 0.4 秒前後だった（seed は 7 module。2026-10-30 の測定）。
- 業界テンプレートは作成時には選ばない（作成後に「業界テンプレート」画面で適用する。将来のセットアップウィザード B4 で案内する）。

## 検証

- kernel の DB 試験 `kernel/test/company-admin.db.test.ts`: 作成（会社・所属・seed が system context で新会社に対して 1 回・監査）、既定の module 一覧、テナント管理者以外・無効・店舗限定の拒否、コードの検証と重複、更新の監査と不変項目、一覧、seed の失敗で全体が巻き戻ること、RLS とテナント分離（別テナントからの一覧・更新・挿入・読取）。
- API の DB 試験 `apps/api/test/company-admin.db.test.ts`: 実際の module 一覧で勘定科目・税率・会計年度・倉庫が入ること、会社ピッカーへの反映、403 / 400 / 404、`company.profile` が会社タブの先頭、請求書の発行者の解決。
- ブラウザ試験 `apps/web/e2e/company-admin.spec.ts`。
