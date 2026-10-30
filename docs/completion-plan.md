# 完成度向上の実装計画（設計・作業一覧・引継ぎ）

更新: 2026-10-30（第6波まで統合: 波0〜3 の大半、B2・B3・D3・A4、B6・B7・C6・E2・E4、B4・C5 を実装。E4 は行の読取規則が判断待ち）。作成時の対象は `main` の `431dda5`。候補の洗い出しは [改善・拡張候補](improvement-candidates.md)、現在地は [STATUS](STATUS.md)、方針は [PLAN](../PLAN.md)。この文書は、候補の中から実施するものを選び、作業単位・順序・設計・完了条件を決めた実行計画である。次の実装セッションはこの文書から始める。

## 0. この文書の使い方

- 作業項目は ID（A1、B2 など）で呼ぶ。1 項目 = 1 spec（`docs/specs/<slug>.md`）= 1 ブランチ（`feat/<slug>`）= 1 PR = 1 作業記録（`docs/log/`）。CLAUDE.md 規約 9 のとおり。
- 各項目の「設計」はこの文書で決めた範囲であり、spec を書くときに EARS の受入基準へ写す。spec で変えた判断はこの文書へ反映する。
- 実装中の検査は [3 段階の回帰テスト](specs/test-tiers.md)（A1）を使う。A1 が終わるまでは `pnpm test`、`pnpm --filter @daifuku/web test`、`pnpm gate` を使う。
- 完了した項目は STATUS と PLAN に移し、この文書と候補一覧から消す。

## 1. 実測した現状

| 指標 | 値 | 出典 |
| --- | --- | --- |
| 単体テスト | 1,003 件（Web 36 ファイルを含む）。波0統合後 1,207 件、第2・第3波の統合後 1,547 件、第4波の統合後 1,693 件、第5波の統合後 1,881 件、第6波の統合後 2,045 件 | STATUS、`vitest.config.mts` の unit project |
| DB テスト | 668 件、約 90 suite（suite ごとに schema を再作成）。第2・第3波の統合後 822 件・131 ファイル（A3 以降はテンプレート DB から複製）、第4波の統合後 883 件・134 ファイル、第5波の統合後 1,005 件・146 ファイル、第6波の統合後 1,075 件・152 ファイル | STATUS、`kernel/src/testing.ts` |
| ブラウザ試験 | 69 件、Playwright 1 worker。波0統合後 87 件（industry 3 件を含む）と認証 3 件。第2・第3波の統合後 160 件、第4波の統合後 182 件、第5波の統合後 195 件、第6波の統合後 203 件 | `apps/web/e2e`、`playwright.config.ts` |
| CI `pnpm gate` | 13 分 19 秒 | run #44（2026-09-14） |
| CI ブラウザ試験 | 8 分 42 秒 | 同上 |
| CI 認証試験 / セットアップ受入 | 37 秒 / 32 秒 | 同上 |
| Web の CSS | 13 ファイル 6,469 行。汎用画面は Tailwind ユーティリティ、専用画面は手書き CSS | `apps/web/src/*.css` |
| 画面幅の分岐点 | 380 / 600 / 640 / 700 / 720 / 760 / 950 / 1000 / 1100 / 1150 / 1200 / 1250 px の 12 種類 | 同上 |
| 会社の作成経路 | setup CLI の初回 bootstrap のみ。画面・API なし | `kernel/src/auth.ts`、`apps/api/src/routes/access-admin.ts` |
| 設定画面 | key 別カード、細目名は英語（JSON Schema の `title` が単一文字列） | `apps/web/src/lib/schema.ts` |
| 汎用一覧 | 検索・並べ替え・ページ送りのみ | `apps/web/src/pages/entity-list-page.tsx` |
| 業務イベント配送 | transactional outbox はあるが購読者 0 | `kernel/src/events.ts` |

## 2. 進め方の原則

1. **既存の不変条件を緩めない。** 権限は `Repository` と `Context`、金額は `Decimal`、確定伝票は不変、module から DB 直結なし。新しい画面は既存 action の呼び出し順を案内するものに徹し、新しい閲覧・書込経路を作らない。
2. **汎用画面を先に良くする。** 一覧・フォーム・設定・アクション画面は全 entity に効く。専用画面の手直しはその後、UI キット（D1）に寄せながら行う。
3. **検査は段階で使い分ける。** quick は編集ごと、light は push 前、full は「完了」の前。昇格パターンに触れたら full。
4. **測ってから最適化する。** DB テストの起動短縮（A3）や仮想スクロールは、計測値が目標を外れたときだけ着手する。
5. **文書は同じ PR で更新する。** spec、manual の付録、STATUS、log。UI の変更はブラウザ試験（390px を含む）を既存の E2E に足す。
6. **日本の制度は出典と期間付きデータ。** 固定資産の償却や住民税など新しい制度値は `docs/domain/` に一次資料と確認日を置く。

## 3. 作業項目一覧

サイズの目安: S = 半日〜1 日、M = 1〜3 日、L = 3 日以上（エージェント 1 セッション換算の粗い見積り）。

| ID | 名称 | 波 | サイズ | 依存 | spec slug | 主な変更先 |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | 3 段階の回帰テスト（quick / light / full）**済** | 0 | M | なし | [test-tiers](specs/test-tiers.md) | `scripts/gate.mjs`、`package.json`、`ci.yml`、CONTRIBUTING |
| A2 | E2E の smoke タグとアクセシビリティ自動検査 **済** | 0 | S | A1 | [e2e-a11y](specs/e2e-a11y.md) | `apps/web/e2e` |
| A3 | DB suite 起動の短縮と light の DB 選択の絞り込み **済** | 0（A1 の計測で前倒し） | M | A1 の計測 | db-test-startup | `kernel/src/testing.ts` |
| A4 | gate:light の短縮（静的検査と DB の並行、DB の分割）**済** | 0（A3 の結果で追加） | M | A3 | light-tier-speed | `scripts/gate.mjs`、`scripts/gate-select.mjs` |
| D1 | UI キットとデザイントークン、状態表示の統一 **済** | 0 | M | なし | ui-kit | `apps/web/src/ui/`、`styles.css`、汎用画面 |
| B1 | 設定定義の拡張と設定画面の再構成 **済** | 1 | M | D1（最小） | settings-console | `kernel/src/registry.ts`、`apps/api/src/routes/settings.ts`、`settings-page.tsx` |
| B2 | 会社の追加・編集と会社プロフィール **済** | 1 | M | B1 | company-admin | kernel 会社作成、`/admin/companies` |
| B3 | 導入チェック（ヘルスチェック）**済** | 1 | S | B1 | setup-health | `/meta/health`、`/admin/health` |
| B4 | セットアップウィザード **済** | 1 | M | B1、B2、B3 | setup-wizard | `/setup`、ホームのチェックリスト |
| B5 | マスタの CSV 取込 **済** | 2 | L | D1 | csv-import | kernel import port、`/api/:entity/import`、`/e/:entity/import` |
| B6 | 期首残高の取込 **済** | 2 | M | B5 | opening-balances | accounting / sales / purchase / inventory の action |
| B7 | pack 雛形生成 **済** | 4 | S | なし | pack-scaffold | `scripts/pack-new.mjs` |
| C1 | 一覧の絞り込み・列・保存ビュー・CSV・一括操作 **済** | 2 | L | D1 | list-workbench | `entity-list-page.tsx`、`data-table.tsx`、REST export |
| C2 | 伝票の複製・関連伝票・クイック操作 **済** | 3 | M | D1 | document-links | kernel related route、`entity-form-page.tsx` |
| C3 | やること受信箱 **済** | 3 | M | D1 | inbox | `*.todo` action 規約、`/inbox`、ホーム |
| C4 | 月次締めガイド **済** | 3 | M | C3 の規約 | close-guide | `accounting.close_readiness`、`/finance/close` |
| D2 | コマンドパレット・最近の記録・お気に入り・ヘルプ導線 **済** | 3 | M | D1 | navigation-assist | `lib/navigation.ts`、sidebar、ScreenTrail |
| D3 | フォームのセクション・エラー要約・ショートカット・モバイル操作バー **済** | 3 | M | D1 | form-ergonomics | DSL `views.form`、`record-form.tsx`、`line-grid.tsx` |
| C5 | 帳票の共通化と拡充 **済** | 4 | L | B2 | print-templates | `render_*_html` 規約、各 module |
| C6 | 役割別ホーム **済** | 4 | S | C3 | role-home | `home-page.tsx` |
| E4 | 証憑の横断検索（電帳法の検索要件）**実装済み（AC-6 は判断待ち）** | 4 | M | C1 | evidence-search | `/finance/evidence` |
| E2 | 定期仕訳 **済** | 4 | M | なし | recurring-journals | accounting |
| E1 | 固定資産台帳と減価償却 | 5 | L | E2 | fixed-assets | 新 module `fixed-assets`、l10n/jp |
| E3 | 資金繰り表と支払予定 | 5 | M | なし | cash-forecast | 新 action と画面 |
| E5 | 経費精算の一般化 | 5 | M | なし | expense-settlement | workforce / payment / accounting |
| E6 | 給与 2027 年版の制度データ **保留（公表待ち）** | 5 | M | 一次資料 | payroll-2027 | l10n/jp |
| F1 | 業務イベントの配送 worker | 5 | M | C3 | event-delivery | kernel outbox、`apps/api` worker |
| F2 | 機械用資格情報（API キー） | 5 | M | なし | machine-credentials | kernel identity、`/admin/tokens` |
| F3 | 権限マトリクスと監査の横断検索 | 5 | M | D1 | access-insight | `/admin/permissions`、`/admin/audit` |

