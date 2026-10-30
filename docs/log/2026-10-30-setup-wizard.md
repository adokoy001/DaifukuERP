# 作業記録: 2026-10-30 セットアップウィザード（B4）

- セッション: 完成度向上計画 B4（workflow の作業項目、worktree `wip/setup-wizard`、基点 `8d40672`。spec writer の draft 改訂 `9e9d4dd` → spec 批評への対応 → 実装）／ 担当: agent ／ 対象: [docs/specs/setup-wizard.md](../specs/setup-wizard.md)
- 計測: tokens=null（未計測）, agent_minutes=約115, human_minutes=0, rework_lines=約60（下の「見つけた問題と修正」）, gate_failures=1（gate:light の docs:check が、この作業記録を書く前のマニュアルからのリンク切れで止まった。記録を書いて再実行）

## 決めたこと（と理由）

- **spec 批評 13 件のうち 12 件を採用、1 件を一部採用**（spec の「改訂の記録」に表）。主なもの: ホームのカードは C6 のビューに関係なく `admin` を持つ全員に見せ、`admin` でないセッションは `GET /meta/setup-status` を要求しない（C6 が「403 の要求 0 件」を試験するため）。会計年度は「前の年度の続き」を先に提案し、今日を含む年度があるのに点検が `fail` なら何も提案しない。`setup.progress` は応答の `progress`（保存値そのもの）に変更を重ねて保存する（返さない段階 9 や `done` の段階に残るスキップの記録を消さない）。招待の後に所属の編集を開く案だけは採らなかった（受理前に所属を付けると `kernel/src/identity/invitations.ts` が招待の再発行を拒否し、既存の招待画面も「受理後に割り当てる」と案内しているため）。
- **計画からの逸脱を 2 点記録した**（spec 決定事項 3）: 計画のカードの条件「`setup.progress` が無く fail がある」を「必須段階に `todo` がある、または `fail` の点検がある」に、計画の「スキップは未完了として残す」を「一覧に『スキップ（理由）』として残し、カードの残りには数えない。ただし `fail` はスキップしてもカードに警告として残す」にした。completion-plan の更新は統合担当へ（integrationNotes）。
- **新しい ADR は作らず ADR-0027 §8 に追記**（ADR-0034 は使っていない）。`setup.progress` と `managedBy` は ADR-0027 の設定の表示属性の延長で、計画の ADR 表も B4 を ADR-0027 に割り当てている。§8 に「ウィザードは新しい書込経路を作らない」規則を書いた。
- **判定は apps/api**（`apps/api/src/setup-status.ts`）。9 段階は複数の module の点検 id と entity 名にまたがるので、module を知らない kernel ではなくアプリに置いた（ADR-0013）。`setup.*` の条件は満たさないとき `warn`（`fail` は導入チェックの「伝票を確定できない」だけに使う）。
- **所属人数は kernel の `activeCompanyMemberCount`**。`user_company_memberships` の RLS はテナントの境界だけなので、会社と有効の条件を明示した。admin・会社全体の所属以外は `PermissionDenied`、会社の無い Context は `NotFound`。
- **アプリ内の経路の判定を `kernel/src/app-href.ts` に移した**。`setting-presentation.ts` は `registry.ts` から import され、`health.ts` は `registry.ts` を import するので、`isHealthHref` を `setting-presentation.ts` から直接使うと循環する。
- **ウィザードの部品は既存の部品に省略可の prop を足して使った**: `SettingCard`（`onDirtyChange`・`draftValue`・`onSettled`・`managedBy` の読取専用表示）、`AccessCreateUser.onCreated`、`AccessInviteUser.onInvited`、`AccessMemberships.initialCompanyId`、`WorkforceInitialize.onDone`、`TemplateCard` の export。既存の呼出しは変わらない。
- **`?step=` を固定する**（spec 改訂の記録）。`?step=` 無しで開いたとき、最初の状態で決めた段階を URL に置き換える。そうしないと、段階 1 を保存して完了した瞬間に「最初の未完了の段階」が変わり、開いている段階が勝手に移る。
- **利用者の段階の状態の取り直し**は、アクセスの一覧（フォーカス時に取り直す設定）が変わるたびではなく、この会社の有効な所属の組が変わったときだけにした（AC-1 の「自動の定期取得はしない」）。
- **ホームの `home-page.tsx` には import と 1 要素だけ**（C6 が同じファイルを並行で作り直すため）。統合前の置き場所は入口の操作の直後。

## やったこと

