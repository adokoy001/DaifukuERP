# Spec: navigation-assist（コマンドパレット・最近の記録・お気に入り・画面の説明）

- 状態: implemented（2026-10-29、[作業記録](../log/2026-10-29-navigation-assist.md)）
- モジュール: `apps/web`（画面カタログ、サイドバー、現在位置） ／ 依存: [ui-kit](ui-kit.md)、[navigation-workspaces](navigation-workspaces.md)
- ADR: 不要（表示層のみ。保存はブラウザ内。新しい API・閲覧経路なし）
- 作成: 2026-10-29 ／ 作成者: agent（計画セッション）。設計の元は [完成度向上の実装計画](../completion-plan.md) D2。実装時に受入基準を具体化し、レビュー後の修正（2026-10-30）で補った（「未決事項」の末尾に変更点）

## 目的（1段落）

画面は業務分野と全画面検索から探せるが、毎日使う画面や直前に見た伝票へ戻るには、分野を開き直すか一覧を検索し直す必要がある。また画面の操作説明はマニュアルにあるが、画面からたどれない。キーボードで画面を開くコマンドパレット、最近開いた記録とお気に入り、画面ごとの説明リンクを足し、迷う時間を減らす。

## 受入基準（EARS）

- AC-1 WHEN 利用者が `Ctrl+K`（macOS は `⌘+K`。macOS の `Ctrl+K` は入力欄の既定動作に残し、上部ボタンの `aria-keyshortcuts` も端末の 1 つだけを示す）を押すか、上部の検索ボタンを押した THE SYSTEM SHALL コマンドパレット（kit の `Dialog`）を開き、入力欄に焦点を移す。`Escape` または閉じるボタンで閉じ、開く前の要素へ焦点を戻す。入力欄からでも `Ctrl+K` で開く。他のモーダル（確認ダイアログ、小画面のメニュー）が開いている間は開かない。
- AC-2 WHEN パレットに入力した THE SYSTEM SHALL 既存の画面カタログの検索（`searchNavigation`）で権限のある画面を最大 20 件、続けて最近開いた記録で一致するものを最大 10 件、候補に出す。入力前はお気に入り、最近開いた記録、主要な専用画面（業務分野の順に分野ごと 1 画面ずつ巡って選び、8 件まで）を出す。上下キーで選択（端で折り返す）、`Enter` またはクリックで移動する。入力欄は `combobox`、候補は `listbox` / `group` / `option` の役割で、選択中の候補を `aria-activedescendant` で示す。移動は router を通し、未保存の入力があれば既存の破棄確認が働く。一致しなければその旨と「すべての画面を探す」を示す。画面の一覧（`/meta`）の読込中と読込失敗は「一致しない」ではなくその旨を示し、入力前に候補が無いときは「まだありません」と示す。
- AC-3 WHEN 利用者が記録の画面（`/e/<entity>/<id>`）を開いた THE SYSTEM SHALL entity・id・表示名（表示項目、無ければ伝票番号）・開いた日時を、利用者・tenant・会社ごとにブラウザ内へ新しい順に最大 30 件保存する（同じ記録は先頭へ移す）。表示名に個人情報を含む entity（`workforce_` と `filing_payroll_` で始まるもの）は表示名を保存せず、entity 名と短い id で表示する。会社を切り替えた場合はその会社の記録だけを表示する。entity の閲覧権限を失った（一覧がカタログに無い）記録は表示せず、個別に読めなくなった記録は開いたときに通常の権限エラーになる。表示項目から取った表示名は、その項目が現在の利用者に見えなくなった（metadata の `displayField` が無い）ときは表示しない（伝票番号から取った表示名は残す）。利用者が明示的にログアウトした（通常のログアウト、全端末からのログアウト、パスワードや認証設定（多要素認証・外部ログイン）の変更に伴うログアウト）とき、その利用者の保存済みの表示名を全会社分消し、記録は entity 名と短い id で残す（期限切れによる自動の切断では消さない）。
- AC-4 WHEN 利用者が現在位置の「お気に入り」ボタン（`aria-pressed` の切替ボタン。カタログの画面そのものを開いているときだけ表示）を押した THE SYSTEM SHALL その画面の href を同じ境界でブラウザ内に保存（再度押すと解除）し、サイドバーの「お気に入り」とパレットに表示する。表示名は保存せずカタログから引き、権限を失った画面（カタログに無い href）は表示しない。上限は 20 画面で、満杯のときは表示されないお気に入りから外して空きを作り、それも無ければ追加せずに知らせる。
- AC-5 THE SYSTEM SHALL サイドバーの業務分野の下に「お気に入り」と「最近」（直近 5 件）を表示する。どちらも 0 件なら見出しごと表示しない。
- AC-6 THE SYSTEM SHALL 画面の経路からマニュアルの章（必要なら節）への対応表（`apps/web/src/lib/help.ts`）を持ち、現在位置（`ScreenTrail`）に「この画面の説明」リンク（新しいタブ）を表示する。リンク先の基点は `VITE_MANUAL_URL`（絶対 http(s) URL、query・fragment・資格情報なし。それ以外と未設定は公開リポジトリの `main` の `docs/manual/`）とし、対応の無い画面（汎用のアクション画面の多くなど）には表示しない。正式な配布物（`scripts/build-release.mjs`）は、既定でその配布物の commit の公開リポジトリの `docs/manual/` を、`--manual-url` を指定すればその URL（同じ規則で検証し、違反なら構築を止める）を `VITE_MANUAL_URL` として焼き込む。entity の画面は個別の章が無ければ「02 画面の基本」へ対応させる。マニュアルは日本語だけなので、リンクに `hreflang="ja"` を付け、英語表示の文言でも日本語であることを示す。
- AC-7 IF ブラウザ内の保存が使えない（`localStorage` の取得や読込の例外、容量超過、壊れた内容）THEN THE SYSTEM SHALL 最近とお気に入り（サイドバーの見出しと現在位置のボタン）を表示しないか、保存しないだけで、パレット・説明リンク・画面の移動など他の操作を妨げない。お気に入りの保存に失敗したときは通知だけ出す。
- AC-8 THE SYSTEM SHALL 文言を日本語と英語で持ち、390px 幅ではパレットを画面の全幅で上端から表示し、横スクロールを生じさせない。上部の検索ボタンは 768px 未満でアイコンだけになる。

