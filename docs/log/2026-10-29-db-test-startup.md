# 作業記録: 2026-10-29 db-test-startup（DB suite 起動の短縮と light の DB 選択）

- セッション: A3 実装（Opus 5.5、worktree `wip/db-test-startup`、基準 `ebc7574`、他エージェントと同居する 4 CPU の一時 container、試験 DB `daifuku_test_w1`、18:37〜UTC） ／ 担当: agent ／ 対象: [docs/specs/db-test-startup.md](../specs/db-test-startup.md)
- 計測: tokens=null（未計測）, agent_minutes=約 140（18:37〜20:55 UTC。全 DB suite 3 回・light 5 回の計測待ち約 90 分を含む）, human_minutes=0, rework_lines=0（初回の実装。初回 commit `299ba76` の差分は 17 ファイル +1,483 / −48 行で、文書と試験を含む）, gate_failures=0（light 5 回はすべて成功。開発中の unit 試験の失敗 1 件は gate の実行ではない）。レビュー指摘の修正は末尾の節に別に記す

## 決めたこと（と理由）

- **先に測った。** `freshDb()`・`dropAll()`・`runMigrations()` に一時的な計時（commit していない）と vitest reporter（`TestModule.diagnostic()`）を入れて全 116 suite を実行した。schema の作り直しは全体の 27%（232 / 862 秒）、freshDb の 106 suite では 26%（193 / 753 秒）で、計画の判断基準「50% 超」には届かなかった。それでも実装したのは、残りが試験本体（48%）と import（21%）で、試験を変えずに減らせる固定費は schema が最大だからである。light の sales 変更（65 suite）では freshDb の schema が 26%、migration/setup suite が 13〜17% を占めた。計測表は spec に載せた。
- **同じ名前の試験 DB を作り直す方式にした。** suite ごとに別名の DB を作る案は、`apps/mcp/test/stdio.db.test.ts` が `OWNER_URL` / `APP_URL` を子プロセスに渡すため使えない（ソース確認）。`DROP DATABASE <試験DB>` → `CREATE DATABASE <試験DB> TEMPLATE <テンプレート>` で、試験からは従来と同じ DB 名・同じ URL に見える。
- **鍵は「schema を作る全文」のハッシュ。** registry の DDL（drizzle-kit の差分、従来と同じ生成）、`dropAll` の文、`enforcePolicies` の文を `migrate.ts` から列挙して鍵に入れた。RLS・grant・trigger の文を変えれば鍵が変わる。DSL の構造から自前の指紋を作る案は、DDL に効く属性の取りこぼしが黙って古いテンプレートを使わせるため採らなかった。drizzle-kit の読込（約 0.5 秒）は従来どおり残る。
- **テンプレートは template1 の新しい複製の中で作る。** 試験 DB から複製すると、繰り返しの作り直しで肥大した system catalog まで写り、kernel だけの registry でも 49 MB になった（実測）。template1 の複製で作ると 8.6 MB（全 module でも 21 MB）で、複製（WAL_LOG）も速い。試験 DB の encoding・locale が template1 と違うとき、または public / drizzle 以外の schema・plpgsql 以外の拡張があるときは、従来の作り直しが残す物を変えないよう試験 DB の中で作ってその DB を複製する（レビュー指摘の修正で変更: 余分な物があるときは複製もテンプレート作成もせず従来の作り直しに戻る。末尾の節）。
- **安全側の条件。** テンプレート経路は (1) owner / app の URL が同じサーバー・同じ DB で query なし、(2) DB 名が `test` を含む小文字の識別子、(3) owner が CREATEDB を持ち試験 DB を所有、(4) DB 単位の ACL・設定・接続上限なし、template1 と同じ tablespace、のときだけ使う。作り直すと失われる DB 属性があるときは従来の作り直しに戻る。作成・削除するのは試験 DB と、`<db>_tpl_<16桁>` の名前で同じ試験 DB 名と鍵を持つ印（`COMMENT ON DATABASE`）付きの DB だけ。他の試験 DB（`daifuku_test_w10` など接頭辞が重なる名前）や印の無い DB は年齢切れの削除対象に入らない（unit 試験と、実サーバーに囮 DB を作る DB 試験で確認）。テンプレートは `ALLOW_CONNECTIONS false` にして誤って書き換えられないようにした。
- **中断への備え。** `DROP` と `CREATE` の間で止まって試験 DB が無いときは、次の `freshDb()` が同じ試験 DB の自分のテンプレートから作り直す。テンプレート作成の途中で止まってコメントが無い DB は、名前に現在の鍵が入っている（この harness しか作らない）ので削除して作り直す。他のセッションが試験 DB に残っているときは 15 秒待ち、残れば削除せずに従来の作り直しに戻る（レビュー指摘の修正で変更: 待つのはこの harness の接続だけで、psql などの他のクライアントがいれば待たずに戻る）。`DROP DATABASE ... WITH (FORCE)` は他の role の接続を切れず、他人の接続を切る操作にもなるため使わない。
- **`synchronous_commit = off` や 1 transaction 化は採らなかった。** 1,563 文の DDL は 1.9〜2.2 秒で、どちらでもほぼ変わらなかった（試作で実測。fsync ではなく catalog 処理が律速）。
- **上限は 80 件。** 全 suite の 1 回の実行で約 59 種類の registry 構成（鍵）を使った（実測。DDL 文数での見積り 41 より多い）。最初の上限 48 では cold 実行の途中で古いものが追い出され、次の実行で作り直しが起きた。80 にして、合計約 0.7 GB（1 件 8〜21 MB）を目安として CONTRIBUTING に書いた。
- **light の migration/setup suite（test-tiers の選択肢 (b)）。** 実施の根拠は、統括セッションのワークフローが生成した round 2 の作業項目文（2026-10-29。A3 を「DB test harness + light selection」と記す）である。[完成度向上の実装計画](../completion-plan.md) の A3 には書かれておらず、利用者の承認でもない（レビュー指摘で訂正。当初「計画の作業項目で実施が指示された」と書いたのは不正確だった）。test-tiers は (b) を利用者の承認待ちとしていたため、受け入れるかは spec の未決事項に残し、修正で `GATE_DEFER_SCHEMA_SUITES=0` による無効化を足した。対象は「試験か同じディレクトリの補助ファイルが `runMigrations(` を呼ぶ DB suite」とソースから判定する（`runMigrations(` を自分で呼ぶのは 6 件で、4 件は `./legacy-fixture.ts` 経由。test-tiers が挙げた 9 件に `industry-templates` を加えた 10 件）。これらはモジュールグラフ上は全 module に依存するが、検証の中心は migration・registry と migration の一致・旧 fixture・setup であるため、schema 宣言（`defineEntity(` / `defineDocument(` / `definePack(` / `registerSystemTable(`）を含む変更、同じ package の schema 宣言が import するファイル（`UNIT_STATUSES` のような enum 値。vitest の Vite server で package 内だけ辿る）、`apps/api` 内の変更があるときだけ実行し、それ以外は full に回して報告に `deferred` と hint を出す。migration・kernel・`apps/api/src/db` などは従来どおり昇格で DB 全件。quick・full・`pnpm gate`・`pnpm test:db` は変えていない。
- **ADR は書かなかった。** 本番の schema・権限・RLS・DSL・migration は変えず、`enforcePolicies` / `dropAll` が実行する文と順序は同一（unit 試験で確認）。試験基盤の判断は spec・検証と公開・テスト規約に記した。

