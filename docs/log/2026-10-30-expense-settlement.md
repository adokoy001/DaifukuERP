# 作業記録: 2026-10-30 経費精算の一般化（E5）

- セッション: 完成度向上計画 E5（第 7 回の workflow、worktree `wip/expense-settlement`、基点 ffc2f42）。最初の実装者の作業は統合担当が約 15 分で止め、未コミットの変更（workforce の支払方法、payment の相手科目、`modules/expense` の骨組み）を引き継いだ ／ 担当: agent ／ 対象: [docs/specs/expense-settlement.md](../specs/expense-settlement.md)
- 計測: tokens=null（未計測）, agent_minutes=約160（引継ぎ後の経過時間 16:58〜19:35 UTC。うち約 85 分は高負荷の機械での gate:light 2 回とブラウザ試験の待ち。最初の実装者の約 15 分を含めず）, human_minutes=0, rework_lines=約100（試験側の修正: fixture の利用者の重複、拠点の境界の期待、未配分の件数の対照群、l10n の種類別件数、既存の移行試験 3 ファイル。製品コードの修正は型の 2 か所と `expense.todo` の扱いの文書化）, gate_failures=1（1 回目の gate:light の DB lane で、新しい module・migration に追従していなかった既存の試験 3 ファイル。下の「見つけた問題と修正」）

## 決めたこと（と理由）

- **spec critic の指摘は 0 件。** spec は変更せず、実装で決めたことを spec の「実装時の決定」I1〜I9 に書いた。
- **引き継いだ未コミットの変更は概ねそのまま採用した。** workforce の `paymentMethod`・`expense-settlement.ts`、payment の `counterAccountId`・`clearing.ts`・hook の変更、`modules/expense` の entity・hook・action・設定・導入チェックは spec の D1〜D28 と AC に合っていた。型の誤り 2 か所（下書きの作成に `userId`、`lineTaxPatch` の型変換）を直し、明細の書類の検査（`invoiceIssues`）を純関数 `services/invoice.ts` に分けて単体試験できるようにした。
- **`expense.todo` の権限は AC-18 のまま（精算書の `submit`）。** 拠点・店舗に限定された文脈は kernel の規則で確定できないため `/meta` に提供元が出ず、受信箱は呼ばない。AC-16 の「`expense.todo` は実行できる」はこの形（受信箱の呼出しを失敗させない）に文言を合わせた（I2）。権限を `read` にすると処理できない利用者全員の受信箱が空の提供元を呼ぶことになる。
- **`/finance/expenses` に「仮払精算を作成」を足した（I5）。** 使わなかった仮払の明細 0 行の精算（D24）を専用画面から行えるようにした。
- **試験の注入点。** AC-9 の巻戻しは入出金の `before_submit` に、AC-11・AC-13 の銀行照合済みの拒否は入出金の `before_cancel` に、試験の中で失敗する hook を登録して確かめた（expense は banking に依存しない。I6）。
- **ADR は予約番号の ADR-0039 を新規に書いた。** payment が他 module の伝票から作られる契約（相手科目、作成関数、取消の順序）は payment・expense・accounting の 3 module にまたがり、既存の ADR に追記できる場所が無いため。
- **migration は `0018_expense_settlement`**（新しい 3 表、`workforce_expense.payment_method` 既定 `personal`、`payment.counter_account_id`）。第 5・6 回の migration との番号合わせは統合担当に委ねる（I9）。

### レビュー指摘への対応（fixer、20:30〜 UTC）

レビューの 20 件をコードと突き合わせ、19 件を直し、1 件（相手科目付き入出金の「訂正」ボタンを隠す）は汎用画面に入出金だけの例外を入れないため、文書で対応した。spec の「レビュー指摘の対応」R1〜R9 に決定を書いた。

- **blocker: 明細の税区分が英字のコード** — `TAX_CATEGORY_LABELS` を付けた（他の伝票の明細と同じ）。ブラウザ試験で日本語「課税（標準）」・英語「Taxable (standard)」の選択肢を確かめる。
- **major: 自分の経費のまとまりで「精算書を作成」が必ず失敗し、理由が「役割が足りない」と出る** — 候補の出力に `self` を足し、画面は自分のまとまり・仮払に作成の操作を出さず理由を出す。失敗表示は `details.op` で自己精算（説明を分ける）・役割不足・その他を分け、権限の拒否には再試行を出さない。
- **major: 単一ファイルのマニュアルに章が入らない** — `scripts/build-manual.mjs` に名前付きの章の表（`edge-service-setup.md` と同じ扱い）を作り、`expense-settlement.md` を 05 の後に置き、名前付きの章へのリンクも章内の位置に書き換える（`edge-service-setup.md` へのリンクも直る）。
- **minor（安全）: 自己精算の拒否が作成・確定・取消だけ** — ヘッダ・明細・仮払の更新と削除にも掛けた（AC-15 を拡張、ADR-0039 決定 6 に追記）。
- **minor: 200 件を超えるまとまり / 重複した経費 id / 未精算の仮払が無い仮払精算のまとまり / 作成中の表示と失敗後の古い候補 / `/workforce` の主操作 / 受信箱の説明の誤り / 付録N の行の欠落 / AC-23 の試験が他の試験の残りに依存 / 重複した表示名と未使用の関数 / 証憑の読取規則の説明** — それぞれ直した（下の「見つけた問題と修正」）。
- **nit: 候補の明細の読取・省略時の承認済み経費の読取が 500 行で切れる** — ページ送りにした（R5）。**nit: AC-11 の参照番号の条件の試験が無い** — workforce の DB 試験を足し、条件を外す変異で失敗することを確かめた。**nit: 空の一覧・骨格の aria-busy / `/me` の説明文の aria-describedby / ヘッダの「支払先」の表示名** — 直した。
- **証憑（attachments）の読取規則は変えない（R7）**: 既存の attachments の規則（`accounting`・`sales`・`purchasing`・`viewer` が読める、行の規則なし）を、精算書の読取規則に合わせるのは attachments 全体の変更で E5 の範囲外（D9）。マニュアルと ADR-0039 に読める役割と「個人的な書類を添付しない」を書いた。

