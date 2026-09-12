# 作業記録: 2026-09-11 pack-real-estate（導入テンプレート「不動産（賃貸管理・自主管理）」）

- セッション: 実装エージェント（Claude）1 ラン ／ 担当: agent ／ 対象: docs/specs/pack-real-estate.md
- 計測: tokens=null, agent_minutes≈45（12:01〜12:45 UTC の実時間）, human_minutes=0, rework_lines≈26（src ≈24: 滞納一覧の並び順 10、sample の動的 import 5、型キャスト除去 3、その他 6。test 2: シード順の期待値）, gate_failures=1（DB テスト初回: モジュールのシード順の期待値が誤りで 13 件連鎖失敗。1 行直して green）
- 編集範囲: `packs/real-estate/**`、`docs/domain/{real-estate,scenario-real-estate}.md`、本記録のみ。kernel / modules / l10n / apps / 他 pack は未編集。`pnpm install` / `db:generate` / `db:reset` / `db:migrate` は実行していない。
- **H3 計測: pack 行数 `packs/real-estate/src` 1,401 行（21 ファイル）、テスト 613 行（4 ファイル）。この pack のために触ったコア（kernel / modules / l10n / apps）: 0 行。** ただし下の「コアの穴」7 件を pack 側の回避・制限として抱えている。

