# 作業記録: 2026-10-29 コマンドパレット・最近の記録・お気に入り・画面の説明（D2）

- セッション: 完成度向上計画 D2（workflow の作業項目、worktree `wip/navigation-assist`、基点 `0dded55`）／ 担当: agent ／ 対象: [docs/specs/navigation-assist.md](../specs/navigation-assist.md)
- 計測: tokens=null（未計測）, agent_minutes=約75（実装・単体 約35、ブラウザ試験と修正 約20、文書 約20。gate の待ち時間を除く）, human_minutes=0, rework_lines=約15（ブラウザ試験 2 件の判定の修正）, gate_failures=0

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
- [未検証] 別タブでの更新の反映（`storage` イベント）。コードレビューのみ。

## 見つけた問題と修正（発見経路つき）

- 新しいブラウザ試験の従業員の名前を API の戻り値（`register_employee` の出力に `name` が無い）から取っていた — 発見: E2E、修正: 画面の題名から読む。
- 会社を戻す手順で、会社一覧の読込前に選択値（空）を読んでいた（1 回目は偶然通った）— 発見: E2E（2 回目の全件で失敗）、修正: 値が UUID になるのを待ってから読む。修正後に `--repeat-each=2` で成功。
- fixture の作成が 1 回、理由の出ない失敗（`undefined`）で止まった。負荷平均 8 前後の時間帯で、再実行で成功した。製品の不具合ではないと判断したが原因は未確認。

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