## 関係するファイル・インターフェース（名指し）

- 新規: `apps/web/src/components/command-palette.tsx`、`apps/web/src/components/navigation-assist.css`、`apps/web/src/lib/command-palette.ts`（候補の組立て）、`apps/web/src/lib/recent-records.ts`、`apps/web/src/lib/favorites.ts`、`apps/web/src/lib/assist-storage.ts`（保存境界と失敗の扱い）、`apps/web/src/lib/help.ts`、`apps/web/src/api/navigation-assist.ts`（React の hook: `useRecentRecords` / `useRecordVisit` / `useFavorites`）
- 変更: `apps/web/src/router.tsx`（ショートカット、上部ボタン、パレットの表示）、`apps/web/src/components/sidebar.tsx`、`apps/web/src/components/screen-trail.tsx`、`apps/web/src/pages/entity-form-page.tsx`（`useRecordVisit` の 1 行）、`apps/web/src/components/icon.tsx`（star / help）、`apps/web/src/lib/navigation.ts`（正規化関数 `normalizeSearchText` の公開）、`apps/web/src/vite-env.d.ts`（`VITE_MANUAL_URL`）、`apps/web/src/ui/token-usage.test.ts`（`CONVERTED`）、`apps/web/src/pages/account-page.tsx` と `apps/web/src/components/identity-security.tsx`（ログアウトで表示名を消す 1 行）、`deploy/build.mjs` と `scripts/build-release.mjs`（配布物のマニュアルの基点、`--manual-url`）
- 保存境界は `apps/web/src/lib/analytics-storage.ts` と同じ（利用者・tenant・会社の JSON 配列をキーに含む）。キーは `daifuku.recent.v1.[…]` と `daifuku.favorites.v1.[…]`、値は `{ version: 1, items }`
- docs: `docs/manual/appendix-n-navigation.md`、`docs/architecture/navigation-workspaces.md`、`docs/conventions/ui.md`（業務分野と画面検索）、`docs/operations/deployment.md`（`--manual-url`）

## データ・業務ルール（出典）

- 業務データは保存しない（entity 名・id・表示名・表示名の出どころ（表示項目か伝票番号か）・開いた日時だけ）。表示名に個人情報を含む entity（従業員・給与申告）は表示名を保存しない。読込時にも同じ規則を適用し、手で書き換えられた内容からも表示しない。明示的なログアウトで、その利用者の表示名を消す（共用の端末に名前を残さない）。
- 日本の制度値は扱わない（出典不要）。

## スコープ外（明記）