## やったこと

- `kernel/src/test-database.ts`（新規）: 鍵・名前・印・年齢切れ・対象判定・DB 状態の読取・`prepareFromTemplate`。
- `kernel/src/testing.ts`: `freshDb()` がテンプレートを試し、使えなければ従来の `dropAll` + `createSchemaFromScratch`。`schemaPreparation()` を追加。
- `kernel/src/db/migrate.ts`: `policyStatements()` と `RESET_STATEMENTS` を公開し、`enforcePolicies` / `dropAll` はそれを順に実行（文は同一）。
- `kernel/test/test-database.test.ts`（unit 19 件）、`kernel/test/test-template.db.test.ts`（DB 5 件）。
- `scripts/gate.mjs`・`scripts/gate-select.mjs`・`scripts/gate.d.mts`: migration/setup suite の判定と後回し、報告（`selected.deferred`・`deferred`・注記・表・hint・dry-run）。`scripts/test/gate.test.ts` に `db-test-startup AC-8〜AC-10` の 8 件。
- 文書: spec（新規）、[test-tiers](../specs/test-tiers.md)（選択規則・AC-3・実測・未決事項の解決）、CONTRIBUTING（DB テストの説明、light の目安）、[テスト規約](../conventions/testing.md)、[検証と公開](../architecture/verification-and-release.md)、`scripts/check-doc-links.mjs`。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