## 決めたこと（と理由）
- **エンティティ名は `real_estate_property` / `real_estate_unit` / `real_estate_deposit`（spec の `property` / `unit` / `deposit` から変更）**。docs/conventions/packs.md「エンティティ名は `<pack>_` で始める（全体で一意）」に合わせた。`unit` のような一般名は将来の module と衝突する。
- **AC-3 の税区分の既定は contract_line の before_validate に置いた**（spec は contract の before_validate）。kernel の汎用 create はヘッダを作ってから明細を `saveLines` するので、ヘッダのフックは明細を見られない。明細のフックは親契約の `ext.unitId` → 部屋の用途を読む。kernel のフックは登録順に走り、契約モジュールの「品目から補完」が先に入るので、**優先順位は「明細で明示 > 品目 > 部屋の用途」**（spec の「明細に taxCategory が無ければ」と同じ意味になる）。品目 RENT（非課税）を事務所の契約に使うと非課税が入る — RENT_TAXABLE を使うか明示する（台本 ひっかけ 1、DB テストで順位を実測）。
- **住宅でも貸付期間 1 か月未満は課税**を規則に入れた（spec の用途表には無い）。No.6226 の非課税の条件そのもので、純粋関数 1 つで済むため。判定は明細作成時の契約期間（`oneMonthEnd`: 翌月同日の前日、同日が無ければ翌月末）。
- **契約の ext 既定（keyMoney / depositMonths / renewalFee = 0）と部屋の存在確認は `ext.unitId` がある契約だけ**。pack のフックは全社で動く（ADR-0015）ので、賃貸でない契約（保守契約など）の ext を汚さない。これで `readAppliedPacks` の確認は不要にした（pack のフックはすべて「部屋が付いた契約」か pack のエンティティにしか作用しない）。
- **unit.status の規則: 確定済み（docstatus 1）で、終了日が今日より前でない契約がある部屋は occupied**（開始前の成約済みも occupied）。spec の「move_in → occupied」「move_out → 終了日が過ぎていれば vacant」を 1 つの導出規則で満たすため。部屋の before_update で毎回導出し（汎用 update で書き換えても戻る）、契約の after_submit / after_update / after_cancel と move_in / move_out が「導出値が変わったときだけ」部屋を touch する（請求の生成で部屋の version・監査を増やさない）。レントロールは同じ規則を asOf で計算する。
- **敷金台帳の受領・返還項目は pack のアクションだけが書ける**（per-Context マーカー。contract の台帳・kernel の isSavingLines と同じ形）。汎用 create ではリセット、update で変えると INVALID_STATE、受領済みの金額変更・削除も拒否。仕訳と台帳がずれないため（spec に無いガード）。
- **敷金台帳に `deductionAmount` を足し、`returnedAmount` は「入居者に払い戻した額」**（spec の項目に追加）。預り金の取崩し = 返還額 + 控除額 を台帳だけで追えるようにするため。
- **`return_deposit` は全額精算のみ（`amount` = 敷金額、違えば VALIDATION）**。一部だけ取り崩すと預り金の残りの行き先が無いため。`accountId`（振込元口座）を任意入力に足した。控除行は税区分なし（原状回復費は課税の可能性が高い — docs/domain/real-estate.md#deposit-deduction【未確認】→ 判断待ち）。
- **返還の仕訳の起票元は `real_estate_deposit_return`**（受領は `real_estate_deposit`）。accounting の postFromSource は (sourceEntity, sourceId) ごとに生きた仕訳を 1 本しか許さないため（コアの穴 2）。
- **`real_estate.accounts` に `deduction: '4100'` を足し、`bank` を任意にして未設定なら `payment.accounts.bank`**（AC-4「既定 payment.accounts.bank」と AC-5 の `bank` の両立）。pack の既定では `bank: '1100'` を書くので、実際は pack の設定が使われる。`rentRevenue` は宣言のみ（転記先は `sales.accounts.revenue`。pack が同じ 4200 を入れる）— 使っていない設定であることを設定の説明文に書いた。
- **敷金額 = 敷金月数 × 契約明細の月額合計（税抜）を契約の端数処理で通貨桁に丸め**。明細が家賃 1 行の台本では spec の値と同じ。共益費を別行にすると共益費も含む（判断待ち）。
- **入居者の支払条件は sample で「当月分を当月末日まで」（31/0/31）にした**（spec に記載なし）。取引先の既定（月末締め翌月末払い）のままだと 11 月分の期日が 12-31 になり、spec の「asOf 12-05 に T4 の 11 月分が滞納」が成り立たない。民法 614 条（月末払い）とも合う（【未確認】）。
- **品目 KEY_MONEY の税区分は non_taxable**（spec に記載なし）。RENT と揃えた。move_in は品目ではなく部屋の用途で礼金行の税区分を決める。
- **AC-8 発行日基準の判断: 11 月の消費税集計は課税売上 208,000・税 20,800 が正しい（spec の対案 316,000・31,600 は誤り）**。理由は台本 §消費税集計表: (1) 12 月分は 11-25 に生成しても請求書の日付は 12-01（契約モジュールの billingDay 規則）で、集計表は仕訳日 = 請求日で集計する、(2) 家賃の資産の譲渡等の時期は支払を受けるべき日で前受けを除く（消基通 9-1-20、逐語【未確認】）ので 12 月分は 12 月の取引、(3) 31,600 は 11/01〜12/05 の累計（試算表で実測）。
- **台本の運用**: 4 契約とも 11-01 に確定（T2 は成約済み・11-11 入居）。T1（2026-04 からの既存入居者）は move_in ではなく `contract.generate_invoices { period: '2026-11', contractId }`（move_in は開始月 = 4 月を請求する）。12 月分は 11-25 に `submit: true` で生成（未入金・期日前の請求を滞納一覧と区別して見せるため）。
- **滞納一覧は 1 行 = 1 請求書、並びは物件・部屋・期日**（spec「per 入居者×部屋」）。入居者名の文字コード順は日本語で意味が無いので部屋順にした。請求書と契約の結び付きは contract_billing（sales_invoice に契約の項目は無い。note は表示用）。
- **レントロールの月額賃料**: 入居中は契約明細の月額合計（日割り前）、空室は部屋の募集賃料を表示して合計に入れない。税区分の列は明細が 1 種なら その区分、混在なら `mixed`。`asOf` は任意（既定 今日、sales.ar_aging と同じ）。
- **pack のラベルは spec どおり（contract → 賃貸借契約、sales_invoice → 家賃請求書、partner → 入居者/取引先）**。ラベル上書きは全社・全 pack 共通で重複は Conflict（ADR-0015）: **packs/example と同じプロセスで読み込むと import 時に `CONFLICT pack "real_estate": label override(s) partner (set by "example")`**（tsx で両方を import して実測）。apps への配線時に判断が要る（判断待ち）。
- pack のラベル（グループ名）は「賃貸管理（不動産）」。メニュー 6 件（物件・部屋・区画・賃貸借契約・敷金台帳・レントロール `/r/real_estate.rent_roll`・滞納一覧 `/r/real_estate.arrears`、order 70〜75）。