## やったこと

- modules/expense（新規 `@daifuku/mod-expense`）: entity 3 つ（`expense_settlement`・`expense_settlement_line`・`expense_advance`）、hook（下書きの検査と再計算、確定で `postFromSource` と `createClearingPayment`、取消で逆仕訳・経費の差戻し・入出金の取消、仮払の確定・取消）、純関数（`services/tax.ts` の税計算・配分、`services/posting.ts` の仕訳と入出金の計画、`services/invoice.ts`）、action（`expense.settlement_candidates`・`expense.draft_settlement`・`expense.todo`）、設定 `expense.accounts` と導入チェック `expense.accounts`、wire contract（`./contract`）
- modules/payment: `counterAccountId`、`clearing.ts`（`createClearingPayment`）、相手科目への転記、配分額・未配分額 0、消込明細の拒否、訂正した下書きの拒否
- modules/workforce: `paymentMethod`（保存・凍結・portal の出力）、`expense-settlement.ts`（`settleExpensesForSource`・`reopenExpensesForSource`・`lockEmployeeForSettlement`）
- l10n/jp: 勘定科目 `1800 仮払金`
- apps: runtime の catalog、api/web/runtime の依存、dependency-cruiser の contract 許可、migration、web の `/finance/expenses`（UI キット）・`api/expense.ts`・`lib/expense-settlement.ts`、`/me` の支払方法の選択と精算書番号の表示、`/workforce` の承認済みの行から `/finance/expenses` への移動、router・navigation・help・`CONVERTED`
- 試験: 単体 `modules/expense/test/tax.test.ts`・`posting.test.ts`（golden `golden/settlement.json` 11 件）、payment `allocate.test.ts` に相手科目の転記、web `lib/expense-settlement.test.ts`・`lib/workforce.test.ts`・`lib/help.test.ts`。DB `modules/expense/test/{settlement,draft,advance,access,todo,health}.db.test.ts`、`modules/payment/test/clearing.db.test.ts`、`modules/workforce/test/leave-expense.db.test.ts`（AC-1）、`l10n/jp/test/l10n-jp.db.test.ts`（1800）、`apps/api/test/setup-health.db.test.ts`（固定 id と href の一覧を拡張）。ブラウザ `apps/web/e2e/expense-settlement.spec.ts`（2 件）
- 文書: ADR-0039、マニュアル `expense-settlement.md`（新規）・付録F・05・00-index、`docs/architecture/workforce.md`（構成表・経費の状態図）・`program-map.md`、`docs/conventions/ui.md`、`docs/specs/payment.md`（AC-8）・`setup-health.md`（固定 id の表）・`inbox.md`（提供元の表）・`l10n-jp.md`（AC-1 の科目一覧）、`docs/verification/invariants.md`（PV-EXPENSE-01）、spec（implemented、実装時の決定）

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] 単体: `modules/expense` 2 ファイル 23 件（golden 11 件を含む）、payment `allocate.test.ts` 13 件、web の lib 262 件（expense-settlement・workforce・help・token-usage・navigation を含む実行）がすべて通過。
- [実測] DB（`daifuku_test_w53`、個別に実行）: `settlement.db.test.ts` 26 件（約 36 秒）、`draft.db.test.ts` 10 件（約 17 秒）、`advance.db.test.ts` 5 件（約 19 秒）、`access.db.test.ts` 8 件（約 29 秒）、`todo.db.test.ts` + `health.db.test.ts` 9 件（約 37 秒）、`modules/payment/test/clearing.db.test.ts` 7 件（約 15 秒）、`modules/workforce/test/leave-expense.db.test.ts` 10 件、`l10n/jp/test/l10n-jp.db.test.ts` 4 件、`apps/api/test/setup-health.db.test.ts` を含む l10n との同時実行 23 件がすべて通過。`out of shared memory` は出なかった。
- [実測] golden: 同じ `golden/settlement.json` を純関数（`posting.test.ts`）と実 DB の転記（`settlement.db.test.ts` が仕訳明細の科目・借方・貸方・税区分・税率・摘要・取引先と、入出金の向き・額・相手科目・仕訳を照合）の両方で確かめた。spec AC-8 の例（立替 4,930 円、仮払 10,000 円で入金 5,070、仮払 3,000 円で支払 1,930、法人カードで入出金なし）と (a)〜(g) を含む。
- [実測] 原子性と競合: 入出金の `before_submit` に注入した失敗、締め済みの期間、`expense.accounts` の科目欠落で、仕訳・入出金の件数が変わらず、経費 `approved`・仮払 `open`・精算書が下書きのままであることを確かめた。`Promise.allSettled` で同じ経費の 2 回の下書き作成、精算書の確定と手動の `workforce.settle_expense`、同じ仮払の 2 枚の確定が、それぞれ 1 つだけ成功することを確かめた。
- [実測] 権限・境界: accounting だけ（`<op>:requires-workforce_payroll` を 9 種の操作で）、workforce_payroll だけ（kernel の `create` / `submit`）、本人と admin 本人（`<op>:self-settlement`）、従業員 2 人の行の境界・`related`・`export_rows`、拠点限定の管理者、拠点限定の経理（候補・下書き・確定・他拠点の作成の拒否、`/meta` に `expense.todo` が出ない）、2 社（取得 `NOT_FOUND`、参照 `VALIDATION`、他社のデータが不変）。
- [実測] HTTP の一連（検証手順 4。e2e 用の新しい DB と API サーバー、slot 23、試験用の一時ファイルで実行して削除）: 本人の `workforce.save_expense`（`paymentMethod: personal`、3,300 円）→ 提出 → 拠点の承認 → `POST /actions/expense.draft_settlement` → `PATCH /api/expense_settlement/:id`（取引先と明細 `qualified`）→ `POST .../submit` で `EXP-2026-000001`、合計 3300・税 300・支払 3300 → `GET .../related` に `journal_entry:1`・`payment:1`・`workforce_expense:1` → `accounting.trial_balance`（当日）: `1100` 貸方 3300、`1500` 借方 300、`2150` 借方 3300・貸方 3300・残高 0、`6500` 借方 3000 → `POST .../cancel` で docstatus 2、試算表は 4 科目とも残高 0 → `POST .../amend` で訂正元を持つ下書き。
- [実測] ブラウザ（`apps/web/e2e/expense-settlement.spec.ts`、slot 23、chromium、--no-deps）: 2 件通過。本人が 390px の `/me` で立替と法人カードの経費を記録・提出（支払方法の表示）→ 拠点長が `/workforce` で承認 → 経理が `/workforce` の「経費精算へ」から `/finance/expenses` → 立替のまとまりから精算書を作成 → 汎用画面で節（基本・支払・金額・転記・備考）、写した内容が読取専用、取引先・支払先名・請求書区分・登録番号を入れて保存 → 確定 → 関連記録に仕訳と入出金、証憑パネル → 本人の `/me` に精算済みと番号 → 取消（入出金も取消）→ 訂正で明細 1 行の下書き → API で作った仮払の画面の関連記録に入出金 → `/finance/expenses` の「仮払精算を作成」で明細 0 行の仮払精算を確定し仮払が精算済み。もう 1 件で accounting だけの利用者に必要な役割の説明、日本語 390px で横スクロールなし、英語 1280px、axe（`a11y-policy.ts` の `judge()`）で serious / critical なし。
- [実測] 既存のブラウザ試験: `workforce.spec.ts`（3 件）・`inbox.spec.ts`（3 件）・`payment.spec.ts`（2 件）・`a11y.spec.ts`（34 件）と `expense-settlement.spec.ts`（2 件）を slot 23 でまとめて実行し 44 件通過（6.5 分）。
- [実測] `pnpm typecheck`、`pnpm lint:boundaries`（違反なし）、変更した package ごとの `tsc`（試験を含む）、`pnpm verify:assurance`（16 条件）、`node scripts/check-doc-links.mjs`（123 文書）。
- [実測] `GATE_DB_SHARDS=1 pnpm gate:light`（1 回目、18:07〜18:53 UTC、負荷 平均 13〜26）: 静的 lane はすべて通過（format、typecheck・API・Web、lint（警告 5 件、うち 1 件は既存の `WorkforceReviews` の関数行数 394→400）、boundaries、単体 165 ファイル 1,728 件、deploy、docs、assurance）。DB lane は変更が kernel 以外でも全 141 ファイルが選ばれ、138 ファイル・936 件が通過、3 ファイル 13 件が失敗（約 45 分）: `apps/api/test/scenario.db.test.ts`（module 一覧の固定値に `expense` が無い）、`boolean-migration.db.test.ts`（0016 からの移行の前後で全制約を比べており、0018 の新しい表・`payment` の新しい外部キーが差分になる）、`commerce-finance-migration.db.test.ts`（`select * from payment` に新しい列 `counter_account_id`）。修正して 4 ファイル（`ext-index-migration.db.test.ts` を含む）を個別に再実行し 23 件通過（約 1 分 43 秒）。
- [実測] `GATE_DB_SHARDS=1 pnpm gate:light`（2 回目、修正後、18:58〜19:30 UTC、負荷 平均 7〜11）: 全段通過。静的 lane（format・docs・assurance・typecheck・API・Web・lint・単体 165 ファイル 1,728 件・deploy）、DB lane 141 ファイル 949 件（1,900 秒）。全体 31 分 41 秒。
- [実測・fixer] DB（`daifuku_test_w53`）: `access.db.test.ts`（10 件。本人による更新・削除の拒否と候補の `self` の 2 件を追加）・`draft.db.test.ts`（11 件。重複 id の 1 件を追加）・`modules/workforce/test/leave-expense.db.test.ts`（11 件。AC-11 の参照番号の 1 件を追加）をまとめて 32 件通過（44 秒）。変異: `reopenExpensesForSource` の参照番号の条件を外すと追加の AC-11 試験が失敗し、元に戻して通過。
- [実測・fixer] 単体: `apps/web/src/lib/expense-settlement.test.ts`・`workforce.test.ts` 17 件（200 件を超えるまとまり、作成できないまとまり・仮払、再試行の作り直し、失敗の分類を追加）。
- [実測・fixer] ブラウザ（slot 23、chromium、--no-deps）: `expense-settlement.spec.ts` 3 件（税区分の日英の名前、待ち・下書きだけのまとまりを自前で用意した 390px と axe、本人のまとまりに作成の操作が無い試験を追加）。`-g AC-23` の単独実行で通過（初回は試験の組立ての誤りで失敗、上の「見つけた問題と修正」）。`expense-settlement`・`workforce`・`inbox`・`payment`・`a11y` の 5 ファイルをまとめて 45 件通過（3.9 分）。
- [実測・fixer] `pnpm manual:build`（python-markdown 3.11.2 を scratchpad に入れて `PYTHONPATH` で実行）: 26 章、目次に「経費精算」（`#ch-expense`、05 日常業務と 06 月次の間）、`expense-settlement.md` と `edge-service-setup.md` を指す未変換のリンク 0 件、`#ch-expense` へのリンク 4 件、ページ内の切れたアンカー 0 件。生成物 `docs/manual/daifuku-manual.html` は追跡対象外。
- [実測・fixer] `GATE_DB_SHARDS=1 pnpm gate:light`（20:55〜21:14 UTC、負荷 平均 2〜7）: 全段通過。format・docs・assurance・typecheck（全体・API・Web）・lint（警告 5 件。`WorkforceReviews` の関数行数は「経費精算へ」を主操作にした変更で 400→408。分割はしない）・単体 165 ファイル 1,732 件・deploy・DB 141 ファイル 953 件（1,140 秒）。gate の後にコメントの折返しと文書だけを直し、`pnpm format:check`・`pnpm docs:check`・変更した source の eslint を再実行して通過。
- [レビュー] 引き継いだ hook の順序（`before_submit` で仕訳 → 番号確定後の `after_submit` で入出金と経費の精算、`before_cancel` で逆仕訳と経費の差戻し → `after_cancel` で入出金の取消）を kernel の `submitDocument` / `cancelDocument` / `findDependents` / `amendDocument` と突き合わせた。
- [未検証] **一次資料で未確認（not verified）**: 帳簿のみ保存の特例（公共交通機関・出張旅費等・自動販売機・回収される入場券）と少額特例の控除率 1、経過措置の書類の条件、仕入税額控除の時期（D20 の精算日での計上の帰結）。2026-10-30 に `curl` で www.nta.go.jp と laws.e-gov.go.jp に接続したが、プロキシが CONNECT を 403 で拒否した。[japan-tax.md#expense-settlement](../domain/japan-tax.md#expense-settlement) の【未確認】はそのまま。統合担当に、これらのドメインをセッションのネットワーク設定で許可するよう依頼する（spec の検証手順 7）。
- [未検証] banking の実際の銀行照合での取消拒否（試験は同じ phase の hook で代替）。入出金の確定時の消込明細の拒否（公開の経路では到達できない二重の防御。I7）。`pnpm gate:full`（統合担当が実行）。

## 見つけた問題と修正（発見経路つき）

レビュー（2026-10-30、spec・safety・ux の 3 観点）で見つかったもの。発見: レビュー、確認: fixer がコードと試験で再現・検証。

- 明細の税区分の選択肢が `standard` などのコードのまま（日英とも） — 修正: `labels: TAX_CATEGORY_LABELS`。確認: ブラウザ試験に選択肢の名前の検査を足した（日・英）。
- 経理と給与・精算本部を兼ね、自分の承認済み経費がある利用者に、必ず失敗する「精算書を作成」が出て、失敗理由が役割不足と表示される — 修正: 候補の `self`、画面の作成操作の非表示と理由、失敗の分類（`draftFailureKind`）。確認: 単体（分類・判定）、DB（`access.db.test.ts` で本人の候補が `self: true`、同僚から `false`）、ブラウザ（本人のまとまりに作成ボタンが無く、他人のまとまりにはある）。
- 自己精算の拒否が下書きの更新・削除に無く、本人が同僚の作った下書きの取引先・明細・仮払の金額を変えられた — 修正: ヘッダ・明細の `before_validate` / `before_delete`、仮払の `before_validate`（更新）/ `before_delete` で `refuseSelfSettlement`。確認: DB（`update:self-settlement` / `delete:self-settlement`、版が変わらないこと、同僚は編集・削除できること）。
- 200 件を超えるまとまりで「精算書を作成」が毎回 `VALIDATION` — 修正: 画面は古い 200 件を送り、残りの件数を表示（契約の上限 `MAX_DRAFT_EXPENSES` を共有）。確認: 単体（201 件のまとまりの要求が契約の検査を通る）。
- `expense.draft_settlement` が同じ経費 id の重複を受け付け、1 経費 2 行・合計 2 倍の下書きを作った — 修正: 入力の検査で重複を拒否。確認: DB（`VALIDATION`「duplicate expense id」、下書きが作られない）。
- 候補の明細の読取（500 行）と省略時の承認済み経費の読取（500 行）がページ送りしていなかった — 修正: `services/load.ts` の `heldBy`（ページ送り）を候補と下書きの両方で使い、下書きは空き経費が 200 件になるか一覧が尽きるまで読む。確認: コードレビューと既存の DB 試験（500 行を超える再現はしていない）。
- 未精算の仮払が無い従業員の仮払精算のまとまりに「精算書を作成」が出て、確定できない下書きができた — 修正: 作成操作を出さず理由を表示、マニュアル手順 2 に書いた。確認: 単体。
- 作成中の表示が無く、失敗後に候補を読み直さず、再試行が古い経費 id を送った — 修正: 押したボタンを「作成中…」にし live region で知らせ、失敗時に候補を読み直し、再試行は読み直した候補から要求を作る（無くなったまとまりには再試行を出さない）。確認: 単体（`inputFor`）、ブラウザ。
- `/workforce` で経費精算を使える利用者に、仕訳・支払を作らない「精算を記録」が主操作として出ていた — 修正: 「経費精算へ」を主操作にし、「精算を記録」の確認に「仕訳・支払は作られません」を足した。確認: ブラウザ（`workforce.spec.ts` は変えずに通過）。
- マニュアルの受信箱の説明（「従業員の受信箱」）が誤り、付録N に経費精算の行が無い — 修正: 給与・精算本部の受信箱、付録N に行を追加。確認: コードレビュー（`workforce.todo` の `expense_settlement` は `workforce_payroll` に限る）。
- 単一ファイルのマニュアルに章が入らず、3 か所からのリンクが切れていた — 修正: `build-manual.mjs` の名前付きの章。確認: 実測（下の「検証」）。
- AC-23 のブラウザ試験が、同じファイルの 1 件目の試験が残した経費に依存していた — 修正: 試験の中で待ちのまとまり（立替）と下書きだけのまとまり（法人カード）を API で用意する。確認: `-g AC-23` で単独に実行して通過。単独実行の初回は「下書きの精算書に入っている経費」の節が無く失敗し、同じ従業員・同じ支払方法では節に出ないこと（試験の組立ての誤り）が分かった。
- `settlementHref`（未使用）と、`lib/workforce.ts` と重複した支払方法の表示名 — 削除し、`expensePaymentMethods` を使う。
- 空の一覧が `EmptyState` でない・仮払の骨格に `aria-busy` が無い・`/me` の説明文が支払方法と証憑の欄に結び付いていない・ヘッダの「支払先（取引先）」が明細の「支払先名」と紛らわしい — 修正: `EmptyState`（次の一手のリンク付き）、`aria-busy`、`aria-describedby`、「精算先（取引先）」。
- 相手科目付きの入出金を取消後に「訂正」すると保存・確定できない下書きが残る — 対応: kernel の訂正は作成時に訂正元を渡さないため hook で止められない（訂正前の hook は ADR が要る）。汎用の操作ボタンに入出金だけの例外も入れない。マニュアルに「削除する」と書き、ADR-0039 の帰結に記録（R6）。
- 証憑の読取が精算書の読取規則と一致しない（既存の attachments の規則） — 対応: マニュアルと ADR-0039 に記録、attachments の別項目へ（R7）。

- 下書き作成の `create` に `userId` が無く型エラー、`lineTaxPatch` の型変換 — 発見: 実測（typecheck）、修正: 引継ぎ後の最初のコミット。
- `l10n-jp.db.test.ts` が勘定科目の種類別件数（資産 6）を固定していた — 発見: 実測（DB 試験）、修正: 7 に更新（1800 の追加。弱めていない。I8）。
- 経費の拠点が複数にまたがる指定（AC-3）は、承認済みの経費があると workforce が異動を拒むため、「精算 → 異動 → 精算書の取消」でしか起きない — 発見: 実測（DB 試験の組立て）、対応: 試験をその手順で組み、訂正後の拠点の制限を I4 とマニュアルに書いた。
- `/me` の支払方法の選択欄が説明文を含む label のため名前が長くなった — 発見: E2E、修正: `aria-label` を付けた。
- 既存の試験 3 ファイルが新しい module・migration に追従していなかった — 発見: 実測（gate:light の DB lane）。修正: `scenario.db.test.ts` の module 一覧に `expense` を足した（runtime の catalog の順）。`boolean-migration.db.test.ts`・`ext-index-migration.db.test.ts` は、移行前に存在した制約（関係と名前が同じもの）だけを移行後と比べる `upgradedFacts` にした。後の migration が足す表・既存の表への新しい制約は「変更」ではなく「追加」で、既存の制約が変わらない・消えないことは引き続き確かめる（試験を弱めたのではなく、0017 以降の migration に依存しない形に直した。統合ブランチ adb94b6 は同じ名前の関数で「移行前に存在した関係」に絞っており、こちらはそれを含むより細かい条件）。`commerce-finance-migration.db.test.ts` は既存の入出金の新しい列 `counter_account_id` を null として期待値に足した（元の列は変わらない）。

## 未実施（減らさない。完了したら「済」を付けて残す）

- 帳簿のみ特例・少額特例・経過措置の書類・計上時期の一次資料での確認（ネットワーク許可が必要）。
- 精算書の印刷（C5 の統合後に `expense.render_expense_settlement_html`。`hooks/settlement.ts` に `// C5 hook:`）。
- 共有の `a11y.spec.ts` の画面一覧への `/finance/expenses` の追加（自分の spec の中で `judge()` を実行した。一覧の単体試験が画面数を固定しているため、統合担当の判断に委ねる）。
- 済: `pnpm test:db:templates -- --drop`（実装者の実行で `daifuku_test_w53` のテンプレート 68 件を削除。fixer の gate:light の後にも実行し、68 件・779 MB を削除、shard 0 件）。
- 証憑（attachments）の読取を添付先の記録の読取に合わせる（`attachment.get`・ダウンロード・`attachment.search`）。attachments の別項目（R7）。
- 相手科目付きの入出金の訂正そのものの拒否（kernel の訂正前の hook と ADR が要る。R6）。

## 判断待ち（利用者）

- spec の未決事項のまま（従業員と取引先の対応表、費目から科目への対応、本人の仮払申請、法人カードの引落しの支払、領収書の記載税額との 1 円差、特例の自動判定、汎用画面の分野）。

## 次のセッションへ

- 統合時: migration の番号（0018。統合ブランチでは 0018・0019 が使用済み）、移行試験 3 ファイルの `upgradedFacts` と `commerce-finance-migration` の期待値（統合ブランチにも 0018 opening_balance の同種の変更がある）、`scenario.db.test.ts` の module 一覧、`apps/api/test/setup-health.db.test.ts` の `STABLE_IDS` / `KNOWN_HREFS`（E1 も同じ一覧に id を足す）、`docs/specs/l10n-jp.md` AC-1 と `l10n-jp.db.test.ts` の種類別件数（E1 も資産を足す）、`apps/web/src/router.tsx`・`navigation-data.ts`・`help.ts`・`token-usage.test.ts` の追加の合流。

## 統合時の修正（2026-10-30、統合担当）

- 発見経路: 第7波の統合レビュー（F2 の API キーとの突合せで確定した major）。E5 は F2 より前に作られ、`modules/expense/src/access.ts` の `actorUserId` が独自に `agent ? onBehalfOf : actor.id` を返していた。F2 の機械の actor（`{ type: 'machine', id: 資格情報の id }`）には資格情報の id を返すので、`refuseSelfSettlement` が発行者本人の従業員に一致しない。admin（または accounting と workforce_payroll）の鍵で、発行者本人の従業員の仮払を作成・確定でき（`after_submit` の `createClearingPayment` で支払まで進む）、任意の確定済みの精算書を取り消せた（`before_cancel` の本人の検査を通り、workforce の `reopenExpensesForSource` はロールしか見ない）。`expense.draft_settlement`・`expense.settlement_candidates`・`expense.todo` も同じ helper を使っていた。精算書の確定だけは、仕訳の計上の後に `after_submit` → `settleExpensesForSource` → `requireOther` → `requireHumanUserId` で間接に拒否され、巻き戻っていた。[machine-credentials](../specs/machine-credentials.md) AC-22（精算などの人の判断を要する業務は kernel の `requireHumanUserId` で 403 `human-actor-required`）に反する。
- 修正:
  - `actorUserId` を `@daifuku/kernel` の `requireHumanUserId` に委ねた。`requireSettlementRoles` はロールの検査の前に `requireHumanUserId(ctx)` を呼ぶ。精算書・明細・仮払の利用者が呼ぶ hook（作成・更新・明細の保存と削除・削除・確定・取消。訂正は kernel の作成を通る）と `expense.draft_settlement`・`expense.settlement_candidates` が、どれも最初にこれを呼ぶことをコードを読んで確かめた（呼出しの追加は不要だった）。呼ばないのは module 内部の書込（write capability）と、確定済みの記録の allowOnSubmit の欄の更新だけ（欄はすべて server-owned で、外からは変えられない）。
  - `expense.todo` は `workforce.todo` に合わせ、ロールの判定（`canSettle`）より前に `actorUserId` を呼ぶ。action の権限を通った鍵は、ロールによらず 403 `human-actor-required` になる（accounting だけの鍵も。人なら AC-18 のとおり `{ items: [] }`）。
  - workforce の `requireSettler`（`settleExpensesForSource` / `reopenExpensesForSource` が呼ぶ）も、ロールの検査の前に module の `userId`（`requireHumanUserId`）で鍵を拒否する。精算書の取消は expense の hook と独立にも守られる。
  - 仕様: [expense-settlement](../specs/expense-settlement.md) AC-15 に鍵の拒否の 1 文、machine-credentials AC-22 の一覧に expense module と日付つきの追記、同 spec の関係するファイルと試験の表。
- 試験（どれも修正前に失敗することを下の変異の確認で確かめた）:
  - `apps/api/test/machine-credentials.db.test.ts` に AC-22 の 1 件を追加した。既存の `workforce.settle_expense` の鍵の試験と同じ組み方（HTTP、`issue` で発行した鍵、`human-actor-required` の検査）。l10n/jp の勘定科目・税率・会計年度を入れ、発行者（テナント管理者）を従業員に登録し、admin の鍵と accounting + workforce_payroll の鍵で次を確かめる。(a) 発行者本人の従業員への仮払の作成が 403 で、仮払は 0 件のまま。(b) 精算担当の人が用意した下書きの仮払の確定が 403 で、下書き・状態なし・支払なしのまま。(c) 人が確定した精算書の取消が 403 で、確定済みのまま・経費は精算済みのまま。(d) `expense.draft_settlement`・`expense.settlement_candidates` が 403 で、発行者の精算書は 0 件。(e) `expense.todo` が `workforce.todo` と同じく 403（accounting だけの鍵も）。同じロールの人（精算担当）は (b) の仮払を確定でき、受信箱の未精算の仮払に 1 件出る。
  - `modules/expense/test/access.db.test.ts` に、機械の actor（admin、accounting + workforce_payroll）で全 hook・action を通す 1 件を追加した。候補・下書き・受信箱、汎用の作成、ヘッダと明細の更新、明細の更新と削除、削除、確定、仮払の作成・更新・削除・確定、確定後の精算書と仮払の取消、取消後の訂正。版・状態・件数・経費の状態が変わらないことも確かめる。
  - `modules/workforce/test/leave-expense.db.test.ts` に、鍵での `settleExpensesForSource` / `reopenExpensesForSource` が 403 で経費の状態が変わらず、給与担当の人なら精算・差戻しできる 1 件を追加した。
  - 1 回目の API の実行で、精算担当の受信箱が空でないことを期待した検査が失敗した。下書きの仮払は数えないので空が正しく、試験の組立ての誤り。人が仮払を確定してから `open_advances` が 1 件になることを確かめる形に直した。
- 変異の確認 [実測、22:00〜22:04。確認後は退避した版へ戻し、`diff` で一致を確かめた]:
  - `access.ts` を統合前の版に戻す: API の新しい試験が (a) で失敗（鍵による仮払の作成が 200 で作られた）、expense の新しい試験も失敗（鍵に候補が返った）。
  - `actions/todo.ts` だけを戻す: API の新しい試験が (e) で失敗（accounting だけの鍵に `{ items: [] }` の 200）。admin・精算のロールの鍵では、委ねた `actorUserId` が拒否するので失敗しない（二重の防御）。
  - workforce の `expense-settlement.ts` だけを戻す: workforce の新しい試験が失敗（鍵の差戻しが成功した）。API の取消の試験は expense の hook が拒否するので通る（二重の防御）。
  - 3 つの変更をすべて戻し、API の新しい試験から (c) の取消だけを残した一時ファイル（実行後に削除）を実行: 鍵の取消が 200 になり、精算書が取消済み（docstatus 2）になった。指摘の欠陥が実在したことと、(c) がそれを捕えることの確認。修正を戻すと同じ一時ファイルは通過した。
  - 実行していない変異: `requireSettlementRoles` の `requireHumanUserId` だけを外す変更。コードを読む限り、委ねた `actorUserId`（`refuseSelfSettlement`）が少し後で同じ 403 にするので、新しい試験は失敗しない（従業員の読取が先に起きるが書込は無い）。「読む前に拒否する」ことは試験で観測しておらず、コードレビューで確かめた。
- 検証 [実測]: 変更した TS 6 ファイルの `npx prettier --write` と `--check`、`pnpm typecheck`、`pnpm --filter @daifuku/api typecheck`、`npx eslint`（6 ファイル、0 件）。関係する unit（`modules/expense/test/posting.test.ts`・`tax.test.ts`、`kernel/test/machine-credentials.test.ts`）3 files / 44 tests が通過。DB（専用 DB `daifuku_test_i7k`、`TEST_DATABASE_TEMPLATE=off`）: `apps/api/test/machine-credentials.db.test.ts`・`modules/expense/test/*.db.test.ts`（6 files）・`modules/workforce/test/leave-expense.db.test.ts` の 8 files / 89 tests が通過（22:05）。`node scripts/check-doc-links.mjs` 通過。
- [未検証] `pnpm gate` / `pnpm gate:full`（統合担当の通しの実行に含める）。MCP の鍵での経費精算（同じ `runAction` を通るので同じ 403 になるはずだが、MCP 経由の試験はしていない）。画面は変えていない（API キーはブラウザーから使えない。machine-credentials AC-11）。
- 統合後の独立検証の指摘と対応（2026-10-30、統合担当。検証者は鍵の拒否そのものは確認したうえで 3 点を挙げた）:
  - (1) 試験で捕えられない変異: `requireSettlementRoles` から `requireHumanUserId(ctx)` の 1 行だけを外しても、既存の試験はすべて通った（上の「実行していない変異」のとおり）。それなのに AC-15 と machine-credentials AC-22 の追記は「ロールの検査より前・読む前に拒否する」と書いていた。検証者がこの変異で失敗し HEAD で通る試験の下書き（V1〜V3）を残したので、`modules/expense/test/access.db.test.ts` の「API keys are refused」の describe に AC id（AC-15 AC-22）つきの試験として移した（fixture の `ready` に合わせて組み直し、既存の試験は消していない。下書きのファイルは移した後に削除した）。
    - accounting だけの鍵: 候補・下書き・受信箱・汎用の作成・ヘッダと明細の更新・明細の更新と削除・削除・確定、仮払の作成・更新・削除・確定、確定後の精算書と仮払の取消、取消後の訂正がすべて `human-actor-required`（`<op>:requires-workforce_payroll` ではない）で、版・明細・仮払・件数が変わらない。検証者の下書きに無かった仮払の更新・削除・確定・取消と訂正も足した。
    - admin の鍵で存在しない従業員を指定した `expense_settlement.create`・`expense.draft_settlement`・`expense_advance.create` と、存在しない精算書を親にした明細の作成が 403 `human-actor-required`（`NOT_FOUND` や参照の整合性の誤りではない）。「読む前に拒否する」ことを観測する。
    - 代理の agent: 本人の代理は本人として自己精算を拒否され（作成・仮払の作成・更新・確定・取消）、候補では本人のまとまりに `self` が立つ（下書きでは配列であることだけを見ていたのを、まとまりの `self` を見る形に強めた）。精算担当の代理は別の従業員の精算書を作成・確定・取消し、仮払を確定（支払）し、受信箱に未精算の仮払が出る。人の代理の経路を通す試験はこれまで無かった。
  - (2) 文言の過大: AC-15 の追記は「ロールによらず」鍵を `human-actor-required` で拒否するとしていたが、`workforce_payroll` だけの鍵は kernel の entity・action の権限で先に通常の 403（`details.op` = `create` / `submit`）になる。AC-15 を AC-22 の追記（「action の権限を通った鍵」）に合わせ、kernel の権限を通った鍵は module のロールの検査より前・読み書きの前に `human-actor-required`、権限の無い鍵は同じロールの人と同じ kernel の通常の 403、と書き直した。この区別は `workforce_payroll` だけの鍵と同じロールの人が同じ `details.op` になる試験で固定した。AC-15 の検証の表に鍵と agent の試験を足し、`access.ts` の冒頭の注釈も同じ区別に直した。
  - (3) 残っていた経路: 確定済みの精算書・仮払の `before_validate` は allowOnSubmit の欄の更新のために早く戻り、鍵の検査を通らなかった。admin の鍵の空の patch（`{}`）が受け付けられ、版・`updatedAt`・`updatedBy` が書き換わった（業務の値は変わらない）。上の「呼ばないのは…allowOnSubmit の欄の更新だけ」はこの経路を見落としていた。早く戻る前に `refuseMachineActor`（`access.ts` に追加。`requireHumanUserId` を呼ぶだけ）を呼ぶようにした。人・agent・system / relay には何もしないので、人の振舞い（確定・取消の中の内部の書込を含む）は変わらない。admin の鍵と accounting + workforce_payroll の鍵の空の patch が精算書・仮払とも 403 `human-actor-required` で、版・`updatedAt`・状態が変わらない試験を足した。
  - 変異の確認 [実測、22:31〜22:34。各変異の後は退避した版へ戻し、`diff` で一致を確かめた]:
    - 修正前の hook のまま新しい試験を実行: allowOnSubmit の試験だけが失敗（鍵の空の patch が受け付けられた）、移した 3 件は通過（HEAD で通ること）。
    - `requireSettlementRoles` の `requireHumanUserId(ctx)` の 1 行だけを外す: 新しい 2 件が失敗（accounting だけの鍵に `candidates:requires-workforce_payroll`、存在しない従業員で `workforce_employee` の `NOT_FOUND`）。前回「実行していない変異」とした変更が、これで試験に捕えられる。
    - 精算書の hook の `refuseMachineActor` だけを外す: allowOnSubmit の試験が精算書の更新で失敗。仮払の hook の `refuseMachineActor` だけを外す: 同じ試験が仮払の更新で失敗。
    - 検証者の下書きの V4・V5 も一度だけ実行した（一時的に試験の場所へ写し、実行後に削除）: `workforce_payroll` だけの鍵は `expense_settlement.create` で `create`、`expense.todo` で `submit` の kernel の拒否。修正後は鍵の空の patch が `human-actor-required` で版は 7 のまま。
  - 検証 [実測]: 変更した TS 4 ファイルの `npx prettier --write` と `--check`、`npx eslint`（0 件）、`pnpm typecheck`。DB（専用 DB `daifuku_test_i7m`、`TEST_DATABASE_TEMPLATE=off`）: `modules/expense/test/*.db.test.ts`（6 files）・`modules/workforce/test/leave-expense.db.test.ts`・`apps/api/test/machine-credentials.db.test.ts` の 8 files / 94 tests が通過（22:36〜22:38。前回の 89 件に新しい 5 件）。`node scripts/check-doc-links.mjs` 通過。
  - [未検証] `pnpm gate` / `pnpm gate:full`（統合担当の通しの実行に含める）。machine-credentials spec の試験の表の expense の行は今回足した試験（accounting だけ・権限の無い鍵、存在しない従業員・親、確定済みの記録への空の更新、代理の agent）を列挙していない（AC-22 の追記の文言は検証者が正しいとしたので変えていない）。