## 4. 実施順（スプリント案）

| 波 | 項目 | ねらい |
| --- | --- | --- |
| 0 基盤 | A1 → D1 → A2 | 以後の全作業を速く安全にする。D1 は汎用画面の置き換えまで |
| 1 導入 | B1 → B2 → B3 → B4 | 2 社目を画面から作れ、初期設定を順番に完了できる |
| 2 データ | B5 → B6 → C1 | 実データの持込みと、毎日の一覧操作 |
| 3 日常 | C2 → C3 → C4 → D2 → D3 | 伝票 1 件あたりの手数と承認・締めの漏れを減らす |
| 4 帳票・拡張 | C5 → C6 → E4 → E2 → B7 | 紙の運用、証憑検索、定期仕訳、第三者の pack 追加 |
| 5 機能の穴 | E1、E3、E5、E6、F1、F2、F3、必要なら A3 | 中小企業の決算・運用に必要な残り |

波 0 と 1 は順番どおりに進める。波 2 以降は依存が無ければ入れ替えてよい。1 セッションで複数項目を進めるときも、ブランチと PR は項目ごとに分ける。

## 5. 各作業項目の設計

### A1. 3 段階の回帰テスト

実装済み（2026-10-29）。設計からの変更点（vitest の Node API による選択、setupFile と子プロセスの依存規則、AC-15〜AC-18、`--provision`、認証試験用の `GATE_IDENTITY_DATABASE_URL*`）と実測は [spec](specs/test-tiers.md) と [記録](log/2026-10-29-test-tiers.md) を正とする。light は module 変更で 10〜13 分かかり目標 6 分に届かないため、A3 を波0に前倒しした。

spec は [test-tiers](specs/test-tiers.md) に作成済み（draft）。要点:

- `scripts/gate.mjs` に `--tier quick|light|full` を実装し、`pnpm gate:quick` / `gate:light` / `gate:full` を追加する。`pnpm gate` は不変。
- quick は変更ファイル限定の Prettier / ESLint、変更 package の typecheck、`vitest --project unit --changed <base>`。light は全体の静的検査と unit 全件に、`vitest list --project db --changed` の関連 suite と kernel の番人 suite 4 件を足す。full は `gate` に API/Web の typecheck・build とブラウザ試験 2 種を足す。
- 昇格パターン（kernel、migration、依存、設定ファイル、CI）に触れたら light は DB 全件、quick は注意を表示。
- 報告は標準出力の表と `.runtime/gate/*.json`。fail-fast 既定、`--keep-going` あり。CI に `quick` job を追加。
- 検証: spec の手順 1〜10 を実行し、所要時間を log に残す。目標は quick 2 分、light 6 分。

### A2. E2E の smoke タグとアクセシビリティ自動検査

実装済み（2026-10-30 統合）。主要 8 画面 × 日英 × 1280/390px の axe 検査（33 件）、導入時の serious 違反 13 件を修正し例外 0 件。`@smoke` は 15 件。 詳細と設計からの変更は [spec](specs/e2e-a11y.md) と [記録](log/2026-10-29-e2e-a11y.md) を正とする。

- `@smoke` を 6〜8 件に付け、`pnpm e2e:smoke` で実行する（A1 の AC-11）。
- `@axe-core/playwright`（devDependency 追加、lockfile 更新）で、ログイン、ホーム、取引先一覧、売上請求書フォーム、設定、`/me`、`/workforce`、`/analytics` を日英 × デスクトップ/390px で検査する。`serious` / `critical` の違反で失敗。既知の例外は `apps/web/e2e/a11y-exceptions.json` に理由付きで登録し、例外の追加は spec の未決事項に書く。
- 受入基準の骨子: WHEN a11y spec が実行された THE SYSTEM SHALL 8 画面 × 2 幅 × 2 言語で axe を実行し、例外ファイルにない serious 以上の違反があれば失敗する。
- 対象外: 色コントラストの全面修正（違反が出た箇所は D1 で直す）。

### A3. DB suite 起動の短縮（計測後に判断）

実装済み（2026-10-30 統合）。計測で schema 再作成は DB 全体の 27%（50% 未満）だったが、除去できる最大の費用として schema ハッシュのテンプレート DB 複製を実装し、light では migration 系 10 suite を後回しにする。light はなお banking 6.8 分・sales 9.8 分で目標 6 分に届かず、A4 で続ける。 詳細と設計からの変更は [spec](specs/db-test-startup.md) と [記録](log/2026-10-29-db-test-startup.md) を正とする。

- 先に `freshDb()` の `dropAll` + `createSchemaFromScratch` の時間を 10 suite で計測し、suite 全体に占める割合を出す。
- 50% を超えるなら、schema のハッシュをキーにしたテンプレート DB（`CREATE DATABASE ... TEMPLATE`）を owner 接続で作り、suite ごとに複製する方式を spec にする。ハッシュが変わらない限り再作成しない。RLS・role・拡張の有無が同じであることを `checkColumns` 相当で確認する。
- 対象外: テストの並列化（`fileParallelism: false` は維持）。

### A4. gate:light の短縮

実装済み（2026-10-30 統合）。light は静的検査の lane と DB の lane を並行に走らせ、DB suite を `<試験DB>` と `<試験DB>_shard_2` に分ける（`--serial` か `GATE_DB_SHARDS=1` で従来の順序）。同じ時間帯の実測で banking 761→328 秒、sales 813→462 秒、kernel 1,260→655 秒。sales は負荷平均 9〜11 で目標 6 分に届かない。選択する suite の集合と full は変えていない。詳細と設計からの変更は [spec](specs/light-tier-speed.md) と [記録](log/2026-10-30-light-tier-speed.md) を正とする。

