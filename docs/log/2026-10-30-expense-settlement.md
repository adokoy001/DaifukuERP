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
- [レビュー] 引き継いだ hook の順序（`before_submit` で仕訳 → 番号確定後の `after_submit` で入出金と経費の精算、`before_cancel` で逆仕訳と経費の差戻し → `after_cancel` で入出金の取消）を kernel の `submitDocument` / `cancelDocument` / `findDependents` / `amendDocument` と突き合わせた。
- [未検証] **一次資料で未確認（not verified）**: 帳簿のみ保存の特例（公共交通機関・出張旅費等・自動販売機・回収される入場券）と少額特例の控除率 1、経過措置の書類の条件、仕入税額控除の時期（D20 の精算日での計上の帰結）。2026-10-30 に `curl` で www.nta.go.jp と laws.e-gov.go.jp に接続したが、プロキシが CONNECT を 403 で拒否した。[japan-tax.md#expense-settlement](../domain/japan-tax.md#expense-settlement) の【未確認】はそのまま。統合担当に、これらのドメインをセッションのネットワーク設定で許可するよう依頼する（spec の検証手順 7）。
- [未検証] banking の実際の銀行照合での取消拒否（試験は同じ phase の hook で代替）。入出金の確定時の消込明細の拒否（公開の経路では到達できない二重の防御。I7）。`pnpm gate:full`（統合担当が実行）。

## 見つけた問題と修正（発見経路つき）

- 下書き作成の `create` に `userId` が無く型エラー、`lineTaxPatch` の型変換 — 発見: 実測（typecheck）、修正: 引継ぎ後の最初のコミット。
- `l10n-jp.db.test.ts` が勘定科目の種類別件数（資産 6）を固定していた — 発見: 実測（DB 試験）、修正: 7 に更新（1800 の追加。弱めていない。I8）。
- 経費の拠点が複数にまたがる指定（AC-3）は、承認済みの経費があると workforce が異動を拒むため、「精算 → 異動 → 精算書の取消」でしか起きない — 発見: 実測（DB 試験の組立て）、対応: 試験をその手順で組み、訂正後の拠点の制限を I4 とマニュアルに書いた。
- `/me` の支払方法の選択欄が説明文を含む label のため名前が長くなった — 発見: E2E、修正: `aria-label` を付けた。
- 既存の試験 3 ファイルが新しい module・migration に追従していなかった — 発見: 実測（gate:light の DB lane）。修正: `scenario.db.test.ts` の module 一覧に `expense` を足した（runtime の catalog の順）。`boolean-migration.db.test.ts`・`ext-index-migration.db.test.ts` は、移行前に存在した制約（関係と名前が同じもの）だけを移行後と比べる `upgradedFacts` にした。後の migration が足す表・既存の表への新しい制約は「変更」ではなく「追加」で、既存の制約が変わらない・消えないことは引き続き確かめる（試験を弱めたのではなく、0017 以降の migration に依存しない形に直した。統合ブランチ adb94b6 は同じ名前の関数で「移行前に存在した関係」に絞っており、こちらはそれを含むより細かい条件）。`commerce-finance-migration.db.test.ts` は既存の入出金の新しい列 `counter_account_id` を null として期待値に足した（元の列は変わらない）。

## 未実施（減らさない。完了したら「済」を付けて残す）

- 帳簿のみ特例・少額特例・経過措置の書類・計上時期の一次資料での確認（ネットワーク許可が必要）。
- 精算書の印刷（C5 の統合後に `expense.render_expense_settlement_html`。`hooks/settlement.ts` に `// C5 hook:`）。
- 共有の `a11y.spec.ts` の画面一覧への `/finance/expenses` の追加（自分の spec の中で `judge()` を実行した。一覧の単体試験が画面数を固定しているため、統合担当の判断に委ねる）。
- `pnpm test:db:templates -- --drop` は最後に実行する（下の「次のセッションへ」）。

## 判断待ち（利用者）

- spec の未決事項のまま（従業員と取引先の対応表、費目から科目への対応、本人の仮払申請、法人カードの引落しの支払、領収書の記載税額との 1 円差、特例の自動判定、汎用画面の分野）。

## 次のセッションへ

- 統合時: migration の番号（0018。統合ブランチでは 0018・0019 が使用済み）、移行試験 3 ファイルの `upgradedFacts` と `commerce-finance-migration` の期待値（統合ブランチにも 0018 opening_balance の同種の変更がある）、`scenario.db.test.ts` の module 一覧、`apps/api/test/setup-health.db.test.ts` の `STABLE_IDS` / `KNOWN_HREFS`（E1 も同じ一覧に id を足す）、`docs/specs/l10n-jp.md` AC-1 と `l10n-jp.db.test.ts` の種類別件数（E1 も資産を足す）、`apps/web/src/router.tsx`・`navigation-data.ts`・`help.ts`・`token-usage.test.ts` の追加の合流。