- kernel: `setup-progress.ts`（新規。`SETUP_STEP_IDS`、strict な記録の schema、`SETUP_PROGRESS_SETTING`、`ensureSetupProgressSetting`、`setupProgressOf`）、`app-href.ts`（新規。`isAppHref`）、`company-access.ts`（`activeCompanyMemberCount`）、`registry.ts`・`setting-presentation.ts`（`managedBy` と登録時の検査）、`health.ts`（`isHealthHref` は `isAppHref` を呼ぶ）、`index.ts`
- runtime: `loadRuntime` が `ensureSetupProgressSetting()` を呼ぶ
- api: `setup-status.ts`（新規。`SETUP_STEPS`、純粋関数 `deriveSetupStatus`、`collectSetupFacts`、`setupStatus`）、`routes/setup-status.ts`（新規。`GET /meta/setup-status`、読取専用のトランザクション）、`routes/settings.ts`（`managedBy` を返す）、`server.ts`
- web: `pages/setup-page.tsx`、`components/setup-card.tsx`・`setup-stepper.tsx`・`setup-shared.tsx`・`setup-setting-steps.tsx`・`setup-fiscal-step.tsx`・`setup-people-steps.tsx`、`api/setup.ts`、`lib/setup-wizard.ts`（いずれも新規）。`router.tsx`（`/setup`）、`lib/navigation-data.ts`・`navigation.ts`（条件 `admin`）、`lib/help.ts`（03 章「セットアップウィザード」）、`lib/companies.ts`（作成後の導線を `/setup` 1 つに）、`lib/settings-console.ts`（`managedByView`）、`api/types.ts`、`pages/home-page.tsx`（`<SetupCard />`）、既存部品の省略可の prop、`ui/token-usage.test.ts` の `CONVERTED` に 7 ファイル
- tests: 下の「検証」
- 文書: spec（批評への対応、implemented、実装時の補足）、ADR-0027 §8・冒頭の追記・帰結、マニュアル 03（ウィザードを主手順に書き換え、会計年度を画面から作る手順、設定画面の「セットアップの進捗」）・01（初回ログイン後の案内）・08（会社の作成後の導線、導入チェックとの違い）・付録 E（会社を増やした後の続き）

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] 単体（kernel）`kernel/test/setup-progress.test.ts` 10 件（段階 id、strict な記録、理由の 1〜200 文字と前後空白、合わない保存値は `{}`、冪等な登録、表示属性）、`kernel/test/setting-presentation.test.ts` に `managedBy` の 7 件（アプリ外の経路・`//`・スキーム・`..`・ja/en の欠けを拒否）。`apps/runtime/test/setting-labels.test.ts` に `setup.progress` の登録を追加（全 property の日英ラベルは既存の走査で通過）
- [実測] 単体（API）`apps/api/test/setup-status.test.ts` 13 件（9 段階の順と点検、`warn` / `fail` / 欠落は `todo`、done → skipped → todo、`done` の段階にもスキップの記録を返す、`completed` と `regressed`、任意の段階を数えない、段階 9 が無い runtime で記録が `progress` に残る、`attention`）
- [実測] DB（API）`apps/api/test/setup-status.db.test.ts` 27 件（全 module の runtime、自分の DB `daifuku_test_b4sw`、21 秒）: 段階ごとに実データで todo → done（正式名称、年度の 30 日前の `warn` と年度無しの `fail`、仮受消費税の科目の無効化、標準税率の終了、登録番号と免税事業者、倉庫を解決できない自動入出庫と off、`example` だけ・業界 pack、所属 1 人 → 2 人 → 無効化、workforce の seed を除いて作った会社で `workforce.initialize_policy` の前後）、点検用の表を一時的に改名して条件だけが「点検できませんでした」になること、`PUT /meta/settings/setup.progress` のスキップ・理由の正規化・取消・400（理由なし・空白・201 文字・`completed` に理由）、`regressed`、合わない保存値、`GET /meta/settings` の `managedBy`、sales / settings ロールの 403（HTTP）、店舗・拠点限定と会社の無い Context の拒否、会社の分離（A 社の記録と所属が B 社に出ない、所属の無い会社を指定した非テナント管理者の 403）、無効な（招待中を想定した）利用者の所属を数えない、読取専用で監査が増えない・メールや接続先を返さない
- [実測] 既存の DB 試験 `settings-console.db.test.ts`・`setup-health.db.test.ts`・`meta.db.test.ts` 43 件が通過（`managedBy` と `isHealthHref` の変更の影響確認）
- [実測] 単体（Web）`apps/web/src/lib/setup-wizard.test.ts` 35 件（初期段階、`proposeFiscalYear` の (a)(b)(c) と seed の 1〜12 月・決算月 3・翌年 1〜3 月の継続、12 か月を超える空き、重なり、`buildProgress` の記録の保持と置換え、操作の可否、カードの表示判定、キー操作、在庫の選択、発行者の複写、日英）。`settings-console.test.ts`（`managedByView` 3 件）、`navigation.test.ts`（条件 `admin`）、`help.test.ts`（`/setup` の章と見出しの実在）、`companies.test.ts`（AC-9 の行き先を `/setup` に書き換え。弱めたのではなく company-admin の spec が予定していた差し替え）
- [実測] ブラウザ `apps/web/e2e/setup-wizard.spec.ts` 5 件（slot 47、`--no-deps`）: 2 社目を `/admin/companies` で作成 → 「切り替えてセットアップを始める」→ ホームのカード（次の段階: 会社情報）→ 9 段階（会社情報を保存、会計年度は既存の年度と決算月の不一致の注記で年度が増えない（年末 30 日以内なら翌年度を作る分岐）、勘定科目、端数処理のカード、発行者の複写と未保存の確認（取りやめると移動しない）、在庫を使わないで 2 つの設定が `false`、テンプレートを理由付きでスキップ（理由なしは誤り表示と焦点）、利用者を作成してこの会社に所属、勤怠は準備済み）→ 再読込で状態とスキップが残る → カードが消える → `SAMPLE-GOODS`（在庫 0）の売上請求書を API で作って確定し、画面で「確定」を確認。キー操作（roving tabindex、↓ ↑ → Home End の巡回、Enter で開いて見出しへ焦点）、390px で 9 段階すべて横にはみ出さない、英語表示、axe（`judge`、ja 390px と en 1280px）、`GET /api/fiscal_year` を空に差し替えて提案 → 作成が 409 → 説明が出て年度が増えない、`GET /meta/setup-status` の 500 でホームのカードが出ずホームは表示・`/setup` は alert と「再読込」で入力が残る、`PUT company.profile` の 500 で入力が残り段階が進まず状態を取り直す、在庫の 2 つ目の保存の 500 で失敗表示・取り直し・「片方だけ有効」の表示、settings ロールの利用者はホームで状態を要求せず項目もカードも無く URL では説明・API は 403、admin＋accounting の利用者にカード、403 の差し替えで説明の表示、テナント管理者でない会社の管理者は利用者の段階で説明だけ
- [実測] 既存のブラウザ試験（slot 47、`--no-deps`）: `company-admin.spec.ts` 4 件（作成後のボタンの文言と遷移先を `/setup` に合わせ、プロフィールの入力はウィザードの段階 1 の同じカードで行うよう書き換えた）、`settings-console.spec.ts` 5 件、`navigation-assist.spec.ts` 12 件、`setup-health.spec.ts` 4 件、`smoke.spec.ts` 2 件、`navigation.spec.ts` のうち業界の会社を使わない 4 件が通過。業界の会社を使う 2 件（`navigation.spec.ts` AC-3/10、`access-management.spec.ts` の店舗所属）は `--no-deps` では準備されない会社（飲食チェーン）を探して失敗するため、業界の依存 project 付きで再実行した（結果は下）
- [実測] gate:light（`GATE_DB_SHARDS=1`）: 結果は下の追記
- [レビュー] `home-page.tsx` の差分は import と 1 要素（`git diff --stat` で 2 行）
- [未検証] 実際の招待メールの受理から所属の割当てまで（招待の作成は既存の画面と同じ部品。ブラウザ試験では利用者の直接作成だけを通した）、メールで招待した後の説明の表示（同上）、テンプレートを段階 7 から適用する操作（既存の `/templates` と同じ部品と `pack.apply`。ブラウザ試験ではスキップを通した）、`workforce.initialize_policy` を段階 9 から実行する操作（DB 試験で action の前後の状態は確認、画面の操作は未実行）、会計年度の提案の「継続」「空き」の画面表示（単体試験で計算を確認、ブラウザでは年度が今日を含む分岐と差し替えの 409 だけ）、C6 統合後のカードの位置（統合担当）、gate:full（統合担当）