A3 の後も light は目標 6 分に届かない（module 変更で 6.8〜9.8 分、kernel 変更で約 15 分。DB が大半）。選択する suite の集合は変えずに、(1) 静的検査・単体と DB の並行実行、(2) DB suite を複数の試験 DB に分けて並行実行（各 DB 内は `fileParallelism: false` のまま）、(3) import の依存から影響が無いと証明できる suite だけの絞り込み、を計測して選ぶ。中断時の子プロセス停止、`.runtime/gate` の報告、full の対象範囲は変えない。spec は `docs/specs/light-tier-speed.md`（実装時に作成）。

### D1. UI キットとデザイントークン、状態表示の統一

実装済み（2026-10-29）。`FieldRow` は D3 へ移した。部品と規約は [spec](specs/ui-kit.md)、[UI 規約](conventions/ui.md) の「UI キットとトークン」、[記録](log/2026-10-29-ui-kit.md) を参照する。新しい画面は `apps/web/src/ui/token-usage.test.ts` の `CONVERTED` に登録する。

現状: 汎用画面（一覧・フォーム・設定・アクション・状態表示）は Tailwind ユーティリティの直書き、専用画面は 13 本の手書き CSS。色は hex 直書きが多く、分岐点は 12 種類。`<html lang="ja">` は英語表示でも固定。

設計:

- `apps/web/src/ui/` に小さな部品を置く: `PageHeader`（題名・副題・右側の操作）、`Toolbar`、`Card`、`EmptyState`（説明と主操作）、`Skeleton`（表・カード）、`Button`（primary / default / danger / ghost、既存 `.btn` に対応）、`Badge`（伝票状態・件数）、`Tabs`、`Dialog`（native `<dialog>` の薄い包み。`ActionConfirm` と同じ焦点管理）、`FormSection`、`FieldRow`、`DataTableShell`（枠・固定ヘッダ・右寄せ数値・空状態・読込骨格）。
- `styles.css` の `@theme` に意味トークンを足す: `--surface`、`--surface-muted`、`--border`、`--text`、`--text-muted`、`--accent`、`--danger`、`--success`、`--warning`。既存の hex は汎用画面から順にトークンへ置き換える。ダークモードは対象外だが、トークン化で後から足せる状態にする。
- 分岐点は 480 / 768 / 1024 / 1280 の 4 つに寄せる。専用 CSS は触った画面から順に合わせ、一括書き換えはしない。
- 状態表示: `LoadingView` を骨格表示に、`MetaError` は「何が起きたか（人向け）」を先に、`code` と `hint` は折りたたみに。トーストの `error` も同じ順序。`data-table` の `opacity-60` は骨格行に置き換える。
- `useLocale` の切替で `document.documentElement.lang` を同期する。
- `WorkforceDialog` / `CommerceDialog` / `ControlDialog` は `Dialog` に段階的に寄せる（この項目では置き換えず、新規は `Dialog` を使う規約にする）。
- 最初に置き換える画面: `entity-list-page`、`entity-form-page`、`settings-page`、`action-page`、`report-page`、`status-views`、`home-page`。
- 受入基準の骨子: WHEN 汎用画面が描画された THE SYSTEM SHALL キットの部品とトークンだけを使い、hex 直書きを含まない（lint か unit で検査）。WHEN 一覧が 0 件 THE SYSTEM SHALL 空状態と「新規」の導線を表示する。WHEN 言語を切り替えた THE SYSTEM SHALL `lang` 属性を更新する。
- 検証: 既存ブラウザ試験 69 件、390px の既存ケース、A2 の axe。スクリーンショット比較は CI のフォント差があるため導入しない。
- 対象外: ダークモード、専用画面の全面移行、アイコンセットの変更。

### B1. 設定定義の拡張と設定画面の再構成

実装済み（2026-10-30 統合）。`SettingDef` の `category` / `order` / `fields`、既定に戻す、変更履歴、勘定科目・倉庫のコード選択（[ADR-0027](adr/0027-setting-presentation.md)）。 詳細と設計からの変更は [spec](specs/settings-console.md) と [記録](log/2026-10-29-settings-console.md) を正とする。

設計:

- `SettingDef` に `category`（`company | accounting | tax | sales | purchase | inventory | contract | workforce | industry | integration`）、`order`、`fields?: Record<string, { label: Label; description?: Label; widget?: 'account-code' | 'warehouse-code' | 'checkbox' | 'textarea' | 'select' }>` を追加する。未指定の pack 設定は `industry`、その他は key の module 名から既定を決める。
- `GET /meta/settings` は新しい属性を返す。`PUT` の検証は不変。`DELETE /meta/settings/:key` を追加し、会社の値を消して module 既定に戻す（監査あり）。
- Web `/settings`: カテゴリのタブ、カード内の細目は `fields.label` を使う。`account-code` は `account` の有効行から選ぶピッカー（保存値は `code`）、`warehouse-code` も同様、boolean はチェックボックス、長文は textarea。会社の値が無いときは「既定を使用中」と既定値を表示し、「既定に戻す」を出す。
- 変更履歴: `setSetting` が書く監査から、直近 20 件（時刻・利用者・キー）を `GET /meta/settings/:key/audit` で返し、カードの「履歴」で表示する。
- 各 module の `SettingDef` に `fields` のラベルを追加する（tax、sales、purchase、payment、inventory、contract、workforce、各 pack の `due_days`）。
- ADR: `SettingDef` の拡張と kernel 側の `company.profile`（B2）をまとめて 1 本（ADR-0027 候補）。
- 受入基準の骨子: WHEN 設定画面を開いた THE SYSTEM SHALL カテゴリ別に設定を並べ、細目を日本語/英語のラベルで表示する。WHEN `account-code` の細目を編集する THE SYSTEM SHALL 有効な勘定科目から選ばせ、存在しないコードを保存しない。IF 会社の値が無い THEN THE SYSTEM SHALL module 既定を表示し、既定に戻す操作で会社の値を削除する。
- 検証: 設定の unit（schema → fields）、API の DB テスト（DELETE と監査）、ブラウザ試験（タブ、ピッカー、既定に戻す）。マニュアル 03 の表を更新。

### B2. 会社の追加・編集と会社プロフィール

実装済み（2026-10-30 統合）。kernel の `createCompany`（app role の RLS で挿入でき owner 接続は使わない。会社行・作成者の admin 所属・監査・全 module の seed を 1 トランザクションで行う）、設定 `company.profile`、`sales.issuer` 未設定時の発行者の組み立て、`/admin/companies`（[ADR-0029](adr/0029-company-creation.md)）。作成後は自動で切り替えず切替ボタンを出す。通貨は当面 JPY のみ。詳細と設計からの変更は [spec](specs/company-admin.md) と [記録](log/2026-10-30-company-admin.md) を正とする。

設計:

