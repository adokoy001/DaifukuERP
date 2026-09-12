# 作業記録: 2026-09-10 accounting モジュール（勘定科目・会計期間・仕訳・台帳・試算表）

- セッション: 実装エージェント（Claude）**再開ラン** — 前のエージェントが API レート制限で中断（src 23 ファイル／約 1,200 行、test 2 ファイルがディスク上に残存、記録なし・未コミット）。本ランは残存物を全部読んで AC-1〜12 に突き合わせ、良いものは残し、欠けているものを足し、誤りを直した ／ 担当: agent ／ 対象: docs/specs/accounting.md
- 計測: tokens=null, agent_minutes=22（本ラン。前ランは不明）, human_minutes=0, rework_lines=82（既存コードへの変更: hooks/freeze-lines.ts 68、hooks/validate-entry.ts 12、test/balance.test.ts 2）, gate_failures=2（内訳は下記）

## 残存物の評価（何があって、何が無かったか）
- **あった（そのまま採用）**: entities 5 件（account / fiscal_year / fiscal_period / journal_entry / journal_line）、services 4 件（balance / periods / ledger / table-result: すべて純粋関数）、actions 7 件（open_fiscal_year / post_from_source / reverse_entry / trial_balance / general_ledger / close_period / reopen_period）、hooks 4 件、seeds/fiscal-year.ts、module.ts、index.ts（`postFromSource` / `reverseEntry` を素の関数として export 済み）、test/balance.test.ts（例 + property 10 件）、test/periods.test.ts（例 + property 7 件）。tsc / eslint / depcruise は再開時点で既に緑、unit 17 件通過。
- **無かった（本ランで追加）**: `test/accounting.db.test.ts`（AC-1〜12 の Postgres テスト 14 件、うち DB 上の property 3 件）、本記録、metrics。
- **誤っていた（本ランで修正）**: 下記「見つけた問題と修正」の 2 件。

## 決めたこと（と理由）
- **`journal_line.entryDate` / `posted` を submit 時にヘッダから複写する非正規化列にする**（前ランの設計を維持）。理由: kernel の aggregate/list ポートは単一エンティティのみで join が無く、「転記済み仕訳の明細だけを日付で絞る」には明細側に日付と転記フラグが要る（AC-8/9 は raw SQL 禁止）。両列は `hidden: true`。
- **スタンプ（posted=true / entryDate=日付）は `after_submit` で書き、`journal_line` のフックで「posted=true ⇔ 親が submitted」を不変条件として守る**（本ランで変更）。前ランは `before_submit` で書いていたが、そのときは親がまだ draft なので「draft の明細に posted=true をユーザーが書く」のと区別できず、試算表に未転記の明細が混入し得た（AC-8「submitted のみ」違反）。変更後: draft 配下では posted/entryDate はユーザー書き込み不可（VALIDATION）。submitted 配下で受理される唯一の書き込みは「posted=true かつ entryDate=親の date で、他の列（ext 含む）が不変」のスタンプそのもの（after_submit が書く内容と同じ。再送は無害な no-op）。それ以外は INVALID_STATE（frozen）。
- **`cancel` は `before_cancel` フックで常に拒否（hint: `use accounting.reverse_entry`）**。既に逆仕訳済みの仕訳は kernel の依存チェック（`findDependents` が `before_cancel` より先に走る）で `HAS_DEPENDENTS` になる。どちらも拒否なので受け入れたが、エラーコードが 2 種類になる点は kernel 側の順序の帰結（下記 gap）。
- **TableResult のスキーマは accounting が `services/table-result.ts` に持つ**。kernel が docs/conventions/reports.md の zod を export していないため。他の帳票モジュールが出来たら kernel へ移す前提。
- **accounting.* アクションの出力は `lines: JournalLine[]`（フラット）**、汎用 `journal_entry.get/create` は kernel の `lines: { journal_line: [...] }`（エンティティ名キー）。in-process 呼び出し（sales/purchase）に都合がよいフラット形を前ランが選んでいたので維持。UI/MCP が両方を見る点は判断待ち。
- **sales / purchasing ロールに journal_entry の create/update/submit と journal_line の create/update を付与**。`post_from_source` は呼び出し側ユーザーの Context で動く（権限バイパス無し、ADR-0007）ため。副作用として営業・購買が手入力の仕訳も転記できる。判断待ち。
- **fiscal_period に `code`（YYYY-MM、会社内一意）を追加**（spec のフィールド表には無い）。一覧・締め操作の可読性と一意性のため。fiscal_year の code は開始日の暦年で `FY2026`（4 月開始でも FY2026）。
- **`open_fiscal_year` の startDate は月初日のみ**（それ以外は VALIDATION）。年度・期間の `endDate ≥ startDate` と年度の重複禁止は `before_validate` / `before_create` / `before_update` フックにしたので、汎用 `fiscal_year.create/update` 経由でも守られる。
- **残高は科目区分に関係なく借方プラス（貸方はマイナス）**。符号の見せ方は UI の責務。試算表の期首残高は差引を片側にだけ表示（`splitOpening`）。
- **試算表・元帳の既定範囲**: `to` = 今日（`ctx.now()` を JST 日付に）、`from` = `to` を含む年度の期首（無ければ 1/1）。
- **逆仕訳の日付は省略時に元仕訳の日付**。指定した場合もその日付が開いている期間に属する必要がある（submit フックが検証）。