すべてこの一時 container（4 CPU、他エージェントが同時に DB 試験・ブラウザ試験を実行）での値。CI の値ではない。

- [実測] 実装前の全 116 suite（計時入り、commit していない）: 877.8 秒、701 試験すべて成功（load average 2.0〜6.7）。suite ごとの分解は spec の計測表。
- [実測] 試作（一時ファイル、削除済み）: 全 module の 1,563 文の DDL 実行は既定 2.2 秒、`synchronous_commit = off` 2.2 秒、1 transaction 1.9〜2.0 秒。`CREATE DATABASE ... TEMPLATE`（WAL_LOG）0.14〜0.31 秒、`DROP DATABASE` 0.04〜0.06 秒（初回のみ 2.2 秒）、`STRATEGY FILE_COPY` 0.24〜0.31 秒。肥大した DB から作ったテンプレートは 49〜51 MB。試作で作った DB は名前が `daifuku_test_w1_proto_*` で、終了時に削除した。
- [実測] `freshDb()` 1 回の時間（全 module の registry、一時的な DB 試験で 4 回ずつ 2 巡）: 従来の作り直し 3.5〜4.3 秒、テンプレートからの複製 0.6〜1.1 秒（bootstrap 約 0.3 秒を含む）。
- [実測] `kernel/test/test-database.test.ts`（unit 19 件）と `scripts/test/gate.test.ts`（84 件、うち `db-test-startup` 8 件）が成功。
- [実測] `kernel/test/test-template.db.test.ts`（5 件）が成功: 従来の作り直し・template1 から作ったテンプレート・その複製、および余分な schema を持つ試験 DB を中で作った場合の 3 経路で catalog（relation・列・制約・索引・RLS・policy・grant・trigger・関数・schema・型・拡張・既定権限・DB 属性・app role の表権限）が一致、テンプレートの印・接続不可・所有者、囮 DB（印なし・他の試験 DB の印）を年齢切れの対象にしないこと、CREATEDB の無い role の拒否。
- [実測] 試験の効き目: `applySchemaBuild` がテンプレート作成時に最後の policy 文（audit_log の trigger）を落とすよう一時的に書き換えると、catalog 比較の試験が失敗した。戻した後、壊れたテンプレートは次の実行の冒頭で消して作り直されることを確認した（これは `test-template.db.test.ts` が自分の鍵のテンプレートを最初に消すためである。他の suite は同じ鍵の壊れたテンプレートをそのまま複製する。作り方を変えたときは `TEMPLATE_FORMAT` を上げる、とテスト規約に書いた）。
- [実測] AC-3: `kernel/test/access-boundary.db.test.ts` と `noninterference.db.test.ts` が `TEST_DATABASE_TEMPLATE=off`（7 試験）と既定（7 試験）の両方で成功。
- [実測] 全 117 suite、テンプレート無し（cold）: 790.2 秒、706 試験すべて成功、作り直しへの退避の通知 0 件（load average 2.8〜3.7）。テンプレート有り（上限 200 にして実行、cold 実行で上限 48 により追い出された分は作り直し）: 776.1 秒、706 試験すべて成功、通知 0 件（load average 1.8〜2.7）。実行後のテンプレートは 59 件・676 MB（1 件 8〜21 MB）、この実行で使ったのは 58 件。freshDb の suite の合計は 753 秒 → 679 秒（cold）→ 659 秒（warm）、全 module を読む `apps/api` の suite は 1 件あたり 3〜11 秒短くなった（例: `companies` 8.3 → 3.9 秒、`demo-identity` 16.8 → 5.7 秒、`industry-demo-ownership` 15.8 → 6.8 秒）。kernel だけの小さな suite はほぼ変わらない（作り直し 0.3〜0.9 秒と複製の手間が近い）。
- [実測] 試験選択（`gate-select.mjs` を直接実行）: sales の 1 ファイル変更で 65 → 55 suite（10 件を後回し）、banking で 38 → 28。`modules/sales/src/entities/sales-invoice.ts` の変更では 65 件すべて（理由: schema 宣言）、`packs/real-estate/src/services/rent-roll.ts`（`UNIT_STATUSES` を entity が import）では 38 件すべて（理由: 同じ package の schema 宣言から import）。選択の列挙は 3.6〜4.3 秒。
- [実測] light、`modules/sales/src/settings.ts` に 1 行足す同じ変更、`--base HEAD`:
  - 実装前 1 回目 825.6 秒（db 630.3 秒、65/116 files。load average 2.3〜8.2、静的検査が同居負荷で遅かった）
  - 実装前 2 回目 **792.6 秒**（format 22.6、docs 0.4、assurance 0.1、typecheck 8.1、typecheck:api 14.3、typecheck:web 20.3、lint 22.4、unit 58.3、db 631.3（65/116）、deploy 14.7。load average 1.1〜2.5）
  - 実装後 **588.5 秒**（format 22.2、docs 0.5、assurance 0.1、typecheck 7.9、typecheck:api 14.7、typecheck:web 21.6、lint 22.3、unit 55.0、db 428.7（55/117、10 件後回し）、deploy 15.5。load average 1.6〜2.0）。同程度の負荷の 2 回目と比べて 204 秒（26%）、DB 工程は 203 秒（32%）短い。**目標 6 分は未達。**