- kernel に `createCompany(ctx, { code, name, country, currency })` を追加する。テナント管理者のみ。同じトランザクションで、会社行の挿入、作成者の `admin` 所属、全 module の `seed` を `systemParams(tenantId, companyId)` で実行（seed は冪等で、setup と `db:reset` が同じ経路を使う）、監査を行う。`companies` への挿入が app role の RLS で許可されるかを先に確認し、許可されないなら kernel の owner 接続を使う経路を setup と共有する（実装時に確認し、結果を spec に書く）。
- 会社プロフィールは kernel が登録する設定 `company.profile`（郵便番号、住所、電話、メール、登録番号 `T+13 桁`、課税/免税、決算月、代表者名）。`companies` の列は増やさない（移行不要）。`sales.issuer` が未設定のとき、請求書の発行者欄は `company.profile` と会社名から組み立てる。申告資料・給与資料も同じ出典を読むよう、該当 module の読み取り箇所を 1 か所ずつ差し替える。
- API: `GET /admin/companies`（テナント管理者）、`POST /admin/companies`、`PATCH /admin/companies/:id`（`name`、`country`。`code` と `currency` は作成後不変）。
- Web: `/admin/companies` の一覧と作成フォーム。作成後はその会社へ切り替え、B4 のウィザードへ誘導する。会社ピッカーの再取得。
- 受入基準の骨子: WHEN テナント管理者が会社を作成した THE SYSTEM SHALL 新会社に勘定科目・税率・会計年度などの module 初期データを投入し、作成者を管理者として所属させる。IF テナント管理者でない THEN THE SYSTEM SHALL 作成と編集を拒否する。WHEN `sales.issuer` が未設定で請求書を表示した THE SYSTEM SHALL `company.profile` の名称・登録番号・住所を印字する。
- 検証: kernel の DB テスト（seed の実行、所属、監査、権限拒否、RLS）、ブラウザ試験（2 社目の作成と切替、非管理者の拒否）。マニュアル 08 と付録 E を更新。
- 対象外: 会社の削除・無効化、テナントの作成、会社間のデータ移動。

### B3. 導入チェック（ヘルスチェック）

実装済み（2026-10-30 統合）。kernel の `registry.registerHealthCheck` port（呼出し元の Context で savepoint 内に実行）、`GET /meta/health`、`/admin/health`（[ADR-0027](adr/0027-setting-presentation.md) の 7 節）。項目 id（`accounting.fiscal_period`、`tax.standard_rate`、`company.profile`、`sales.issuer`、`inventory.stock_settings`、`system.*`）は B4 の完了判定で使うため固定する。バックアップ最終時刻は対象外にした。詳細と設計からの変更は [spec](specs/setup-health.md) と [記録](log/2026-10-30-setup-health.md) を正とする。

設計:

- `GET /meta/health`（admin または settings ロール）が項目の配列を返す: `{ id, status: 'ok' | 'warn' | 'fail', label: Label, detail: Label, href? }`。
- 項目: 今日を含む会計期間が開いている、税率の有効期間が今日を覆う、`company.profile` と `sales.issuer` の必須項目、在庫を使わない設定の整合（自動入出庫 on で品目に物品がある等は注意）、SMTP / OIDC の設定有無（真偽のみ）、未適用の migration（journal と適用済みの数の比較のみ）、outbox の滞留件数、添付保存先の書込可否、バックアップ最終時刻（setup の状態ファイルがあれば）。秘密値・接続先は返さない。
- Web `/admin/health`: 項目の一覧と「直す」リンク。B4 の完了判定と共用。
- 受入基準の骨子: WHEN 管理者がヘルスチェックを開いた THE SYSTEM SHALL 各項目の状態と対処先を表示する。IF 今日を含む会計期間が無い THEN THE SYSTEM SHALL `fail` と会計年度作成への導線を示す。THE SYSTEM SHALL 秘密値・接続文字列を応答に含めない。
- 検証: API の DB テスト（各項目の ok / fail を作る）、ブラウザ試験 1 件。

### B4. セットアップウィザード

設計:

- ルート `/setup`。管理者のみ。初回ログイン後（`setup.progress` が無く、ヘルスチェックに `fail` がある）はホームに「セットアップを続ける」カードを出す。任意の時点で開ける。
- ステップ: (1) 会社情報 `company.profile`、(2) 会計年度 `accounting.open_fiscal_year`（決算月から開始日を提案）、(3) 勘定科目（既定表の確認、`/e/account` へのリンク）、(4) 税率と端数処理（tax 設定）、(5) 請求書の発行者（`sales.issuer`、プロフィールから複写）、(6) 在庫の扱い（自動入出庫の on / off を業種の説明付きで選択）、(7) 業界テンプレート（既存テンプレート画面を埋め込み、サンプル投入可）、(8) 利用者（招待メールか直接作成。既存 `/admin/users` の部品を再利用）、(9) 勤怠・給与（任意。`workforce.initialize_policy`）。
- 進捗は kernel が登録する設定 `setup.progress`（完了・スキップしたステップとその理由、更新時刻）。完了判定は保存の有無ではなく実データの条件（B3 の項目）で行い、`GET /meta/setup-status` が返す。
- 新しい書込経路は作らない。各ステップは既存の `PUT /meta/settings/:key`、`POST /actions/...`、`POST /admin/users...` を呼ぶ。
- 受入基準の骨子: WHEN 管理者が初回にログインした THE SYSTEM SHALL ホームに未完了のセットアップを表示する。WHEN ステップを完了した THE SYSTEM SHALL 実データの条件で完了を判定し、ブラウザを閉じても再開できる。IF ステップをスキップした THEN THE SYSTEM SHALL 理由を記録し、チェックリストに未完了として残す。THE SYSTEM SHALL 既存 API の権限検査をそのまま通す。
- 検証: ブラウザ試験（新会社で 9 ステップを通し、売上請求書の確定まで）、390px、権限なし利用者の拒否。マニュアル 03 を書き換える。

実装済み（2026-10-30 統合）。kernel の設定 `setup.progress`（段階ごとの完了・スキップと理由。表示属性 `managedBy` で設定画面からは読取専用にし、書込みは `writeRoles` で admin に限る）、`GET /meta/setup-status`（apps/api。B3 の項目 id と 4 つの条件から実データで判定し、会社の admin だけ）、`/setup` の 9 段階とホームの「セットアップを続ける」カード（役割別ホームのビュー切替の上）。各段階は既存の設定 API・action・`/admin/users` を呼び、新しい書込み経路は作らない（[ADR-0027](adr/0027-setting-presentation.md) の 8 節。新しい ADR は使っていない）。カードは必須の段階が未完了か、検査に fail があるときに出る。スキップは理由付きで残り件数に数えないが、検査が fail なら警告を続ける。会計年度は作るだけで、既存の年度は変えない。詳細と設計からの変更は [spec](specs/setup-wizard.md) と [記録](log/2026-10-30-setup-wizard.md) を正とする。

### B5. マスタの CSV 取込

実装済み（2026-10-30 統合）。kernel の import port と派生 action `<entity>.import`、`POST /api/:entity/import`、`/e/:entity/import`（[ADR-0028](adr/0028-import-port.md)）。伝票は対象外。 詳細と設計からの変更は [spec](specs/csv-import.md) と [記録](log/2026-10-29-csv-import.md) を正とする。

設計:

- kernel に `import.ts`（port）: `importRecords(ctx, entity, rows, { mode: 'dry-run' | 'execute', onExisting: 'skip' | 'update', keyField? })`。列は DSL の field から導出し、型変換（日付、Decimal 文字列、真偽の `true/false/はい/いいえ`、enum の値またはラベル）、`ref` は参照先の `code`（または `displayField`）で解決、`unique` の text を自然キーとする。dry-run は `withSavepoint` の中で実際に `Repository` を通して検証し、最後にロールバックする（hook と権限を含めて本番と同じ検査になる）。結果は行ごとの `{ line, status: 'created' | 'updated' | 'skipped' | 'error', message? }`。
- 制限: 1 要求 5,000 行、2 MB。document は下書きとしてのみ作成し、確定しない（規約 4）。明細を持つ document は対象外（まず `entity` 種別のマスタ）。
- API: `POST /api/:entity/import`。create 権限（`update` 指定時は update 権限も）。`GET /api/:entity/import-template.csv` でヘッダ付き雛形。
- Web: `/e/:entity/import`（一覧の「取込」から）。ファイル選択 → 文字コード判定（UTF-8 / BOM / Shift_JIS は `TextDecoder`）→ 列の自動対応（ヘッダ = ラベル ja/en か field 名）と手動対応 → 事前確認（先頭 50 行と行ごとの結果）→ 実行 → 件数とエラー CSV のダウンロード。
- ADR: kernel の import port（dry-run の savepoint、権限、制限）を 1 本。
- 受入基準の骨子: WHEN CSV を事前確認した THE SYSTEM SHALL 行ごとの結果を返し、DB を変更しない。WHEN 実行した THE SYSTEM SHALL `Repository` を通して作成・更新し、各行を監査する。IF 参照先のコードが無い THEN THE SYSTEM SHALL その行を error とし、他の行の処理を続ける（all-or-nothing は選択式）。THE SYSTEM SHALL 金額を `Decimal` 文字列として扱い、浮動小数に変換しない。
- 検証: kernel の unit（型変換）と DB テスト（dry-run の無変更、権限、ref 解決、重複）、ブラウザ試験（取引先 100 行と品目 50 行の取込、エラー CSV）。
- 対象外: 明細付き document の取込、他システム固有の形式、スケジュール取込。

### B6. 期首残高の取込

設計（spec で確定する選択肢を含む）:

- 開始仕訳: `accounting.import_opening_balances { date, rows: [{ accountCode, partnerCode?, debit, credit }] }` が貸借一致を検査し、会計年度開始日の前日付で 1 本の仕訳を作る（`source: 'opening'`）。
- 売掛・買掛の明細残高: 取引先別の未消込残高は、不課税の「期首残高」品目を 1 行持つ売上/仕入請求書として作る案（消込・年齢表がそのまま使える。開始仕訳からは売掛金・買掛金を除く）と、開始仕訳の取引先付き明細だけで持つ案（消込できない）がある。前者を推奨し、spec の未決事項で確認する。
- 在庫の初期数量と単価: `inventory.entry` の入庫で作る（評価は移動平均の初期値になる）。
- 受入基準の骨子: IF 貸借が一致しない THEN THE SYSTEM SHALL 取り込まない。WHEN 取り込んだ THE SYSTEM SHALL 試算表の期首残高と年齢表の残高が CSV と一致する。
- 検証: golden（CSV → 試算表 / 年齢表）、ブラウザ試験 1 件。

実装済み（2026-10-30 統合）。開始仕訳は期首日の前日（期首残高日）付で年度ごとに 1 本、`sourceEntity='fiscal_year'` で年度に紐づける。この日はどの会計期間にも入らないため、accounting の内部の書込み権 `accounting.opening` を通した取込だけが転記できる。売掛・買掛は取引先ごとに不課税 1 行の期首請求書（`openingBalance`。適格請求書としての表示は拒否）、在庫は期首残高日付の入庫で作る。取引先なしの売掛・買掛の行と期首請求書の相手科目は期首残高仮勘定（設定 `accounting.opening_balances`、l10n/jp の科目表に 3900 を追加）を通し、全部が一致すると残高が 0 になる。取り込めるのは会社の最初の会計年度だけ。1 ファイルの上限は計測から売掛・買掛 200 行、在庫 2,000 行に下げた（[ADR-0030](adr/0030-opening-balances.md)）。詳細と設計からの変更は [spec](specs/opening-balances.md) と [記録](log/2026-10-30-opening-balances.md) を正とする。

### B7. pack 雛形生成

- `scripts/pack-new.mjs <name>` が `packs/example` を元に `package.json`、`tsconfig.json`、`src/{index,pack,entities,actions,seed,sample}.ts`、`test/pack.db.test.ts`、`docs/specs/pack-<name>.md` の雛形を作り、`apps/runtime/src/packs.ts` への登録手順を表示する。
- 受入基準の骨子: WHEN 雛形を生成して `pnpm gate:light` を実行した THE SYSTEM SHALL 追加なしで成功する。
- 検証: 生成 → 依存境界 lint → DB テスト → 画面での適用。第三者完走の記録条件（[拡張手順](architecture/extension-guide.md)）を満たすかを log に書く。

実装済み（2026-10-30 統合）。`node scripts/pack-new.mjs <name> [--register] [--dry-run]` が `scripts/pack-template/` から pack と spec の雛形を作る。名前の検査と衝突の拒否、書き込む前の全計算、失敗・中断時の巻戻しを持ち、`--register` で runtime の登録 4 か所を書き換える。生成した pack の DB 試験を子の vitest で走らせる DB 試験も足した。第三者完走の記録条件は、エージェントの実行なので満たしていない（拡張手順に記載）。詳細と設計からの変更は [spec](specs/pack-scaffold.md) と [記録](log/2026-10-30-pack-scaffold.md) を正とする。

### C1. 一覧の絞り込み・列・保存ビュー・CSV・一括操作

実装済み（2026-10-30 統合）。CSV は `GET /api/:entity/export.csv` ではなく、派生 action `<entity>.export_rows`（export 権限、5,000 行、監査 1 行）を既存の `POST /actions/:name/export` で呼ぶ形にした。 詳細と設計からの変更は [spec](specs/list-workbench.md) と [記録](log/2026-10-29-list-workbench.md) を正とする。

設計:

- 絞り込み: entity meta から自動生成する。document の `docstatus`、日付 field の範囲、`ref` のピッカー、`enum` の複数選択、money の範囲、`bool`。状態は URL の `where`（`lib/query.ts` は既に `where` を持つ）に JSON で保持し、REST の `where` にそのまま渡す。使える演算子は kernel の `Domain` に合わせる。
- 列: 列の選択と並び替え、幅はブラウザ既定。保存先は `localStorage`（利用者・tenant・会社・entity ごと、`analytics-storage` と同じ境界）。`views.list` に戻す操作。
- 保存ビュー: v1 は同じ `localStorage` に名前付きで保存。v2（別項目）で DSL entity `saved_view` による会社共有。
- 合計: 表示ページの money 列の合計を脚注に出す。条件全体の合計は `aggregate` の API がある場合のみ（無ければ対象外と明記）。
- CSV: サーバー側 `GET /api/:entity/export.csv?where=&orderBy=`。read 権限、列マスクは `.list` と同じ、上限 5,000 行、監査に `export` を記録。レポートの再認可と同じく、クリック時に取得し直す。
- 一括操作: 複数選択して「確定」「取消」「削除」。1 件ずつ `POST /api/:entity/:id/:op` を `expectedVersion` 付きで呼び、行ごとの成否を一覧で表示する。失敗を隠さず、途中停止はしない（選択式で「最初の失敗で止める」）。
- 受入基準の骨子: WHEN 絞り込みを変更した THE SYSTEM SHALL URL に反映し、再読込と戻る操作で復元する。WHEN CSV を出力した THE SYSTEM SHALL 現在の条件と列マスクで最大 5,000 行を返し、監査に記録する。WHEN 一括確定で一部が失敗した THE SYSTEM SHALL 成功分を取り消さず、失敗した行と理由を表示する。
- 検証: unit（where 生成、列の保存）、API の DB テスト（export の権限・マスク・上限・監査）、ブラウザ試験（絞り込み、保存ビュー、CSV の中身、3 件一括確定で 1 件失敗）。

### C2. 伝票の複製・関連伝票・クイック操作

実装済み（2026-10-30 統合）。複製、`<entity>.related`（`GET /api/:entity/:id/related`）、伝票のクイック操作。 詳細と設計からの変更は [spec](specs/document-links.md) と [記録](log/2026-10-29-document-links.md) を正とする。

