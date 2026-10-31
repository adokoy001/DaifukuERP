# 作業記録: 2026-10-29 コマンドパレット・最近の記録・お気に入り・画面の説明（D2）

- セッション: 完成度向上計画 D2（workflow の作業項目、worktree `wip/navigation-assist`、基点 `0dded55`）／ 担当: agent ／ 対象: [docs/specs/navigation-assist.md](../specs/navigation-assist.md)
- 計測: tokens=null（未計測）, agent_minutes=約75（実装・単体 約35、ブラウザ試験と修正 約20、文書 約20。gate の待ち時間を除く）+ レビュー後の修正 約60, human_minutes=0, rework_lines=約15（ブラウザ試験 2 件の判定の修正）+ 約52（レビュー後の修正で置き換えた試験以外の行）, gate_failures=0

## 決めたこと（と理由）

- **パレットは kit の `Dialog` の中の combobox + grouped listbox。** 規約（新しいダイアログは `Dialog`）に従い、焦点の閉じ込め・Escape・開いた要素への焦点の復帰を native modal と `Dialog` に任せた。入力欄に焦点を残し、選択は `aria-activedescendant` で示す（WAI-ARIA APG の combobox と grouped listbox）。グループ見出しは `role="presentation"` で group の `aria-labelledby` から参照する。
- **選んだらパレットを `flushSync` で閉じてから `navigate`。** 未保存フォームの `useBlocker` は `window.confirm` を同期で出すので、先に閉じないと確認がパレットの後ろに出る。閉じた時点で焦点が開いた要素（例: 入力中の項目）へ戻るため、移動を取り消すとそのまま入力を続けられる（ブラウザ試験で確認）。
- **`Ctrl/⌘+K` は他のモーダルが開いているときは横取りしない。** `dialog[open]` または `[aria-modal="true"]`（小画面のメニュー）があればブラウザの既定動作に任せる。パレットが開いているときだけ既定動作を止める。入力欄からも開く（`Ctrl+K` は文字入力に使わない）。IME 変換中（`isComposing`）は無視する。
- **候補の件数。** 入力ありは画面 20 件 + 最近の記録 10 件、入力なしはお気に入り + 最近 10 件 + featured の専用画面 8 件。21 件目以降の画面は「ほか N 画面をすべての画面で見る」（`/workspaces?q=`）へ送る。カタログの検索は既存の `searchNavigation` をそのまま使い、記録の照合も同じ正規化（`normalizeSearchText` として公開）にした。
- **保存は `analytics-storage.ts` を再利用せず、同じキー形の `assist-storage.ts`。** 保存分析は厳密な形の検証・競合検出・Web Locks（無ければ書かない）を前提にしており、最近の記録には重い。キーは `daifuku.recent.v1.` / `daifuku.favorites.v1.` + `[tenantId, userId, companyId]` の JSON。読込は寛容（1 件の不正で全体を捨てない）、64,000 文字超・壊れた JSON・別 version は空。タブ間の排他はしない（最後の書込みが勝つ。失って困る情報ではない）。
- **「使えない」と「空」を分ける。** `readRaw` は例外なら `undefined`、未保存なら `null`。`undefined` のときだけ見出しとボタンを出さない（AC-7）。お気に入りの書込みが拒否されたら通知（`info` トースト）だけ出す。最近の記録の書込み失敗は黙って捨てる（利用者の操作ではないため）。
- **個人情報の判定は名前の接頭辞（`workforce_`、`filing_payroll_`）。** 計画の初版案に給与申告を足した。読込時にも同じ規則で表示名を捨てるので、古い版や手で書いた内容からも出ない。取引先（個人事業主を含みうる）は対象外とし、spec の未決事項に残した。
- **最近の記録の表示はカタログに一覧がある entity だけ。** entity の閲覧権限を失ったら出さない。個別の記録の行権限は、開いたときに既存の認可が通常のエラーにする（spec の AC-3 を 2 つに分けて明記）。
- **お気に入りは href だけを保存し、名前はカタログから引く。** 言語切替・メニュー名の変更・権限の変化にそのまま従う。保存できる href はスキーム・host・query・hash・dot segment を持たないアプリ内 path に限る（手で書いた外部 URL をリンクにしない）。上限 20。満杯ならカタログに無い href から外し、それも無ければ「20 画面まで」と知らせる。
- **お気に入りボタンは現在位置（`ScreenTrail`）に置き、画面そのもの（pathname がカタログの href と一致）でだけ出す。** 新規・詳細画面で押すと一覧が登録される、という分かりにくさを避けた。ボタンは名前を変えない切替ボタン（`aria-pressed`）。
- **現在位置の構造を `div.screen-trail > nav + div.screen-tools` に変えた。** パンくずの `nav` に操作ボタンを入れないため。既存の `.screen-trail` の余白と分岐点（1200 / 760px）はそのまま使い、新しい分岐点を足していない。e2e の `getByRole('navigation', { name: '現在位置' })` はそのまま通る。
- **サイドバーの「お気に入り」「最近」は業務分野の下。** 既存の入口の位置を変えないため。画面の高さが低いとスクロールが必要になる（720px の高さで見出しが下端）ので、spec の未決事項に残した。
- **help の対応表は章ファイル名（と節アンカー）。** 節は句読点を含まない見出しだけにし（GitHub のアンカーが見出しと同じ文字列になる）、`help.test.ts` が章ファイルの実在と、節が `##` 見出しから作ったアンカーと一致することを確かめる。entity 画面は個別の章が無ければ「02 画面の基本」。汎用のアクション画面は月次締めなど一部だけ。同じ回の `/inbox`（C3）と `/finance/close`（C4）は、それぞれの spec が更新する章（付録 N、06 月次）へ先に対応させた。`help.test.ts` は専用画面（`/account` 以外）すべての対応を要求するので、専用画面を足すときは対応表にも足す（`ui.md` に明記）。
- **`VITE_MANUAL_URL` は絶対 http(s) URL で query・fragment・資格情報なしのときだけ使う。** それ以外（相対、`javascript:` など）は公開リポジトリの `docs/manual/`。リンクは `target="_blank" rel="noreferrer"`。
- **色はトークン、分岐点は 480 / 768。** 新しい CSS（`components/navigation-assist.css`）と `command-palette.tsx` を `token-usage.test.ts` の `CONVERTED` に足した。サイドバーの暗い背景の上は既存の `.nav-caption` / `.nav-link` を使い、新しい色を足していない。