- 記録データの全文横断検索（サーバー側の索引が必要）
- 端末間でのお気に入り共有、最近の記録の消去ボタン（表示名はログアウトで消え、記録そのものはブラウザのサイトデータ削除で消える）
- マニュアルのアプリ内表示（外部リンクで開く）
- タブ間の同時更新の排他（最後の書込みが勝つ。保存分析のような Web Locks は使わない）
- 行の権限（支払の向き・フランチャイズ・従業員本人など）が後から狭まった記録の表示名を隠すこと（表示時に記録を読み直さないため。開けば通常の権限エラーになる）

## 検証手順（E2E、実行して記録する）

1. `pnpm gate:quick`、`pnpm gate:light`
2. 単体（`lib/navigation-assist.test.ts`、`lib/help.test.ts`）: 保存境界（会社切替で混ざらない）、上限 30 件と並び、保存失敗時の動作、個人情報を含む entity の表示名を保存しない、マスクされた表示項目の名前を出さない、ログアウトで表示名を消す（他の利用者・tenant は残す）、お気に入りの境界と上限、パレットの候補（入力前の分野ごとの選び方）、help の対応表（章ファイルと節見出しの実在）と未対応画面、`VITE_MANUAL_URL` の検証、選択中の候補の 2 行目のコントラスト（AC-2〜AC-8）。配布物（`deploy/test/release.test.mjs`）: 既定の基点が commit 固定、`--manual-url` の検証、実際の Web 構築で基点が bundle に入る（AC-6）
3. ブラウザ（`e2e/navigation-assist.spec.ts`）: `Ctrl+K` で画面を開く、矢印と Enter、Escape と閉じるボタンでの焦点の戻り、小画面のメニューと確認ダイアログの上では開かない、読込中・読込失敗の表示、未保存フォームからの移動確認、記録を開いて最近に出る（5 件、別会社で出ない、従業員名を保存しない、ログアウトで名前が消える）、お気に入りの追加・再読込後の保持・削除・20 件の上限と通知・別タブへの反映、説明リンク（`hreflang`、英語の文言）、保存不可のブラウザと書込み拒否の通知、390px（上端から全幅）、768px 未満でアイコンだけ（AC-1〜AC-8）
4. `pnpm gate:full`（統合担当が実行）

## 未決事項（利用者の判断待ち）

- 個人情報を含む entity の判定方法。初版は名前の接頭辞（`workforce_`、`filing_payroll_`）で判定した。取引先（個人事業主を含みうる）や業界別の案件名は対象外。entity 定義に「表示名は個人情報」の印を持たせる（DSL の拡張と ADR）かは利用者の判断を待つ。
- サイドバーでの位置。業務分野の下に置いた（既存の入口の位置を変えないため）。画面の高さが低いとスクロールしないと見えない。上に置くかは利用状況を見て判断する。

実装時に計画の下書きから変えた点（2026-10-29）:

- AC-2: 入力前の候補（お気に入り・最近・主要画面）と件数の上限、未保存入力の確認を明記した。
- AC-3: 個人情報の判定に `filing_payroll_` を足した。「読めない記録」を、entity の権限を失った場合（表示しない）と個別の記録が読めない場合（開いたときに権限エラー）に分けた。
- AC-4: ボタンを現在位置に置き、画面そのものを開いているときだけ出すことにした（新規・詳細画面では出さない）。上限 20 を決めた。
- AC-6: 節（アンカー）への対応、`VITE_MANUAL_URL` の検証規則、entity 画面の既定の章を決めた。同じ回の `/inbox`（C3）と `/finance/close`（C4）の対応を先に入れた。
- AC-7: お気に入りの保存失敗は通知だけ出すことにした（押しても何も起きないように見えるのを避ける）。
- 保存の部品は `analytics-storage.ts` を直接使わず、同じキーの形の小さな `assist-storage.ts` にした（保存分析は厳密な検証と Web Locks を前提にしており、最近の記録には重い）。

レビュー後の修正で変えた点（2026-10-30、[作業記録](../log/2026-10-29-navigation-assist.md)の「レビュー後の修正」）:

- AC-1: ショートカットを端末の修飾キー 1 つに限った（macOS で `Ctrl+K` を奪わない）。
- AC-2: 入力前の主要画面を「定義順の先頭 8 件」（人事・労務の 5 画面が先に並ぶ）から「分野ごとに 1 画面ずつ巡る」に変えた。読込中・読込失敗・候補なしの文言を分けた。
- AC-3: 明示的なログアウトで表示名を消す。マスクされた表示項目の名前を表示しない（表示名の出どころを保存）。
- AC-6: 正式な配布物でも基点を指定できるようにした（`--manual-url`。既定は配布物の commit に固定し、古い配布物が新しい `main` の章へ飛ばないようにした）。日本語だけのマニュアルであることをリンクに示した。