- [実測] light、`modules/banking/src/matching.ts` に 1 行足す変更、実装後: **407.6 秒**（静的検査など 163.2、db 244.4（28/117、10 件後回し）。load average 1.2〜4.7）。目標 6 分を 48 秒超過。実装前はこの環境で測っていない（参考: 実装前の suite ごとの時間から DB 38 suite の合計は 420 秒、A1 の記録では同じ変更の light が 598.8 秒。API / Web の typecheck が加わる前の版）。
- [実測] 最終状態の `pnpm gate:light --base ebc7574`（この作業の 16 ファイル。kernel の変更で DB 全件に昇格）: **950.0 秒で成功**。format 26.5、docs 0.4、assurance 0.1、typecheck 18.8、typecheck:api 23.8、typecheck:web 29.0、lint 24.9、unit 57.5（132 ファイル / 1,234 試験）、db 747.8（117 / 117 ファイル、706 試験、作り直しへの退避の通知 0 件）、deploy 21.2。報告に `kernel/**` と `scripts/gate-select.mjs` の昇格注意と `pnpm gate:full` の hint（load average 2.0〜3.7）。
- [レビュー] テンプレート経路が作成・削除する DB は試験 DB と自分の印付きテンプレートだけであること、名前の引用（`"` の二重化）とコメントの引用（`'` の二重化）、`starts_with` による一覧で `_` が LIKE の任意文字にならないこと。
- [未検証] CI 上の時間、`pnpm gate:full`、CREATEDB の無い環境での全 suite 実行、template1 と locale の違う試験 DB。初回の実装では AC-6（他のセッションでの待機と 55006）と AC-7（試験 DB が無いときの復元と報告、失敗の包み方）にも試験が無かった（実装時の要約が「AC-1〜AC-10 を unit で確認」としたのは過大。レビューで指摘され、修正で DB 試験を足した）。

## 見つけた問題と修正（発見経路つき）

- テンプレートが 49 MB になった（kernel だけの registry でも） — 発見: 実測（`pg_database_size`）。試験 DB の system catalog の肥大を写していた。template1 の新しい複製の中で作るよう修正し 8.6 MB になった。
- migration/setup suite の判定が 6 件しか拾わなかった — 発見: unit 試験（`AC-8 recognises ...`）。4 件は `./legacy-fixture.ts` の `upgradeLegacyConnection` 経由で migration を適用する。同じディレクトリの補助ファイルも見るよう修正。
- 上限 48 では 1 回の全 suite 実行で使う鍵（約 59）に足りず、cold 実行の途中で追い出しが起きた — 発見: 実測（実行後のテンプレート数）。80 に変更。
- `exists` を SQL の列別名に使っていた（予約語） — 発見: 実行前のレビュー。`present` に変更。
- 16 桁の接頭辞だけが一致する別の鍵の自分のテンプレートを複製しうる（確率 2^-64） — 発見: レビュー。複製前に印の完全な鍵を照合し、違えば作り直すよう修正。
- cold の全 suite 実行の途中で `kernel/src/test-database.ts` を編集した（上の 2 点の修正）。正常経路の挙動は同じだが、この実行は 2 つの版が混ざっている。warm の実行と light の計測は最終の版で行った。