## やったこと

- 新規: `components/command-palette.tsx`、`components/navigation-assist.css`、`lib/command-palette.ts`、`lib/recent-records.ts`、`lib/favorites.ts`、`lib/assist-storage.ts`、`lib/help.ts`、`api/navigation-assist.ts`
- 変更: `router.tsx`（`usePaletteShortcut`、上部の「検索」ボタン、パレットの表示）、`sidebar.tsx`（お気に入り・最近）、`screen-trail.tsx`（お気に入りボタン・説明リンク）、`entity-form-page.tsx`（`useRecordVisit` の 1 行。C2 と衝突しにくいよう hook は別ファイル）、`icon.tsx`（Feather の star / help-circle）、`navigation.ts`（`normalizeSearchText` を公開）、`vite-env.d.ts`
- テスト: `lib/navigation-assist.test.ts`（21 件）、`lib/help.test.ts`（51 件）、`e2e/navigation-assist.spec.ts`（6 件）、`ui/token-usage.test.ts` の対象追加
- 文書: spec（implemented、受入基準の具体化と変更点）、`docs/manual/appendix-n-navigation.md` 追補と `00-index.md`、`docs/architecture/navigation-workspaces.md`（保存の節の改訂、新しい節、表）、`docs/conventions/ui.md`

## 検証（何を・どう確認したか。コードレビューか実測かを明記）