- 複製: 画面側で record と lines を取得し、system 列・`serverOwned`・`immutable` で `unique` の field（`code` など）・`number`・`docstatus` を除いて `/e/:entity/new` に初期値として渡す（router state）。作成権限で動く。
- 関連伝票: kernel に `GET /api/:entity/:id/related`。registry の `ref` から逆参照（この記録を参照する document）と順参照（この記録が参照する記録）を集め、entity ごとに読取権限と row rule を通し、各 50 件まで。`journalEntryId`、`amendedFrom`、訂正先も含める。フォーム画面に「関連」パネル。
- クイック操作: `apps/web/src/lib/quick-actions.ts` に宣言（`sales_invoice` → 入金を記録、`purchase_invoice` → 支払を記録、`trade_quotation` → 受注へ、など）。遷移先の新規フォームに取引先・区分・消込行を初期値で渡す。
- 受入基準の骨子: WHEN 複製した THE SYSTEM SHALL 新しい下書きを採番せずに開き、確定済みの番号や状態を持ち越さない。WHEN 関連伝票を表示した THE SYSTEM SHALL 読取権限の無い entity を一覧に含めない。
- 検証: kernel の DB テスト（related の権限と件数）、ブラウザ試験（複製と入金のクイック操作）。

### C3. やること受信箱

実装済み（2026-10-30 統合）。kernel の `todoResult` 契約と provider 6 件（workforce・payment・banking・edge・tax_filing・restaurant_chain）。sales の項目は payment.todo に統合した。 詳細と設計からの変更は [spec](specs/inbox.md) と [記録](log/2026-10-29-inbox.md) を正とする。

- 規約: `<module>.todo` という名前の action（`resultKind` は通常の JSON、`mutates: false`）が `{ items: [{ key, label: Label, count, href, severity: 'info' | 'warn' }] }` を返す。各 provider は自分の `Repository` 読取で件数を数えるため、権限と会社・拠点の境界は既存のまま。
- Web: `/meta` の action のうち `.todo` で終わり呼べるものを `Promise.allSettled` で呼び、ホームのカードと `/inbox` にまとめる。失敗した provider は「取得できませんでした」と出し、他を隠さない。
- 初版の provider: workforce（承認待ちの訂正・有給・経費、未確定の給与）、restaurant_chain（未提出・承認待ちの日次報告）、banking（照合待ちの明細）、sales（期限超過の請求）、payment（未消込の入出金）、edge（結果不明のジョブ）、tax_filing（確認待ちの資料）。
- 受入基準の骨子: WHEN 受信箱を開いた THE SYSTEM SHALL 利用者が呼べる provider の件数と導線を表示し、呼べない provider を表示しない。IF provider が失敗した THEN THE SYSTEM SHALL その provider だけを失敗表示にする。
- 検証: provider ごとの DB テスト（境界）、ブラウザ試験 1 件。`docs/conventions/ui.md` に規約を追加。

### C4. 月次締めガイド

実装済み（2026-10-30 統合）。`accounting.close_readiness` と `/finance/close`。下書きの href は C1 の `?status=draft&from&to` で絞り込んだ一覧を開く。 詳細と設計からの変更は [spec](specs/close-guide.md) と [記録](log/2026-10-29-close-guide.md) を正とする。

- `accounting.close_readiness { periodId }` が点検項目を返す: 期間内の下書き伝票（entity ごとの件数と絞り込み済み一覧への href）、未消込の入出金、照合待ち明細（banking 適用時）、在庫期間の未締め、前期間の未締め、未転記の原資料。各項目に `blocking` の有無。
- Web `/finance/close`: 期間の選択、点検項目、試算表・消費税集計表・年齢表・在庫評価への導線、すべての `blocking` が 0 のときだけ有効になる「期間を締める」ボタン（既存 `accounting.close_period`）。再開と訂正日の案内も同じ画面に置く。
- 受入基準の骨子: WHILE blocking の項目が残る WHEN 締めを押そうとした THE SYSTEM SHALL 実行せず残件を示す。WHEN 全項目が 0 THE SYSTEM SHALL 既存の締め action を実行し、結果を表示する。
- 検証: DB テスト（点検項目の計数）、ブラウザ試験（下書き 1 件を残した状態からの締め拒否と、確定後の締め）。マニュアル 06 を更新。

### D2. コマンドパレット・最近の記録・お気に入り・ヘルプ導線

実装済み（2026-10-30 統合）。`Ctrl/⌘+K` のパレット、最近開いた記録（30 件）、お気に入り（20 画面）、画面ごとのマニュアル導線。 詳細と設計からの変更は [spec](specs/navigation-assist.md) と [記録](log/2026-10-29-navigation-assist.md) を正とする。

- `Ctrl/⌘+K` で `searchNavigation` を使うパレットを開く（既存の正規化検索を再利用）。候補は画面と、最近開いた記録（entity・id・表示名を `localStorage` に利用者・tenant・会社ごとに 30 件）。
- サイドバーに「最近」と「お気に入り」。お気に入りは画面単位。
- ヘルプ導線: `lib/help.ts` にルート → マニュアル章の対応表を持ち、`ScreenTrail` に「この画面の説明」を出す。リンク先は `VITE_MANUAL_URL`（既定は公開リポジトリの `docs/manual`）。
- 受入基準の骨子: WHEN `Ctrl+K` を押した THE SYSTEM SHALL 入力欄に焦点を移し、権限のある画面だけを候補に出す。WHEN 記録を開いた THE SYSTEM SHALL 最近の一覧に加え、別会社に切り替えたら表示しない。
- 検証: unit（保存境界）、ブラウザ試験（パレットで画面を開く、390px）。

### D3. フォームのセクション・エラー要約・ショートカット・モバイル操作バー

実装済み（2026-10-30 統合）。`views.form` のラベル付きグループ（[ADR-0002](adr/0002-declarative-entity-dsl.md) の追補。取引先・売上/仕入請求書・支払・契約に適用）、エラー要約と焦点移動、`Ctrl/⌘+S`・`Ctrl/⌘+Enter`、明細グリッドのキー操作、390px の下部操作バー、`sessionStorage` への入力退避（制限項目は保存しない）、一覧からの前後移動。狭い画面はタブにし、行削除のショートカットは置かない。詳細と設計からの変更は [spec](specs/form-ergonomics.md) と [記録](log/2026-10-30-form-ergonomics.md) を正とする。

- DSL: `views.form` の各グループに `{ label: Label, fields: string[] }` を許し、`/meta` が出す。既存の `string[][]` は互換で残す。
- 画面: グループを `FormSection` で描画し、グループが 4 以上で幅が狭いときはタブ。保存失敗時はフォーム上部に `role="alert"` の要約（項目名のリンク付き）を出し、最初の不正項目へ焦点を移す。必須マークと `description` を補助文として表示。
- 操作: `Ctrl/⌘+S` で保存、`Ctrl/⌘+Enter` で確定の確認を開く、明細グリッドは `Enter` で次セル、末尾で行追加、`Alt+↑/↓` で行移動。狭い画面では保存・確定を下部の固定バーに置く。
- 入力の退避: 未保存の入力を `sessionStorage` に entity と id ごとに退避し、再表示時に復元を提案する（既存の一時障害時の保持を一般化）。
- 一覧から開いた記録では「前へ / 次へ」で同じ条件の隣の記録へ移動する（一覧の id 列を router state で渡す）。
- ADR: `views.form` のラベル付きグループ（短い ADR か ADR-0002 の追補）。
- 受入基準の骨子: WHEN 保存が VALIDATION で失敗した THE SYSTEM SHALL 要約を表示し最初の項目へ焦点を移す。WHEN `Ctrl+S` を押した THE SYSTEM SHALL 保存を実行し、ブラウザの保存ダイアログを開かない。
- 検証: unit（グループ解釈、ショートカットの判定）、ブラウザ試験（要約と焦点、390px の操作バー、前後移動）。