## 未実施（減らさない。完了したら「済」を付けて残す）

- `pnpm gate:full`（統合担当が実行する。`kernel/src/testing.ts` は昇格パターン）。
- CI 上の時間（push していない）。CI の `daifuku_ci_test` は空の job 専用 PostgreSQL で、全 suite の最初の実行になるため cold の値（この環境で 790 秒）に近いはず（推測、未検証）。
- owner に CREATEDB が無い環境での全 suite 実行（作り直しへの退避は unit 試験と、CREATEDB の無い app role で DB 状態を読む DB 試験で確認しただけ）。
- encoding・locale が template1 と違う試験 DB での実行（試験 DB 内で作る経路は、余分な schema を作る DB 試験で通した）。

## 判断待ち（利用者）

- light の目標 6 分は未達（spec の未決事項）。
- テンプレートの disk 使用（全 suite の 1 回で試験 DB ごとに約 0.7 GB、上限 80 件まで溜まると最大約 1.7 GB）の可否。後始末は `pnpm test:db:templates -- --drop`。
- 従来の作り直し経路でも DB 名に `test` を要求するか（test-tiers の未決事項の残り）。
- migration/setup suite を light で後回しにすること自体（根拠はワークフローの作業項目文で、利用者の承認ではない。`GATE_DEFER_SCHEMA_SUITES=0` で無効）と、後回しによりmodule のサービス変更が旧データの移行結果と組み合わさったときだけ壊れる場合（`upgrade.db.test.ts` の `applyPayment`、`industry-templates.db.test.ts` の売上請求書作成）は full まで見つからない。この幅を受け入れるか。

## 次のセッションへ

- light をさらに縮めるなら、計測上の残りは試験本体（sales 変更の 55 suite で `apps/api/test/identity-rate-limit.db.test.ts` 約 54 秒、`modules/trade/test/workflow-model.db.test.ts` 約 26 秒など）と import（suite あたり 1.3〜2.3 秒）、静的検査約 160 秒。静的検査と DB 工程の並行実行、`apps/api` の DB suite の選択の見直しは、それぞれ判断が要る（spec の未決事項）。
- bootstrap tenant（scrypt）のテンプレート化で全 suite 約 36 秒を減らせる見込み（未実施。テナント ID が実行間で固定になる影響の確認が要る）。

## レビュー指摘の修正（2026-10-30、修正セッション）

- セッション: A3 の修正担当（Opus 5.5、同じ worktree・branch、試験 DB `daifuku_test_w1`、00:20〜UTC）。レビュー 3 観点（spec・safety・ux）の指摘 23 件（重複を除くと 19 件）をコードで確かめ、すべて妥当と判断して直した（一部は別の直し方を選んだ。下記）。

### 決めたこと（と理由）