- [実測] 新しい単体 2 ファイル + `navigation.test.ts` 120 件成功（0.9 秒）。保存境界（会社・利用者・tenant でキーが変わり、会社 A の訪問が会社 B で読めない）、30 件の上限と並び、従業員の表示名を保存しない（手で書いた内容も）、カタログに無い entity の非表示、読込・書込の例外と `localStorage` の getter の例外、壊れた内容、お気に入りの境界・上限・href の検証、パレットの候補の順序と上限、help の章ファイルと節見出しの実在・未対応画面・`VITE_MANUAL_URL` の検証。
- [実測] `pnpm gate:quick`（基点 `origin/main` の merge-base `431dda5`。前の回の統合で `package.json` などが変わっているため全 unit・全 lint に拡大）: format・docs・assurance・eslint・boundaries・typecheck（全体・api・web）・unit 全件・deploy すべて成功。
- [実測] ブラウザ試験（slot 24、毎回新しい fixture DB、`--project=chromium --no-deps`）: `navigation-assist.spec.ts` 6 件を `--repeat-each=2` で 12/12 成功（1.3 分）。内容: `Ctrl+K` で開いて入力欄に焦点、listbox / group / option と `aria-activedescendant`、↑↓ の折り返し、Enter で画面へ、Escape で開く前の検索欄へ焦点が戻る、該当なしの表示、未保存フォームからの移動で確認が出て取り消すと入力と焦点が残る、上部ボタン（`aria-keyshortcuts`）で開いて Escape / 閉じるボタンでボタンへ戻る、390px で x=0・幅 390 の全幅表示と横スクロールなし、英語表示、6 件の記録を開いてサイドバーは新しい順 5 件・パレットから記録を開く・従業員の名前がリンクにも `localStorage` にも無い・別会社（農家サンプル）では出ず戻すと出る、お気に入りの追加・パレットの先頭・再読込後も保持・解除で見出しごと消える・新規画面にボタンが無い、説明リンクの URL（`04-masters.md#取引先`）と `target` / `rel`、説明の無い画面（`/a/sales.record_payment`）にリンクが無い、390px の現在位置で横スクロールなし、`localStorage` の getter が例外を投げるブラウザで最近・お気に入りが出ず、パレットと説明リンクと移動が動き、page error が 0 件。
- [実測] 変更した画面を含む既存のブラウザ試験: `navigation.spec.ts`（industry 依存込みで 3 + 5 件成功、1.5 分）、`ui-kit.spec.ts`・`smoke.spec.ts`・`company-context.spec.ts`・`foundation-ui.spec.ts` は `--no-deps` で成功（同じ実行の `navigation` AC-3/10 は飲食テンプレートの導入が前提のため `--no-deps` では失敗し、industry 込みの再実行で成功）。
- [目視] 1280×720 と 390px の画面写真（パレット、現在位置のボタンとリンク、サイドバーの最近）を作業用に撮って確認した（リポジトリには入れていない）。720px の高さではサイドバーの「最近」「お気に入り」が下端にあり、スクロールしないと見えない。
- [実測] `pnpm gate:light`（`TEST_DATABASE_URL_*` = 専用 DB `daifuku_test_w33`、基点 `431dda5` からの変更に CI 定義・`package.json` などが含まれるため DB は全 suite に拡大）: format 25 秒・docs・assurance・typecheck（全体・api・web）・lint（警告 4 件は既存ファイルの関数行数）・unit 133 ファイル 1,283 件（90 秒）・DB 116 ファイル 701 件（935 秒）・deploy 16 件（29 秒）すべて成功。合計約 19.5 分（負荷平均 6〜8 の共有コンテナ）。
- [実測] ブラウザ試験の全件（slot 24、新しい fixture DB、industry → chromium、コミット `07bbbcf` の内容）: 93 件すべて成功（既存 87 件 + 新規 6 件、13.3 分）。
- [未検証] `pnpm gate:full`（統合担当が実行。認証試験 3 件はこのブランチでは未実行）。
- [未検証] 実機のスクリーンリーダーでの読み上げ（combobox と `aria-activedescendant`、候補数の live region）、macOS の `⌘+K`（Linux の Chromium で `Control+K` のみ実行）、Safari / Firefox。
- [済・2026-10-30] 別タブでの更新の反映（`storage` イベント）。レビュー後の修正でブラウザ試験を足した（下記）。

## 見つけた問題と修正（発見経路つき）

- 新しいブラウザ試験の従業員の名前を API の戻り値（`register_employee` の出力に `name` が無い）から取っていた — 発見: E2E、修正: 画面の題名から読む。
- 会社を戻す手順で、会社一覧の読込前に選択値（空）を読んでいた（1 回目は偶然通った）— 発見: E2E（2 回目の全件で失敗）、修正: 値が UUID になるのを待ってから読む。修正後に `--repeat-each=2` で成功。
- fixture の作成が 1 回、理由の出ない失敗（`undefined`）で止まった。負荷平均 8 前後の時間帯で、再実行で成功した。製品の不具合ではないと判断したが原因は未確認。

## レビュー後の修正（2026-10-30、fixer）

3 つの観点（spec・safety・ux）のレビュー指摘 16 件をコードと照合した。すべて実際の挙動として確認でき、却下は無い（同じ内容の重複指摘は 1 件として直した）。