## 見つけた問題と修正（発見経路つき）

- `?step=` 無しで開いた段階が、保存で完了した瞬間に別の段階へ移った — 発見: E2E（`company-admin.spec.ts` の保存後の確認が段階のカードを見失った）、修正: 最初の状態で決めた段階を `?step=` に固定（`4294e68`）
- 利用者の段階の状態の取り直しが、アクセス一覧のフォーカス時の再取得のたびに走る — 発見: レビュー、修正: この会社の有効な所属の組が変わったときだけ取り直す（最終コミット）
- ブラウザ試験の誤り 2 件（必須の欄の `getByLabel` が必須の印で一致しない → `getByRole('textbox', { name })`、3 人所属した会社の利用者の段階に「スキップ」を期待していた）— 発見: E2E、修正: 試験側（`4294e68`）
- DB 試験の誤り（エラー応答の形 `{ error: { code } }`、利用者の段階の初期状態に AC-8 の試験で足した所属を数えていなかった）— 発見: 実測、修正: 試験側（`2b285c2`）

## 未実施（減らさない。完了したら「済」を付けて残す）

- `a11y.spec.ts` の画面一覧への `/setup` の追加（自分の spec の中で `judge` を実行した。共有の一覧の固定件数を変えると並行の項目と衝突するため、統合担当に委ねる）
- C6 のロール別ホームの統合後、`<SetupCard />` をビューの切替の上へ移すこと（統合担当。spec AC-7）
- completion-plan の B4 の記述（カードの条件・スキップの扱い）の更新（統合担当）

## 判断待ち（利用者）

- spec の未決事項のとおり（カードを消す操作、勤怠の段階の表示、`packs.applied` への `managedBy`、設定の PUT の版の検査、seed の暦年の年度の置換え、確認の段階を `completed` まで未完了にするか）

## 次のセッションへ

- 段階を module / pack が宣言する仕組みはスコープ外（初版は固定の 9 段階）。足すときも ADR-0027 §8 の「新しい書込経路を作らない」に従う。