## やったこと
- 読んだもの: CLAUDE.md、spec pack-real-estate、conventions/packs.md、ADR-0014/0015、specs {pack, contract, sales, payment, tax}、packs/example 全部、modules/contract/src 全部、modules/sales の index / entities / hooks（recalc, lines, submit, cancel）/ services（recalculate, posting, aging）/ actions（ar-aging, record-payment）/ recalculate / settings、modules/payment の src 全部、modules/accounting の index / post-from-source / tax-period-summary / tax-summary / trial-balance / account / helpers / seeds、modules/partner の entity と due-date、modules/product の entity、l10n/jp の index / module / chart-of-accounts / settings、kernel の dsl/{pack,defs,fields,action,entity}、pack.ts、lines.ts、actions/{run,crud}、document.ts（submit）、registry（hooks, packs）、settings、testing、errors、meta（AppMeta）、apps/api/test/scenario.db.test.ts、docs/domain/{japan-tax,scenario-kojin}.md、contract の作業記録。
- 出典: WebFetch で No.6226・No.6225 を取得（要約モデル経由の抽出）。消基通 9-1-20 と質疑応答事例（原状回復費）は文字化け、e-Gov（別表第二・民法）は本文を取得できず → docs/domain/real-estate.md に【未確認】で既知の内容を記載。curl は egress proxy が nta.go.jp を拒否（403）。
- 新規 src（21 ファイル）: `pack.ts`、`index.ts`、`settings.ts`、`load.ts`、`seed.ts`、`sample.ts`、`entities/{property,unit,deposit}.ts`、`services/{tax-rule,rent-roll,arrears}.ts`（純粋）、`hooks/{contract-defaults,unit-status,deposit}.ts`、`actions/{move-in,move-out,receive-deposit,return-deposit,rent-roll,arrears}.ts`。
- 新規 test: `tax-rule.test.ts`（unit 10）、`scenario-real-estate.db.test.ts`（db 13）＋ `scenario-checks.ts` / `support.ts`（ヘルパ。400 行制限のため分割）。
- docs: `docs/domain/real-estate.md`（出典つき規則）、`docs/domain/scenario-real-estate.md`（台本・全期待値の導出）、本記録。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）
- [実測] `npx vitest run --project unit packs/real-estate`: 1 file / 10 passed。
- [実測] `TEST_DATABASE_URL*=…/daifuku_test_real_estate npx vitest run --project db packs/real-estate`: 1 file / 13 passed（約 4.3〜6.9 秒）。最終版で**連続 3 回 green**（下の「最終確認」）。
- [実測] DB テストがアサートしている台本の期待値（すべて手計算と一致）: pack:apply の結果（書いた設定 4 件・kept 1 件、科目 4200/4210、品目 3 件、sample の物件・部屋・入居者・契約と明細の税区分）、2 回目の適用で部屋の version と会社設定が不変、11 月分 4 枚と 12 月分 4 枚の請求日・期日・税抜・税・税込・明細、各仕訳の [科目, 借方, 貸方]（請求書 5 枚・敷金 2 件・入金 3 件・元入金）、T2 の taxSummary、試算表 11/01〜11/30（全科目、合計 1,550,466）と 11/01〜12/05（合計 1,794,266）、売掛金 8,800 / 252,600、敷金台帳の未返還合計 265,000、売掛金年齢表 12-05、滞納一覧（12-05 / 11-30 / 2027-01-01）、レントロール 11-30（全列と合計）、消費税集計表 11 月・12 月（行・明細数・totals）、台本の後（退去 2 回・レントロール 2027-01-01・敷金返還仕訳・試算表 12/31 の 2500/4100/1100・ガード 9 種）、T1 の nextPeriod と 5 月の schedule（コアの穴 3 の実測）。
- [実測] ミューテーション 5 種（src を退避して改変 → DB テスト → 復元、diff で復元を確認）: 事務所・駐車場を非課税に → 12 件 fail、礼金行を足さない → 8 件 fail、部屋の状態の導出を壊す → 2 件 fail、敷金ガードを外す → 1 件 fail。**滞納の判定を「期日当日も遅れ」に変える改変は DB テストでは検出されなかった**（repository の where `dueDate $lt asOf` が同じ条件を先に絞るため）。同じ改変を unit テストに掛けると 1 件 fail（期日当日は false のケース）で検出する（実測、復元済み）。
- [実測] `packs/example` と同一プロセスでの import → CONFLICT（上記）。
- [実測] 最終確認: `pnpm typecheck`（tsc7、ルート）0 エラー、`node node_modules/tsc7/bin/tsc -p packs/real-estate/tsconfig.json`（test を含む）0 エラー、`pnpm lint`（eslint . + depcruise）0 エラー、`npx eslint packs/real-estate --max-warnings 0` 0、`pnpm lint:boundaries` 違反なし。
- [レビュー] 400 行・80 行の制限（最大 src 123 行、test 248 行）、`any` / 非 null アサーション / `as never` なし（`as` はフックの生の行を typeof で確かめた後の `Record<string, unknown>` / `string` への絞り込み 4 か所だけ。modules と同じ書き方）、金額は Decimal、ラベル ja/en、import は kernel と module / l10n の公開 index のみ。
- [未検証] apps/api・apps/mcp への配線、マイグレーション（3 テーブル）、`pnpm pack:apply real_estate --sample` の daifuku_dev での実行、web 表示。国税庁・e-Gov の【未確認】項目。