- **作り直しが残し、DB の再作成が失う物があれば、どの経路でも DB を削除しない。** 初回の実装は余分な schema・拡張の確認をテンプレート作成時だけ行い、既定権限（`pg_default_acl`）を見ていなかった。複製の経路は確認なしに試験 DB を `DROP` していた（safety の指摘。レビュアの実験で、既定権限が消えて app role の表権限が in-place と変わることが示された）。`extraObjects()` が public / drizzle 以外の schema、plpgsql 以外の拡張、既定権限、event trigger、publication、large object、外部データラッパー・外部サーバー、追加の手続き言語、利用者定義の cast を数え、1 つでもあれば従来の作り直しに戻る。鍵に指紋を入れて複製する案は、余分な schema の中のデータまでは指紋にできないため採らなかった。DB のコメント（共有オブジェクトで再作成では消える）も `targetProblem` の条件に足した。
- **待つのはこの harness の接続だけ。** psql や GUI が試験 DB につないだままだと、初回の実装では毎 suite 15 秒待っていた（全 suite で約 30 分）。postgres.js の既定の `application_name`（`postgres.js`）の接続だけを前の suite のものとみなして最大 15 秒待ち、それ以外がいればすぐに従来の作り直しに戻って理由に `application_name` を出す。他の role の接続でも `application_name` は見える（`backend_type` は見えない）ことを実測で確かめ、autovacuum は `usesysid is not null` で除いた（`DROP DATABASE` が止める）。待機時間は `prepareFromTemplate` の `sessionWaitMs`（試験用）で変えられる。
- **使用中の DB の `DROP` はすべて作り直しへの退避か飛ばしにする。** 中断したテンプレートの作り直し（55006 で作り直しに戻る）と年齢切れ（使用中は飛ばす）。テンプレート作成が失敗したときは作りかけの DB を消してから失敗させる（印が無いと年齢切れの対象にならず残るため）。
- **DB 名は `test` を `_` 区切りの 1 語として含むこと**（`/(?:^|_)test(?:_|$)/`）。`includes('test')` では `daifuku_latest`・`contest_prod` を通していた。
- **通知は「suite ごとに 1 回」と文書を直した。** 試験ファイルをまたいで 1 回にする案（vitest の globalSetup で先に判定する）は、実行時の理由（他のクライアント、余分な物）を suite ごとに判定する必要があり、通知の重複を消すためだけに仕組みを足すことになるため採らなかった。通知に「`TEST_DATABASE_TEMPLATE=off` で出なくなる」を加えた。
- **light の後回しは既定で有効のまま、根拠を正し、無効化を足した。** 根拠を作業項目文と明記し（上の「決めたこと」を訂正）、`GATE_DEFER_SCHEMA_SUITES=0` で無効にできるようにした。既定で無効にする案は、計測した light の短縮（sales 変更で DB 32%）を捨て、作業項目の指示にも反するため採らなかった。受け入れるかは利用者の判断として残した。
- **後始末のコマンドを足した。** `pnpm test:db:templates`（一覧）と `-- --drop`（削除）。`isOwnTemplate` と同じ判定で、試験 DB 自身・他の試験 DB のテンプレート・印の無い DB には触れない。`TEST_DATABASE_TEMPLATE=off` でも使える。開発環境で上限を下げる案は、1 回の全 suite 実行で約 59 件の鍵を使うため毎回の作り直しになるので採らなかった。
- **gate-select はファイルごとに選んだ規則をすべて記録する。** 後回しはモジュールグラフが唯一の理由のときだけ。子プロセス規則の import グラフ探索は、グラフだけで選ばれた migration/setup suite にも行う。出力の各要素は、規則が複数のときだけ `reasons` を持つ（既存の `selected` の形を保つ）。`registerExt(` を schema 宣言に加え、schema に関係する変更で実行したときは理由を工程の注記に出す。
- **案内文・README を「DB を作り直し、テンプレート DB を残す」に直した。** CONTRIBUTING の CREATEDB の文は条件付き（試験専用の owner が持つときに使う。既存 role に足す必要はない）にした。

### やったこと

- `kernel/src/test-database.ts`: `extraObjects`（旧 `holdsExtraObjects` を拡張し、試験 DB があるときは最初に確認）、DB コメントの条件、`DISPOSABLE_NAME`、`waitForNoSessions` の harness 判定、55006 の扱い、作成失敗時の後始末、テンプレートを待機前に印付け、`PrepareOptions`（`now`・`sessionWaitMs`・`build`）、`ownTemplates`、`databaseUrl` の公開、`templateTarget` の `ignoreMode`。
- `kernel/src/test-database-cli.ts`（新規）とルート `package.json` の `test:db:templates`。`kernel/src/testing.ts`: 通知の文。
- `scripts/gate-select.mjs`（規則の記録、子プロセス規則の再確認）、`scripts/gate.mjs`（`registerExt`、`reasons` を見た後回し、`GATE_DEFER_SCHEMA_SUITES`、残した理由の注記、案内文と注記の「recreates」）、`scripts/gate.d.mts`。
- 試験: `kernel/test/test-template.db.test.ts` に AC-6 3 件・AC-7 3 件を足し、余分な物の試験を「既定権限・余分な schema があれば DB を削除せず作り直す」2 件に置き換え、一覧の試験に `ownTemplates` を足した（12 件）。失敗しても接続と追加した物を残さないよう `withFreshDb` と `finally` で後始末する。`kernel/test/test-database.test.ts` に DB 名の語・DB コメント・`ignoreMode`（23 件）。`scripts/test/gate.test.ts` に複数規則・`registerExt`・残した理由の注記・`GATE_DEFER_SCHEMA_SUITES` を足し、案内文の変更に合わせて期待値 3 か所を直した（`resets the schema of` → `recreates`。意味は同じで、文言の変更に合わせた）。既存の gate-select の結合試験は出力に `reasons` が加わったため、期待値を新しい形（`reasons` を含む完全な要素）に直した（弱めていない）。
- 文書: spec（AC-2〜AC-11、検証手順 9、結果表の注記、未決事項）、テスト規約、CONTRIBUTING、README、検証と公開、test-tiers。