### C5. 帳票の共通化と拡充

- 規約を `<module>.render_<document>_html`（入力 `id`）に一般化し、`lib/print.ts` が entity ごとに該当 action を見つける。レイアウト共通部（発行者ブロック、宛先、明細表、合計、備考、和暦切替）を module が import できる純粋関数として `modules/` のいずれか（sales の既存実装を抽出）に置く。
- 追加する帳票: 見積書（trade_quotation）、注文書（trade_order）、納品書（trade_fulfillment）、領収書（payment）、支払通知書（purchase_settlement）、合計請求書（取引先の締め日で期間内の売上請求書をまとめる新 action `sales.render_statement_html { partnerId, closingDate }`）、給与明細（workforce payslip）。
- 発行者情報は `sales.issuer` → `company.profile` の順で解決。ロゴは対象外（添付基盤での対応は別項目）。
- 受入基準の骨子: WHEN 確定済みの対象 document を開いた THE SYSTEM SHALL 印刷ボタンを表示し、権限のある利用者だけが HTML を取得できる。THE SYSTEM SHALL 金額の端数処理と税率別内訳を保存済みの値から表示し、再計算しない。
- 検証: golden（HTML の固定部分）、ブラウザ試験（印刷タブの表示）。

実装済み（2026-10-30 統合）。action 定義に `print: { entity, label, idInput?, when?, fields? }` の宣言を足し（[ADR-0009](adr/0009-actions-rest-mcp.md) の追補）、画面は `/meta` の宣言からボタンを出す（接尾辞による発見は廃止）。共通のレイアウト部品は新しいライブラリ `@daifuku/mod-print-layout`（kernel と zod だけに依存、設定 `print_layout.date_style` で和暦・西暦）。帳票は請求書（期首請求書は除く）、合計請求書（取引先の締め日で区切った期間の確定済み請求書。期首請求書は載せない）、見積書、注文書、納品書、領収書と支払通知書（どちらも payment。計画の purchase_settlement ではない）、給与明細。金額と税率別の内訳は保存値を使い再計算しない。領収書の記載事項と印紙税の注意は国税庁の一次資料を確認できなかったため印字していない。詳細と設計からの変更は [spec](specs/print-templates.md) と [記録](log/2026-10-30-print-templates.md) を正とする。

### C6. 役割別ホーム

- `meta.roles` と所属から初期表示を選ぶ: 経理（売掛・買掛・資金・今月の締め状況・受信箱）、店長（今日の売上・勤怠・シフト・未提出）、従業員（`/me` へ）。既存の analytics データセット、operations snapshot、C3 の受信箱を使い、新しい集計は作らない。
- 受入基準の骨子: WHEN 利用者がホームを開いた THE SYSTEM SHALL 役割に応じた初期表示を出し、権限の無い集計を要求しない。

実装済み（2026-10-30 統合）。`/meta` の役割・画面カタログ・テナント管理者の別から経理・店舗・従業員・管理・全体の表示を選ぶ。複数の表示に当てはまる利用者は切り替えられ、選択は利用者・会社ごとに端末へ保存する。既存の action・REST・analytics データセットだけを呼び、権限の無い読取を送らないことをブラウザ試験のネットワーク記録で確かめた。管理の表示には導入チェック（B3）へのリンクが出る。変更は apps/web と docs だけ。詳細と設計からの変更は [spec](specs/role-home.md) と [記録](log/2026-10-30-role-home.md) を正とする。

### E4. 証憑の横断検索（電子帳簿保存法の検索要件）

- `/finance/evidence`: `attachment` を取引年月日の範囲、取引金額の範囲、取引先の組み合わせで検索（既存の列と索引、複合範囲検索を使う）。結果からリンク先の伝票と差替履歴（`supersededById`）へ移動。選択した証憑の一括ダウンロード（zip はブラウザ側で生成、上限あり）。
- 出典: [日本の制度事実](domain/japan-tax.md) の電子帳簿保存法の項（取引年月日・取引金額・取引先、範囲と 2 項目以上の組み合わせ）。
- 受入基準の骨子: WHEN 日付範囲と金額範囲と取引先を指定した THE SYSTEM SHALL 3 条件の AND で検索する。THE SYSTEM SHALL 差し替えられた証憑を削除せず、履歴として表示する。