## コアの穴（pack 側で回避・制限として持ったもの。本体の判断用）
1. **フックの順序・値の出所が分からない**: 契約モジュールの品目既定が pack のフックより先に入り、「明示された税区分」と「品目から入った税区分」を区別できない → 部屋の用途を品目より優先できない（優先順位を文書化して回避）。
2. **postFromSource は起票元 1 件につき生きた仕訳 1 本**: 受領と返還の 2 回転記する台帳は別の sourceEntity 名（`real_estate_deposit_return`）を名乗るしかない。
3. **contract: 導入前の月を請求済みにできない**（contract_billing は generate_invoices しか書けない）: 既存契約 T1 は nextPeriod 2026-04 のまま、schedule で過去月が due に出る（実測）。データ移行の手段が要る。
4. **contract: 前払いの請求日は対象月の billingDay 固定**: 月途中開始の初回請求書が開始日前の日付になる（T2: 11-01）。「翌月分を当月 25 日に請求」（前家賃）を表せない。
5. **sales: 売上科目が 1 つ（`sales.accounts.revenue`）**: 礼金を 4210 に分けられない（品目・明細ごとの収益科目が無い）。
6. **contract.end は請求済みの月を調整しない**（赤伝・返金なし）: 月途中退去の過請求は手作業（台本は月末退去で回避）。
7. **ラベル上書きがプロセス全体で 1 つ**: example（と、同じ partner を改名するなら retail）と同時に読み込めない。
- 補足（穴ではないが落とし穴）: `accounting.tax_period_summary` は資産科目の税区分つき明細を仕入として数える。敷金の預金側に `out_of_scope` を付けると仕入に入るので付けていない。部屋の保存上の状態は時間の経過だけでは変わらない（何かが書くまで。contract.status と同じ性質）。

## 見つけた問題と修正（発見経路つき）
- DB テスト初回、モジュールのシード順の期待値が実際（partner, accounting, product, tax, l10n_jp）と違い、以降の step が連鎖失敗 — 発見: 実測、修正: 期待値を実際の登録順に（テストの誤り）。
- 滞納一覧を入居者名順にしていた — 発見: レビュー（2027-01-01 の期待値を書くとき、漢字のコード順は業務的に無意味）、修正: 物件・部屋・期日順。
- sample で不要な動的 import、move-in に税区分の型キャスト、deposit フックに `as never` — 発見: レビュー、修正: 静的 import・型を RentTaxCategory に・配列を string[] に。

## 未実施（減らさない。完了したら「済」を付けて残す）
- apps/api `src/packs.ts`・apps/mcp `src/modules.ts` への登録と `@daifuku/pack-real-estate` 依存の追加（本体）。example とのラベル衝突の解消が先。
- マイグレーション生成（real_estate_property / real_estate_unit / real_estate_deposit の 3 テーブル。本体が `pnpm db:generate`）。
- daifuku_dev で `pnpm pack:apply real_estate --sample` と web 表示の確認。
- 【未確認】の出典の逐語確認（消費税法 別表第二 十三、消基通 9-1-20、質疑応答事例「保証金から差し引く原状回復工事費用」、民法 143・614 条）。

## 判断待ち（利用者）
- ラベル上書きの衝突（partner を example が「得意先/仕入先」、本 pack が「入居者/取引先」に改名）: どちらかの上書きを外すか、会社単位のラベルを kernel に入れるか。
- 敷金から控除した額の税区分（原状回復費 = 課税、敷引き = 住宅非課税/事業用課税）を入力させて仕訳を分けるか（v1 は税区分なしで雑収入）。
- 礼金を 4210 に分けるための「品目ごとの収益科目」を sales に入れるか。
- 既存契約の移行手段（過去月を請求済みにする）を contract に入れるか。
- 敷金額の基準（家賃のみか、共益費を含む契約明細の合計か）。

## 次のセッションへ
- 配線時は `apps/api/test/scenario.db.test.ts` の modules 一覧のアサーションに注意（pack は modules に入らないが、import で payment / contract / l10n_jp が先に登録される）。
- 小売 pack と同時に読み込む場合も、partner / sales_invoice のラベル上書きが衝突しないか確認。