## やったこと
- 読んだもの: CLAUDE.md、docs/conventions/*、ADR-0005/0006/0009/0013、spec、kernel の index/lines/aggregate/document/registry/settings/testing/crud/run/repository/zod/permissions、kernel/test/ports.db.test.ts、modules/partner 一式、modules/accounting の全ファイル。
- `src/hooks/validate-entry.ts`: `before_submit`（検証＋合計）と `after_submit`（明細スタンプ）に分離。
- `src/hooks/freeze-lines.ts`: 上記の不変条件（`assertNotStamped` / `isStamp` / `sameValue`: raw の numeric 文字列と Decimal を同値比較）。
- `test/accounting.db.test.ts`（新規、456 行、14 件）: AC-11 seed → AC-1 → AC-2 → AC-3 → AC-4 → AC-5 → AC-6 → AC-7 → AC-8/9（専用科目 TB-A/B/C で期首・期間・期末を手計算値と照合、draft は集計外、submit すると数字が動く、既定範囲）→ AC-10（締め／再開／監査証跡の actor／年度締め）→ AC-12（DB 上の property: 釣り合う明細は必ず submit、釣り合わない明細は必ず VALIDATION で draft のまま、任意の転記済み仕訳の逆仕訳後に科目ごとの net（Σ借方−Σ貸方、aggregate ポート）が不変。各 6 runs）。`ctx.now` を 2026-09-10 に固定し、seed と帳票既定値を日付に依存させない。
- `test/balance.test.ts`: 生成器のバグ修正（下記）。

## 検証（何を・どう確認したか。コードレビューか実測かを明記）
- [実測] `pnpm exec tsc -p modules/accounting/tsconfig.json --noEmit`: エラー 0。`pnpm typecheck`（リポジトリ全体）: エラー 0。
- [実測] `pnpm exec eslint modules/accounting`: エラー 0・警告 0。
- [実測] `pnpm exec depcruise --config .dependency-cruiser.cjs modules/accounting`: violations 0（84 modules, 365 dependencies）。
- [実測] `TEST_DATABASE_URL*=daifuku_test_accounting pnpm exec vitest run modules/accounting`: **3 files, 31 tests passed**（6.6〜7.9 秒）を連続 3 回。内訳: balance 10（property 4）、periods 7（property 3）、accounting.db 14（property 3）。純粋 property は修正後に 8 回連続で緑。
- [実測] `pnpm exec vitest run --project unit`（リポジトリ全体）: 19 files, 152 tests passed。
- [実測] AC-4 の hint 文言（`open the period or change the date`）、AC-6 の hint（`use accounting.reverse_entry`）、`journal_entry.reversed` の outbox 行（payload に id/number/reversalId/reversalNumber）、締め・再開の audit_log（`update` 2 行、actor は accounting ロールのユーザー）を DB テストで確認。
- [レビュー] spec のフィールド表と entities の対応（account 8、fiscal_year 4、fiscal_period 4+code、journal_entry 7、journal_line 9+2 非正規化）。ラベル ja/en。`journal_entry.naming = { prefix: 'JE-', period: 'year' }` → 実測で `JE-2026-000001` 形式。
- [レビュー] services/ が DB・ctx に触れないこと（import は `@daifuku/kernel` の Decimal / 型 / Label と zod のみ）。trial_balance / general_ledger が raw SQL を使わず `repo().aggregate` と `list` のみで組み立てていること。
- [レビュー] Decimal のみ（`parseFloat` / number の金額なし）。submit 後の不変性は kernel（allowOnSubmit / saveLines）＋本モジュールのフックの二重。
- [未検証] spec 検証手順の `apps/api/src/modules.ts` への追加（partner の後）、`pnpm db:generate && pnpm db:reset`、curl での open_fiscal_year → create(lines) → submit → trial_balance。apps/* は本ランの編集範囲外。`runAction` 経由の同等シナリオは DB テストで実施。
- [未検証] `pnpm gate` 全体（他モジュールの db テストを含む一括実行）。モジュール単位の 4 ゲートとリポジトリ全体の typecheck / unit のみ実施。
- [未検証] 同時 submit 時の no-gap 採番（kernel の責務。単一接続でのみ確認）。
- [未検証] 汎用 UI `/r/accounting.trial_balance` と MCP での TableResult 描画。

## 見つけた問題と修正（発見経路つき）
- `journal_line.posted` / `entryDate` が draft 配下でユーザー書き込み可能で、試算表に未転記明細が混入し得た — 発見: レビュー（AC-8 との突き合わせ）。修正: スタンプを `after_submit` へ移し、freeze-lines フックで不変条件を強制（上記「決めたこと」）。DB テスト AC-5 で「draft への posted=true は VALIDATION」「submitted 配下でスタンプ以外の全書き込みは INVALID_STATE」「同一スタンプの再送は受理」を確認。
- `test/balance.test.ts` の生成器 `splitCents(total, weights)` が `total < weights.length`（例: 借方 1 セントを 5 分割）で負の金額を作り `Decimal.from("-1.-1")` で落ちる（3 つの property が確率的に赤） — 発見: 実測（連続実行 2 回目で失敗）。修正: 分割数を `min(weights.length, total)` に制限（テストの誤りで、実装は正しい）。DB テスト側の同型生成器にも同じ修正。gate_failures 1。
- 本ランの DB テスト AC-7 で、素の関数 `postFromSource` の戻り値（ドメイン行 = Decimal）を JSON 文字列と比較していた — 発見: 実測（vitest 失敗 1）。修正: `toBeInstanceOf(Decimal)` + `toString()` で比較（実装は正しい）。gate_failures 1。

## kernel への要望（gap。本ランでは kernel を編集していない）
- **TableResult の zod を kernel が export する**（docs/conventions/reports.md の形）。現状は accounting が `services/table-result.ts` に複製。
- **明細エンティティが親の docstatus / 業務日付で絞れる手段**（aggregate/list の join、または「親の列を継承する line」宣言）。無いので `posted` / `entryDate` を非正規化し、after_submit スタンプ＋フック 74 行で整合性を守っている。
- **システム導出フィールドの宣言**（`f.xxx({ derived: true })` のような「汎用 create/update から書けない」印）。`posted` / `entryDate` / `totalDebit` / `totalCredit` は現状 draft の間はユーザーが書ける（totals は submit で上書きされるので実害なし）。
- **`cancelDocument` の順序**: `findDependents` が `before_cancel` より先なので、モジュールが「依存あり」のケースに自前の hint を出せない（逆仕訳済みは HAS_DEPENDENTS、未逆仕訳は INVALID_STATE と、同じ「取消禁止」で code が割れる）。
- `ValidationError` の issue 型（`{ path, message }`）が kernel の index から export されていない（balance.ts が `Issue` を再定義）。

## 未実施（減らさない。完了したら「済」を付けて残す）
- `apps/api/src/modules.ts` に `AccountingModule` を追加（partner の後）→ `pnpm db:generate && pnpm db:reset` → curl で spec 検証手順。
- `pnpm gate` 一括実行。
- 残高キャッシュ（ADR-0005「期間別集計テーブル」）: 現状は都度 aggregate。件数が増えたら。
- 多通貨・分析軸・BS/PL 帳票・固定資産（spec スコープ外）。
- l10n/jp の勘定科目シード（AC-11 により本モジュールは CoA を持たない）。

## 判断待ち（利用者）
- sales / purchasing ロールが journal_entry を create/submit できる（post_from_source を呼び出し側の Context で動かすため）。専用ロール／内部アクション用の権限モデルを kernel に足すか、この副作用を許容するか。
- accounting.* アクション出力の `lines` がフラット配列、汎用アクションはエンティティ名キー。統一するか。
- fiscal_period.code（YYYY-MM）の追加を spec に反映するか。

## 次のセッションへ
- sales / purchase / payment からは `import { postFromSource, reverseEntry } from '@daifuku/mod-accounting'` で同一トランザクション内に転記する。`lines` は `{ accountId, debit|credit, partnerId?, taxCategory?, taxRate?, memo? }`、金額は Decimal か文字列。同じ `sourceEntity/sourceId` の再転記は逆仕訳後のみ（CONFLICT）。
- 勘定科目の解決（売掛金・売上・仮受消費税…）は `account.subtype` で引く想定（l10n/jp のシードが subtype を埋める）。
- 試算表・元帳は `runAction(ctx, 'accounting.trial_balance', { from, to })` / `'accounting.general_ledger', { accountId, from, to }`。出力は TableResult。