- **ログアウトで記録の名前を消す（safety・minor）。** 取引先名・伝票の摘要などの表示名が、ログアウト後も `localStorage` に残っていた（セッションと会社選択は tab 内の `sessionStorage`、業務データのキャッシュはログアウトで `qc.clear()` しているのに対して不釣合い）。`forgetRecentNames()`（`api/navigation-assist.ts`）を足し、明示的なログアウトの 3 経路（router の logout、アカウント画面の全端末ログアウトとパスワード変更、認証設定の変更による切断）で `clearSession()` の前に呼ぶ。その利用者・tenant の全会社の `daifuku.recent.v1.` から表示名だけを消し、記録は entity と短い id で残す（他の利用者の分は触らない）。期限切れ（401）の自動の切断では呼ばない（利用者の操作ではなく、次のログインで名前が戻らないと不便なため）。キーの列挙は `assist-storage.ts` の `assistKeysOf`（キーの JSON を解析し tenant と利用者が一致するものだけ）。
- **マスクされた表示項目の名前を出さない（safety・nit）。** 保存時に表示名の出どころ（`labelSource`: 表示項目か伝票番号か）を持たせ、表示時に現在の metadata の `displayField` が無い entity は表示項目由来の名前を捨てる。出どころの無い保存内容は厳しい側（表示項目）として扱う。現時点で field group を宣言する module は無いので、今までに漏れていたものは無い。行の権限が後から狭まった場合は表示時に記録を読み直さないので隠せず、spec のスコープ外に明記した。
- **配布物でもマニュアルの基点を指定できるようにし、既定を commit に固定（spec・minor、ux・major、ux・minor）。** `deploy/build.mjs` の build 環境は許可した変数だけで組み立てるので、`VITE_MANUAL_URL` は正式な配布物に届かず、マニュアルの記述（「構築時に指定」）が効かなかった。また既定の `blob/main` は、古い配布物から新しい `main` の章へ飛ぶ。`scripts/build-release.mjs --manual-url` を足し、`releaseManualUrl(commit, manualUrl)` が既定で `blob/<commit>/docs/manual/`、指定があればその URL（help.ts と同じ規則で検証し、違反なら構築前に止める）を Web の構築にだけ渡し、manifest に `manualBase` として残す。実行者の環境変数を引き継ぐ方式にはしなかった（build は許可した変数だけという方針を保つ）。公開リポジトリに無い commit から作ると既定のリンクは見つからないので、配備手順に明記した。
- **入力前の主要画面を選び方のある 8 件に（ux・minor）。** 定義順の先頭 8 件だと人事・労務の 5 画面が先に並び、分析・レポートや設定が出なかった。`startScreens` で業務分野の順（`WORKSPACES`）に分野ごと 1 画面ずつ巡って 8 件まで選ぶ。明示の一覧にしなかったのは、専用画面を足すたびに保守が要るため。
- **パレットの読込中・失敗・候補なし（ux・minor）。** `/meta` の読込中と失敗はカタログが空になり、「一致する画面がありません」と出ていた。読込中は「読み込み中…」（listbox に `aria-busy`）、失敗は再読込を促す文、入力前に候補が無いときは「お気に入りや最近開いた記録はまだありません」に分けた。
- **選択中の候補の 2 行目のコントラスト（ux・minor）。** `--text-muted` と `--accent-soft` は 4.34:1（11px の文字に AA の 4.5:1 未満、手計算で確認）。選択中は `--accent-on-soft`（8.2:1）にし、CSS の契約試験に足した。
- **英語表示の説明リンク（ux・minor）。** マニュアルは日本語だけなので、英語の文言を「Help for this screen (Japanese)」にし、`hreflang="ja"` を付けた。
- **ショートカットの修飾キー（spec・nit、ux・nit）。** どの端末でも Ctrl と ⌘ の両方を受けていた。macOS の入力欄の `Ctrl+K`（行末まで削除）を奪わないよう、macOS は `⌘+K`、それ以外は `Ctrl+K` だけにし、`aria-keyshortcuts` も 1 つにした。
- **名前の無い記録で種類が 2 回出る（ux・nit）。** 「従業員 1a2b3c4d…」の下に「従業員」と重ねていた。名前の無い記録は 2 行目を出さない（`recentRecordDetail`）。
- **マニュアルの「閉じる」（ux・nit）。** ボタンは × の図だけなので「右上の ×（閉じる）」に直した。
- **試験の不足（spec・minor、ux・minor）。** 次の受入基準の部分をブラウザ試験に足した: 小画面のメニューと記録の削除確認（kit の `Dialog`）の上では `Ctrl+K` で開かない、パレットの中で押しても 2 つ目を開かない（AC-1）、読込中と読込失敗の表示（AC-2）、ログアウトで名前が消え再ログイン後は短い id で出る（AC-3）、見えるお気に入り 20 件で追加を断る通知と、カタログに無いお気に入りから空きを作る、別タブの追加が再読込なしで出る（AC-4）、説明リンクの `hreflang` と英語の文言（AC-6）、お気に入りの書込み拒否の通知（AC-7）、390px で y=0、768px 未満でアイコンだけ（AC-8）。レビューの試し書き（作業用の probe）をもとにし、AC 番号を付けた。