実装済み（2026-10-30 統合。ただし AC-6 は判断待ち）。`attachment.evidence_search`（取引年月日・取引金額の範囲と取引先の AND に、種別・差替の扱い・3 項目の欠けた証憑の条件）、`attachment.history`（差替の系譜）、`/finance/evidence` を足した。一括ダウンロードはブラウザで zip を作り（50 件かつ 100 MB まで）、ファイルは既存の認可付きダウンロードを通す。証憑の行・履歴・ダウンロードはリンク先の記録の読取規則を継がない（例: 営業が仕入請求書に付いた証憑のファイル名・金額・取引先を見られる）。この差は [権限](architecture/permissions.md) に既知の穴として記録した。閉じるには polymorphic リンクの行規則を kernel に足す spec と ADR が要り、利用者の判断を待つ（[候補一覧の8章](improvement-candidates.md#8-実装で残った判断待ち2026-10-30)）。詳細と設計からの変更は [spec](specs/evidence-search.md) と [記録](log/2026-10-30-evidence-search.md) を正とする。

### E2. 定期仕訳

- entity `recurring_journal`（名称、周期、開始/終了、明細テンプレート、次回日付）と action `accounting.generate_recurring { asOf }` が期日到来分の仕訳を下書きで作る（確定は人が行う。設定で自動確定を選べるが既定は off）。前払費用の按分は期間と金額から明細を生成する。
- 受入基準の骨子: WHEN 生成を 2 回実行した THE SYSTEM SHALL 同じ期日の仕訳を重複して作らない。

実装済み（2026-10-30 統合）。kernel の `defineEntity` が明細（`lines`）を持てるようにした（[ADR-0031](adr/0031-entity-lines.md)。伝票の明細の処理を使い、凍結は伝票だけ）。accounting に `recurring_journal`（定額・按分、月次・四半期・年次、日 31 は月末）、`accounting.generate_recurring { asOf }`、予定 `accounting.recurring_schedule`、`accounting.todo`、`/finance/recurring` を足した。生成は（定期仕訳, 回の日付）の一意索引とロックで、2 本の同時実行でも重複しない。締めた期間の回は理由付きで止める。按分は最小単位へ切り捨て、端数を最終回に寄せる。自動確定の設定 `accounting.recurring_auto_submit` は既定 off。期日での自動生成は F1（worker）を待つ。詳細と設計からの変更は [spec](specs/recurring-journals.md) と [記録](log/2026-10-30-recurring-journals.md) を正とする。

### E1. 固定資産台帳と減価償却

- 新 module `fixed-assets`: `fixed_asset`（取得日、取得価額、耐用年数、償却方法、償却開始、事業供用、勘定科目、所在拠点）、`depreciation_run`（期間ごとの償却計算と仕訳）、除却・売却の document。定額法・定率法（200%）と月割、期中取得、残存 1 円。制度値（耐用年数表、償却率表）は `l10n/jp` に期間付きデータとして持ち、出典と確認日を `docs/domain/japan-fixed-assets.md` に置く。
- 償却資産申告の準備資料（CSV）は B/S 科目別の集計まで。申告書そのものは対象外。
- 受入基準の骨子: WHEN 償却を実行した THE SYSTEM SHALL golden の手計算と一致する仕訳を期間ごとに 1 本作る。IF 期間が締まっている THEN THE SYSTEM SHALL 作らない。

### E3. 資金繰り表と支払予定

- action `finance.cash_forecast { from, to }` が、売上請求の支払期日、仕入請求の支払期日、契約請求予定、給与の支払日、銀行振込予約を日別に集計し、入金予定・支払予定・残高推移を返す。督促状は C5 の帳票として `sales.render_reminder_html`。
- 受入基準の骨子: THE SYSTEM SHALL 確定済み伝票だけを予定に含め、下書きは別色で任意表示とする。

### E5. 経費精算の一般化

- 従業員経費に加え、法人カード・仮払・立替の区分、精算 document から支払（payment）と仕訳までを 1 本の流れにする。承認は既存の workforce の確認待ちに載せる。
- 受入基準の骨子: WHEN 精算を確定した THE SYSTEM SHALL 支払と仕訳を同じトランザクションで作る。

### E6. 給与 2027 年版の制度データ

- [給与制度版](specs/payroll-rule-versions.md) の仕組みに沿って、2027 年の月額表・保険料率・年調のデータを一次資料から投入する。公表前の値は入れない。出典と確認日を `docs/domain/japan-payroll-automation.md` に追記。

保留（2026-10-30）。協会けんぽの 2027 年度の保険料率は例年 2〜3 月に決まるため、この時点では公表されていない。2027 年分の源泉徴収税額表も、この環境から国税庁の一次資料（www.nta.go.jp）に接続できず確認できていない。公表前の値は入れない方針どおり着手せず、一次資料を読める環境で公表後に spec を書く。

### F1. 業務イベントの配送 worker

- `apps/api` に outbox の配送 worker（`deliverPending` の定期実行）と、購読者の初版: メール（認証用 transport を共有）、Webhook（署名付き POST、再試行、失敗の可視化）。購読の設定は会社設定 `integration.webhooks`。C3 の受信箱の件数変化を通知する購読を 1 つ用意する。
- 受入基準の骨子: WHEN 配送に失敗した THE SYSTEM SHALL 再試行し、上限後は失敗として記録して管理画面に表示する。THE SYSTEM SHALL 同じイベントを 2 回配送しても受信側で区別できる ID を付ける。

### F2. 機械用資格情報（API キー）

- テナント管理者が発行する、期限・会社・ロール・用途（MCP / 連携）を持つトークン。人の JWT と同じ `Context` に解決し、権限は同じ経路。失効と最終使用時刻、監査。ADR-0023 の機械認可の考え方を一般化する。
- 受入基準の骨子: IF 期限切れか失効済み THEN THE SYSTEM SHALL 401 を返す。THE SYSTEM SHALL トークン本体を発行時に一度だけ表示し、ハッシュだけを保存する。

### F3. 権限マトリクスと監査の横断検索

- `/admin/permissions`: entity × ロール × 操作の表（`registry` から導出、会社・拠点の制限は注記）。`/admin/audit`: 期間・利用者・entity・操作で監査を横断検索（既存の監査表に索引が足りなければ移行を伴う）。
- 受入基準の骨子: THE SYSTEM SHALL 表の内容をソースの permission 定義から導出し、手書きの一覧を持たない。

## 6. 横断する設計決定（ADR 候補）

| 候補 | 内容 | 必要性 |
| --- | --- | --- |
| ADR-0027 設定定義の表示属性と会社プロフィール | `SettingDef` の `category` / `order` / `fields`、kernel 登録の `company.profile` と `setup.progress`、`DELETE /meta/settings/:key` | B1、B2、B4 |
| ADR-0028 取込 port | dry-run を savepoint で実行し、`Repository` を通す。権限・上限・document は下書きのみ | B5、B6 |
| ADR-0029 会社作成と初期データ | テナント管理者の会社作成で module seed を system context で実行する境界 | B2 |
| ADR-0030 期首残高 | 期首残高日付・期首残高仮勘定・開始仕訳と module ごとの期首伝票への分割 | B6 |
| ADR-0031 entity の明細 | `defineEntity` の `lines`（伝票以外の明細。凍結は伝票だけ） | E2 |
| ADR-0002 追補 `views.form` のラベル付きグループ | DSL の後方互換な拡張 | D3 |
| 規約追加（ui.md） | `*.todo` provider、`render_<document>_html`、一覧 export の監査、UI キットの使用 | C3、C5、C1、D1 |
| 規約追加（testing.md、verification-and-release.md） | 3 段階の使い分け、`@smoke`、axe の例外ファイル | A1、A2 |

## 7. 完了の定義と記録

各項目は次を満たしたときに完了とする。

1. spec の状態が `implemented` になり、受入基準ごとにテスト名へ `AC-n` が入っている。
2. 開発中は `gate:quick` / `gate:light`、完了前に `pnpm gate:full`（A1 以前は `pnpm gate` とブラウザ試験）が成功している。昇格パターンに触れた変更は full が必須。
3. マニュアル（該当章または付録）と、必要なら `docs/domain/` の出典を更新した。
4. `docs/log/<date>-<slug>.md` に、決めたこと、実行した検証とその方法（測定か目視か）、未検証の範囲、計測した所要時間を書いた。`pnpm metrics:add` で数値を残す。
5. STATUS と PLAN を更新し、この文書と候補一覧から項目を消した。
6. PR の CI が全 job 成功している。

## 8. 引継ぎメモ（次の実装セッション向け）

開始手順:

1. `AI_INDEX.md` → この文書 → 着手する項目の設計 → 関連する既存 spec / 規約 / ソースの順で読む。過去 log の全読込はしない。
2. `git fetch origin main` し、`feat/<slug>` を main から切る。既存の作業ブランチを上書きしない。
3. spec を `docs/specs/_template.md` から作り、この文書の「受入基準の骨子」を EARS に展開し、未決事項を書く。判断が必要で止まる場合は、未決事項を残して他の部分を進める。
4. 実装 → `pnpm gate:quick`（A1 完了後）→ テスト追加 → `pnpm gate:light` → マニュアル → `pnpm gate:full` → log → PR。
5. A1 が未完了の間は `pnpm test`、`pnpm --filter @daifuku/web test`、`pnpm gate`、CONTRIBUTING のブラウザ試験手順を使う。

環境:

- Node 22、pnpm は `package.json` の固定版、PostgreSQL 16。DB テストとブラウザ試験には破棄可能な専用 DB（`TEST_DATABASE_URL_OWNER` / `TEST_DATABASE_URL`）。既存の業務 DB に `db:reset` を実行しない。
- ブラウザ試験の fixture は CONTRIBUTING の手順で新しい空 DB を作る。認証試験は別 fixture。
- AWS 試用環境、配備済み Caddy、実外部サービスはこの計画の変更で更新しない。

注意:

- 新しい画面は `Repository` と action を呼ぶだけにする。`systemContext()` は B2 の seed 実行のように migration / seed に限る。
- テストを skip・削除・弱体化して通さない。誤ったテストは直して log に書く。
- 日本語の UI 文言は `{ ja, en }` の両方を持つ。識別子・コミット・PR 題名は英語。
- 推測で書いた設計（RLS の挿入可否、`aggregate` API の有無、`vitest list` の挙動）は実装時に確認し、結果を spec に記す。
- 1 つの PR に複数の項目を混ぜない。波 0 の A1 と D1 は特に分ける。

順番に迷ったら: A1 → D1 → A2 → B1 → B2 → B3 → B4 → B5 → C1。