### 検証

- [実測] `kernel/test/test-template.db.test.ts` 12 件成功（20.9〜22.6 秒）。AC-6 の harness 接続は 300 ms 待って作り直しに戻り試験 DB の OID は不変、他のクライアント（`application_name` `tpl-probe-psql`）ではすぐに戻る、接続中の印の無いテンプレートは 55006 で作り直しに戻り、切断後は template1 から作る。AC-7 は試験 DB を消すと自分のテンプレートから復元、テンプレートの無い DB は何も作らずに報告、壊れた DDL は試験 DB 名と `TEST_DATABASE_TEMPLATE=off` の案内付きで失敗し作りかけのテンプレートが残らない。
- [実測] 効き目: 余分な物の確認・他クライアントの判定・テンプレート削除の 55006 扱い・作成失敗時の後始末をそれぞれ一時的に無効にすると、対応する試験が失敗した（4 通り）。最初の確認で、失敗した試験が接続と既定権限を残し後続の試験を 15 秒ずつ待たせることが分かり、試験の後始末を直した（失敗時も残さないことを同じ方法で再確認）。
- [実測] `kernel/test/test-database.test.ts`（23 件）と `scripts/test/gate.test.ts`（86 件）が成功。
- [実測] AC-3: `access-boundary.db.test.ts` と `noninterference.db.test.ts` が `TEST_DATABASE_TEMPLATE=off` と既定の両方で 7 件ずつ成功（手動の実行。自動試験ではない）。
- [実測] `gate-select.mjs` を直接実行: sales の 1 ファイル変更で 55 suite + 10 件後回し、`rent-roll.ts` で 38 件（理由: 同じ package の schema 宣言から import）、entity の変更で 65 件（理由: schema 宣言）。修正前と同じ。
- [実測] `pnpm test:db:templates`: 試験 DB `daifuku_test_w1` のテンプレート 59 件・676.1 MB を一覧し、`-- --drop` で 59 件すべてを 9.5 秒で削除した。試験 DB と他の試験 DB（`daifuku_test_w10` など）は残った。変数が無いとき・`daifuku_latest` では終了コード 2 で何もしない。
- [実測] `pnpm gate:light --base ebc7574`（テンプレートを消した直後の cold 状態）: **894.7 秒で成功**（wall 14 分 55 秒）。format 25.4、docs 0.4、assurance 0.1、typecheck 8.9、typecheck:api 15.7、typecheck:web 20.4、lint 19.4、unit 48.1（132 ファイル / 1,240 試験）、db 739.2（kernel の変更で DB 全件に昇格、117 / 117 ファイル、713 試験）、deploy 17.1。作り直しへの退避の通知は 2 件で、どちらも `test-template.db.test.ts` 自身が余分な schema・既定権限を足した試験のもの。実行後のテンプレートは 59 件・672.7 MB で、試験 DB に既定権限・試験用 schema は残っていない（load average 3.0〜4.8。修正前の最終 light 950.0 秒・db 747.8 秒と同程度で、cold と warm の違いがあるため差は比べない）。
- [レビュー] 正常経路で増えるのは、試験 DB への確認の接続 1 回と catalog の小さな問い合わせ 1 回である。修正前の全 DB suite・light の時間（上の表）は測り直していない。
- [未検証] 年齢切れの削除で使用中のテンプレートを飛ばすこと（試験すると試験 DB の他のテンプレートを消すため、コードレビューのみ）。テンプレート作成中に他のクライアントがテンプレートへ接続する場合。locale の違う試験 DB の経路（初回と同じく未実測）。

### 時間

- agent_minutes 約 50（00:20〜01:10 UTC。gate:light の待ち 15 分を含む）。rework_lines 812（修正 commit の差分 17 ファイル +649 / −163。spec・規約・CONTRIBUTING・作業記録の書き直しを含む）。gate_failures 0（修正後の light 1 回は成功。開発中の DB 試験の失敗は効き目の確認のための意図したもの）。