### 修正の検証

- [実測] 単体（`navigation-assist.test.ts`、`help.test.ts`、`navigation.test.ts`）127 件成功。新しい試験: 表示名の出どころとマスク、名前の無い記録の 2 行目、ログアウトで自分の全会社分だけ名前を消す（他の利用者・tenant・お気に入りは残る、2 回目は 0 件、列挙できない保存領域でも例外なし）、入力前の主要画面の選び方（定義順で人事・労務が先に 5 件並ぶ catalog から分野を巡る）、選択中の 2 行目の色。
- [実測] `node --test deploy/test/release.test.mjs` 9 件成功。新しい試験: 既定の基点が commit 固定、`--manual-url` の正規化と拒否（相対・`javascript:`・query・fragment・資格情報）、不正な指定は source を触る前に構築を止める。既存の「実際の Web 構築」の試験に、構築環境の `VITE_MANUAL_URL` が bundle の JS に文字列として入ることの確認を足した。`buildRelease` 全体（clean な commit からの配布物の生成）は gate に含まれず、今回も実行していない。
- [実測] ブラウザ試験（slot 24、新しい fixture DB、`--project=chromium --no-deps`）: 1 回目は 12 件中 2 件が試験側の誤りで失敗（ログアウトのボタンを `メニュー` の nav の中で探した。`/account` は共通の shell の外なので、そこでの確認ダイアログはパレットの判定を試せていなかった）。locator と、確認ダイアログを記録の削除確認に替えて再実行した結果は下記。
  - `navigation-assist.spec.ts` 12 件すべて成功（1.4 分）。
  - 感度の確認: `router.tsx` で他のモーダルの判定と logout の `forgetRecentNames()` を一時的に外すと、AC-1（モーダルの上で開かない）と AC-3（ログアウトで名前が消える）の 2 件がどちらも失敗した（`--retries=0`。外した変更は戻した）。
  - 変更した shell・アカウント画面に関わる既存の試験と合わせて（industry → chromium、新しい fixture DB）: `industry-templates` 3・`navigation` 5・`account-security` 3・`company-context` 2・`ui-kit` 10・`smoke` 2・`foundation-ui` 1・`navigation-assist` 12 の 38 件すべて成功（5.0 分）。全件（93 件 + 新規 6 件）は再実行していない。
- [実測] `pnpm gate:light`: 成功（`TEST_DATABASE_URL_*` = `daifuku_test_w33`、ブラウザ試験と同時に実行した負荷平均 7〜10 の共有コンテナで約 24 分）。format・docs・assurance・typecheck（全体・api・web）・lint（警告 4 件は既存ファイルの関数行数）・unit 133 ファイル 1,288 件・DB 116 ファイル 701 件（基点 `431dda5` からの変更に CI 定義などが含まれ全 suite に拡大、1,131 秒）・deploy 17 件（新しい 1 件を含む）。
- [未検証] `pnpm gate:full`（統合担当）、`buildRelease` の通しの実行、macOS の `⌘+K`、Safari / Firefox、実機のスクリーンリーダー（変わらず）。

## 未実施（減らさない。完了したら「済」を付けて残す）

- `pnpm gate:full`（統合担当）
- 個人情報の判定を entity 定義の宣言にする（DSL 拡張 + ADR）かの判断
- 最近の記録を消すボタン（現在はブラウザのサイトデータ削除）

## 判断待ち（利用者）

- 個人情報を含む entity の判定方法（spec の未決事項 1）
- サイドバーでの「お気に入り」「最近」の位置（spec の未決事項 2）

## 次のセッションへ

- 専用画面を足すときは `lib/help.ts` にも章を足す（`help.test.ts` が落ちる）。C3 / C4 の画面は先に対応させてあるが、章や節が決まったら更新する。
- D3（フォームのショートカット）で `Ctrl+K` と衝突しないこと。パレットは `dialog.command-palette` で識別できる。
